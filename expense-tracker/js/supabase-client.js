import { APP_CONFIG, validateConfig } from "./config.js";

validateConfig();

const { createClient } = window.supabase;

export const supabase = createClient(APP_CONFIG.supabaseUrl, APP_CONFIG.supabaseAnonKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false
  }
});

const ROOM_EVENT_NAME = "room_event";

async function unwrapSingle(query, fallbackMessage) {
  const { data, error } = await query;
  if (error) {
    throw new Error(error.message || fallbackMessage);
  }

  return data;
}

function normalizeGroup(group) {
  if (!group) {
    return {
      id: null,
      name: "",
      room_key: "",
      currency_code: APP_CONFIG.defaultCurrency
    };
  }

  return {
    id: group.group_id || group.id || group.default_group_id || null,
    name: group.group_name || group.name || "Unnamed room",
    room_key: group.room_key || group.roomKey || group.default_room_key || "",
    currency_code: group.currency_code || group.currencyCode || APP_CONFIG.defaultCurrency,
    roomId: group.roomId || group.room_id || group.room_key || group.roomKey || "",
    inviteUrl: group.inviteUrl || group.invite_url || ""
  };
}

function normalizeDeleteVoteStatus(status) {
  return {
    group_id: status?.group_id || null,
    deleted: Boolean(status?.deleted),
    active_member_count: Number(status?.active_member_count || 0),
    approval_count: Number(status?.approval_count || 0),
    all_approved: Boolean(status?.all_approved),
    members: (status?.members || []).map((member) => ({
      member_id: member.member_id,
      display_name: member.display_name || "Unknown",
      approved: Boolean(member.approved)
    }))
  };
}

function getRoomChannelName(groupId) {
  return `room:${groupId}`;
}

function waitForChannelSubscribed(channel) {
  return new Promise((resolve, reject) => {
    channel.subscribe((status, error) => {
      if (status === "SUBSCRIBED") {
        resolve();
        return;
      }

      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || error) {
        reject(error || new Error("Unable to subscribe to realtime room channel."));
      }
    });
  });
}

export async function loginMember(email, password) {
  const data = await unwrapSingle(
    supabase.rpc("login_member", {
      member_email: email.trim(),
      member_password: password
    }),
    "Unable to log in."
  );

  if (!data || !data.member_id) {
    throw new Error("Invalid email or password.");
  }

  return data;
}

export async function signUpMember({ displayName, email, password, currency }) {
  const data = await unwrapSingle(
    supabase.rpc("signup_member", {
      member_display_name: displayName.trim(),
      member_email: email.trim(),
      member_password: password,
      preferred_currency: currency.trim().toUpperCase()
    }),
    "Unable to create account."
  );

  if (!data || !data.member_id) {
    throw new Error("Signup did not return a member profile.");
  }

  return data;
}

export async function createGroupForMember(sessionToken, { roomName, roomKey, currency }) {
  const data = await unwrapSingle(
    supabase.rpc("create_group_for_member", {
      session_token_input: sessionToken,
      new_group_name: roomName.trim(),
      room_key_input: roomKey.trim().toUpperCase(),
      app_base_url_input: APP_CONFIG.appBaseUrl,
      preferred_currency_input: (currency || "").trim().toUpperCase()
    }),
    "Unable to create room."
  );

  return normalizeGroup(data);
}

export async function fetchGroupsForMember(sessionToken) {
  const data = await unwrapSingle(
    supabase.rpc("get_member_groups", {
      session_token_input: sessionToken
    }),
    "Unable to load rooms."
  );

  return (data || []).map(normalizeGroup);
}

export async function joinGroupByRoomKey(sessionToken, roomKey) {
  const data = await unwrapSingle(
    supabase.rpc("join_group_by_room_key", {
      session_token_input: sessionToken,
      room_key_input: roomKey.trim().toUpperCase()
    }),
    "Unable to join room."
  );

  return normalizeGroup(data);
}

export async function fetchGroupMembers(sessionToken, groupId) {
  const data = await unwrapSingle(
    supabase.rpc("get_group_members", {
      session_token_input: sessionToken,
      group_id_input: groupId
    }),
    "Unable to load members."
  );

  return (data || []).map((row) => ({
    id: row.member_id,
    display_name: row.display_name,
    email: row.email,
    preferred_currency: row.preferred_currency || APP_CONFIG.defaultCurrency
  }));
}

export async function fetchExpenses(sessionToken, groupId) {
  const data = await unwrapSingle(
    supabase.rpc("get_group_expenses", {
      session_token_input: sessionToken,
      group_id_input: groupId
    }),
    "Unable to load expenses."
  );

  return (data || []).map((expense) => ({
    id: expense.id,
    title: expense.title,
    amount: Number(expense.amount || 0),
    currency_code: expense.currency_code || APP_CONFIG.defaultCurrency,
    expense_date: expense.expense_date,
    paid_by_member_id: expense.paid_by_member_id,
    created_by_member_id: expense.created_by_member_id,
    paid_by_name: expense.paid_by_name || "Unknown",
    shares: (expense.shares || []).map((share) => ({
      member_id: share.member_id,
      member_name: share.member_name || "Unknown",
      owed_amount: Number(share.owed_amount || 0)
    }))
  }));
}

export async function fetchSettlements(sessionToken, groupId) {
  const data = await unwrapSingle(
    supabase.rpc("get_group_settlements", {
      session_token_input: sessionToken,
      group_id_input: groupId
    }),
    "Unable to load settlements."
  );

  return (data || []).map((settlement) => ({
    id: settlement.id,
    group_id: settlement.group_id,
    from_member_id: settlement.from_member_id,
    to_member_id: settlement.to_member_id,
    amount: Number(settlement.amount || 0),
    paid_at: settlement.paid_at,
    created_at: settlement.created_at,
    created_by_member_id: settlement.created_by_member_id,
    note: settlement.note || "",
    from_member_name: settlement.from_member_name || "Unknown",
    to_member_name: settlement.to_member_name || "Unknown"
  }));
}

export async function createExpense(sessionToken, payload) {
  return unwrapSingle(
    supabase.rpc("create_group_expense", {
      session_token_input: sessionToken,
      expense_payload: payload
    }),
    "Unable to create expense."
  );
}

export async function createSettlement(sessionToken, payload) {
  return unwrapSingle(
    supabase.rpc("record_group_settlement", {
      session_token_input: sessionToken,
      settlement_payload: payload
    }),
    "Unable to record settlement."
  );
}

export async function deleteExpense(sessionToken, expenseId) {
  return unwrapSingle(
    supabase.rpc("delete_group_expense", {
      session_token_input: sessionToken,
      expense_id_input: expenseId
    }),
    "Unable to delete expense."
  );
}

export async function leaveGroup(sessionToken, groupId) {
  return unwrapSingle(
    supabase.rpc("leave_group", {
      session_token_input: sessionToken,
      group_id_input: groupId
    }),
    "Unable to exit room."
  );
}

export async function fetchGroupDeleteVoteStatus(sessionToken, groupId) {
  const data = await unwrapSingle(
    supabase.rpc("get_group_delete_vote_status", {
      session_token_input: sessionToken,
      group_id_input: groupId
    }),
    "Unable to load delete vote."
  );

  return normalizeDeleteVoteStatus(data);
}

export async function castGroupDeleteVote(sessionToken, groupId) {
  const data = await unwrapSingle(
    supabase.rpc("cast_group_delete_vote", {
      session_token_input: sessionToken,
      group_id_input: groupId
    }),
    "Unable to record delete vote."
  );

  return normalizeDeleteVoteStatus(data);
}

export function subscribeToRoomEvents(groupId, onEvent) {
  const channel = supabase
    .channel(getRoomChannelName(groupId), {
      config: {
        broadcast: {
          self: true
        }
      }
    })
    .on("broadcast", { event: ROOM_EVENT_NAME }, ({ payload }) => {
      onEvent(payload);
    });

  void waitForChannelSubscribed(channel).catch((error) => {
    console.error(error);
  });
  return channel;
}

export async function unsubscribeFromRoomEvents(channel) {
  if (!channel) {
    return;
  }

  await supabase.removeChannel(channel);
}

export async function broadcastRoomEvent(groupId, type, payload = {}) {
  const channel = supabase.channel(getRoomChannelName(groupId), {
    config: {
      broadcast: {
        self: true
      }
    }
  });

  try {
    await waitForChannelSubscribed(channel);
    await channel.send({
      type: "broadcast",
      event: ROOM_EVENT_NAME,
      payload: {
        ...payload,
        groupId,
        type
      }
    });
  } finally {
    await supabase.removeChannel(channel);
  }
}
