create extension if not exists pgcrypto;

create table if not exists public.members (
  id uuid primary key default gen_random_uuid(),
  display_name text not null unique,
  email text not null,
  password_hash text not null,
  preferred_currency text not null default 'INR',
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now())
);

alter table public.members add column if not exists email text;
alter table public.members add column if not exists password_hash text;
alter table public.members add column if not exists preferred_currency text not null default 'INR';
alter table public.members add column if not exists is_active boolean not null default true;
alter table public.members add column if not exists created_at timestamptz not null default timezone('utc', now());

create unique index if not exists members_email_lower_idx
  on public.members (lower(email));

create table if not exists public.member_sessions (
  token uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members(id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  expires_at timestamptz not null default timezone('utc', now()) + interval '30 days'
);

create table if not exists public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  room_key text not null,
  currency_code text not null default 'INR',
  created_by_member_id uuid not null references public.members(id),
  created_at timestamptz not null default timezone('utc', now())
);

alter table public.groups add column if not exists room_key text;
alter table public.groups add column if not exists currency_code text not null default 'INR';
alter table public.groups add column if not exists created_at timestamptz not null default timezone('utc', now());

create unique index if not exists groups_room_key_idx
  on public.groups (room_key);

create table if not exists public.group_members (
  group_id uuid not null references public.groups(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  is_active boolean not null default true,
  joined_at timestamptz not null default timezone('utc', now()),
  primary key (group_id, member_id)
);

create table if not exists public.group_delete_votes (
  group_id uuid not null references public.groups(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  approved_at timestamptz not null default timezone('utc', now()),
  primary key (group_id, member_id)
);

create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  title text not null,
  amount numeric(12, 2) not null check (amount > 0),
  currency_code text not null default 'INR',
  expense_date date not null,
  paid_by_member_id uuid not null references public.members(id),
  created_by_member_id uuid not null references public.members(id),
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.expense_shares (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null references public.expenses(id) on delete cascade,
  member_id uuid not null references public.members(id),
  owed_amount numeric(12, 2) not null check (owed_amount >= 0),
  created_at timestamptz not null default timezone('utc', now()),
  unique (expense_id, member_id)
);

create table if not exists public.settlement_payments (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  from_member_id uuid not null references public.members(id),
  to_member_id uuid not null references public.members(id),
  amount numeric(12, 2) not null check (amount > 0),
  paid_at timestamptz not null,
  created_at timestamptz not null default timezone('utc', now()),
  created_by_member_id uuid not null references public.members(id),
  note text
);

alter table public.members enable row level security;
alter table public.member_sessions enable row level security;
alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.expenses enable row level security;
alter table public.expense_shares enable row level security;
alter table public.settlement_payments enable row level security;
alter table public.group_delete_votes enable row level security;

drop policy if exists no_direct_access_members on public.members;
create policy no_direct_access_members on public.members for all using (false) with check (false);

drop policy if exists no_direct_access_member_sessions on public.member_sessions;
create policy no_direct_access_member_sessions on public.member_sessions for all using (false) with check (false);

drop policy if exists no_direct_access_groups on public.groups;
create policy no_direct_access_groups on public.groups for all using (false) with check (false);

drop policy if exists no_direct_access_group_members on public.group_members;
create policy no_direct_access_group_members on public.group_members for all using (false) with check (false);

drop policy if exists no_direct_access_expenses on public.expenses;
create policy no_direct_access_expenses on public.expenses for all using (false) with check (false);

drop policy if exists no_direct_access_expense_shares on public.expense_shares;
create policy no_direct_access_expense_shares on public.expense_shares for all using (false) with check (false);

drop policy if exists no_direct_access_settlement_payments on public.settlement_payments;
create policy no_direct_access_settlement_payments on public.settlement_payments for all using (false) with check (false);

drop policy if exists no_direct_access_group_delete_votes on public.group_delete_votes;
create policy no_direct_access_group_delete_votes on public.group_delete_votes for all using (false) with check (false);

create or replace function public.normalize_email(input_email text)
returns text
language sql
immutable
as $$
  select lower(trim(input_email));
$$;

create or replace function public.generate_room_key()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  candidate text;
begin
  loop
    candidate := upper(substr(encode(gen_random_bytes(6), 'hex'), 1, 8));
    exit when not exists (
      select 1
      from public.groups
      where room_key = candidate
    );
  end loop;

  return candidate;
end;
$$;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'members'
      and column_name = 'passcode_hash'
  ) then
    execute '
      update public.members
      set password_hash = coalesce(password_hash, passcode_hash)
      where password_hash is null
    ';
  end if;
end;
$$;

update public.members
set email = coalesce(
  email,
  lower(regexp_replace(display_name, '\s+', '.', 'g')) || '+' || substr(id::text, 1, 8) || '@legacy.local'
)
where email is null;

alter table public.members alter column email set not null;
alter table public.members alter column password_hash set not null;

update public.groups
set room_key = public.generate_room_key()
where room_key is null or btrim(room_key) = '';

alter table public.groups alter column room_key set not null;

create or replace function public.create_session(member_id_input uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  session_token uuid;
begin
  delete from public.member_sessions
  where member_id = member_id_input
    and expires_at < timezone('utc', now());

  insert into public.member_sessions (member_id)
  values (member_id_input)
  returning token into session_token;

  return session_token;
end;
$$;

create or replace function public.require_valid_session(session_token_input uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  resolved_member_id uuid;
begin
  select member_id
  into resolved_member_id
  from public.member_sessions
  where token = session_token_input
    and expires_at > timezone('utc', now());

  if resolved_member_id is null then
    raise exception 'Session expired or invalid';
  end if;

  return resolved_member_id;
end;
$$;

create or replace function public.require_group_membership(group_id_input uuid, member_id_input uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.group_members
    where group_id = group_id_input
      and member_id = member_id_input
      and is_active = true
  ) then
    raise exception 'You do not belong to this group';
  end if;
end;
$$;

create or replace function public.login_member(member_email text, member_password text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  matched_member public.members%rowtype;
  session_token uuid;
  normalized_email text := public.normalize_email(member_email);
begin
  select *
  into matched_member
  from public.members
  where lower(email) = normalized_email
    and is_active = true;

  if matched_member.id is null then
    return null;
  end if;

  if matched_member.password_hash <> extensions.crypt(member_password, matched_member.password_hash) then
    return null;
  end if;

  session_token := public.create_session(matched_member.id);

  return jsonb_build_object(
    'member_id', matched_member.id,
    'display_name', matched_member.display_name,
    'email', matched_member.email,
    'preferred_currency', matched_member.preferred_currency,
    'session_token', session_token
  );
end;
$$;

create or replace function public.signup_member_with_group(
  member_display_name text,
  member_email text,
  member_password text,
  initial_group_name text,
  preferred_currency text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  new_member_id uuid;
  new_group_id uuid;
  new_room_key text;
  session_token uuid;
  normalized_currency text := upper(coalesce(nullif(trim(preferred_currency), ''), 'INR'));
  normalized_email text := public.normalize_email(member_email);
begin
  if exists (
    select 1
    from public.members
    where lower(email) = normalized_email
  ) then
    raise exception 'An account with this email already exists';
  end if;

  insert into public.members (display_name, email, password_hash, preferred_currency)
  values (
    trim(member_display_name),
    normalized_email,
    extensions.crypt(member_password, extensions.gen_salt('bf')),
    normalized_currency
  )
  returning id into new_member_id;

  new_room_key := public.generate_room_key();

  insert into public.groups (name, room_key, currency_code, created_by_member_id)
  values (trim(initial_group_name), new_room_key, normalized_currency, new_member_id)
  returning id into new_group_id;

  insert into public.group_members (group_id, member_id)
  values (new_group_id, new_member_id);

  session_token := public.create_session(new_member_id);

  return jsonb_build_object(
    'member_id', new_member_id,
    'display_name', trim(member_display_name),
    'email', normalized_email,
    'preferred_currency', normalized_currency,
    'default_group_id', new_group_id,
    'default_room_key', new_room_key,
    'session_token', session_token
  );
end;
$$;

create or replace function public.signup_member(
  member_display_name text,
  member_email text,
  member_password text,
  preferred_currency text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  new_member_id uuid;
  session_token uuid;
  normalized_currency text := upper(coalesce(nullif(trim(preferred_currency), ''), 'INR'));
  normalized_email text := public.normalize_email(member_email);
begin
  if exists (
    select 1
    from public.members
    where lower(email) = normalized_email
  ) then
    raise exception 'An account with this email already exists';
  end if;

  insert into public.members (display_name, email, password_hash, preferred_currency)
  values (
    trim(member_display_name),
    normalized_email,
    extensions.crypt(member_password, extensions.gen_salt('bf')),
    normalized_currency
  )
  returning id into new_member_id;

  session_token := public.create_session(new_member_id);

  return jsonb_build_object(
    'member_id', new_member_id,
    'display_name', trim(member_display_name),
    'email', normalized_email,
    'preferred_currency', normalized_currency,
    'session_token', session_token
  );
end;
$$;

create or replace function public.create_group_for_member(
  session_token_input uuid,
  new_group_name text,
  room_key_input text,
  app_base_url_input text default null,
  preferred_currency text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_member_id uuid;
  new_group_id uuid;
  resolved_room_key text;
  resolved_currency text;
  resolved_base_url text;
begin
  current_member_id := public.require_valid_session(session_token_input);
  resolved_room_key := upper(trim(coalesce(room_key_input, '')));
  resolved_base_url := trim(coalesce(app_base_url_input, ''));

  if resolved_room_key = '' then
    raise exception 'Room key is required';
  end if;

  if char_length(resolved_room_key) < 6 then
    raise exception 'Room key must be at least 6 characters';
  end if;

  if char_length(resolved_room_key) > 12 then
    raise exception 'Room key must be 12 characters or fewer';
  end if;

  if resolved_room_key !~ '[A-Z]' then
    raise exception 'Room key must include at least 1 capital letter';
  end if;

  if resolved_room_key !~ '[0-9]' then
    raise exception 'Room key must include at least 1 number';
  end if;

  if resolved_room_key !~ '[^A-Z0-9]' then
    raise exception 'Room key must include at least 1 symbol';
  end if;

  if exists (
    select 1
    from public.groups
    where room_key = resolved_room_key
  ) then
    raise exception 'Room key is already taken';
  end if;

  resolved_currency := upper(coalesce(
    nullif(trim(preferred_currency), ''),
    (
      select preferred_currency
      from public.members
      where id = current_member_id
    ),
    'INR'
  ));

  insert into public.groups (name, room_key, currency_code, created_by_member_id)
  values (trim(new_group_name), resolved_room_key, resolved_currency, current_member_id)
  returning id into new_group_id;

  insert into public.group_members (group_id, member_id, is_active)
  values (new_group_id, current_member_id, true)
  on conflict (group_id, member_id)
  do update set
    is_active = true,
    joined_at = timezone('utc', now());

  return jsonb_build_object(
    'group_id', new_group_id,
    'group_name', trim(new_group_name),
    'room_key', resolved_room_key,
    'currency_code', resolved_currency,
    'roomId', resolved_room_key,
    'inviteUrl',
      case
        when resolved_base_url = '' then '/join/' || resolved_room_key
        else rtrim(resolved_base_url, '/') || '/join/' || resolved_room_key
      end
  );
exception
  when unique_violation then
    raise exception 'Room key is already taken';
end;
$$;

create or replace function public.get_member_groups(session_token_input uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_member_id uuid;
begin
  current_member_id := public.require_valid_session(session_token_input);

  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'group_id', g.id,
        'group_name', g.name,
        'room_key', g.room_key,
        'currency_code', g.currency_code
      )
      order by gm.joined_at asc
    )
    from public.group_members gm
    join public.groups g on g.id = gm.group_id
    where gm.member_id = current_member_id
      and gm.is_active = true
  ), '[]'::jsonb);
end;
$$;

create or replace function public.join_group_by_room_key(
  session_token_input uuid,
  room_key_input text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_member_id uuid;
  target_group public.groups%rowtype;
begin
  current_member_id := public.require_valid_session(session_token_input);

  select *
  into target_group
  from public.groups
  where room_key = upper(trim(room_key_input));

  if target_group.id is null then
    raise exception 'Room key not found';
  end if;

  insert into public.group_members (group_id, member_id, is_active)
  values (target_group.id, current_member_id, true)
  on conflict (group_id, member_id)
  do update set
    is_active = true,
    joined_at = timezone('utc', now());

  return jsonb_build_object(
    'group_id', target_group.id,
    'group_name', target_group.name,
    'room_key', target_group.room_key,
    'currency_code', target_group.currency_code
  );
end;
$$;

create or replace function public.get_group_members(session_token_input uuid, group_id_input uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_member_id uuid;
begin
  current_member_id := public.require_valid_session(session_token_input);
  perform public.require_group_membership(group_id_input, current_member_id);

  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'member_id', m.id,
        'display_name', m.display_name,
        'email', m.email,
        'preferred_currency', m.preferred_currency
      )
      order by gm.joined_at asc
    )
    from public.group_members gm
    join public.members m on m.id = gm.member_id
    where gm.group_id = group_id_input
      and gm.is_active = true
  ), '[]'::jsonb);
end;
$$;

create or replace function public.get_group_expenses(session_token_input uuid, group_id_input uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_member_id uuid;
begin
  current_member_id := public.require_valid_session(session_token_input);
  perform public.require_group_membership(group_id_input, current_member_id);

  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'id', e.id,
        'title', e.title,
        'amount', e.amount,
        'currency_code', e.currency_code,
        'expense_date', e.expense_date,
        'paid_by_member_id', e.paid_by_member_id,
        'created_by_member_id', e.created_by_member_id,
        'paid_by_name', payer.display_name,
        'shares', coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'member_id', es.member_id,
              'member_name', debtor.display_name,
              'owed_amount', es.owed_amount
            )
            order by debtor.display_name asc
          )
          from public.expense_shares es
          join public.members debtor on debtor.id = es.member_id
          where es.expense_id = e.id
        ), '[]'::jsonb)
      )
      order by e.expense_date desc, e.created_at desc
    )
    from public.expenses e
    join public.members payer on payer.id = e.paid_by_member_id
    where e.group_id = group_id_input
  ), '[]'::jsonb);
end;
$$;

create or replace function public.get_group_settlements(session_token_input uuid, group_id_input uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_member_id uuid;
begin
  current_member_id := public.require_valid_session(session_token_input);
  perform public.require_group_membership(group_id_input, current_member_id);

  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'id', sp.id,
        'group_id', sp.group_id,
        'from_member_id', sp.from_member_id,
        'to_member_id', sp.to_member_id,
        'amount', sp.amount,
        'paid_at', sp.paid_at,
        'created_at', sp.created_at,
        'created_by_member_id', sp.created_by_member_id,
        'note', sp.note,
        'from_member_name', debtor.display_name,
        'to_member_name', creditor.display_name
      )
      order by sp.paid_at desc, sp.created_at desc
    )
    from public.settlement_payments sp
    join public.members debtor on debtor.id = sp.from_member_id
    join public.members creditor on creditor.id = sp.to_member_id
    where sp.group_id = group_id_input
  ), '[]'::jsonb);
end;
$$;

create or replace function public.record_group_settlement(session_token_input uuid, settlement_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_member_id uuid;
  target_group_id uuid := (settlement_payload ->> 'group_id')::uuid;
  to_member uuid := (settlement_payload ->> 'to_member_id')::uuid;
  amount_value numeric(12, 2) := round((settlement_payload ->> 'amount')::numeric, 2);
  settlement_id uuid;
begin
  current_member_id := public.require_valid_session(session_token_input);
  perform public.require_group_membership(target_group_id, current_member_id);
  perform public.require_group_membership(target_group_id, to_member);

  if current_member_id = to_member then
    raise exception 'You cannot pay yourself';
  end if;

  insert into public.settlement_payments (
    group_id,
    from_member_id,
    to_member_id,
    amount,
    paid_at,
    created_by_member_id,
    note
  )
  values (
    target_group_id,
    current_member_id,
    to_member,
    amount_value,
    coalesce((settlement_payload ->> 'paid_at')::timestamptz, timezone('utc', now())),
    current_member_id,
    nullif(trim(coalesce(settlement_payload ->> 'note', '')), '')
  )
  returning id into settlement_id;

  return jsonb_build_object('settlement_id', settlement_id);
end;
$$;

create or replace function public.create_group_expense(session_token_input uuid, expense_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_member_id uuid;
  expense_id_created uuid;
  target_group_id uuid := (expense_payload ->> 'group_id')::uuid;
  paid_by_member uuid := (expense_payload ->> 'paid_by_member_id')::uuid;
  total_amount numeric(12, 2) := round((expense_payload ->> 'amount')::numeric, 2);
  split_mode text := expense_payload ->> 'split_mode';
  participant_id_text text;
  custom_share jsonb;
  participant_count integer;
  equal_share numeric(12, 2);
  adjusted_share numeric(12, 2);
  running_total numeric(12, 2) := 0;
  participant_index integer := 0;
  custom_total numeric(12, 2) := 0;
  participant_member_id uuid;
begin
  current_member_id := public.require_valid_session(session_token_input);
  perform public.require_group_membership(target_group_id, current_member_id);
  perform public.require_group_membership(target_group_id, paid_by_member);

  insert into public.expenses (
    group_id,
    title,
    amount,
    currency_code,
    expense_date,
    paid_by_member_id,
    created_by_member_id
  )
  values (
    target_group_id,
    trim(expense_payload ->> 'title'),
    total_amount,
    coalesce(nullif(expense_payload ->> 'currency_code', ''), 'INR'),
    (expense_payload ->> 'expense_date')::date,
    paid_by_member,
    current_member_id
  )
  returning id into expense_id_created;

  if split_mode = 'custom' then
    for custom_share in
      select value
      from jsonb_array_elements(coalesce(expense_payload -> 'custom_shares', '[]'::jsonb))
    loop
      participant_member_id := (custom_share ->> 'member_id')::uuid;
      perform public.require_group_membership(target_group_id, participant_member_id);

      custom_total := custom_total + round((custom_share ->> 'owed_amount')::numeric, 2);

      insert into public.expense_shares (expense_id, member_id, owed_amount)
      values (
        expense_id_created,
        participant_member_id,
        round((custom_share ->> 'owed_amount')::numeric, 2)
      );
    end loop;

    if custom_total <> total_amount then
      raise exception 'Custom shares must add up to the full expense amount';
    end if;
  else
    participant_count := jsonb_array_length(coalesce(expense_payload -> 'participant_ids', '[]'::jsonb));
    if participant_count = 0 then
      raise exception 'At least one participant is required';
    end if;

    equal_share := round(total_amount / participant_count, 2);

    for participant_id_text in
      select jsonb_array_elements_text(expense_payload -> 'participant_ids')
    loop
      participant_member_id := participant_id_text::uuid;
      participant_index := participant_index + 1;

      perform public.require_group_membership(target_group_id, participant_member_id);

      adjusted_share := case
        when participant_index = participant_count then round(total_amount - running_total, 2)
        else equal_share
      end;

      insert into public.expense_shares (expense_id, member_id, owed_amount)
      values (expense_id_created, participant_member_id, adjusted_share);

      running_total := running_total + adjusted_share;
    end loop;
  end if;

  return jsonb_build_object('expense_id', expense_id_created);
exception
  when others then
    if expense_id_created is not null then
      delete from public.expenses where id = expense_id_created;
    end if;
    raise;
end;
$$;

create or replace function public.delete_group_expense(session_token_input uuid, expense_id_input uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_member_id uuid;
  expense_owner uuid;
begin
  current_member_id := public.require_valid_session(session_token_input);

  select created_by_member_id
  into expense_owner
  from public.expenses
  where id = expense_id_input;

  if expense_owner is null then
    raise exception 'Expense not found';
  end if;

  if expense_owner <> current_member_id then
    raise exception 'You can only delete expenses you created';
  end if;

  delete from public.expenses
  where id = expense_id_input;

  return jsonb_build_object('deleted', true);
end;
$$;

create or replace function public.get_group_delete_vote_status(session_token_input uuid, group_id_input uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_member_id uuid;
  active_member_count integer;
  approval_count integer;
begin
  current_member_id := public.require_valid_session(session_token_input);
  perform public.require_group_membership(group_id_input, current_member_id);

  select count(*)
  into active_member_count
  from public.group_members
  where group_id = group_id_input
    and is_active = true;

  select count(*)
  into approval_count
  from public.group_delete_votes gdv
  join public.group_members gm
    on gm.group_id = gdv.group_id
   and gm.member_id = gdv.member_id
  where gdv.group_id = group_id_input
    and gm.is_active = true;

  return jsonb_build_object(
    'group_id', group_id_input,
    'deleted', false,
    'active_member_count', active_member_count,
    'approval_count', approval_count,
    'all_approved', active_member_count > 0 and approval_count = active_member_count,
    'members', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'member_id', m.id,
          'display_name', m.display_name,
          'approved', gdv.member_id is not null
        )
        order by gm.joined_at asc
      )
      from public.group_members gm
      join public.members m on m.id = gm.member_id
      left join public.group_delete_votes gdv
        on gdv.group_id = gm.group_id
       and gdv.member_id = gm.member_id
      where gm.group_id = group_id_input
        and gm.is_active = true
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.leave_group(session_token_input uuid, group_id_input uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_member_id uuid;
  active_member_count integer;
begin
  current_member_id := public.require_valid_session(session_token_input);
  perform public.require_group_membership(group_id_input, current_member_id);

  update public.group_members
  set is_active = false
  where group_id = group_id_input
    and member_id = current_member_id;

  delete from public.group_delete_votes
  where group_id = group_id_input
    and member_id = current_member_id;

  select count(*)
  into active_member_count
  from public.group_members
  where group_id = group_id_input
    and is_active = true;

  if active_member_count = 0 then
    delete from public.groups
    where id = group_id_input;

    return jsonb_build_object('deleted', true);
  end if;

  if exists (
    select 1
    from public.group_members gm
    where gm.group_id = group_id_input
      and gm.is_active = true
      and not exists (
        select 1
        from public.group_delete_votes gdv
        where gdv.group_id = gm.group_id
          and gdv.member_id = gm.member_id
      )
  ) then
    return jsonb_build_object('deleted', false);
  end if;

  delete from public.groups
  where id = group_id_input;

  return jsonb_build_object('deleted', true);
end;
$$;

create or replace function public.cast_group_delete_vote(session_token_input uuid, group_id_input uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_member_id uuid;
  active_member_count integer;
  approval_count integer;
begin
  current_member_id := public.require_valid_session(session_token_input);
  perform public.require_group_membership(group_id_input, current_member_id);

  insert into public.group_delete_votes (group_id, member_id)
  values (group_id_input, current_member_id)
  on conflict (group_id, member_id)
  do update set approved_at = excluded.approved_at;

  select count(*)
  into active_member_count
  from public.group_members
  where group_id = group_id_input
    and is_active = true;

  select count(*)
  into approval_count
  from public.group_delete_votes gdv
  join public.group_members gm
    on gm.group_id = gdv.group_id
   and gm.member_id = gdv.member_id
  where gdv.group_id = group_id_input
    and gm.is_active = true;

  if active_member_count > 0 and approval_count = active_member_count then
    delete from public.groups
    where id = group_id_input;

    return jsonb_build_object(
      'group_id', group_id_input,
      'deleted', true,
      'active_member_count', active_member_count,
      'approval_count', approval_count,
      'all_approved', true,
      'members', '[]'::jsonb
    );
  end if;

  return public.get_group_delete_vote_status(session_token_input, group_id_input);
end;
$$;
