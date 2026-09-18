// @ts-nocheck -- ported from the original site; behavior preserved, not yet fully typed.
import { appPageHref, clearButtonLoading, escapeHtml, renderShell, setButtonLoading, showToast } from './shell';
import { LPSApi } from './sheets-api';
import { confirmDiscardChanges, formSnapshot, isSchoolAdmin } from './app-config';
import { requireAuth } from './auth';
import { DEMO_USERS, isSheetsApiConfigured } from './demo-data';
import { Icon } from './icons';
import { fsGetUsers, fsSubscribeUsers } from './firestore-api';

export let MU = { users: [], editingId: null, deletingId: null, deletingName: "", selectedIds: new Set() };
export let usersLoadRequest = 0;
export let userFormInitialSnapshot = "";
let teacherAssignmentLoadToken = 0;
/** Live subscription that keeps the user directory current without a manual refresh. */
export let usersLiveUnsubscribe = null;

export function debounce(fn, delay) {
  let timeoutId;
  return (...args) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), delay);
  };
}

export async function initManageUsers() {
  if (!isSchoolAdmin()) {
    window.location.replace(appPageHref("dashboard.html"));
    return;
  }
  renderShell("users", "Admin Console");
  ensureUserBulkControls();
  document.getElementById("searchInput").addEventListener("input", debounce((e) => renderUsersTable(filterUsers(e.target.value)), 250));
  wireUserModal();
  await loadUsers();
  // Push updates: an admin adding/editing/removing a user on another device
  // shows up here instantly. The search filter is re-applied, and transient
  // listener errors never replace the last known good directory.
  usersLiveUnsubscribe?.();
  usersLiveUnsubscribe = typeof fsSubscribeUsers === "function" ? fsSubscribeUsers((users) => {
    MU.users = users;
    renderUsersTable(filterUsers(document.getElementById("searchInput")?.value || ""));
  }, () => {}) : null;
}

export async function loadUsers() {
  const tbody = document.getElementById("usersTableBody");
  const requestId = ++usersLoadRequest;
  MU.selectedIds.clear();
  updateUserBulkControls();
  tbody.innerHTML = `<tr class="admin-table-loading"><td colspan="5"><span class="admin-spinner" aria-hidden="true"></span><span>Refreshing user directory</span></td></tr>`;
  try {
    if (typeof fsGetUsers === "function") {
      MU.users = await getUsersWithTimeout();
    } else {
      MU.users = DEMO_USERS.slice();
      document.getElementById("demoBanner").style.display = "flex";
    }
    if (requestId === usersLoadRequest) renderUsersTable(MU.users);
    const demoBanner = document.getElementById("demoBanner");
    if (demoBanner && isSheetsApiConfigured()) demoBanner.style.display = "none";
  } catch (err) {
    if (requestId !== usersLoadRequest) return;
    tbody.innerHTML = `<tr><td colspan="6" class="state-row error">Couldn't load users: ${escapeHtml(err.message)}<br><small>Check your Firestore connection and School Admin profile.</small><br><button class="btn btn-secondary retry-users" type="button">Try again</button></td></tr>`;
    const retryBtn = tbody.querySelector(".retry-users");
    if (retryBtn) retryBtn.addEventListener("click", loadUsers);
  }
}

export async function getUsersWithTimeout() {
  let timeoutId;
  const timeout = new Promise((resolve, reject) => {
    timeoutId = setTimeout(() => reject(new Error("Manage Users is taking too long to respond.")), 10000);
  });
  try {
    return await Promise.race([LPSApi.getUsers(), timeout]);
  } finally {
    clearTimeout(timeoutId);
  }
}

export function filterUsers(query) {
  const q = query.trim().toLowerCase();
  if (!q) return MU.users;
  return MU.users.filter((u) => `${u.userId} ${u.name} ${u.email} ${u.role} ${u.status}`.toLowerCase().includes(q));
}

export function statusBadgeClass(status) {
  if (status === "Active") return "badge-success";
  if (status === "Invited") return "badge-warning";
  return "badge-danger";
}

export function renderUsersTable(users) {
  const tbody = document.getElementById("usersTableBody");
  if (!users || users.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="state-row">No users found.</td></tr>`;
    updateUserBulkControls();
    return;
  }
  tbody.innerHTML = users.map((u) => `
    <tr>
      <td><input class="row-select user-select" type="checkbox" value="${escapeHtml(u.userId)}" aria-label="Select ${escapeHtml(u.name)}" /></td>
      <td class="cell-name">${escapeHtml(u.name)}</td>
      <td>${escapeHtml(u.email)}</td>
      <td>${escapeHtml(u.role)}</td>
      <td><span class="badge ${statusBadgeClass(u.status)}">${escapeHtml(u.status)}</span></td>
      <td>
        <div class="row-actions">
          <button class="icon-btn" title="Edit" data-edit="${escapeHtml(u.userId)}">${Icon.edit}</button>
          <button class="icon-btn danger" title="Remove" data-delete="${escapeHtml(u.userId)}" data-name="${escapeHtml(u.name)}">${Icon.trash}</button>
        </div>
      </td>
    </tr>`).join("");

  tbody.querySelectorAll(".user-select").forEach((checkbox) => checkbox.addEventListener("change", () => {
    if (checkbox.checked) MU.selectedIds.add(checkbox.value);
    else MU.selectedIds.delete(checkbox.value);
    updateUserBulkControls();
  }));
  tbody.querySelectorAll("[data-edit]").forEach((btn) => btn.addEventListener("click", () => openEditUserModal(btn.getAttribute("data-edit"))));
  tbody.querySelectorAll("[data-delete]").forEach((btn) => btn.addEventListener("click", () => openDeleteUserModal(btn.getAttribute("data-delete"), btn.getAttribute("data-name"))));
  updateUserBulkControls();
}

export function ensureUserBulkControls() {
  const table = document.querySelector("#usersTableBody")?.closest("table");
  if (!table || document.getElementById("userBulkToolbar")) return;
  const toolbar = document.createElement("div");
  toolbar.id = "userBulkToolbar";
  toolbar.className = "bulk-toolbar";
  toolbar.innerHTML = `<span class="bulk-selection-count">No users selected</span><button class="btn btn-danger-outline" id="deleteSelectedUsersBtn" type="button" disabled>Remove selected</button>`;
  table.parentElement.parentElement.insertBefore(toolbar, table.parentElement);
  table.querySelector("thead tr").insertAdjacentHTML("afterbegin", `<th class="select-column"><input id="selectAllUsers" class="row-select" type="checkbox" aria-label="Select all visible users" /></th>`);
  document.getElementById("selectAllUsers").addEventListener("change", (event) => {
    table.querySelectorAll(".user-select").forEach((checkbox) => {
      checkbox.checked = event.target.checked;
      if (checkbox.checked) MU.selectedIds.add(checkbox.value);
      else MU.selectedIds.delete(checkbox.value);
    });
    updateUserBulkControls();
  });
  document.getElementById("deleteSelectedUsersBtn").addEventListener("click", () => {
    const selected = [...MU.selectedIds];
    if (selected.length) openDeleteUserModal(selected, `${selected.length} selected users`);
  });
}

export function updateUserBulkControls() {
  const count = MU.selectedIds.size;
  const countEl = document.querySelector("#userBulkToolbar .bulk-selection-count");
  const deleteBtn = document.getElementById("deleteSelectedUsersBtn");
  const selectAll = document.getElementById("selectAllUsers");
  const visible = document.querySelectorAll(".user-select");
  if (countEl) countEl.textContent = count ? `${count} user${count === 1 ? "" : "s"} selected` : "No users selected";
  if (deleteBtn) deleteBtn.disabled = count === 0;
  if (selectAll) {
    selectAll.checked = visible.length > 0 && [...visible].every((checkbox) => checkbox.checked);
    selectAll.indeterminate = count > 0 && !selectAll.checked;
  }
}

export function wireUserModal() {
  const backdrop = document.getElementById("userModalBackdrop");
  document.getElementById("addUserBtn").addEventListener("click", openAddUserModal);
  document.getElementById("userModalClose").addEventListener("click", () => closeUserModal());
  document.getElementById("userModalCancel").addEventListener("click", () => closeUserModal());
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) closeUserModal(); });
  document.getElementById("userForm").addEventListener("submit", handleUserFormSubmit);
  document.getElementById("u_role").addEventListener("change", toggleTeacherAssignmentFields);
  document.getElementById("u_teacher_year").addEventListener("change", () => loadTeacherAssignmentSections());

  const delBackdrop = document.getElementById("userDeleteModalBackdrop");
  document.getElementById("userDeleteModalCancel").addEventListener("click", closeDeleteUserModal);
  delBackdrop.addEventListener("click", (e) => { if (e.target === delBackdrop) closeDeleteUserModal(); });
  document.getElementById("userDeleteModalConfirm").addEventListener("click", confirmDeleteUser);
}

export function openAddUserModal() {
  MU.editingId = null;
  document.getElementById("userModalTitle").textContent = "Add User";
  document.getElementById("userForm").reset();
  document.getElementById("userPasswordField").hidden = false;
  document.getElementById("u_password").required = true;
  const status = document.getElementById("userFormStatus");
  if (status) { status.hidden = true; status.textContent = ""; }
  toggleTeacherAssignmentFields();
  userFormInitialSnapshot = formSnapshot(document.getElementById("userForm"));
  document.getElementById("userModalBackdrop").classList.add("is-open");
}

export function openEditUserModal(userId) {
  const u = MU.users.find((x) => x.userId === userId);
  if (!u) return;
  MU.editingId = userId;
  document.getElementById("userModalTitle").textContent = "Edit User";
  document.getElementById("u_name").value = u.name;
  document.getElementById("u_email").value = u.email;
  document.getElementById("userPasswordField").hidden = true;
  document.getElementById("u_password").required = false;
  document.getElementById("u_password").value = "";
  document.getElementById("u_role").value = u.role;
  document.getElementById("u_status").value = u.status;
  const status = document.getElementById("userFormStatus");
  if (status) { status.hidden = true; status.textContent = ""; }
  toggleTeacherAssignmentFields(u.teacherAssignment || {});
  userFormInitialSnapshot = formSnapshot(document.getElementById("userForm"));
  document.getElementById("userModalBackdrop").classList.add("is-open");
}

function teacherKey(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "unassigned";
}

function advisoryKey(value) {
  return teacherKey(value);
}

function normalizeTeacherGrade(value) {
  const text = String(value || "").trim();
  const normalized = text.toLowerCase().replace(/\s+/g, " ");
  if (["kinder", "kindergarten", "kg", "0"].includes(normalized)) return "Kinder";
  const match = normalized.match(/^grade\s*(\d+)$/) || normalized.match(/^(\d+)$/);
  return match ? `Grade ${match[1]}` : text;
}

export async function loadTeacherAssignmentSections(selectedSection = "") {
  const year = document.getElementById("u_teacher_year")?.value;
  const sectionSelect = document.getElementById("u_teacher_section");
  if (!sectionSelect || !year) return;
  const requestToken = ++teacherAssignmentLoadToken;
  try {
    const sections = await LPSApi.getSections(year);
    if (requestToken !== teacherAssignmentLoadToken || year !== document.getElementById("u_teacher_year")?.value) return;
    sectionSelect.innerHTML = sections.length
      ? sections.map((section) => {
        const value = encodeURIComponent(JSON.stringify({ gradeLevel: section.gradeLevel, section: section.section }));
        return `<option value="${value}">${escapeHtml(section.gradeLevel)} · ${escapeHtml(section.section)}</option>`;
      }).join("")
      : `<option value="">No sections configured</option>`;
    if (selectedSection) sectionSelect.value = encodeURIComponent(JSON.stringify({ gradeLevel: selectedSection.gradeLevel, section: selectedSection.section }));
  } catch (error) {
    sectionSelect.innerHTML = `<option value="">Unable to load sections</option>`;
  }
}

export async function toggleTeacherAssignmentFields(selected = {}) {
  const role = document.getElementById("u_role")?.value;
  const wrapper = document.getElementById("teacherAssignmentFields");
  const yearSelect = document.getElementById("u_teacher_year");
  const sectionSelect = document.getElementById("u_teacher_section");
  if (!wrapper || !yearSelect || !sectionSelect) return;
  const required = role === "Teacher";
  wrapper.hidden = !required;
  sectionSelect.required = required;
  if (!required) return;
  teacherAssignmentLoadToken += 1;
  const years = await LPSApi.getSchoolYears();
  yearSelect.innerHTML = years.map((year) => `<option value="${escapeHtml(year.schoolYear)}">${escapeHtml(year.schoolYear)}</option>`).join("");
  yearSelect.value = selected.schoolYear || years.find((year) => year.isCurrent)?.schoolYear || years[0]?.schoolYear || "";
  await loadTeacherAssignmentSections(selected);
}

export function closeUserModal(force = false) {
  if (!force && !confirmDiscardChanges(document.getElementById("userForm"), userFormInitialSnapshot, "user form")) return;
  document.getElementById("userModalBackdrop").classList.remove("is-open");
  userFormInitialSnapshot = "";
}

export async function handleUserFormSubmit(e) {
  e.preventDefault();
  const saveBtn = document.getElementById("userSaveBtn");
  const status = document.getElementById("userFormStatus");
  setButtonLoading(saveBtn, "Saving user…");
  if (status) { status.hidden = true; status.textContent = ""; }
  const record = {
    name: document.getElementById("u_name").value.trim(),
    email: document.getElementById("u_email").value.trim(),
    role: document.getElementById("u_role").value,
    status: document.getElementById("u_status").value,
    password: document.getElementById("u_password").value,
  };
  try {
    if (record.role === "Teacher") {
      let selected;
      try { selected = JSON.parse(decodeURIComponent(document.getElementById("u_teacher_section").value || "")); }
      catch (error) { throw new Error("Select a valid teacher grade and section."); }
      const gradeLevel = normalizeTeacherGrade(selected.gradeLevel);
      const section = String(selected.section || "").trim();
      record.teacherAssignment = { schoolYear: document.getElementById("u_teacher_year").value.trim(), gradeLevel, section, teacherName: record.name, teacherKey: teacherKey(record.name), gradeKey: advisoryKey(gradeLevel), sectionKey: advisoryKey(section) };
      if (!record.teacherAssignment.schoolYear || !record.teacherAssignment.gradeLevel || !record.teacherAssignment.section) throw new Error("Teacher grade, section, and school year are required.");
    } else record.teacherAssignment = null;
    if (MU.editingId) {
      await LPSApi.updateUser(MU.editingId, record);
      showToast("User updated.", "success");
    } else {
      await LPSApi.addUser(record);
      showToast("User added.", "success");
    }
    userFormInitialSnapshot = formSnapshot(document.getElementById("userForm"));
    closeUserModal(true);
    loadUsers();
  } catch (err) {
    const message = err.message || "The user could not be saved.";
    if (status) { status.hidden = false; status.textContent = message; }
    showToast(message, "error");
  } finally {
    clearButtonLoading(saveBtn);
  }
}

export function openDeleteUserModal(userId, name) {
  MU.deletingId = userId;
  MU.deletingName = name;
  document.getElementById("deleteUserName").textContent = name;
  document.getElementById("userDeleteModalConfirm").textContent = Array.isArray(userId) ? "Remove users" : "Remove user";
  document.getElementById("userDeleteModalBackdrop").classList.add("is-open");
}
export function closeDeleteUserModal() { document.getElementById("userDeleteModalBackdrop").classList.remove("is-open"); }

export async function confirmDeleteUser() {
  const btn = document.getElementById("userDeleteModalConfirm");
  setButtonLoading(btn, Array.isArray(MU.deletingId) ? "Removing users…" : "Removing user…");
  try {
    if (Array.isArray(MU.deletingId)) {
      await LPSApi.deleteUsers(MU.deletingId);
      showToast(`${MU.deletingId.length} users were removed.`, "success");
    } else {
      await LPSApi.deleteUser(MU.deletingId);
      showToast(`${MU.deletingName} was removed.`, "success");
    }
    MU.selectedIds.clear();
    closeDeleteUserModal();
    loadUsers();
  } catch (err) {
    showToast(err.message, "error");
  } finally {
    clearButtonLoading(btn);
  }
}
