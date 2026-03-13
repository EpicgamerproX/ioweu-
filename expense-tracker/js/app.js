import { APP_CONFIG } from "./config.js";
import {
  createGroupForMember,
  createExpense,
  deleteExpense,
  fetchExpenses,
  fetchGroupMembers,
  fetchGroupsForMember,
  fetchSettlements,
  joinGroupByRoomKey,
  loginMember,
  signUpMember
} from "./supabase-client.js";
import { CashSelector } from "./cash-selector.js";

const state = {
  currentMember: null,
  availableGroups: [],
  activeGroupId: null,
  groupMembers: [],
  expenses: [],
  settlements: [],
  balances: [],
  debtRows: [],
  summary: null,
  amountEntries: []
};

const elements = {
  authPanel: document.querySelector("#auth-panel"),
  workspacePanel: document.querySelector("#workspace-panel"),
  authStatus: document.querySelector("#auth-status"),
  expenseStatus: document.querySelector("#expense-status"),
  amountBuilderStatus: document.querySelector("#amount-builder-status"),
  loginForm: document.querySelector("#login-form"),
  signupForm: document.querySelector("#signup-form"),
  groupSelect: document.querySelector("#group-select"),
  activeRoomIdDisplay: document.querySelector("#active-room-id-display"),
  createRoomPanel: document.querySelector("#create-room-panel"),
  createRoomForm: document.querySelector("#create-room-form"),
  createRoomToggle: document.querySelector("#create-room-toggle"),
  createRoomCancel: document.querySelector("#create-room-cancel"),
  createRoomName: document.querySelector("#create-room-name"),
  createRoomKey: document.querySelector("#create-room-key"),
  createRoomStatus: document.querySelector("#create-room-status"),
  joinRoomForm: document.querySelector("#join-room-form"),
  welcomeTitle: document.querySelector("#welcome-title"),
  activeRoomChip: document.querySelector("#active-room-chip"),
  owedToYou: document.querySelector("#owed-to-you"),
  youOwe: document.querySelector("#you-owe"),
  netBalance: document.querySelector("#net-balance"),
  totalSpent: document.querySelector("#total-spent"),
  drawerName: document.querySelector("#member-drawer-name"),
  drawerTitle: document.querySelector("#drawer-title"),
  drawerRoomName: document.querySelector("#drawer-room-name"),
  drawerEquivalentGrid: document.querySelector("#drawer-equivalent-grid"),
  roomKeyDisplay: document.querySelector("#room-key-display"),
  debtTableBody: document.querySelector("#debt-table-body"),
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
  tabPanels: document.querySelectorAll(".tab-panel"),
  memberDrawer: document.querySelector("#member-drawer"),
  memberDrawerToggle: document.querySelector("#member-drawer-toggle"),
  expenseAmountInput: document.querySelector("#expense-amount"),
  amountBuilderBody: document.querySelector("#amount-builder-body"),
  amountBuilderTotal: document.querySelector("#amount-builder-total"),
  amountBuilderClear: document.querySelector("#amount-builder-clear"),
  amountBuilderConfirm: document.querySelector("#amount-builder-confirm"),
  cashSelectorRoot: document.querySelector("#cash-selector-root")
};

new CashSelector(elements.cashSelectorRoot);

function init() {
  bindEvents();
  setDefaultDate();
  restoreSession();
}

function bindEvents() {
  elements.loginForm.addEventListener("submit", handleLogin);
  elements.signupForm.addEventListener("submit", handleSignup);
  elements.groupSelect.addEventListener("change", handleGroupChange);
  if (elements.createRoomToggle) {
    elements.createRoomToggle.addEventListener("click", openCreateRoomPanel);
  }
  if (elements.createRoomForm) {
    elements.createRoomForm.addEventListener("submit", handleCreateRoom);
  }
  if (elements.createRoomCancel) {
    elements.createRoomCancel.addEventListener("click", closeCreateRoomPanel);
  }
  elements.joinRoomForm.addEventListener("submit", handleJoinRoom);
  elements.expenseForm.addEventListener("submit", handleCreateExpense);
  elements.splitMode.addEventListener("change", renderCustomShareInputs);
  elements.logoutButton.addEventListener("click", handleLogout);
  elements.memberDrawerToggle.addEventListener("click", toggleMemberDrawer);
  elements.cashSelectorRoot.addEventListener("cashValueSelected", handleCashValueSelected);
  elements.amountBuilderClear.addEventListener("click", handleClearAmountBuilder);
  elements.amountBuilderConfirm.addEventListener("click", handleConfirmAmountBuilder);

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

  localStorage.setItem(APP_CONFIG.sessionStorageKey, JSON.stringify({
    currentMember: state.currentMember,
    activeGroupId: state.activeGroupId
  }));
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
    const member = await loginMember(String(formData.get("email")), String(formData.get("password")));
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
  setStatus(elements.authStatus, "Creating your account...");

  const formData = new FormData(event.currentTarget);

  try {
    const member = await signUpMember({
      displayName: String(formData.get("displayName")),
      email: String(formData.get("email")),
      password: String(formData.get("password")),
      currency: String(formData.get("currency"))
    });

    state.currentMember = normalizeMember(member);
    state.activeGroupId = null;
    await bootstrapWorkspace();
    event.currentTarget.reset();
    setStatus(elements.authStatus, "");
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
  elements.drawerName.textContent = state.currentMember.display_name;
  elements.drawerTitle.textContent = `${state.currentMember.display_name}'s spend story`;

  try {
    state.availableGroups = await fetchGroupsForMember(state.currentMember.session_token);
    if (!state.availableGroups.length) {
      state.activeGroupId = null;
      renderGroups();
      renderEmptyWorkspace("You are not part of any rooms yet. Create a room or join one with a room ID.");
      saveSession();
      return;
    }

    state.activeGroupId = state.availableGroups.some((group) => group.id === state.activeGroupId)
      ? state.activeGroupId
      : state.availableGroups[0].id;

    renderGroups();
    await loadActiveGroupData();
    saveSession();
  } catch (error) {
    setStatus(elements.authStatus, error.message || "Unable to load workspace.");
  }
}

async function handleGroupChange(event) {
  state.activeGroupId = event.target.value;
  resetAmountBuilder(true);
  closeCreateRoomPanel();
  await loadActiveGroupData();
  saveSession();
}

async function handleCreateRoom(event) {
  event.preventDefault();
  if (!state.currentMember) {
    return;
  }

  const formData = new FormData(event.currentTarget);
  const roomName = String(formData.get("roomName") || "").trim();
  const roomKey = String(formData.get("roomKey") || "").trim().toUpperCase();

  if (!roomName || !roomKey) {
    setStatus(elements.createRoomStatus, "Enter a room name and room ID.");
    return;
  }

  setStatus(elements.createRoomStatus, "Creating room...");

  try {
    const created = await createGroupForMember(state.currentMember.session_token, {
      roomName,
      roomKey,
      currency: state.currentMember.preferred_currency
    });

    state.availableGroups = await fetchGroupsForMember(state.currentMember.session_token);
    state.activeGroupId = created.group_id;
    resetAmountBuilder(true);
    renderGroups();
    closeCreateRoomPanel();
    await loadActiveGroupData();
    saveSession();
    setStatus(elements.expenseStatus, `Created ${created.group_name}. Room ID: ${created.room_key}.`);
  } catch (error) {
    setStatus(elements.createRoomStatus, error.message || "Could not create room.");
  }
}

async function handleJoinRoom(event) {
  event.preventDefault();
  if (!state.currentMember) {
    return;
  }

  const formData = new FormData(event.currentTarget);
  const roomKey = String(formData.get("roomKey") || "").trim().toUpperCase();
  if (!roomKey) {
    return;
  }

  setStatus(elements.expenseStatus, "Loading...");

  try {
    const joined = await joinGroupByRoomKey(state.currentMember.session_token, roomKey);
    state.availableGroups = await fetchGroupsForMember(state.currentMember.session_token);
    state.activeGroupId = joined.group_id;
    resetAmountBuilder(true);
    closeCreateRoomPanel();
    renderGroups();
    await loadActiveGroupData();
    event.currentTarget.reset();
    saveSession();
    setStatus(elements.expenseStatus, `Success! Joined ${joined.group_name}.`);
  } catch (error) {
    setStatus(elements.expenseStatus, error.message || "Could not join room.");
  }
}

async function loadActiveGroupData() {
  if (!state.activeGroupId) {
    renderEmptyWorkspace("Select a room to continue.");
    return;
  }

  setStatus(elements.expenseStatus, "Loading room balances, expenses, and payments...");

  try {
    const [members, expenses, settlements] = await Promise.all([
      fetchGroupMembers(state.currentMember.session_token, state.activeGroupId),
      fetchExpenses(state.currentMember.session_token, state.activeGroupId),
      fetchSettlements(state.currentMember.session_token, state.activeGroupId)
    ]);

    state.groupMembers = members;
    state.expenses = expenses;
    state.settlements = settlements;
    state.balances = computeBalances(expenses, settlements, members, state.currentMember.id);
    state.debtRows = computeOutstandingDebtRows(expenses, settlements, state.currentMember.id);
    state.summary = computeSummary(expenses, state.balances, state.currentMember.id);

    renderWorkspace();
    setStatus(elements.expenseStatus, "");
  } catch (error) {
    renderEmptyWorkspace(error.message || "Unable to load room data.");
  }
}

function renderGroups() {
  if (!state.availableGroups.length) {
    elements.groupSelect.innerHTML = `<option value="">No rooms yet</option>`;
    elements.groupSelect.disabled = true;
    return;
  }

  elements.groupSelect.disabled = false;
  elements.groupSelect.innerHTML = state.availableGroups
    .map((group) => {
      const selected = group.id === state.activeGroupId ? "selected" : "";
      return `<option value="${group.id}" ${selected}>${escapeHtml(group.name)} (${escapeHtml(group.room_key)})</option>`;
    })
    .join("");
}

function renderWorkspace() {
  renderSummary();
  renderDrawer();
  renderDebtTable();
  renderBalancesTable();
  renderExpenseFormMembers();
  renderExpenseHistory();
  renderAmountBuilder();
}

function renderDrawer() {
  const activeGroup = getActiveGroup();
  elements.activeRoomIdDisplay.textContent = activeGroup
    ? `Room ID: ${activeGroup.room_key}`
    : "Room ID: --------";
  elements.drawerRoomName.textContent = activeGroup
    ? `${activeGroup.name} room`
    : "No room selected";
  elements.roomKeyDisplay.textContent = activeGroup?.room_key || "--------";
  elements.activeRoomChip.textContent = activeGroup
    ? `${activeGroup.name} | ${activeGroup.room_key}`
    : "No room selected";

  const funEquivalents = state.summary?.fun_equivalents || [];
  if (!funEquivalents.length) {
    elements.drawerEquivalentGrid.innerHTML = `<div class="empty-state">Add expenses you paid to unlock your dashboard cards.</div>`;
    return;
  }

  elements.drawerEquivalentGrid.innerHTML = funEquivalents
    .map((item) => `
      <article class="equivalent-card">
        <p class="equivalent-card__label">${escapeHtml(item.label)}</p>
        <strong>${escapeHtml(item.quantity)}</strong>
      </article>
    `)
    .join("");
}

function renderEmptyWorkspace(message) {
  elements.owedToYou.textContent = formatCurrency(0);
  elements.youOwe.textContent = formatCurrency(0);
  elements.netBalance.textContent = formatCurrency(0);
  elements.totalSpent.textContent = formatCurrency(0);
  elements.debtTableBody.innerHTML = `<tr><td colspan="4"><div class="empty-state">${escapeHtml(message)}</div></td></tr>`;
  elements.balancesTableBody.innerHTML = `<tr><td colspan="3"><div class="empty-state">${escapeHtml(message)}</div></td></tr>`;
  elements.participantsList.innerHTML = `<div class="empty-state">${escapeHtml(message)}</div>`;
  elements.customShareList.innerHTML = "";
  elements.expenseHistory.innerHTML = `<div class="empty-state">${escapeHtml(message)}</div>`;
  elements.drawerEquivalentGrid.innerHTML = `<div class="empty-state">${escapeHtml(message)}</div>`;
  elements.roomKeyDisplay.textContent = "--------";
  elements.drawerRoomName.textContent = message;
  elements.activeRoomChip.textContent = "No room selected";
  elements.activeRoomIdDisplay.textContent = "Room ID: --------";
  closeCreateRoomPanel({ preserveStatus: true });
  resetAmountBuilder(true);
  renderAmountBuilder(message);
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

function renderDebtTable() {
  if (!state.debtRows.length) {
    elements.debtTableBody.innerHTML = `<tr><td colspan="4"><div class="empty-state">You are settled up in this room.</div></td></tr>`;
    return;
  }

  elements.debtTableBody.innerHTML = state.debtRows
    .map((row) => `
      <tr>
        <td>${escapeHtml(row.creditor_name)}</td>
        <td class="amount-negative">${formatCurrency(row.remaining_amount)}</td>
        <td>${escapeHtml(formatDate(row.expense_date))}</td>
        <td>${escapeHtml(row.message)}</td>
      </tr>
    `)
    .join("");
}

function renderBalancesTable() {
  if (!state.balances.length) {
    elements.balancesTableBody.innerHTML = `<tr><td colspan="3"><div class="empty-state">Everything is settled for this room.</div></td></tr>`;
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
  const combined = [
    ...state.expenses.map((expense) => ({ type: "expense", sortDate: `${expense.expense_date}T00:00:00`, payload: expense })),
    ...state.settlements.map((settlement) => ({ type: "settlement", sortDate: settlement.paid_at, payload: settlement }))
  ].sort((left, right) => new Date(right.sortDate).getTime() - new Date(left.sortDate).getTime());

  if (!combined.length) {
    elements.expenseHistory.innerHTML = `<div class="empty-state">No expenses or payments yet for this room.</div>`;
    return;
  }

  elements.expenseHistory.innerHTML = combined
    .map((entry) => {
      if (entry.type === "settlement") {
        const settlement = entry.payload;
        return `
          <article class="history-item">
            <div class="history-item__settlement">
              <div>
                <strong>${escapeHtml(settlement.from_member_name)} paid ${escapeHtml(settlement.to_member_name)}</strong>
                <p class="history-item__meta">${escapeHtml(formatDateTime(settlement.paid_at))}</p>
              </div>
              <span class="history-item__amount">${formatCurrency(settlement.amount)}</span>
            </div>
            <p class="history-item__participants">${escapeHtml(settlement.note || "Settlement payment recorded from the cash selector.")}</p>
          </article>
        `;
      }

      const expense = entry.payload;
      const shareSummary = expense.shares
        .map((share) => `${share.member_name}: ${formatCurrency(share.owed_amount)}`)
        .join(" | ");

      const deleteButton = expense.created_by_member_id === state.currentMember.id
        ? `<div class="history-item__actions"><button type="button" data-delete-expense-id="${expense.id}">Delete expense</button></div>`
        : "";

      return `
        <article class="history-item">
          <div class="history-item__top">
            <div>
              <strong>${escapeHtml(expense.title)}</strong>
              <p class="history-item__meta">Paid by ${escapeHtml(expense.paid_by_name)} on ${escapeHtml(formatDate(expense.expense_date))}</p>
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

function renderAmountBuilder(emptyMessage) {
  if (emptyMessage) {
    elements.amountBuilderBody.innerHTML = `
      <tr>
        <td colspan="3"><div class="empty-state">${escapeHtml(emptyMessage)}</div></td>
      </tr>
    `;
    elements.amountBuilderTotal.textContent = formatCurrency(0);
    elements.amountBuilderClear.disabled = true;
    elements.amountBuilderConfirm.disabled = true;
    setStatus(elements.amountBuilderStatus, "");
    return;
  }

  if (!state.amountEntries.length) {
    elements.amountBuilderBody.innerHTML = `
      <tr>
        <td colspan="3"><div class="empty-state">Tap a base amount to start building the total.</div></td>
      </tr>
    `;
  } else {
    elements.amountBuilderBody.innerHTML = state.amountEntries
      .map((entry, index) => `
        <tr>
          <td>${escapeHtml(entry.label)}</td>
          <td>${formatCurrency(entry.amount)}</td>
          <td class="amount-builder__remove-cell">
            <button class="amount-builder__remove" type="button" data-remove-amount-index="${index}">Remove</button>
          </td>
        </tr>
      `)
      .join("");
  }

  elements.amountBuilderTotal.textContent = formatCurrency(getAmountBuilderTotal());
  elements.amountBuilderClear.disabled = !state.amountEntries.length;
  elements.amountBuilderConfirm.disabled = !state.amountEntries.length;

  elements.amountBuilderBody.querySelectorAll("[data-remove-amount-index]").forEach((button) => {
    button.addEventListener("click", () => {
      removeAmountEntry(Number(button.dataset.removeAmountIndex));
    });
  });

  if (!state.amountEntries.length) {
    setStatus(elements.amountBuilderStatus, "Tap a base amount to add it instantly, or long-press for the 10-90 wheel.");
  }
}

async function handleCreateExpense(event) {
  event.preventDefault();
  if (!state.currentMember || !state.activeGroupId) {
    setStatus(elements.expenseStatus, "Pick a room before adding expenses.");
    return;
  }

  const formData = new FormData(event.currentTarget);
  const participantIds = getSelectedParticipantIds();
  if (!participantIds.length) {
    setStatus(elements.expenseStatus, "Select at least one participant.");
    return;
  }

  const amount = Number(formData.get("amount"));
  const splitMode = String(formData.get("splitMode"));
  const customShares = splitMode === "custom" ? getCustomShares(participantIds) : [];

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
    resetAmountBuilder(false);
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

function handleCashValueSelected(event) {
  if (!state.currentMember || !state.activeGroupId) {
    setStatus(elements.amountBuilderStatus, "Open a room before building an expense amount.");
    return;
  }

  state.amountEntries.push({
    label: event.detail.label,
    amount: event.detail.amount,
    baseValue: event.detail.baseValue,
    radialValue: event.detail.radialValue,
    timestamp: event.detail.timestamp
  });

  renderAmountBuilder();
  setStatus(elements.amountBuilderStatus, `${event.detail.label} added to the running total.`);
}

function handleLogout() {
  state.currentMember = null;
  state.availableGroups = [];
  state.activeGroupId = null;
  state.groupMembers = [];
  state.expenses = [];
  state.settlements = [];
  state.balances = [];
  state.debtRows = [];
  state.summary = null;
  state.amountEntries = [];
  clearSession();
  closeCreateRoomPanel({ preserveStatus: false });
  elements.memberDrawer.classList.remove("is-open");
  elements.memberDrawerToggle.setAttribute("aria-expanded", "false");
  elements.authPanel.hidden = false;
  elements.workspacePanel.hidden = true;
  renderAmountBuilder("Log in and open a room to build an amount.");
  setStatus(elements.authStatus, "Logged out.");
  setStatus(elements.amountBuilderStatus, "");
}

function openCreateRoomPanel() {
  if (!elements.createRoomPanel || !elements.createRoomName || !elements.createRoomKey) {
    return;
  }

  elements.createRoomPanel.hidden = false;
  elements.createRoomName.value = "";
  elements.createRoomKey.value = generateRoomKeyCandidate();
  if (elements.createRoomStatus) {
    setStatus(elements.createRoomStatus, "");
  }
  window.setTimeout(() => {
    elements.createRoomName.focus();
  }, 0);
}

function closeCreateRoomPanel(options = {}) {
  const { preserveStatus = false } = options;
  if (!elements.createRoomPanel) {
    return;
  }

  elements.createRoomPanel.hidden = true;
  if (elements.createRoomForm) {
    elements.createRoomForm.reset();
  }
  if (!preserveStatus && elements.createRoomStatus) {
    setStatus(elements.createRoomStatus, "");
  }
}

function handleClearAmountBuilder() {
  resetAmountBuilder(true);
  renderAmountBuilder();
  setStatus(elements.amountBuilderStatus, "Running amount cleared.");
}

function handleConfirmAmountBuilder() {
  if (!state.amountEntries.length) {
    setStatus(elements.amountBuilderStatus, "Add at least one amount before confirming.");
    return;
  }

  elements.expenseAmountInput.value = getAmountBuilderTotal().toFixed(2);
  setStatus(elements.amountBuilderStatus, `Expense amount set to ${formatCurrency(getAmountBuilderTotal())}.`);
}

function removeAmountEntry(index) {
  if (Number.isNaN(index) || index < 0 || index >= state.amountEntries.length) {
    return;
  }

  state.amountEntries.splice(index, 1);
  renderAmountBuilder();
  setStatus(elements.amountBuilderStatus, "Amount entry removed.");
}

function resetAmountBuilder(clearField) {
  state.amountEntries = [];
  if (clearField) {
    elements.expenseAmountInput.value = "";
  }
}

function getAmountBuilderTotal() {
  return roundCurrency(state.amountEntries.reduce((total, entry) => total + entry.amount, 0));
}

function toggleMemberDrawer() {
  if (!isTapDrawerMode()) {
    return;
  }

  const isOpen = elements.memberDrawer.classList.toggle("is-open");
  elements.memberDrawerToggle.setAttribute("aria-expanded", String(isOpen));
}

function computeBalances(expenses, settlements, members, currentMemberId) {
  const memberLookup = new Map(members.map((member) => [String(member.id), member.display_name]));
  const counterpartyMap = new Map();
  const currentId = String(currentMemberId);

  expenses.forEach((expense) => {
    expense.shares.forEach((share) => {
      if (String(share.member_id) === String(expense.paid_by_member_id)) {
        return;
      }

      const debtorId = String(share.member_id);
      const creditorId = String(expense.paid_by_member_id);

      if (creditorId === currentId) {
        counterpartyMap.set(debtorId, (counterpartyMap.get(debtorId) || 0) + share.owed_amount);
      }

      if (debtorId === currentId) {
        counterpartyMap.set(creditorId, (counterpartyMap.get(creditorId) || 0) - share.owed_amount);
      }
    });
  });

  settlements.forEach((settlement) => {
    const fromId = String(settlement.from_member_id);
    const toId = String(settlement.to_member_id);

    if (fromId === currentId) {
      counterpartyMap.set(toId, (counterpartyMap.get(toId) || 0) + settlement.amount);
    }

    if (toId === currentId) {
      counterpartyMap.set(fromId, (counterpartyMap.get(fromId) || 0) - settlement.amount);
    }
  });

  return Array.from(counterpartyMap.entries())
    .map(([memberId, signedAmount]) => ({
      member_id: memberId,
      counterparty_name: memberLookup.get(memberId) || "Unknown",
      direction: signedAmount > 0 ? "owes_you" : signedAmount < 0 ? "you_owe" : "settled",
      amount: Math.abs(roundCurrency(signedAmount))
    }))
    .filter((row) => row.amount > 0)
    .sort((left, right) => left.counterparty_name.localeCompare(right.counterparty_name));
}

function computeOutstandingDebtRows(expenses, settlements, currentMemberId) {
  const currentId = String(currentMemberId);

  const rawDebtRows = expenses
    .flatMap((expense) => expense.shares
      .filter((share) => String(share.member_id) === currentId && String(expense.paid_by_member_id) !== currentId)
      .map((share) => ({
        creditor_id: String(expense.paid_by_member_id),
        creditor_name: expense.paid_by_name,
        expense_date: expense.expense_date,
        message: expense.title,
        remaining_amount: roundCurrency(share.owed_amount)
      })))
    .sort((left, right) => new Date(left.expense_date).getTime() - new Date(right.expense_date).getTime());

  const settlementCredits = settlements.reduce((accumulator, settlement) => {
    if (String(settlement.from_member_id) !== currentId) {
      return accumulator;
    }

    const key = String(settlement.to_member_id);
    accumulator.set(key, (accumulator.get(key) || 0) + settlement.amount);
    return accumulator;
  }, new Map());

  return rawDebtRows
    .map((row) => {
      const availableCredit = settlementCredits.get(row.creditor_id) || 0;
      const applied = Math.min(availableCredit, row.remaining_amount);
      const remaining = roundCurrency(row.remaining_amount - applied);

      settlementCredits.set(row.creditor_id, roundCurrency(availableCredit - applied));

      return {
        ...row,
        remaining_amount: remaining
      };
    })
    .filter((row) => row.remaining_amount > 0)
    .sort((left, right) => new Date(right.expense_date).getTime() - new Date(left.expense_date).getTime());
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
    email: member.email || "",
    preferred_currency: member.preferred_currency || APP_CONFIG.defaultCurrency,
    session_token: member.session_token
  };
}

function formatCurrency(value) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: getActiveCurrency()
  }).format(value || 0);
}

function getActiveCurrency() {
  return getActiveGroup()?.currency_code || state.currentMember?.preferred_currency || APP_CONFIG.defaultCurrency;
}

function getActiveGroup() {
  return state.availableGroups.find((group) => String(group.id) === String(state.activeGroupId)) || null;
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

function formatDate(value) {
  if (!value) {
    return "Unknown";
  }

  return new Intl.DateTimeFormat("en-IN", {
    year: "numeric",
    month: "short",
    day: "numeric"
  }).format(new Date(value));
}

function formatDateTime(value) {
  if (!value) {
    return "Unknown";
  }

  return new Intl.DateTimeFormat("en-IN", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(value));
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

function isTapDrawerMode() {
  return window.matchMedia("(max-width: 980px), (hover: none)").matches;
}

function generateRoomKeyCandidate() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let candidate = "";

  for (let index = 0; index < 8; index += 1) {
    candidate += alphabet[Math.floor(Math.random() * alphabet.length)];
  }

  return candidate;
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
