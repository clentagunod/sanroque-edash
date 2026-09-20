// @ts-nocheck -- ported from the original site; behavior preserved, not yet fully typed.
import { LPSApi } from './sheets-api';
import { requireAuth } from './auth';
import { getSelectedSchoolYear, initYearSwitcher } from './school-year';
import { Icon } from './icons';
import { escapeHtml, formatAppDate, renderShell } from './shell';
import { debounce } from './learner-list';
import { deleteArchiveRecord } from './archive-editor';

export let transferRecords = [];
export let transferSearch = "";

export async function initTransferInfo() {
  renderShell("transfer-info", "Transfer Info");
  ["transferTypeFilter", "transferGradeFilter", "transferGenderFilter"].forEach((id) => document.getElementById(id)?.addEventListener("change", () => loadTransferInfo(getSelectedSchoolYear())));
  document.getElementById("transferSearch")?.addEventListener("input", debounce((event) => { transferSearch = event.target.value.trim().toLowerCase(); renderTransferTable(filterTransferRecords(transferRecords)); }, 200));
  await initYearSwitcher(loadTransferInfo);
}

export async function loadTransferInfo(schoolYear) {
  const body = document.getElementById("transferTableBody");
  if (body) {
    body.innerHTML = `<tr><td colspan="10" class="state-row">Loading transfer records…</td></tr>`; // Loading message
  }
  try {
    const records = await LPSApi.getTransferRecords(schoolYear, document.getElementById("transferTypeFilter")?.value || "all", document.getElementById("transferGradeFilter")?.value || "", document.getElementById("transferGenderFilter")?.value || "");
    transferRecords = records;
    renderTransferSummary(transferRecords);
    renderTransferTable(filterTransferRecords(transferRecords));
  } catch (error) {
    transferRecords = [];
    const summary = document.getElementById("transferSummary");
    if (summary) summary.innerHTML = "";
    if (body) {
      body.innerHTML = `<tr><td colspan="10" class="state-row error">${escapeHtml(error.message || "Unable to load transfer records.")}<br><small>Transfer records are stored in Firestore for the selected school year.</small></td></tr>`;
    }
  }
}

export function filterTransferRecords(records) { return records.filter((record) => !transferSearch || `${record.name || ""} ${record.learnerId || ""} ${record.gradeLevel || ""} ${record.transferSchool || ""}`.toLowerCase().includes(transferSearch)); }

export function renderTransferSummary(records = []) {
  const summary = document.getElementById("transferSummary");
  if (!summary) return;
  const inCount = records.filter((record) => record.transferType === "Transfer In").length;
  const outCount = records.filter((record) => record.transferType === "Transfer Out").length;
  summary.innerHTML = `
    <div class="stat-pill"><strong>${records.length.toLocaleString()}</strong>Total transfers</div>
    <div class="stat-pill"><strong>${inCount.toLocaleString()}</strong>Transfer In</div>
    <div class="stat-pill"><strong>${outCount.toLocaleString()}</strong>Transfer Out</div>`;
}

export function renderTransferTable(records = []) {
  const body = document.getElementById("transferTableBody");
  if (!body) return;
  if (!records.length) {
    body.innerHTML = `<tr><td colspan="10" class="state-row">No transfer records found.</td></tr>`;
    return;
  }

  body.innerHTML = records.map((record) => `
    <tr>
      <td>${escapeHtml(record?.learnerId || "—")}</td>
      <td class="cell-name">${escapeHtml(record?.name || [record?.firstName, record?.middleName, record?.lastName].filter(Boolean).join(" ") || "—")}</td>
      <td>${escapeHtml(record?.gradeLevel || "—")}</td>
      <td>${escapeHtml(record?.gender || "—")}</td>
      <td><strong>${escapeHtml(record?.transferType || "—")}</strong></td>
      <td>${escapeHtml(record?.transferSchool || "—")}</td>
      <td>${escapeHtml(formatAppDate(record?.transferDate))}</td>
      <td>${escapeHtml(record?.transferReason || "—")}</td>
      <td>${escapeHtml(record?.transferNotes || "—")}</td>
      <td><div class="row-actions"><button class="icon-btn danger" type="button" title="Delete" aria-label="Delete" data-transfer-delete="${escapeHtml(record.learnerId)}">${Icon.trash}</button></div></td>
    </tr>
  `).join("");
  body.querySelectorAll("[data-transfer-delete]").forEach((button) => button.addEventListener("click", () => { const record = transferRecords.find((item) => item.learnerId === button.dataset.transferDelete); if (record) deleteArchiveRecord(record.transferType === "Transfer In" ? "learners" : "transferredOut", getSelectedSchoolYear(), record, () => loadTransferInfo(getSelectedSchoolYear())); }));
}
