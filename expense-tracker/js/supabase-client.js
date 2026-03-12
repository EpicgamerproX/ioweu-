import { APP_CONFIG, validateConfig } from "./config.js";

validateConfig();

const { createClient } = window.supabase;

export const supabase = createClient(APP_CONFIG.SUPABASE_URL, APP_CONFIG.SUPABASE_ANON_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false
  }
});

async function unwrapSingle(query, fallbackMessage) {
  const { data, error } = await query;
  if (error) {
    throw new Error(error.message || fallbackMessage);
  }

  return data;
}

export async function loginMember(name, passcode) {
  const payload = { member_name: name.trim(), member_passcode: passcode };
  const data = await unwrapSingle(
    supabase.rpc("login_member", payload),
    "Unable to log in."
  );

  if (!data || !data.member_id) {
    throw new Error("Invalid name or passcode.");
  }

  return data;
}

export async function signUpMember({ name, passcode, groupName, currency }) {
  const payload = {
    member_name: name.trim(),
    member_passcode: passcode,
    initial_group_name: groupName.trim(),
    preferred_currency: currency.trim().toUpperCase()
  };

  const data = await unwrapSingle(
    supabase.rpc("signup_member_with_group", payload),
    "Unable to create account."
  );

  if (!data || !data.member_id) {
    throw new Error("Signup did not return a member profile.");
  }

  return data;
}

export async function fetchGroupsForMember(sessionToken) {
  const data = await unwrapSingle(
    supabase.rpc("get_member_groups", {
      session_token_input: sessionToken
    }),
    "Unable to load groups."
  );

  return (data || []).map((row) => ({
    id: row.group_id,
    name: row.group_name,
    currency_code: row.currency_code || APP_CONFIG.defaultCurrency
  }));
}

export async function createGroupForMember({ sessionToken, groupName, currencyCode }) {
  const data = await unwrapSingle(
    supabase.rpc("create_group_for_member", {
      session_token_input: sessionToken,
      new_group_name: groupName.trim(),
      preferred_currency: currencyCode.trim().toUpperCase()
    }),
    "Unable to create group."
  );

  return data;
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

export async function createExpense(sessionToken, payload) {
  const data = await unwrapSingle(
    supabase.rpc("create_group_expense", {
      session_token_input: sessionToken,
      expense_payload: payload
    }),
    "Unable to create expense."
  );

  return data;
}

export async function deleteExpense(sessionToken, expenseId) {
  const data = await unwrapSingle(
    supabase.rpc("delete_group_expense", {
      session_token_input: sessionToken,
      expense_id_input: expenseId,
    }),
    "Unable to delete expense."
  );

  return data;
}
