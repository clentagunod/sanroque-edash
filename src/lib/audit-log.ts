// @ts-nocheck -- ported from the original site; behavior preserved, not yet fully typed.
import { LPSApi } from './sheets-api';
import { isSchoolAdmin } from './app-config';
import { requireAuth } from './auth';
import { APP_CONFIG } from './app-config';
import { appPageHref, escapeHtml, renderShell } from './shell';

export let auditRecords = [];

export async function initAuditLog() {
  if (!isSchoolAdmin()) {
    window.location.replace(appPageHref("dashboard.html"));
    return;
  }
  renderShell("audit-log", "Audit Log");
  document.getElementById("auditSearch")?.addEventListener("input", renderFilteredAuditLog);
  document.getElementById("auditRefreshBtn")?.addEventListener("click", loadAuditLog);
  await loadAuditLog();
}

export async function loadAuditLog() {
  const body = document.getElementById("auditTableBody");
  const meta = document.getElementById("auditMeta");
  if (body) body.innerHTML = `<tr><td colspan="8" class="state-row">Loading audit entries…</td></tr>`;
  if (meta) meta.textContent = "Loading audit entries…";
  try {
    if (!APP_CONFIG.auditLogApiUrl) throw new Error("The AuditLog service is not configured yet.");
    auditRecords = await LPSApi.getAuditLogs();
    renderFilteredAuditLog();
  } catch (error) {
    auditRecords = [];
    if (body) body.innerHTML = `<tr><td colspan="8" class="state-row error">${escapeHtml(error.message || "Unable to load the audit log.")}</td></tr>`;
    if (meta) meta.textContent = "Audit log unavailable";
  }
}

export function renderFilteredAuditLog() {
  const query = document.getElementById("auditSearch")?.value.trim().toLowerCase() || "";
  const records = query
    ? auditRecords.filter((record) => Object.values(record).some((value) => String(value || "").toLowerCase().includes(query)))
    : auditRecords;
  renderAuditTable(records);
}

export function renderAuditTable(records) {
  const body = document.getElementById("auditTableBody");
  const meta = document.getElementById("auditMeta");
  if (!body) return;
  if (!records.length) {
    body.innerHTML = `<tr><td colspan="8" class="state-row">No audit entries found.</td></tr>`;
    if (meta) meta.textContent = "0 entries";
    return;
  }
  body.innerHTML = records.map((record) => {
    const action = String(record.action || "—").toUpperCase();
    return `<tr>
      <td>${escapeHtml(record.timestamp || "—")}</td>
      <td class="cell-name">${escapeHtml(record.user || "—")}</td>
      <td><span class="audit-action" data-action="${escapeHtml(action)}">${escapeHtml(action)}</span></td>
      <td>${escapeHtml(record.sheet || "—")}</td>
      <td>${escapeHtml(record.recordId || "—")}</td>
      <td class="audit-value">${escapeHtml(record.oldValue || "—")}</td>
      <td class="audit-value">${escapeHtml(record.newValue || "—")}</td>
      <td class="audit-value">${escapeHtml(record.ipSession || "—")}</td>
    </tr>`;
  }).join("");
  if (meta) meta.textContent = `${records.length.toLocaleString()} entr${records.length === 1 ? "y" : "ies"}`;
}
