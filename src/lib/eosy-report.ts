// @ts-nocheck -- ported from the original site; behavior preserved, not yet fully typed.
import { LPSApi } from './sheets-api';
import { requireAuth } from './auth';
import { paginationPageNumbers } from './app-config';
import { initYearSwitcher } from './school-year';
import { escapeHtml, renderShell } from './shell';

export let EOSY_REPORT_DATA = null;
export let EOSY_REPORT_PAGE = 1;
export let EOSY_REPORT_DESCENDING = false;
export const EOSY_REPORT_PAGE_SIZE = 25;

export function renderEosyPagination(total, page, onPageChange) {
  const pageCount = Math.max(1, Math.ceil(total / EOSY_REPORT_PAGE_SIZE));
  const info = document.getElementById("eosyPageInfo");
  const buttons = document.getElementById("eosyPagerBtns");
  if (!info || !buttons) return;
  info.textContent = total ? `${(page - 1) * EOSY_REPORT_PAGE_SIZE + 1}-${Math.min(page * EOSY_REPORT_PAGE_SIZE, total)} of ${total}` : "0 learners";
  const pageNumbers = paginationPageNumbers(page, pageCount);
  buttons.innerHTML = `<button type="button" aria-label="Previous page" ${page === 1 ? "disabled" : ""}>‹</button>${pageNumbers.map((value) => value === "..." ? `<span class="pager-ellipsis">…</span>` : `<button type="button" class="${value === page ? "is-active" : ""}" data-page="${value}">${value}</button>`).join("")}<button type="button" aria-label="Next page" ${page === pageCount ? "disabled" : ""}>›</button>`;
  [...buttons.children].forEach((button, index) => { if (!button.disabled && !button.classList.contains("pager-ellipsis")) button.addEventListener("click", () => onPageChange(button.dataset.page ? Number(button.dataset.page) : index === 0 ? page - 1 : page + 1)); });
}

export async function initEosyReport() {
  renderShell("eosy", "EOSY Status Report");
  await initYearSwitcher(loadEosyReport);
  ["eosyStatusFilter", "eosyGradeFilter", "eosySearch"].forEach((id) => document.getElementById(id)?.addEventListener("input", () => { EOSY_REPORT_PAGE = 1; renderEosyReport(); }));
  document.getElementById("eosySortDirection")?.addEventListener("click", () => { EOSY_REPORT_DESCENDING = !EOSY_REPORT_DESCENDING; renderEosyReport(); });
}

export async function loadEosyReport(schoolYear) {
  const body = document.getElementById("eosyStatusTableBody");
  body.innerHTML = `<tr><td colspan="5" class="state-row">Loading EOSY report...</td></tr>`;
  try {
    EOSY_REPORT_DATA = await LPSApi.getReportsData(schoolYear);
    document.getElementById("eosyDemoBanner").style.display = "none";
    renderEosyReport();
  } catch (error) {
    body.innerHTML = `<tr><td colspan="5" class="state-row error">${escapeHtml(error.message || "Unable to load EOSY report.")}</td></tr>`;
  }
}

export function renderEosyReport() {
  const data = EOSY_REPORT_DATA || { learners: [] };
  const query = document.getElementById("eosySearch")?.value.trim().toLowerCase() || "";
  const status = document.getElementById("eosyStatusFilter")?.value || "";
  const grade = document.getElementById("eosyGradeFilter")?.value || "";
  const rows = data.learners.filter((learner) => {
    const name = learner.name || `${learner.firstName || ""} ${learner.lastName || ""}`;
    const haystack = `${name} ${learner.learnerId || ""} ${learner.section || ""}`.toLowerCase();
    return learner.eosyStatus && (!status || learner.eosyStatus === status) && (!grade || learner.gradeLevel === grade) && (!query || haystack.includes(query));
  }).sort((a, b) => {
    const left = `${a.name || a.lastName || ""} ${a.firstName || ""}`.toLowerCase();
    const right = `${b.name || b.lastName || ""} ${b.firstName || ""}`.toLowerCase();
    return (left.localeCompare(right, undefined, { numeric: true }) || String(a.learnerId).localeCompare(String(b.learnerId))) * (EOSY_REPORT_DESCENDING ? -1 : 1);
  });
  const pageCount = Math.max(1, Math.ceil(rows.length / EOSY_REPORT_PAGE_SIZE));
  EOSY_REPORT_PAGE = Math.min(EOSY_REPORT_PAGE, pageCount);
  const visible = rows.slice((EOSY_REPORT_PAGE - 1) * EOSY_REPORT_PAGE_SIZE, EOSY_REPORT_PAGE * EOSY_REPORT_PAGE_SIZE);
  document.getElementById("eosyResultCount").textContent = `${rows.length} learner${rows.length === 1 ? "" : "s"}`;
  document.getElementById("eosyStatusTableBody").innerHTML = visible.length ? visible.map((learner) => `<tr><td>${escapeHtml(learner.learnerId || "—")}</td><td class="cell-name">${escapeHtml(learner.name || `${learner.firstName || ""} ${learner.lastName || ""}`)}</td><td>${escapeHtml(learner.gradeLevel || "—")}</td><td>${escapeHtml(learner.section || "—")}</td><td><strong>${escapeHtml(learner.eosyStatus)}</strong></td></tr>`).join("") : `<tr><td colspan="5" class="state-row">No EOSY statuses recorded.</td></tr>`;
  document.getElementById("eosySortDirection").textContent = EOSY_REPORT_DESCENDING ? "Z-A" : "A-Z";
  renderEosyPagination(rows.length, EOSY_REPORT_PAGE, (page) => { EOSY_REPORT_PAGE = page; renderEosyReport(); });
}
