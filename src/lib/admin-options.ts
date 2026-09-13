// @ts-nocheck -- ported from the original site; behavior preserved, not yet fully typed.
import { LPSApi } from './sheets-api';
import { requireAuth } from './auth';
import { APP_CONFIG, isSchoolAdmin } from './app-config';
import { clearButtonLoading, escapeHtml, setButtonLoading, showToast } from './shell';
import { Icon } from './icons';
import { downloadFirestoreBackup } from './firestore-backup';

/* Admin Console: school years and dynamic section directory. */

export const ADMIN_OPTIONS = { years: [], sections: [], selectedYear: "", editingSection: null };

export function adminOptionEscape(value) {
  return typeof escapeHtml === "function" ? escapeHtml(String(value ?? "")) : String(value ?? "").replace(/[&<>\"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '\"': "&quot;" }[char]));
}

export function adminGradeLabel(value) {
  const text = String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
  if (["kinder", "kindergarten", "kg", "0"].includes(text)) return "Kinder";
  const match = text.match(/^grade\s*(\d+)$/) || text.match(/^(\d+)$/);
  return match ? `Grade ${match[1]}` : String(value || "Unassigned").trim() || "Unassigned";
}

export async function initAdminOptions() {
  if (!isSchoolAdmin()) return;
  document.getElementById("openYearModalBtn")?.addEventListener("click", openAdminYearModal);
  document.getElementById("openSectionModalBtn")?.addEventListener("click", () => openAdminSectionModal());
  document.getElementById("adminYearSelect")?.addEventListener("change", (event) => loadAdminSections(event.target.value));
  document.getElementById("makeCurrentYearBtn")?.addEventListener("click", makeAdminYearCurrent);
  document.getElementById("downloadFirestoreBackupBtn")?.addEventListener("click", downloadFirestoreBackup);
  const backupLink = document.getElementById("openBackupSpreadsheetBtn");
  if (backupLink && APP_CONFIG.backupSpreadsheetUrl) backupLink.href = APP_CONFIG.backupSpreadsheetUrl;
  document.getElementById("refreshFirestoreUsageBtn")?.addEventListener("click", renderSimpleFirestoreUsage);
  await loadAdminStructure();
  ensureAdminModals();
  loadFirestoreUsage();
}

export async function loadFirestoreUsage() {
  const state = document.getElementById("firestoreUsageState");
  const content = document.getElementById("firestoreUsageContent");
  const refresh = document.getElementById("firestoreUsageRefresh");
  if (!state || !content || !refresh) return;
  renderSimpleFirestoreUsage();
  state.textContent = "Simple mode: quotas are shown below. Open Firebase usage for live project totals.";
  state.className = "usage-simple-state";
  content.hidden = false;
  refresh.textContent = "Simple mode";
}

export function renderSimpleFirestoreUsage() {
  const limits = { reads: 50000, writes: 20000, deletes: 20000 };
  const labels = [["reads", "Reads", "blue"], ["writes", "Writes", "green"], ["deletes", "Deletes", "orange"]];
  document.getElementById("firestoreQuotaCards").innerHTML = labels.map(([key, label, color]) => `<article class="usage-quota-card"><div class="usage-quota-icon ${color}">${key === "reads" ? "R" : key === "writes" ? "W" : "D"}</div><div><span>${label}</span><strong>View live total</strong><small>${limits[key].toLocaleString()} free operations per day</small></div><div class="usage-progress"><i style="width:0%"></i></div></article>`).join("");
  document.getElementById("firestoreUsageChart").innerHTML = `<div class="usage-simple-message"><strong>Live project totals are not available in simple mode.</strong><span>Click “Open usage” above to see the current Firebase read, write, delete, storage, and download totals.</span></div>`;
  document.getElementById("firestoreUsageReset").textContent = "Quota refreshes daily";
}

export function renderFirestoreUsage(usage) {
  const limits = usage.limits || {};
  const days = usage.days || [];
  const latest = days[days.length - 1] || { reads: 0, writes: 0, deletes: 0 };
  const metrics = [["reads", "Reads", "blue"], ["writes", "Writes", "green"], ["deletes", "Deletes", "orange"]];
  document.getElementById("firestoreQuotaCards").innerHTML = metrics.map(([key, label, color]) => {
    const value = Number(latest[key] || 0);
    const limit = Number(limits[key] || 0);
    const percent = limit ? Math.round(value / limit * 100) : 0;
    const exceeded = value > limit;
    return `<article class="usage-quota-card ${exceeded ? "is-exceeded" : ""}"><div class="usage-quota-icon ${color}">${key === "reads" ? "R" : key === "writes" ? "W" : "D"}</div><div><span>${label}</span><strong>${value.toLocaleString()}</strong><small>${percent}% of ${limit.toLocaleString()} daily free operations</small></div><div class="usage-progress"><i style="width:${Math.min(100, percent)}%"></i></div>${exceeded ? "<em>Over free limit</em>" : ""}</article>`;
  }).join("");
  const max = Math.max(1, ...days.flatMap((day) => metrics.map(([key]) => Number(day[key] || 0))));
  document.getElementById("firestoreUsageChart").innerHTML = days.map((day) => `<div class="usage-chart-day"><div class="usage-bars">${metrics.map(([key, label, color]) => `<span class="usage-bar ${color}" style="height:${Math.max(3, Number(day[key] || 0) / max * 100)}%" title="${label}: ${Number(day[key] || 0).toLocaleString()}"></span>`).join("")}</div><small>${day.date.slice(5)}</small></div>`).join("");
  document.getElementById("firestoreUsageReset").textContent = `Next reset: ${new Date(usage.nextResetAt).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })}`;
}

export async function loadAdminStructure() {
  const state = document.getElementById("adminSectionsState");
  try {
    await LPSApi.refreshPublicStats?.();
    ADMIN_OPTIONS.years = await LPSApi.getSchoolYears();
    ADMIN_OPTIONS.years = (ADMIN_OPTIONS.years || []).filter((year) => /^\d{4}-\d{4}$/.test(String(year.schoolYear || "")));
    const current = ADMIN_OPTIONS.years.find((year) => year.isCurrent) || ADMIN_OPTIONS.years[0];
    ADMIN_OPTIONS.selectedYear = current?.schoolYear || "";
    renderAdminYearSelect();
    await loadAdminSections(ADMIN_OPTIONS.selectedYear);
  } catch (error) {
    if (state) state.innerHTML = `<span class="state-row error">Unable to load school structure: ${adminOptionEscape(error.message)}</span>`;
  }
}

export function renderAdminYearSelect() {
  const select = document.getElementById("adminYearSelect");
  const count = document.getElementById("adminYearCount");
  if (count) {
    count.classList.remove("admin-loading-value");
    count.textContent = `${ADMIN_OPTIONS.years.length} configured`;
  }
  if (!select) return;
  select.innerHTML = ADMIN_OPTIONS.years.length
    ? ADMIN_OPTIONS.years.map((year) => `<option value="${adminOptionEscape(year.schoolYear)}">${adminOptionEscape(year.schoolYear)}${year.isCurrent ? " · Current" : ""}</option>`).join("")
    : `<option value="">No school years</option>`;
  select.value = ADMIN_OPTIONS.selectedYear;
}

export async function loadAdminSections(schoolYear) {
  ADMIN_OPTIONS.selectedYear = schoolYear || "";
  const state = document.getElementById("adminSectionsState");
  const grid = document.getElementById("adminSectionGrid");
  if (!state || !grid) return;
  state.innerHTML = schoolYear ? `<span class="admin-spinner" aria-hidden="true"></span><span>Loading sections for ${adminOptionEscape(schoolYear)}</span>` : "Create a school year to begin.";
  state.className = schoolYear ? "admin-loading-state" : "state-row";
  grid.innerHTML = "";
  try {
    ADMIN_OPTIONS.sections = schoolYear ? await LPSApi.getSections(schoolYear) : [];
    ADMIN_OPTIONS.sections.sort((left, right) => `${adminGradeLabel(left.gradeLevel)} ${left.section}`.localeCompare(`${adminGradeLabel(right.gradeLevel)} ${right.section}`));
    const sectionCount = document.getElementById("adminSectionCount");
    if (sectionCount) {
      sectionCount.classList.remove("admin-loading-value");
      sectionCount.textContent = `${ADMIN_OPTIONS.sections.length} configured`;
    }
    state.textContent = ADMIN_OPTIONS.sections.length ? "" : "No sections configured for this year yet.";
    renderAdminSections();
  } catch (error) {
    state.innerHTML = `<span class="state-row error">Unable to load sections: ${adminOptionEscape(error.message)}</span>`;
  }
}

export function renderAdminSections() {
  const grid = document.getElementById("adminSectionGrid");
  if (!grid) return;
  const groups = new Map();
  ADMIN_OPTIONS.sections.forEach((section) => {
    const grade = adminGradeLabel(section.gradeLevel);
    if (!groups.has(grade)) groups.set(grade, []);
    groups.get(grade).push(section);
  });
  grid.innerHTML = [...groups.entries()].map(([grade, sections]) => `
    <section class="admin-grade-group">
      <div class="admin-grade-heading"><h4>${adminOptionEscape(grade)}</h4><span>${sections.length} section${sections.length === 1 ? "" : "s"}</span></div>
      <div class="admin-section-list">${sections.map((section) => `
        <div class="admin-section-row">
          <div><strong>${adminOptionEscape(section.section)}</strong><span>${adminOptionEscape(section.adviser || "No teacher assigned")}</span></div>
          <div class="row-actions"><button class="icon-btn" type="button" data-admin-edit-section="${adminOptionEscape(section.id)}" title="Edit section" aria-label="Edit section">${Icon.edit}</button><button class="icon-btn danger" type="button" data-admin-delete-section="${adminOptionEscape(section.id)}" title="Delete section" aria-label="Delete section">${Icon.trash}</button></div>
        </div>`).join("")}</div>
    </section>`).join("");
  grid.querySelectorAll("[data-admin-edit-section]").forEach((button) => button.addEventListener("click", () => openAdminSectionModal(button.dataset.adminEditSection)));
  grid.querySelectorAll("[data-admin-delete-section]").forEach((button) => button.addEventListener("click", () => deleteAdminSection(button.dataset.adminDeleteSection, button)));
}

export function ensureAdminModals() {
  if (document.getElementById("adminYearModalBackdrop")) return;
  document.body.insertAdjacentHTML("beforeend", `
    <div class="modal-backdrop" id="adminYearModalBackdrop"><div class="modal admin-modal">
      <div class="modal-header"><div><span class="eyebrow-label">Academic setup</span><h3>Add school year</h3></div><button class="modal-close" type="button" data-admin-close="adminYearModalBackdrop" aria-label="Close"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg></button></div>
      <form id="adminYearForm"><div class="modal-body"><div class="field"><label for="adminYearInput">School year</label><input id="adminYearInput" placeholder="2027-2028" pattern="\\d{4}-\\d{4}" required /></div><label class="admin-check"><input id="adminYearCurrent" type="checkbox" /> Make this the current school year</label><p class="field-hint">The current year’s section and teacher structure can be copied as a starting template.</p></div><div class="modal-footer"><button class="btn btn-secondary" type="button" data-admin-close="adminYearModalBackdrop">Cancel</button><button class="btn btn-primary" type="submit">Create school year</button></div></form>
    </div></div>
    <div class="modal-backdrop" id="adminSectionModalBackdrop"><div class="modal admin-modal">
      <div class="modal-header"><div><span class="eyebrow-label">School structure</span><h3 id="adminSectionModalTitle">Add section</h3></div><button class="modal-close" type="button" data-admin-close="adminSectionModalBackdrop" aria-label="Close"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg></button></div>
      <form id="adminSectionForm"><div class="modal-body"><div class="field"><label for="adminSectionGrade">Grade level</label><select id="adminSectionGrade" required><option value="Kinder">Kinder</option>${[1, 2, 3, 4, 5, 6].map((grade) => `<option>Grade ${grade}</option>`).join("")}</select></div><div class="field"><label for="adminSectionName">Section name</label><input id="adminSectionName" placeholder="Diamond" required /></div><div class="field"><label for="adminSectionTeacher">Teacher / adviser</label><input id="adminSectionTeacher" placeholder="Full name" /></div></div><div class="modal-footer"><button class="btn btn-secondary" type="button" data-admin-close="adminSectionModalBackdrop">Cancel</button><button class="btn btn-primary" type="submit">Save section</button></div></form>
    </div></div>`);
  document.querySelectorAll("[data-admin-close]").forEach((button) => button.addEventListener("click", () => closeAdminModal(button.dataset.adminClose)));
  document.querySelectorAll(".modal-backdrop[id^=admin]").forEach((backdrop) => backdrop.addEventListener("click", (event) => { if (event.target === backdrop) closeAdminModal(backdrop.id); }));
  document.getElementById("adminYearForm").addEventListener("submit", createAdminYear);
  document.getElementById("adminSectionForm").addEventListener("submit", saveAdminSection);
}

export function openAdminYearModal() { ensureAdminModals(); document.getElementById("adminYearForm").reset(); document.getElementById("adminYearModalBackdrop").classList.add("is-open"); document.getElementById("adminYearInput").focus(); }
export function closeAdminModal(id) { document.getElementById(id)?.classList.remove("is-open"); }

export async function createAdminYear(event) {
  event.preventDefault();
  const input = document.getElementById("adminYearInput");
  const schoolYear = input.value.trim().replace(/[–—/]/g, "-").replace(/\s+/g, "");
  if (!/^\d{4}-\d{4}$/.test(schoolYear)) { showToast("Use the format YYYY-YYYY.", "error"); return; }
  const button = event.submitter;
  setButtonLoading(button, "Creating year…");
  try {
    const currentYear = ADMIN_OPTIONS.years.find((year) => year.isCurrent)?.schoolYear || ADMIN_OPTIONS.years[0]?.schoolYear || "";
    const result = await LPSApi.createSchoolYear(schoolYear, document.getElementById("adminYearCurrent").checked, currentYear);
    showToast(`${schoolYear} created${result.copiedSections ? ` with ${result.copiedSections} section templates` : ""}.`, "success");
    closeAdminModal("adminYearModalBackdrop");
    await loadAdminStructure();
  } catch (error) { showToast(error.message || "School year could not be created.", "error"); }
  finally { clearButtonLoading(button); }
}

export function openAdminSectionModal(sectionId = "") {
  ensureAdminModals();
  if (!ADMIN_OPTIONS.selectedYear) { showToast("Create or select a school year first.", "error"); return; }
  const section = ADMIN_OPTIONS.sections.find((item) => item.id === sectionId);
  ADMIN_OPTIONS.editingSection = section || null;
  document.getElementById("adminSectionModalTitle").textContent = section ? "Edit section" : "Add section";
  document.getElementById("adminSectionGrade").value = section?.gradeLevel || "Kinder";
  document.getElementById("adminSectionName").value = section?.section || "";
  document.getElementById("adminSectionTeacher").value = section?.adviser || "";
  document.getElementById("adminSectionModalBackdrop").classList.add("is-open");
  document.getElementById("adminSectionName").focus();
}

export async function saveAdminSection(event) {
  event.preventDefault();
  const button = event.submitter;
  setButtonLoading(button, "Saving section…");
  try {
    await LPSApi.saveSection({ id: ADMIN_OPTIONS.editingSection?.id, schoolYear: ADMIN_OPTIONS.selectedYear, gradeLevel: document.getElementById("adminSectionGrade").value, section: document.getElementById("adminSectionName").value.trim(), adviser: document.getElementById("adminSectionTeacher").value.trim() });
    await LPSApi.refreshPublicStats?.();
    showToast("Section saved.", "success");
    closeAdminModal("adminSectionModalBackdrop");
    await loadAdminSections(ADMIN_OPTIONS.selectedYear);
  } catch (error) { showToast(error.message || "Section could not be saved.", "error"); }
  finally { clearButtonLoading(button); }
}

export async function deleteAdminSection(sectionId, button) {
  const section = ADMIN_OPTIONS.sections.find((item) => item.id === sectionId);
  if (!section || !window.confirm(`Remove ${section.gradeLevel} · ${section.section}?`)) return;
  setButtonLoading(button, "");
  try { await LPSApi.deleteSection(sectionId); await LPSApi.refreshPublicStats?.(); showToast("Section removed.", "success"); await loadAdminSections(ADMIN_OPTIONS.selectedYear); }
  catch (error) { showToast(error.message || "Section could not be removed.", "error"); }
  finally { clearButtonLoading(button); }
}

export async function makeAdminYearCurrent() {
  if (!ADMIN_OPTIONS.selectedYear) return;
  const button = document.getElementById("makeCurrentYearBtn");
  setButtonLoading(button, "Updating…");
  try { await LPSApi.setCurrentSchoolYear(ADMIN_OPTIONS.selectedYear); showToast(`${ADMIN_OPTIONS.selectedYear} is now current.`, "success"); await loadAdminStructure(); }
  catch (error) { showToast(error.message || "Current school year could not be changed.", "error"); }
  finally { clearButtonLoading(button); }
}
