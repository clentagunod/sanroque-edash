// @ts-nocheck -- ported from the original site; behavior preserved, not yet fully typed.
import { LPSApi } from './sheets-api';
import { requireAuth } from './auth';
import { getSelectedSchoolYear, initYearSwitcher } from './school-year';
import { escapeHtml, formatAppDate, renderShell, showToast, startExportIndicator } from './shell';
import { DEMO_BREAKDOWN, DEMO_SUMMARY, isSheetsApiConfigured } from './demo-data';
import { paginationPageNumbers } from './app-config';
import { fsGetReportsData, fsSubscribeLearners } from './firestore-api';

export let REPORTS_DATA = null;
export let EOSY_SORT_DESCENDING = false;
export let EOSY_PAGE = 1;
export const EOSY_PAGE_SIZE = 25;
/** Live learner subscription for the selected year — reports update instantly when a learner changes. */
export let reportsLearnerUnsubscribe = null;

export async function initReports() {
  renderShell("reports", "Statistics");
  await initYearSwitcher((year) => {
    reportsLearnerUnsubscribe?.();
    reportsLearnerUnsubscribe = year ? fsSubscribeLearners(year, () => refreshReportsQuiet(year), () => {}) : null;
    return loadReportsData(year);
  });
  document.getElementById("exportBtn").addEventListener("click", exportExcel);
    updateExportLabel();
    ["eosyStatusFilter", "eosyGradeFilter", "eosySortField"].forEach((id) => document.getElementById(id).addEventListener("change", () => { EOSY_PAGE = 1; renderEosyStatusReport(); }));
    document.getElementById("eosySortDirection").addEventListener("click", () => {
      EOSY_SORT_DESCENDING = !EOSY_SORT_DESCENDING;
      renderEosyStatusReport();
    });
}

/** Quiet live refresh: recompute the reports from the shared in-memory learners
 *  snapshot (no network round trip) and re-render — without touching the
 *  loading/demo states a normal load would show. */
export async function refreshReportsQuiet(schoolYear) {
  if (!schoolYear || typeof fsGetReportsData !== "function") return;
  try {
    const data = await fsGetReportsData(schoolYear);
    if (!data || schoolYear !== getSelectedSchoolYear()) return;
    REPORTS_DATA = data;
    const demoBanner = document.getElementById("demoBanner");
    if (demoBanner) demoBanner.style.display = "none";
    renderStatPills(data);
    renderBarChart(data);
    renderDonut(data);
    renderBreakdownTable(data.breakdown || []);
    updateExportLabel();
  } catch (error) {
    // Deliberately quiet: a live refresh must never wipe a working report.
  }
}

export function updateExportLabel() {
  const button = document.getElementById("exportBtn");
  if (button) button.lastChild.textContent = ` Export ${getSelectedSchoolYear() || "Current"} Excel`;
}

export async function loadReportsData(schoolYear) {
  let data;
  try {
    data = await LPSApi.getReportsData(schoolYear);
  } catch (e) {
    if (isSheetsApiConfigured() && typeof fsGetReportsData !== "function") {
      const banner = document.getElementById("demoBanner");
      if (banner) {
        banner.textContent = `Unable to load live report data for ${schoolYear || "the selected school year"}: ${e.message || "Please try again."}`;
        banner.style.display = "flex";
      }
      return;
    }
    data = { ...DEMO_SUMMARY, breakdown: DEMO_BREAKDOWN };
    document.getElementById("demoBanner").style.display = "flex";
  }
  REPORTS_DATA = data;
  const demoBanner = document.getElementById("demoBanner");
  if (demoBanner) demoBanner.style.display = "none";

  renderStatPills(data);
  renderBarChart(data);
  renderProfileGraphs(data);
  renderProfileGraphs(data);
  renderDonut(data);
  renderBreakdownTable(data.breakdown || []);
  updateExportLabel();
}

export function renderEosyStatusReport() {
  const body = document.getElementById("eosyStatusTableBody");
  if (!body) return;
  const status = document.getElementById("eosyStatusFilter")?.value || "";
  const grade = document.getElementById("eosyGradeFilter")?.value || "";
  const sortField = document.getElementById("eosySortField")?.value || "name";
  const descending = EOSY_SORT_DESCENDING;
  const rows = (REPORTS_DATA?.learners || [])
    .filter((learner) => (!status || learner.eosyStatus === status) && (!grade || learner.gradeLevel === grade) && learner.eosyStatus)
    .slice()
    .sort((a, b) => {
      const left = String(a[sortField] || (sortField === "name" ? a.name || `${a.firstName || ""} ${a.lastName || ""}` : "")).toLowerCase();
      const right = String(b[sortField] || (sortField === "name" ? b.name || `${b.firstName || ""} ${b.lastName || ""}` : "")).toLowerCase();
      return (left.localeCompare(right, undefined, { numeric: true }) || String(a.learnerId).localeCompare(String(b.learnerId))) * (descending ? -1 : 1);
    });
  const resultCount = document.getElementById("eosyResultCount");
  if (resultCount) resultCount.textContent = `${rows.length} learner${rows.length === 1 ? "" : "s"}`;
  const directionButton = document.getElementById("eosySortDirection");
  if (directionButton) {
    directionButton.textContent = descending ? "Z-A" : "A-Z";
    directionButton.setAttribute("aria-label", descending ? "Sort descending" : "Sort ascending");
  }
  const pageCount = Math.max(1, Math.ceil(rows.length / EOSY_PAGE_SIZE));
  EOSY_PAGE = Math.min(EOSY_PAGE, pageCount);
  const pageRows = rows.slice((EOSY_PAGE - 1) * EOSY_PAGE_SIZE, EOSY_PAGE * EOSY_PAGE_SIZE);
  body.innerHTML = pageRows.length ? pageRows.map((learner) => `<tr><td class="cell-name">${escapeHtml(learner.name || `${learner.firstName || ""} ${learner.lastName || ""}`)}</td><td>${escapeHtml(learner.gradeLevel || "—")}</td><td><strong>${escapeHtml(learner.eosyStatus)}</strong></td></tr>`).join("") : `<tr><td colspan="3" class="state-row">No EOSY statuses recorded.</td></tr>`;
  renderEosyPagination(rows.length, pageCount);
}

export function renderEosyPagination(total, pageCount) {
  const info = document.getElementById("eosyPageInfo");
  const buttons = document.getElementById("eosyPagerBtns");
  if (!info || !buttons) return;
  info.textContent = total ? `${(EOSY_PAGE - 1) * EOSY_PAGE_SIZE + 1}-${Math.min(EOSY_PAGE * EOSY_PAGE_SIZE, total)} of ${total}` : "0 learners";
  const pageNumbers = paginationPageNumbers(EOSY_PAGE, pageCount);
  buttons.innerHTML = `<button type="button" aria-label="Previous page" ${EOSY_PAGE === 1 ? "disabled" : ""}>‹</button>${pageNumbers.map((value) => value === "..." ? `<span class="pager-ellipsis" aria-hidden="true">…</span>` : `<button type="button" class="${value === EOSY_PAGE ? "is-active" : ""}" data-page="${value}">${value}</button>`).join("")}<button type="button" aria-label="Next page" ${EOSY_PAGE === pageCount ? "disabled" : ""}>›</button>`;
  [...buttons.children].forEach((button, index) => {
    if (!button.disabled && !button.classList.contains("pager-ellipsis")) {
      button.addEventListener("click", () => {
        EOSY_PAGE = button.dataset.page ? Number(button.dataset.page) : index === 0 ? EOSY_PAGE - 1 : EOSY_PAGE + 1;
        renderEosyStatusReport();
      });
    }
  });
}

export function renderStatPills(s) {
  document.getElementById("statPillRow").innerHTML = `
    <div class="stat-pill"><strong>${s.totalLearners.toLocaleString()}</strong>Total learners</div>
    <div class="stat-pill"><strong>${s.fourPsCount.toLocaleString()}</strong>4Ps beneficiaries</div>
    <div class="stat-pill"><strong>${s.ipCount.toLocaleString()}</strong>IP learners</div>
    <div class="stat-pill"><strong>${s.snedCount.toLocaleString()}</strong>SNED learners</div>
    <div class="stat-pill"><strong>${s.aralCount.toLocaleString()}</strong>ARAL tagged</div>
    <div class="stat-pill"><strong>${(s.muslimCount || 0).toLocaleString()}</strong>Muslim learners</div>
    <div class="stat-pill"><strong>${(s.maleCount || 0).toLocaleString()}</strong>Male</div>
    <div class="stat-pill"><strong>${(s.femaleCount || 0).toLocaleString()}</strong>Female</div>`;
}

export function renderBarChart(s) {
  const levels = (s.gradeLevels || []).map((grade) => ({ label: grade.label || grade.gradeLevel || "—", value: Number(grade.value ?? grade.total) || 0 }));
  const max = Math.max(...levels.map((g) => g.value), 1);
  document.getElementById("gradeBarChart").innerHTML = levels.map((g) => `
    <div class="bar-col">
      <div class="bar-value">${g.value}</div>
      <div class="bar-rect" style="height:${(g.value / max) * 170}px"></div>
      <div class="bar-label">${g.label}</div>
    </div>`).join("");
}

export function renderProfileGraphs(data) {
  [["readingProfileGraph", data.readingProfiles], ["mathProfileGraph", data.mathProfiles], ["nutritionProfileGraph", data.nutritionProfiles]].forEach(([id, levels]) => {
    const chart = document.getElementById(id);
    if (!chart) return;
    const rows = Array.isArray(levels) ? levels : [];
    const max = Math.max(...rows.map((row) => Number(row.value) || 0), 1);
    chart.innerHTML = rows.length ? rows.map((row) => `<div class="bar-col"><div class="bar-value">${row.value}</div><div class="bar-rect" style="height:${(row.value / max) * 120}px"></div><div class="bar-label">${escapeHtml(row.label)}</div></div>`).join("") : `<span class="state-row">No profile records</span>`;
  });
}

export function renderDonut(s) {
  const segments = [
    { label: "Not Tagged", value: s.notTaggedCount, color: "#2f6fed" },
    { label: "4Ps Beneficiaries", value: s.fourPsCount, color: "#d94f70" },
    { label: "IP Learners", value: s.ipCount, color: "#1e8e5a" },
    { label: "SNED Learners", value: s.snedCount, color: "#7c5cd1" },
    { label: "ARAL Tagged", value: s.aralCount, color: "#e08a2b" },
    { label: "Muslim Learners", value: s.muslimCount || 0, color: "#31527f" },
  ];
  const total = segments.reduce((sum, seg) => sum + seg.value, 0) || 1;
  const radius = 70, circumference = 2 * Math.PI * radius;
  let offset = 0;
  const circles = segments.map((seg) => {
    const fraction = seg.value / total;
    const length = fraction * circumference;
    const circle = `<circle cx="90" cy="90" r="${radius}" fill="none" stroke="${seg.color}" stroke-width="26"
      stroke-dasharray="${length} ${circumference - length}" stroke-dashoffset="${-offset}" transform="rotate(-90 90 90)" />`;
    offset += length;
    return circle;
  }).join("");
  document.getElementById("donutSvg").innerHTML = `<svg viewBox="0 0 180 180" width="190" height="190">${circles}<circle cx="90" cy="90" r="44" fill="#fff" /></svg>`;
  document.getElementById("donutLegend").innerHTML = segments.map((seg) => `
    <div class="legend-row">
      <span class="legend-key"><span class="legend-dot" style="background:${seg.color}"></span>${seg.label}</span>
      <span class="legend-val">${seg.value.toLocaleString()} (${((seg.value / total) * 100).toFixed(1)}%)</span>
    </div>`).join("");
}

export function renderBreakdownTable(rows) {
  document.getElementById("breakdownTableBody").innerHTML = rows.map((r) => `
    <tr>
      <td class="cell-name">${escapeHtml(r.gradeLevel)}</td>
      <td>${r.total}</td>
      <td>${r.male || 0}</td>
      <td>${r.female || 0}</td>
      <td><span class="badge badge-4ps">${r.fourPs}</span></td>
      <td><span class="badge badge-ip">${r.ip}</span></td>
      <td><span class="badge badge-sned">${r.sned}</span></td>
      <td><span class="badge badge-aral">${r.aral}</span></td>
      <td><span class="badge badge-muslim">${r.muslim || 0}</span></td>
    </tr>`).join("") || `<tr><td colspan="9" class="state-row">No data available.</td></tr>`;
}

export function excelCell(value) {
  return `<td${arguments.length > 1 && arguments[1] === "learnerId" ? " class=\"text-cell\"" : ""}>${escapeHtml(value == null ? "" : String(value))}</td>`;
}

export async function exportExcel() {
  if (!REPORTS_DATA) return;
  const yearLabel = getSelectedSchoolYear() || "Current";
  const button = document.getElementById("exportBtn");
  const indicator = startExportIndicator("Preparing enrollment export...", button);
  if (!indicator) return;
  const originalLabel = button.innerHTML;
  button.disabled = true;
  button.textContent = "Preparing…";
  let learners = REPORTS_DATA.learners || [];
  try {
    indicator.update("Preparing enrollment workbook...", 15);
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    if (indicator.cancelled) return;
    if (learners.length === 0 && isSheetsApiConfigured()) {
      const schoolYear = yearLabel === "Current" ? "" : yearLabel;
      const pageSize = 100;
      let page = 1;
      do {
        const result = await LPSApi.getLearnerPage({ page, pageSize, schoolYear });
        learners = learners.concat(result.items || []);
        indicator.update(`Fetching learner records (page ${page})...`, 15 + Math.min(65, learners.length / Math.max(result.total || learners.length, 1) * 65));
        if (!result.items || result.items.length < pageSize || learners.length >= result.total) break;
        page += 1;
      } while (page <= 100);
    }
    if (indicator.cancelled) return;
  } catch (error) {
    showToast("Could not load learner records for the Excel export.", "error");
    indicator.close();
    button.disabled = false;
    button.innerHTML = originalLabel;
    return;
  }
  const breakdownRows = (REPORTS_DATA.breakdown || []).map((r) => `
    <tr>${excelCell(r.gradeLevel)}${excelCell(r.total)}${excelCell(r.male || 0)}${excelCell(r.female || 0)}${excelCell(r.fourPs)}${excelCell(r.ip)}${excelCell(r.sned)}${excelCell(r.aral)}${excelCell(r.muslim || 0)}</tr>`).join("");
  const learnerRows = learners.map((l) => `
    <tr>${excelCell(l.learnerId, "learnerId")}${excelCell(l.lastName + ", " + l.firstName)}${excelCell(l.gradeLevel)}${excelCell(l.section)}${excelCell(l.gender)}${excelCell(l.guardian)}${excelCell(l.is4Ps ? "Yes" : "No")}${excelCell(l.isIP ? "Yes" : "No")}${excelCell(l.isSNED ? "Yes" : "No")}${excelCell(l.isARAL ? "Yes" : "No")}${excelCell(l.isMuslim ? "Yes" : "No")}${excelCell(formatAppDate(l.dateAdded))}</tr>`).join("");
  const workbook = `
    <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
      <head><meta charset="UTF-8"><style>
        body{font-family:Arial,sans-serif;color:#16213a}h1{font-size:20px}h2{font-size:15px;margin-top:24px}table{border-collapse:collapse;margin-bottom:18px}th,td{border:1px solid #b9c5d9;padding:6px 9px;text-align:left}th{background:#dfeaff;font-weight:bold}.metric{font-weight:bold;background:#f1f5fb}.text-cell{mso-number-format:'\\@';}
      </style></head>
      <body>
        <h1>San Roque Elementary School - Enrollment Report</h1>
        <p>School year: <strong>${escapeHtml(yearLabel)}</strong></p>
        <h2>Summary</h2>
        <table><tr><th>Metric</th><th>Count</th></tr>
          <tr class="metric"><td>Total learners</td>${excelCell(REPORTS_DATA.totalLearners)}</tr>
          <tr><td>4Ps beneficiaries</td>${excelCell(REPORTS_DATA.fourPsCount)}</tr>
          <tr><td>IP learners</td>${excelCell(REPORTS_DATA.ipCount)}</tr>
          <tr><td>SNED learners</td>${excelCell(REPORTS_DATA.snedCount)}</tr>
          <tr><td>ARAL tagged</td>${excelCell(REPORTS_DATA.aralCount)}</tr>
          <tr><td>Not tagged</td>${excelCell(REPORTS_DATA.notTaggedCount)}</tr>
          <tr><td>Muslim learners</td>${excelCell(REPORTS_DATA.muslimCount || 0)}</tr>
          <tr><td>Male learners</td>${excelCell(REPORTS_DATA.maleCount || 0)}</tr>
          <tr><td>Female learners</td>${excelCell(REPORTS_DATA.femaleCount || 0)}</tr>
        </table>
        <h2>Grade and Program Breakdown</h2>
        <table><tr><th>Grade Level</th><th>Total</th><th>Male</th><th>Female</th><th>4Ps</th><th>IP</th><th>SNED</th><th>ARAL</th><th>Muslim</th></tr>${breakdownRows}</table>
        <h2>Learner Records</h2>
        <table><tr><th>Learner ID</th><th>Name</th><th>Grade</th><th>Section</th><th>Gender</th><th>Guardian</th><th>4Ps</th><th>IP</th><th>SNED</th><th>ARAL</th><th>Muslim</th><th>Date Added</th></tr>${learnerRows}</table>
      </body>
    </html>`;
  const blob = new Blob(["\ufeff", workbook], { type: "application/vnd.ms-excel" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `san-roque-es-enrollment-report-${yearLabel.replace(/\s+/g, "")}.xls`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  indicator.finish();
  button.disabled = false;
  button.innerHTML = originalLabel;
  showToast("Excel report downloaded.", "success");
}
