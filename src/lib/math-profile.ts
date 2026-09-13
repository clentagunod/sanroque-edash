// @ts-nocheck -- ported from the original site; behavior preserved, not yet fully typed.
import { escapeHtml, renderShell, showToast, startExportIndicator } from './shell';
import { LPSApi } from './sheets-api';
import { requireAuth } from './auth';
import { paginationPageNumbers } from './app-config';
import { getSelectedSchoolYear, initYearSwitcher } from './school-year';
import { debounce } from './learner-list';

export let mathProfiles = [];
export let mathPage = 1;
export let mathSearch = "";
export const MATH_PAGE_SIZE = 10;

export async function initMathProfiles() {
  renderShell("math", "Math Profile");
  document.getElementById("exportMathBtn").addEventListener("click", exportMathExcel);
  ["mathPeriodFilter", "mathSexFilter", "mathStatusFilter"].forEach((id) => document.getElementById(id)?.addEventListener("change", () => { mathPage = 1; renderFilteredMath(); }));
  document.getElementById("mathSearch")?.addEventListener("input", debounce((event) => { mathSearch = event.target.value.trim().toLowerCase(); mathPage = 1; renderFilteredMath(); }, 200));
  await initYearSwitcher(loadMathProfiles);
}

export async function loadMathProfiles(schoolYear) {
  const body = document.getElementById("mathTableBody");
  if (body) {
    body.innerHTML = `<tr><td colspan="7" class="state-row">Loading math profiles…</td></tr>`;
  }
  try {
    const records = await LPSApi.getMathProfiles(schoolYear);
    mathProfiles = records;
    renderFilteredMath();
  } catch (error) {
    mathProfiles = [];
    const summary = document.getElementById("mathSummary");
    if (summary) summary.innerHTML = "";
    if (body) {
      body.innerHTML = `<tr><td colspan="7" class="state-row error">${escapeHtml(error.message || "Unable to load math profiles.")}<br><small>Add BOSYRMA, MOSYRMA, and EOSYRMA to the selected Learners school-year tab.</small></td></tr>`;
    }
  }
}

export function renderFilteredMath() {
  const period = document.getElementById("mathPeriodFilter")?.value || "";
  const sex = document.getElementById("mathSexFilter")?.value || "";
  const status = document.getElementById("mathStatusFilter")?.value || "";
  const records = mathProfiles.filter((record) => { const text = `${record.name || ""} ${record.learnerId || ""} ${record.gradeLevel || ""}`.toLowerCase(); return (!mathSearch || text.includes(mathSearch)) && (!sex || record.gender === sex) && (!period || record[period]) && (!status || record[period] === status); });
  renderMathSummary(records);
  renderMathTable(records.slice((mathPage - 1) * MATH_PAGE_SIZE, mathPage * MATH_PAGE_SIZE));
  renderProfilePagination("math", records.length, mathPage, (page) => { mathPage = page; renderFilteredMath(); });
}

export function renderProfilePagination(prefix, total, page, onPageChange) {
  const pageCount = Math.max(1, Math.ceil(total / MATH_PAGE_SIZE));
  const info = document.getElementById(prefix + "PageInfo");
  const buttons = document.getElementById(prefix + "PagerBtns");
  if (!info || !buttons) return;
  info.textContent = total ? `${(page - 1) * MATH_PAGE_SIZE + 1}-${Math.min(page * MATH_PAGE_SIZE, total)} of ${total}` : "0 learners";
  const pageNumbers = paginationPageNumbers(page, pageCount);
  buttons.innerHTML = `<button type="button" aria-label="Previous page" ${page === 1 ? "disabled" : ""}>‹</button>${pageNumbers.map((value) => value === "..." ? `<span class="pager-ellipsis" aria-hidden="true">…</span>` : `<button type="button" class="${value === page ? "is-active" : ""}" data-page="${value}">${value}</button>`).join("")}<button type="button" aria-label="Next page" ${page === pageCount ? "disabled" : ""}>›</button>`;
  [...buttons.children].forEach((button, index) => { if (!button.disabled && !button.classList.contains("pager-ellipsis")) button.addEventListener("click", () => onPageChange(button.dataset.page ? Number(button.dataset.page) : index === 0 ? page - 1 : page + 1)); });
}

export function renderMathSummary(records = []) {
  const summary = document.getElementById("mathSummary");
  if (!summary) return;
  const changed = records.filter((record) => String(record?.change || "").toLowerCase() !== "no change recorded").length;
  summary.innerHTML = `<div class="stat-pill"><strong>${records.length.toLocaleString()}</strong>Learners tracked</div><div class="stat-pill"><strong>${changed.toLocaleString()}</strong>Profile changes</div>`;
}

export function mathMeasure(record, stage) {
  const value = record?.[stage] == null ? "" : String(record[stage]).trim();
  return `<div class="reading-measure"><strong>${escapeHtml(value || "—")}</strong><span>RMA</span></div>`;
}

export function renderMathTable(records = []) {
  const body = document.getElementById("mathTableBody");
  if (!body) return;
  if (!records.length) { body.innerHTML = `<tr><td colspan="7" class="state-row">No math profiles found.</td></tr>`; return; }
  body.innerHTML = records.map((record) => `<tr><td class="cell-name">${escapeHtml(record?.name || "—")}</td><td>${escapeHtml(record?.gradeLevel || "—")}</td><td>${escapeHtml(record?.gender || "—")}</td><td>${mathMeasure(record, "bosy")}</td><td>${mathMeasure(record, "mosy")}</td><td>${mathMeasure(record, "eosy")}</td><td><strong>${escapeHtml(record?.change || "No change recorded")}</strong></td></tr>`).join("");
}

export async function exportMathExcel() {
  if (!mathProfiles.length) { showToast("There are no math profiles to export.", "error"); return; }
  const indicator = startExportIndicator("Preparing math export...", document.getElementById("exportMathBtn"));
  if (!indicator) return;
  try {
    indicator.update("Building math workbook...", 45);
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    if (indicator.cancelled) return;
  const year = getSelectedSchoolYear() || "Current";
  const headers = ["Learner ID", "Name", "Grade Level", "Gender", "Reference", "BOSY RMA", "MOSY RMA", "EOSY RMA", "Change"];
  const cell = (value, isLearnerId = false) => `<td${isLearnerId ? " class=\"text-cell\"" : ""}>${escapeHtml(value == null ? "" : String(value))}</td>`;
  const rows = mathProfiles.map((record) => [record?.learnerId || "", record?.name || "", record?.gradeLevel || "", record?.gender || "", "RMA", record?.bosy || "", record?.mosy || "", record?.eosy || "", record?.change || "No change recorded"]);
  const workbook = `<html><head><meta charset="UTF-8"><style>table{border-collapse:collapse;font-family:Arial}th,td{border:1px solid #b9c5d9;padding:6px 8px}th{background:#dfeaff}.text-cell{mso-number-format:'\\@';}</style></head><body><h1>San Roque ES Math Profile - ${escapeHtml(year)}</h1><table><tr>${headers.map(cell).join("")}</tr>${rows.map((row) => `<tr>${row.map((value, index) => cell(value, index === 0)).join("")}</tr>`).join("")}</table></body></html>`;
  const url = URL.createObjectURL(new Blob(["\ufeff", workbook], { type: "application/vnd.ms-excel" }));
  const link = document.createElement("a"); link.href = url; link.download = `san-roque-es-math-profile-${year.replace(/\s+/g, "")}.xls`; document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
  indicator.finish();
  showToast("Math profile Excel report downloaded.", "success");
  } catch (error) {
    indicator.close();
    showToast(error.message || "Unable to export math profile.", "error");
  }
}
