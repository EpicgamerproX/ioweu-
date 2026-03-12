import { APP_CONFIG } from "./config.js";
import {
  createExpense,
  createGroupForMember,
  deleteExpense,
  fetchExpenses,
  fetchGroupMembers,
  fetchGroupsForMember,
  loginMember,
  signUpMember
} from "./supabase-client.js";

const state = {
  currentMember: null,
  availableGroups: [],
  activeGroupId: null,
  groupMembers: [],
  balances: [],
  expenses: [],
  summary: null
};

const elements = {
  authPanel: document.querySelector("#auth-panel"),
  workspacePanel: document.querySelector("#workspace-panel"),
  authStatus: document.querySelector("#auth-status"),
  expenseStatus: document.querySelector("#expense-status"),
  loginForm: document.querySelector("#login-form"),
  signupForm: document.querySelector("#signup-form"),
  groupSelect: document.querySelector("#group-select"),
  joinGroupForm: document.querySelector("#join-group-form"),
  welcomeTitle: document.querySelector("#welcome-title"),
  owedToYou: document.querySelector("#owed-to-you"),
  youOwe: document.querySelector("#you-owe"),
  netBalance: document.querySelector("#net-balance"),
  totalSpent: document.querySelector("#total-spent"),
  equivalentGrid: document.querySelector("#equivalent-grid"),
  balancesTableBody: document.querySelector("#balances-table-body"),
  paidBySelect: document.querySelector("#paid-by-select"),
  participantsList: document.querySelector("#participants-list"),
  customShareBox: document.querySelector("#custom-share-box"),
  customShareList: document.querySelector("#custom-share-list"),
  expenseForm: document.querySelector("#expense-form"),
  expenseHistory: document.querySelector("#expense-history"),
  splitMode: document.querySelector("#split-mode"),
  logoutButton: document.querySelector("#logout-button"),
  tabButtons: document.querySelectorAll(".tabs__button"),
  tabPanels: document.querySelectorAll(".tab-panel")
};

function init() {
  bindEvents();
  setDefaultDate();
  restoreSession();
}

function bindEvents() {
  elements.loginForm.addEventListener("submit", handleLogin);
  elements.signupForm.addEventListener("submit", handleSignup);
  elements.groupSelect.addEventListener("change", handleGroupChange);
  elements.joinGroupForm.addEventListener("submit", handleCreateGroup);
  elements.expenseForm.addEventListener("submit", handleCreateExpense);
  elements.splitMode.addEventListener("change", renderCustomShareInputs);
  elements.logoutButton.addEventListener("click", handleLogout);
  elements.tabButtons.forEach((button) => {
    button.addEventListener("click", () => activateTab(button.dataset.tabTarget));
  });
}

function activateTab(targetId) {
  elements.tabButtons.forEach((button) => {
    const active = button.dataset.tabTarget === targetId;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", String(active));
  });

  elements.tabPanels.forEach((panel) => {
    const active = panel.id === targetId;
    panel.classList.toggle("is-active", active);
    panel.hidden = !active;
  });
}

function setDefaultDate() {
  elements.expenseForm.querySelector("#expense-date").value = new Date().toISOString().split("T")[0];
}

function saveSession() {
  if (!state.currentMember) {
    return;
  }

  const payload = {
    currentMember: state.currentMember,
    activeGroupId: state.activeGroupId
  };

  localStorage.setItem(APP_CONFIG.sessionStorageKey, JSON.stringify(payload));
}

function restoreSession() {
  try {
    const raw = localStorage.getItem(APP_CONFIG.sessionStorageKey);
    if (!raw) {
      return;
    }

    const saved = JSON.parse(raw);
    if (!saved.currentMember?.id) {
      return;
    }

    state.currentMember = saved.currentMember;
    state.activeGroupId = saved.activeGroupId || null;
    void bootstrapWorkspace();
  } catch (error) {
    console.error(error);
    localStorage.removeItem(APP_CONFIG.sessionStorageKey);
  }
}

function clearSession() {
  localStorage.removeItem(APP_CONFIG.sessionStorageKey);
}

async function handleLogin(event) {
  event.preventDefault();
  setStatus(elements.authStatus, "Checking your credentials...");

  const formData = new FormData(event.currentTarget);

  try {
    const member = await loginMember(formData.get("name"), formData.get("passcode"));
    state.currentMember = normalizeMember(member);
    await bootstrapWorkspace();
    event.currentTarget.reset();
    setStatus(elements.authStatus, "");
  } catch (error) {
    setStatus(elements.authStatus, error.message || "Login failed.");
  }
}

async function handleSignup(event) {
  event.preventDefault();
  setStatus(elements.authStatus, "Creating your profile...");

  const formData = new FormData(event.currentTarget);

  try {
    const member = await signUpMember({
      name: formData.get("name"),
      passcode: formData.get("passcode"),
      groupName: formData.get("groupName"),
      currency: formData.get("currency")
    });
    state.currentMember = normalizeMember(member);
    state.activeGroupId = member.default_group_id || null;
    await bootstrapWorkspace();
    event.currentTarget.reset();
    activateTab("login-view");
    setStatus(elements.authStatus, "Profile created. You are now logged in.");
  } catch (error) {
    setStatus(elements.authStatus, error.message || "Signup failed.");
  }
}

async function bootstrapWorkspace() {
  if (!state.currentMember) {
    return;
  }

  elements.authPanel.hidden = true;
  elements.workspacePanel.hidden = false;
  elements.welcomeTitle.textContent = `${state.currentMember.display_name}'s dashboard`;

  try {
    state.availableGroups = await fetchGroupsForMember(state.currentMember.session_token);
    if (!state.availableGroups.length) {
      state.activeGroupId = null;
      renderGroups();
      renderEmptyWorkspace("You are not part of any groups yet. Create one to get started.");
      saveSession();
      return;
    }

    const selected = state.availableGroups.some((group) => group.id === state.activeGroupId)
      ? state.activeGroupId
      : state.availableGroups[0].id;

    state.activeGroupId = selected;
    renderGroups();
    await loadActiveGroupData();
    saveSession();
  } catch (error) {
    setStatus(elements.authStatus, error.message || "Unable to load workspace.");
  }
}

async function handleGroupChange(event) {
  state.activeGroupId = event.target.value;
  await loadActiveGroupData();
  saveSession();
}

async function handleCreateGroup(event) {
  event.preventDefault();
  if (!state.currentMember) {
    return;
  }

  const nameInput = document.querySelector("#join-group-name");
  const groupName = nameInput.value.trim();
  if (!groupName) {
    return;
  }

  setStatus(elements.authStatus, "");
  setStatus(elements.expenseStatus, "Creating group...");

  try {
    await createGroupForMember({
      sessionToken: state.currentMember.session_token,
      groupName,
      currencyCode: state.currentMember.preferred_currency || APP_CONFIG.defaultCurrency
    });
    nameInput.value = "";
    state.availableGroups = await fetchGroupsForMember(state.currentMember.session_token);
    state.activeGroupId = state.availableGroups[state.availableGroups.length - 1]?.id || null;
    renderGroups();
    await loadActiveGroupData();
    saveSession();
    setStatus(elements.expenseStatus, "Group created.");
  } catch (error) {
    setStatus(elements.expenseStatus, error.message || "Could not create group.");
  }
}

async function loadActiveGroupData() {
  if (!state.activeGroupId) {
    renderEmptyWorkspace("Select a group to continue.");
    return;
  }

  setStatus(elements.expenseStatus, "Loading balances and expenses...");

  try {
    const [members, expenses] = await Promise.all([
      fetchGroupMembers(state.currentMember.session_token, state.activeGroupId),
      fetchExpenses(state.currentMember.session_token, state.activeGroupId)
    ]);

    state.groupMembers = members;
    state.expenses = expenses;
    state.balances = computeBalances(expenses, members, state.currentMember.id);
    state.summary = computeSummary(expenses, state.balances, state.currentMember.id);
    renderWorkspace();
    setStatus(elements.expenseStatus, "");
  } catch (error) {
    renderEmptyWorkspace(error.message || "Unable to load group data.");
  }
}

function renderGroups() {
  const options = state.availableGroups.map((group) => {
    const selected = group.id === state.activeGroupId ? "selected" : "";
    return `<option value="${group.id}" ${selected}>${escapeHtml(group.name)}</option>`;
  });

  elements.groupSelect.innerHTML = options.join("");
}

function renderWorkspace() {
  renderSummary();
  renderFunEquivalents();
  renderBalancesTable();
  renderExpenseFormMembers();
  renderExpenseHistory();
}

function renderEmptyWorkspace(message) {
  elements.owedToYou.textContent = formatCurrency(0);
  elements.youOwe.textContent = formatCurrency(0);
  elements.netBalance.textContent = formatCurrency(0);
  elements.totalSpent.textContent = formatCurrency(0);
  elements.equivalentGrid.innerHTML = `<div class="empty-state">${escapeHtml(message)}</div>`;
  elements.balancesTableBody.innerHTML = `<tr><td colspan="3"><div class="empty-state">${escapeHtml(message)}</div></td></tr>`;
  elements.participantsList.innerHTML = `<div class="empty-state">${escapeHtml(message)}</div>`;
  elements.customShareList.innerHTML = "";
  elements.expenseHistory.innerHTML = `<div class="empty-state">${escapeHtml(message)}</div>`;
}

function renderSummary() {
  const summary = state.summary || {
    total_owed_to_you: 0,
    total_you_owe: 0,
    net_balance: 0,
    total_spent: 0
  };

  elements.owedToYou.textContent = formatCurrency(summary.total_owed_to_you);
  elements.youOwe.textContent = formatCurrency(summary.total_you_owe);
  elements.netBalance.textContent = formatCurrency(summary.net_balance);
  elements.netBalance.className = summary.net_balance >= 0 ? "amount-positive" : "amount-negative";
  elements.totalSpent.textContent = formatCurrency(summary.total_spent);
}

function renderFunEquivalents() {
  const funEquivalents = state.summary?.fun_equivalents || [];
  if (!funEquivalents.length) {
    elements.equivalentGrid.innerHTML = `<div class="empty-state">Add some expenses to unlock the fun math.</div>`;
    return;
  }

  elements.equivalentGrid.innerHTML = funEquivalents
    .map((item) => `
      <article class="equivalent-card">
        <p class="equivalent-card__label">${escapeHtml(item.label)}</p>
        <strong>${item.quantity}</strong>
      </article>
    `)
    .join("");
}

function renderBalancesTable() {
  if (!state.balances.length) {
    elements.balancesTableBody.innerHTML = `<tr><td colspan="3"><div class="empty-state">Everything is settled for this group.</div></td></tr>`;
    return;
  }

  elements.balancesTableBody.innerHTML = state.balances
    .map((row) => `
      <tr>
        <td>${escapeHtml(row.counterparty_name)}</td>
        <td>${escapeHtml(formatDirection(row.direction))}</td>
        <td class="${row.direction === "owes_you" ? "amount-positive" : row.direction === "you_owe" ? "amount-negative" : ""}">
          ${formatCurrency(row.amount)}
        </td>
      </tr>
    `)
    .join("");
}

function renderExpenseFormMembers() {
  const options = state.groupMembers
    .map((member) => {
      const selected = member.id === state.currentMember.id ? "selected" : "";
      return `<option value="${member.id}" ${selected}>${escapeHtml(member.display_name)}</option>`;
    })
    .join("");

  elements.paidBySelect.innerHTML = options;
  elements.participantsList.innerHTML = state.groupMembers
    .map((member) => `
      <label class="participant-row">
        <span>${escapeHtml(member.display_name)}</span>
        <input type="checkbox" data-member-id="${member.id}" checked>
      </label>
    `)
    .join("");

  elements.participantsList.querySelectorAll("input[type='checkbox']").forEach((input) => {
    input.addEventListener("change", renderCustomShareInputs);
  });

  renderCustomShareInputs();
}

function renderCustomShareInputs() {
  const splitMode = elements.splitMode.value;
  const selectedParticipants = getSelectedParticipantIds();

  elements.customShareBox.hidden = splitMode !== "custom";
  if (splitMode !== "custom") {
    elements.customShareList.innerHTML = "";
    return;
  }

  elements.customShareList.innerHTML = selectedParticipants
    .map((memberId) => {
      const member = state.groupMembers.find((entry) => entry.id === memberId);
      return `
        <label class="custom-share-row">
          <span>${escapeHtml(member?.display_name || "Unknown")}</span>
          <input type="number" min="0" step="0.01" data-custom-share-member-id="${memberId}" placeholder="0.00" required>
        </label>
      `;
    })
    .join("");
}

function renderExpenseHistory() {
  if (!state.expenses.length) {
    elements.expenseHistory.innerHTML = `<div class="empty-state">No expenses yet for this group.</div>`;
    return;
  }

  elements.expenseHistory.innerHTML = state.expenses
    .map((expense) => {
      const shareSummary = expense.shares
        .map((share) => `${share.member_name}: ${formatCurrency(share.owed_amount)}`)
        .join(" • ");

      const deleteButton = expense.created_by_member_id === state.currentMember.id
        ? `<div class="history-item__actions"><button type="button" data-delete-expense-id="${expense.id}">Delete expense</button></div>`
        : "";

      return `
        <article class="history-item">
          <div class="history-item__top">
            <div>
              <strong>${escapeHtml(expense.title)}</strong>
              <p class="history-item__meta">Paid by ${escapeHtml(expense.paid_by_name)} on ${escapeHtml(expense.expense_date)}</p>
            </div>
            <span class="history-item__amount">${formatCurrency(expense.amount)}</span>
          </div>
          <p class="history-item__participants">${escapeHtml(shareSummary)}</p>
          ${deleteButton}
        </article>
      `;
    })
    .join("");

  elements.expenseHistory.querySelectorAll("[data-delete-expense-id]").forEach((button) => {
    button.addEventListener("click", async () => {
      const expenseId = button.dataset.deleteExpenseId;
      await handleDeleteExpense(expenseId);
    });
  });
}

async function handleCreateExpense(event) {
  event.preventDefault();
  if (!state.currentMember || !state.activeGroupId) {
    setStatus(elements.expenseStatus, "Pick a group before adding expenses.");
    return;
  }

  const formData = new FormData(event.currentTarget);
  const participantIds = getSelectedParticipantIds();
  if (!participantIds.length) {
    setStatus(elements.expenseStatus, "Select at least one participant.");
    return;
  }

  const amount = Number(formData.get("amount"));
  const splitMode = formData.get("splitMode");
  const customShares = splitMode === "custom"
    ? getCustomShares(participantIds)
    : [];

  if (splitMode === "custom") {
    const shareTotal = customShares.reduce((total, item) => total + item.owed_amount, 0);
    if (!nearlyEqual(shareTotal, amount)) {
      setStatus(elements.expenseStatus, "Custom shares must add up exactly to the expense amount.");
      return;
    }
  }

  const payload = {
    title: String(formData.get("title")).trim(),
    amount,
    currency_code: getActiveCurrency(),
    paid_by_member_id: formData.get("paidByMemberId"),
    group_id: state.activeGroupId,
    expense_date: formData.get("expenseDate"),
    participant_ids: participantIds,
    split_mode: splitMode,
    custom_shares: customShares
  };

  try {
    setStatus(elements.expenseStatus, "Saving expense...");
    await createExpense(state.currentMember.session_token, payload);
    event.currentTarget.reset();
    setDefaultDate();
    renderExpenseFormMembers();
    await loadActiveGroupData();
    setStatus(elements.expenseStatus, "Expense saved.");
  } catch (error) {
    setStatus(elements.expenseStatus, error.message || "Could not save expense.");
  }
}

async function handleDeleteExpense(expenseId) {
  try {
    setStatus(elements.expenseStatus, "Removing expense...");
    await deleteExpense(state.currentMember.session_token, expenseId);
    await loadActiveGroupData();
    setStatus(elements.expenseStatus, "Expense deleted.");
  } catch (error) {
    setStatus(elements.expenseStatus, error.message || "Could not delete expense.");
  }
}

function handleLogout() {
  state.currentMember = null;
  state.availableGroups = [];
  state.activeGroupId = null;
  state.groupMembers = [];
  state.balances = [];
  state.expenses = [];
  state.summary = null;
  clearSession();
  elements.authPanel.hidden = false;
  elements.workspacePanel.hidden = true;
  setStatus(elements.authStatus, "Logged out.");
}

function computeBalances(expenses, members, currentMemberId) {
  const memberLookup = new Map(members.map((member) => [member.id, member.display_name]));
  const pairTotals = new Map();

  expenses.forEach((expense) => {
    expense.shares.forEach((share) => {
      if (share.member_id === expense.paid_by_member_id) {
        return;
      }

      const debtorId = String(share.member_id);
      const creditorId = String(expense.paid_by_member_id);
      const key = `${debtorId}->${creditorId}`;
      pairTotals.set(key, (pairTotals.get(key) || 0) + share.owed_amount);
    });
  });

  const counterpartyMap = new Map();

  pairTotals.forEach((amount, key) => {
    const [debtorId, creditorId] = key.split("->");
    const currentId = String(currentMemberId);

    if (debtorId !== currentId && creditorId !== currentId) {
      return;
    }

    const counterpartyId = debtorId === currentId ? creditorId : debtorId;
    const signedAmount = debtorId === currentId ? -amount : amount;
    counterpartyMap.set(counterpartyId, (counterpartyMap.get(counterpartyId) || 0) + signedAmount);
  });

  return Array.from(counterpartyMap.entries())
    .map(([memberId, signedAmount]) => ({
      counterparty_name: memberLookup.get(memberId) || "Unknown",
      direction: signedAmount > 0 ? "owes_you" : signedAmount < 0 ? "you_owe" : "settled",
      amount: Math.abs(roundCurrency(signedAmount))
    }))
    .filter((row) => row.amount > 0)
    .sort((left, right) => left.counterparty_name.localeCompare(right.counterparty_name));
}

function computeSummary(expenses, balances, currentMemberId) {
  const totalOwedToYou = balances
    .filter((row) => row.direction === "owes_you")
    .reduce((sum, row) => sum + row.amount, 0);

  const totalYouOwe = balances
    .filter((row) => row.direction === "you_owe")
    .reduce((sum, row) => sum + row.amount, 0);

  const totalSpent = expenses
    .filter((expense) => String(expense.paid_by_member_id) === String(currentMemberId))
    .reduce((sum, expense) => sum + expense.amount, 0);

  return {
    total_owed_to_you: roundCurrency(totalOwedToYou),
    total_you_owe: roundCurrency(totalYouOwe),
    net_balance: roundCurrency(totalOwedToYou - totalYouOwe),
    total_spent: roundCurrency(totalSpent),
    fun_equivalents: APP_CONFIG.comparisonItems.map((item) => ({
      label: item.label,
      quantity: `${Math.floor(totalSpent / item.price)} ${item.label}`
    }))
  };
}

function getSelectedParticipantIds() {
  return Array.from(elements.participantsList.querySelectorAll("input[type='checkbox']:checked"))
    .map((input) => input.dataset.memberId);
}

function getCustomShares(participantIds) {
  return participantIds.map((memberId) => {
    const input = elements.customShareList.querySelector(`[data-custom-share-member-id="${memberId}"]`);
    return {
      member_id: memberId,
      owed_amount: Number(input?.value || 0)
    };
  });
}

function normalizeMember(member) {
  return {
    id: member.member_id || member.id,
    display_name: member.display_name || member.member_name || member.name,
    preferred_currency: member.preferred_currency || APP_CONFIG.defaultCurrency,
    session_token: member.session_token
  };
}

function formatCurrency(value) {
  const currency = getActiveCurrency();
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency
  }).format(value || 0);
}

function getActiveCurrency() {
  const activeGroup = state.availableGroups.find((group) => String(group.id) === String(state.activeGroupId));
  return activeGroup?.currency_code || state.currentMember?.preferred_currency || APP_CONFIG.defaultCurrency;
}

function formatDirection(direction) {
  switch (direction) {
    case "owes_you":
      return "Owes you";
    case "you_owe":
      return "You owe";
    default:
      return "Settled";
  }
}

function setStatus(element, message) {
  element.textContent = message;
}

function nearlyEqual(a, b) {
  return Math.abs(a - b) < 0.01;
}

function roundCurrency(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

init();
