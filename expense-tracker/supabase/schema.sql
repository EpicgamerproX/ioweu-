create extension if not exists pgcrypto;

create table if not exists public.members (
  id uuid primary key default gen_random_uuid(),
  display_name text not null unique,
  passcode_hash text not null,
  preferred_currency text not null default 'INR',
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.member_sessions (
  token uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members(id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  expires_at timestamptz not null default timezone('utc', now()) + interval '30 days'
);

create table if not exists public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  currency_code text not null default 'INR',
  created_by_member_id uuid not null references public.members(id),
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.group_members (
  group_id uuid not null references public.groups(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  is_active boolean not null default true,
  joined_at timestamptz not null default timezone('utc', now()),
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

alter table public.members enable row level security;
alter table public.member_sessions enable row level security;
alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.expenses enable row level security;
alter table public.expense_shares enable row level security;

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

create or replace function public.login_member(member_name text, member_passcode text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  matched_member public.members%rowtype;
  session_token uuid;
begin
  select *
  into matched_member
  from public.members
  where lower(display_name) = lower(trim(member_name))
    and is_active = true;

  if matched_member.id is null then
    return null;
  end if;

  if matched_member.passcode_hash <> extensions.crypt(member_passcode, matched_member.passcode_hash) then
    return null;
  end if;

  session_token := public.create_session(matched_member.id);

  return jsonb_build_object(
    'member_id', matched_member.id,
    'display_name', matched_member.display_name,
    'preferred_currency', matched_member.preferred_currency,
    'session_token', session_token
  );
end;
$$;

create or replace function public.signup_member_with_group(
  member_name text,
  member_passcode text,
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
  session_token uuid;
  normalized_currency text := upper(coalesce(nullif(trim(preferred_currency), ''), 'INR'));
begin
  insert into public.members (display_name, passcode_hash, preferred_currency)
  values (
    trim(member_name),
    extensions.crypt(member_passcode, extensions.gen_salt('bf')),
    normalized_currency
  )
  returning id into new_member_id;

  insert into public.groups (name, currency_code, created_by_member_id)
  values (trim(initial_group_name), normalized_currency, new_member_id)
  returning id into new_group_id;

  insert into public.group_members (group_id, member_id)
  values (new_group_id, new_member_id);

  session_token := public.create_session(new_member_id);

  return jsonb_build_object(
    'member_id', new_member_id,
    'display_name', trim(member_name),
    'preferred_currency', normalized_currency,
    'default_group_id', new_group_id,
    'session_token', session_token
  );
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

create or replace function public.create_group_for_member(
  session_token_input uuid,
  new_group_name text,
  preferred_currency text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_member_id uuid;
  new_group_id uuid;
  normalized_currency text := upper(coalesce(nullif(trim(preferred_currency), ''), 'INR'));
begin
  current_member_id := public.require_valid_session(session_token_input);

  insert into public.groups (name, currency_code, created_by_member_id)
  values (trim(new_group_name), normalized_currency, current_member_id)
  returning id into new_group_id;

  insert into public.group_members (group_id, member_id)
  values (new_group_id, current_member_id);

  return jsonb_build_object(
    'group_id', new_group_id,
    'group_name', trim(new_group_name),
    'currency_code', normalized_currency
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
  is_member boolean;
begin
  current_member_id := public.require_valid_session(session_token_input);

  select exists(
    select 1
    from public.group_members
    where group_id = group_id_input
      and member_id = current_member_id
      and is_active = true
  )
  into is_member;

  if not is_member then
    raise exception 'You do not belong to this group';
  end if;

  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'member_id', m.id,
        'display_name', m.display_name,
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
  is_member boolean;
begin
  current_member_id := public.require_valid_session(session_token_input);

  select exists(
    select 1
    from public.group_members
    where group_id = group_id_input
      and member_id = current_member_id
      and is_active = true
  )
  into is_member;

  if not is_member then
    raise exception 'You do not belong to this group';
  end if;

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
  is_member boolean;
  participant_member_id uuid;
begin
  current_member_id := public.require_valid_session(session_token_input);

  select exists(
    select 1
    from public.group_members
    where group_id = target_group_id
      and member_id = current_member_id
      and is_active = true
  )
  into is_member;

  if not is_member then
    raise exception 'You do not belong to this group';
  end if;

  select exists(
    select 1
    from public.group_members
    where group_id = target_group_id
      and member_id = paid_by_member
      and is_active = true
  )
  into is_member;

  if not is_member then
    raise exception 'Payer must belong to the active group';
  end if;

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

      select exists(
        select 1
        from public.group_members
        where group_id = target_group_id
          and member_id = participant_member_id
          and is_active = true
      )
      into is_member;

      if not is_member then
        raise exception 'Each participant must belong to the active group';
      end if;

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

      select exists(
        select 1
        from public.group_members
        where group_id = target_group_id
          and member_id = participant_member_id
          and is_active = true
      )
      into is_member;

      if not is_member then
        raise exception 'Each participant must belong to the active group';
      end if;

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
