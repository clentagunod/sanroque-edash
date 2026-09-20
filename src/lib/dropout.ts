// @ts-nocheck -- ported from the original site; behavior preserved, not yet fully typed.
import { LPSApi } from './sheets-api';
import { requireAuth } from './auth';
import { paginationPageNumbers } from './app-config';
import { getSelectedSchoolYear, initYearSwitcher } from './school-year';
import { Icon } from './icons';
import { escapeHtml, formatAppDate, renderShell } from './shell';
import { debounce } from './learner-list';
import { deleteArchiveRecord } from './archive-editor';

export let dropoutRecords = [];
export let dropoutPage = 1;
export const DROPOUT_PAGE_SIZE = 15;

export async function initDropout() {
  renderShell("dropout", "Dropout");
  window.dropoutSearch = "";
  const searchInput = document.getElementById("dropoutSearch");
  const gradeFilter = document.getElementById("dropoutGradeFilter");
  const genderFilter = document.getElementById("dropoutGenderFilter");
  if (searchInput) searchInput.value = "";
  if (gradeFilter) gradeFilter.value = "";
  if (genderFilter) genderFilter.value = "";
  searchInput?.addEventListener("input", debounce((event) => { window.dropoutSearch = event.target.value.trim().toLowerCase(); dropoutPage = 1; renderDropout(); }, 200));
  ["dropoutGradeFilter", "dropoutGenderFilter"].forEach((id) => document.getElementById(id)?.addEventListener("change", () => { dropoutPage = 1; renderDropout(); }));
  await initYearSwitcher(loadDropout);
}

export async function loadDropout(schoolYear) {
  const body = document.getElementById("dropoutTableBody");
  if (body) body.innerHTML = `<tr><td colspan="7" class="state-row">Loading dropout records…</td></tr>`;

  try {
    dropoutRecords = await LPSApi.getArchiveRecords("dropout", schoolYear);
    if (!Array.isArray(dropoutRecords) || dropoutRecords.length === 0) {
      // Fallback for older Apps Script deployments: reports already combines
      // active learners with archived dropout records.
      const report = await LPSApi.getReportsData(schoolYear);
      dropoutRecords = (report?.learners || []).filter((record) => {
        const enrollmentStatus = String(record.enrollmentStatus || "").trim().toUpperCase().replace(/[ -]+/g, "_");
        const eosyStatus = String(record.eosyStatus || "").trim().toLowerCase().replace(/[_-]+/g, " ");
        return enrollmentStatus === "DROPPED_OUT" || enrollmentStatus === "DROPOUT" || eosyStatus === "dropped out";
      });
    }
    window.dropoutRecords = dropoutRecords;
    dropoutPage = 1;
    renderDropout();
  } catch (error) {
    if (body) body.innerHTML = `<tr><td colspan="7" class="state-row error">${escapeHtml(error.message || "Unable to load dropout records.")}</td></tr>`;
  }
}

export function renderDropout() {
  const body = document.getElementById("dropoutTableBody");
  if (!body) return;
  const query = String(document.getElementById("dropoutSearch")?.value || window.dropoutSearch || "").trim().toLowerCase();
  const grade = String(document.getElementById("dropoutGradeFilter")?.value || "").trim().toLowerCase();
  const gender = String(document.getElementById("dropoutGenderFilter")?.value || "").trim().toLowerCase();
  const records = dropoutRecords.filter((record) => {
    const name = record.name || [record.firstName, record.lastName].filter(Boolean).join(" ");
    const text = `${record.learnerId || ""} ${name} ${record.gradeLevel || ""} ${record.section || ""} ${record.gender || ""} ${record.eosyStatus || ""} ${record.dateAdded || ""}`.toLowerCase();
    return (!query || text.includes(query)) && (!grade || String(record.gradeLevel || "").trim().toLowerCase() === grade) && (!gender || String(record.gender || "").trim().toLowerCase() === gender);
  });
  const summary = document.getElementById("dropoutSummary");
  if (summary) summary.innerHTML = `<div class="stat-pill"><strong>${dropoutRecords.length.toLocaleString()}</strong>Total dropouts</div><div class="stat-pill"><strong>${records.length.toLocaleString()}</strong>Showing</div><div class="stat-pill"><strong>${records.filter((record) => record.gender === "Male").length.toLocaleString()}</strong>Male</div><div class="stat-pill"><strong>${records.filter((record) => record.gender === "Female").length.toLocaleString()}</strong>Female</div>`;
  if (!records.length) {
    body.innerHTML = `<tr><td colspan="7" class="state-row">No dropout students found.</td></tr>`;
    renderDropoutPagination(0);
    return;
  }
  const pageCount = Math.max(1, Math.ceil(records.length / DROPOUT_PAGE_SIZE));
  dropoutPage = Math.min(dropoutPage, pageCount);
  const pageRecords = records.slice((dropoutPage - 1) * DROPOUT_PAGE_SIZE, dropoutPage * DROPOUT_PAGE_SIZE);
  body.innerHTML = pageRecords.map((record) => `
    <tr>
      <td>${escapeHtml(record?.learnerId || "—")}</td>
      <td class="cell-name">${escapeHtml(record?.name || [record?.firstName, record?.lastName].filter(Boolean).join(" ") || "—")}</td>
      <td>${escapeHtml([record?.gradeLevel, record?.section].filter(Boolean).join(" · ") || "—")}</td>
      <td>${escapeHtml(record?.gender || "—")}</td>
      <td><strong>${escapeHtml(record?.eosyStatus || record?.enrollmentStatus || "Dropped Out")}</strong></td>
      <td>${escapeHtml(formatAppDate(record?.dateAdded))}</td>
      <td><div class="row-actions"><button class="icon-btn danger" type="button" title="Delete" aria-label="Delete" data-archive-delete="${escapeHtml(record.learnerId)}">${Icon.trash}</button></div></td>
    </tr>
  `).join("");
  body.querySelectorAll("[data-archive-delete]").forEach((button) => button.addEventListener("click", () => { const record = dropoutRecords.find((item) => item.learnerId === button.dataset.archiveDelete); if (record) deleteArchiveRecord("dropout", getSelectedSchoolYear(), record, () => loadDropout(getSelectedSchoolYear())); }));
  renderDropoutPagination(records.length, pageCount);
}

export function renderDropoutPagination(total, pageCount = Math.max(1, Math.ceil(total / DROPOUT_PAGE_SIZE))) {
  const info = document.getElementById("dropoutPageInfo");
  const buttons = document.getElementById("dropoutPagerBtns");
  if (!info || !buttons) return;
  info.textContent = total ? `${(dropoutPage - 1) * DROPOUT_PAGE_SIZE + 1}-${Math.min(dropoutPage * DROPOUT_PAGE_SIZE, total)} of ${total}` : "0 learners";
  const pages = paginationPageNumbers(dropoutPage, pageCount);
  buttons.innerHTML = `<button type="button" aria-label="Previous page" ${dropoutPage === 1 ? "disabled" : ""}>‹</button>${pages.map((page) => `<button type="button" class="${page === dropoutPage ? "is-active" : ""}" data-page="${page}">${page}</button>`).join("")}<button type="button" aria-label="Next page" ${dropoutPage === pageCount ? "disabled" : ""}>›</button>`;
  [...buttons.children].forEach((button, index) => { if (!button.disabled) button.addEventListener("click", () => { dropoutPage = button.dataset.page ? Number(button.dataset.page) : index === 0 ? dropoutPage - 1 : dropoutPage + 1; renderDropout(); }); });
}
