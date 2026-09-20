// @ts-nocheck -- ported from the original site; behavior preserved, not yet fully typed.
import { enrollmentGradeLabel } from './enrollment-data';
import { LPSApi } from './sheets-api';
import { requireAuth } from './auth';
import { getSelectedSchoolYear, initYearSwitcher } from './school-year';
import { escapeHtml, renderShell, showToast, startExportIndicator } from './shell';
import { paginationPageNumbers } from './app-config';

export let gradesProfiles = [];
export let gradesRequestId = 0;
export let gradesSortField = "learnerId";
export let gradesSortDirection = "desc";
export let gradesFilteredProfiles = [];
export let gradesPage = 1;
export const GRADES_PAGE_SIZE = 10;
export const GRADE_SUBJECTS = [
  ["filipino", "Filipino"], ["english", "English"], ["math", "Math"], ["science", "Science"],
  ["aralPan", "AralPan"], ["esp", "ESP"], ["music", "Music"], ["arts", "Arts"],
  ["pe", "PE"], ["health", "Health"], ["epp", "EPP"], ["motherTongue", "Mother Tongue"],
];

export function initGradesProfile() {
  renderShell("grades", "Grades Profile");
  document.getElementById("exportGradesBtn").addEventListener("click", exportGradesExcel);
  document.getElementById("gradesSort").addEventListener("change", (event) => { gradesSortField = event.target.value; renderGradesTable(gradesFilteredProfiles); });
  document.getElementById("gradesSortDirection").addEventListener("change", (event) => { gradesSortDirection = event.target.value; renderGradesTable(gradesFilteredProfiles); });
  ["gradesSearch", "gradesGradeFilter", "gradesProgramFilter", "gradesGenderFilter"].forEach((id) => document.getElementById(id).addEventListener("input", () => { gradesPage = 1; filterGradesProfiles(); }));
  ["gradesGradeFilter", "gradesProgramFilter", "gradesGenderFilter"].forEach((id) => document.getElementById(id).addEventListener("change", () => { gradesPage = 1; filterGradesProfiles(); }));
  initYearSwitcher(loadGradesProfiles);
}

export async function loadGradesProfiles(schoolYear) {
  const body = document.getElementById("gradesTableBody");
  const requestId = ++gradesRequestId;
  body.innerHTML = `<tr><td colspan="16" class="state-row">Loading grades...</td></tr>`;
  try {
    const records = await loadGradesProfileData(schoolYear);
    if (requestId !== gradesRequestId) return;
    gradesProfiles = records || [];
    filterGradesProfiles();
  } catch (error) {
    if (requestId !== gradesRequestId) return;
    gradesProfiles = [];
    gradesFilteredProfiles = [];
    document.getElementById("gradesSummary").innerHTML = "";
    body.innerHTML = `<tr><td colspan="16" class="state-row error">${escapeHtml(error.message || "Unable to load grades.")}<br><small>Add the subject grade columns to the selected Learners school-year tab.</small></td></tr>`;
  }
}

export async function loadGradesProfileData(schoolYear) {
  try {
    return await LPSApi.getGradesProfiles(schoolYear);
  } catch (error) {
    if (!/unknown action|getGradesProfiles/i.test(error.message || "")) throw error;
    const learners = [];
    let page = 1;
    let total = Infinity;
    while (learners.length < total) {
      const result = await LPSApi.getLearnerPage({ schoolYear, page, pageSize: 100 });
      learners.push(...(result.items || []));
      total = Number(result.total || 0);
      if (!result.items?.length || learners.length >= total) break;
      page += 1;
    }
    return learners.map((learner) => createGradeProfileFromLearner(learner));
  }
}

export function createGradeProfileFromLearner(learner) {
  const extra = learner.extra || {};
  const extraByKey = {};
  Object.keys(extra).forEach((key) => { extraByKey[key.toLowerCase().replace(/[^a-z0-9]/g, "")] = extra[key]; });
  const profile = {
    learnerId: learner.learnerId, name: learner.name || `${learner.firstName || ""} ${learner.lastName || ""}`.trim(),
    gradeLevel: learner.gradeLevel, section: learner.section, gender: learner.gender,
    is4Ps: learner.is4Ps, isIP: learner.isIP, isSNED: learner.isSNED, isARAL: learner.isARAL, isMuslim: learner.isMuslim,
  };
  let sum = 0;
  let count = 0;
  GRADE_SUBJECTS.forEach(([key]) => {
    const value = learner[key] ?? extra[key] ?? extraByKey[key.toLowerCase()];
    const normalizedValue = value == null ? "" : String(value).trim();
    profile[key] = normalizedValue;
    if (normalizedValue !== "" && Number.isFinite(Number(normalizedValue))) {
      sum += Number(normalizedValue);
      count += 1;
    }
  });
  profile.average = count ? Math.round((sum / count) * 100) / 100 : "";
  return profile;
}

export function filterGradesProfiles() {
  const search = document.getElementById("gradesSearch").value.trim().toLowerCase();
  const grade = document.getElementById("gradesGradeFilter").value;
  const program = document.getElementById("gradesProgramFilter").value;
  const gender = document.getElementById("gradesGenderFilter").value;
  gradesFilteredProfiles = gradesProfiles.filter((record) => {
    const searchable = `${record.name || ""} ${record.learnerId || ""}`.toLowerCase();
    return (!search || searchable.includes(search)) && (!grade || enrollmentGradeLabel(record.gradeLevel) === enrollmentGradeLabel(grade)) && (!gender || record.gender === gender) && (!program || record[{ "4Ps": "is4Ps", IP: "isIP", SNED: "isSNED", ARAL: "isARAL", Muslim: "isMuslim" }[program]]);
  });
  renderGradesSummary(gradesFilteredProfiles);
  renderGradesTable(gradesFilteredProfiles);
}

export function renderGradesSummary(records) {
  const withAverage = records.filter((record) => record.average !== "" && record.average != null);
  const average = withAverage.length ? withAverage.reduce((sum, record) => sum + Number(record.average), 0) / withAverage.length : 0;
  document.getElementById("gradesSummary").innerHTML = `
    <div class="stat-pill"><strong>${records.length.toLocaleString()}</strong>Learners tracked</div>
    <div class="stat-pill"><strong>${withAverage.length.toLocaleString()}</strong>With grades</div>
    <div class="stat-pill"><strong>${average ? average.toFixed(2) : "—"}</strong>Class average</div>`;
}

export function gradeCell(value) {
  return value === "" || value == null ? `<span class="grade-empty">—</span>` : `<strong>${escapeHtml(value)}</strong>`;
}

export function renderGradesTable(records) {
  const body = document.getElementById("gradesTableBody");
  if (!records.length) {
    body.innerHTML = `<tr><td colspan="16" class="state-row">No grade profiles found.</td></tr>`;
    renderGradesPagination(0, 1);
    return;
  }
  const sortedRecords = records.slice().sort(compareGradeProfiles);
  const pageCount = Math.max(1, Math.ceil(sortedRecords.length / GRADES_PAGE_SIZE));
  gradesPage = Math.min(gradesPage, pageCount);
  const pageRecords = sortedRecords.slice((gradesPage - 1) * GRADES_PAGE_SIZE, gradesPage * GRADES_PAGE_SIZE);
  body.innerHTML = pageRecords.map((record) => `<tr>
    <td class="cell-name">${escapeHtml(record.name || "—")}</td><td>${escapeHtml(record.gradeLevel || "—")}</td><td>${escapeHtml(record.section || "—")}</td>
    ${GRADE_SUBJECTS.map(([key]) => `<td class="grade-cell">${gradeCell(record[key])}</td>`).join("")}
    <td class="average-cell">${gradeCell(record.average)}</td>
  </tr>`).join("");
  renderGradesPagination(sortedRecords.length, pageCount);
}

export function renderGradesPagination(total, pageCount) {
  const info = document.getElementById("gradesPageInfo");
  const buttons = document.getElementById("gradesPagerBtns");
  if (!info || !buttons) return;
  info.textContent = total ? `${(gradesPage - 1) * GRADES_PAGE_SIZE + 1}-${Math.min(gradesPage * GRADES_PAGE_SIZE, total)} of ${total}` : "0 learners";
  const pageNumbers = paginationPageNumbers(gradesPage, pageCount);
  buttons.innerHTML = `<button type="button" aria-label="Previous page" ${gradesPage === 1 ? "disabled" : ""}>‹</button>${pageNumbers.map((value) => value === "..." ? `<span class="pager-ellipsis" aria-hidden="true">…</span>` : `<button type="button" class="${value === gradesPage ? "is-active" : ""}" data-page="${value}">${value}</button>`).join("")}<button type="button" aria-label="Next page" ${gradesPage === pageCount ? "disabled" : ""}>›</button>`;
  [...buttons.children].forEach((button, index) => { if (!button.disabled && !button.classList.contains("pager-ellipsis")) button.addEventListener("click", () => { gradesPage = button.dataset.page ? Number(button.dataset.page) : index === 0 ? gradesPage - 1 : gradesPage + 1; renderGradesTable(gradesFilteredProfiles); }); });
}

export function compareGradeProfiles(first, second) {
  const firstValue = first[gradesSortField];
  const secondValue = second[gradesSortField];
  let comparison;
  if (gradesSortField === "average") {
    const firstAverage = firstValue === "" || firstValue == null ? -Infinity : Number(firstValue);
    const secondAverage = secondValue === "" || secondValue == null ? -Infinity : Number(secondValue);
    comparison = firstAverage - secondAverage;
  } else if (gradesSortField === "gradeLevel") {
    const order = ["Kinder", "Grade 1", "Grade 2", "Grade 3", "Grade 4", "Grade 5", "Grade 6"];
    comparison = order.indexOf(enrollmentGradeLabel(firstValue)) - order.indexOf(enrollmentGradeLabel(secondValue));
  } else {
    comparison = String(firstValue || "").localeCompare(String(secondValue || ""), undefined, { numeric: true, sensitivity: "base" });
  }
  if (comparison === 0) comparison = String(first.learnerId || "").localeCompare(String(second.learnerId || ""), undefined, { numeric: true });
  return gradesSortDirection === "asc" ? comparison : -comparison;
}

export async function exportGradesExcel() {
  if (!gradesFilteredProfiles.length) {
    showToast("There are no grade profiles to export.", "error");
    return;
  }
  const indicator = startExportIndicator("Preparing grades export...", document.getElementById("exportGradesBtn"));
  if (!indicator) return;
  try {
    indicator.update("Building grades workbook...", 45);
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    if (indicator.cancelled) return;
  const year = getSelectedSchoolYear() || "Current";
  const headers = ["Learner ID", "Name", "Grade Level", "Section", ...GRADE_SUBJECTS.map(([, label]) => label), "Average"];
  const values = gradesFilteredProfiles.slice().sort(compareGradeProfiles).map((record) => [record.learnerId, record.name, record.gradeLevel, record.section, ...GRADE_SUBJECTS.map(([key]) => record[key]), record.average]);
  const cell = (value, isLearnerId = false) => `<td${isLearnerId ? " class=\"text-cell\"" : ""}>${escapeHtml(value == null ? "" : String(value))}</td>`;
  const workbook = `<html><head><meta charset="UTF-8"><style>.text-cell{mso-number-format:'\\@';}</style></head><body><h1>San Roque ES Grades Profile - ${escapeHtml(year)}</h1><table border="1"><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr>${values.map((row) => `<tr>${row.map((value, index) => cell(value, index === 0)).join("")}</tr>`).join("")}</table></body></html>`;
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob(["\ufeff", workbook], { type: "application/vnd.ms-excel" }));
  link.download = `san-roque-es-grades-profile-${year.replace(/\s+/g, "")}.xls`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  indicator.finish();
  showToast("Grades profile Excel report downloaded.", "success");
  } catch (error) {
    indicator.close();
    showToast(error.message || "Unable to export grades profile.", "error");
  }
}
