// @ts-nocheck -- ported from the original site; behavior preserved, not yet fully typed.
import { LPSApi } from './sheets-api';
import { requireAuth } from './auth';
import { getSelectedSchoolYear, initYearSwitcher } from './school-year';
import { isTeacher } from './app-config';
import { escapeHtml, formatAppDate, renderShell, showToast } from './shell';

export const DATA_PAGE_SIZE = 100;
export const DATA_EXPORT_CONCURRENCY = 3;
export let dataRequestId = 0;
export let dataRecords = [];
export let activeExport = null;

export const DATA_FIELDS = [
  ["learnerId", "Learner ID"], ["firstName", "First Name"], ["middleName", "Middle Name"], ["lastName", "Last Name"], ["birthDate", "Birthdate"], ["age", "Age"],
  ["gradeLevel", "Grade Level"], ["section", "Section"], ["gender", "Gender"],
  ["guardian", "Guardian"], ["contact", "Contact"], ["is4Ps", "4Ps"], ["isIP", "IP"],
  ["isSNED", "SNED"], ["isARAL", "ARAL"], ["isMuslim", "Muslim"], ["dateAdded", "Date Added"],
  ["bosyHeight", "BOSY Height"], ["bosyWeight", "BOSY Weight"], ["bosyNutritionalStatus", "BOSY Nutritional Status"],
  ["mosyHeight", "MOSY Height"], ["mosyWeight", "MOSY Weight"], ["mosyNutritionalStatus", "MOSY Nutritional Status"],
  ["eosyHeight", "EOSY Height"], ["eosyWeight", "EOSY Weight"], ["eosyNutritionalStatus", "EOSY Nutritional Status"],
  ["bosyCRLA", "BOSY CRLA"], ["mosyCRLA", "MOSY CRLA"], ["eosyCRLA", "EOSY CRLA"],
  ["bosyPhilIRI", "BOSY Phil-IRI"], ["mosyPhilIRI", "MOSY Phil-IRI"], ["eosyPhilIRI", "EOSY Phil-IRI"],
  ["bosyRMA", "BOSY RMA"], ["mosyRMA", "MOSY RMA"], ["eosyRMA", "EOSY RMA"],
  ["transferType", "Transfer Type"], ["transferSchool", "Transfer School"], ["transferDate", "Transfer Date"],
  ["transferReason", "Transfer Reason"], ["transferNotes", "Transfer Notes"],
  ["enrollmentStatus", "Enrollment Status"], ["eosyStatus", "EOSY Status"], ["schoolYear", "School Year"],
];

export function initDataPage() {
  renderShell("data", "Data");
  if (isTeacher()) {
    document.getElementById("downloadAllBtn")?.setAttribute("title", "Download all learners in the current school year");
    document.getElementById("downloadFilteredBtn")?.setAttribute("title", "Download filtered learners in the current school year");
  }
  ["dataSearch", "dataGrade", "dataProgram", "dataGender"].forEach((id) => {
    const element = document.getElementById(id);
    element.addEventListener("input", debounceDataLoad);
    element.addEventListener("change", debounceDataLoad);
  });
  document.getElementById("dataRefreshBtn").addEventListener("click", () => loadDataRecords(getSelectedSchoolYear()));
  document.getElementById("downloadFilteredBtn").addEventListener("click", () => downloadData(false, "xls"));
  document.getElementById("downloadAllBtn").addEventListener("click", () => downloadData(true, "xls"));
  document.getElementById("downloadCsvBtn").addEventListener("click", () => downloadData(false, "csv"));
  document.getElementById("downloadTransferredOutBtn").addEventListener("click", () => downloadArchive("transferredOut", "Transferred-Out"));
  document.getElementById("downloadDropoutBtn").addEventListener("click", () => downloadArchive("dropout", "Dropout"));
  document.getElementById("dataExportCancelBtn").addEventListener("click", cancelDataExport);
  initYearSwitcher().then(() => loadDataRecords(getSelectedSchoolYear())).catch((error) => {
    const count = document.getElementById("dataRecordCount");
    if (count && count.textContent === "Loading Firestore records...") {
      count.textContent = "Unable to load records";
      document.getElementById("dataFilterSummary").textContent = error.message || "Unable to initialize school years.";
    }
  });
}

export function debounceDataLoad() {
  clearTimeout(debounceDataLoad.timer);
  debounceDataLoad.timer = setTimeout(() => loadDataRecords(getSelectedSchoolYear()), 300);
}

export function dataFilters() {
  return {
    search: document.getElementById("dataSearch").value.trim(),
    gradeLevel: document.getElementById("dataGrade").value,
    program: document.getElementById("dataProgram").value,
    gender: document.getElementById("dataGender").value,
  };
}

export async function fetchAllDataRecords(schoolYear, filters) {
  const firstPage = await LPSApi.getLearners({ ...filters, schoolYear, page: 1, pageSize: DATA_PAGE_SIZE });
  const total = Number(firstPage.total || 0);
  const pageCount = Math.ceil(total / DATA_PAGE_SIZE);
  if (pageCount <= 1) return firstPage.items || [];

  const pageResults = new Array(pageCount);
  pageResults[0] = firstPage;
  let nextPage = 2;
  let completedPages = 1;
  const fetchPage = async () => {
    while (nextPage <= pageCount) {
      if (activeExport?.cancelled) throw new Error("Download cancelled.");
      const page = nextPage++;
      pageResults[page - 1] = await LPSApi.getLearners({ ...filters, schoolYear, page, pageSize: DATA_PAGE_SIZE });
      completedPages += 1;
      updateExportProgress(`Fetching records (${completedPages}/${pageCount} pages)...`, completedPages / pageCount * 80);
    }
  };
  await Promise.all(Array.from({ length: Math.min(DATA_EXPORT_CONCURRENCY, pageCount - 1) }, fetchPage));
  return pageResults.flatMap((result) => result.items || []);
}

export async function fetchDataPreview(schoolYear, filters) {
  return LPSApi.getLearners({ ...filters, schoolYear, page: 1, pageSize: DATA_PAGE_SIZE });
}

export async function loadDataRecords(schoolYear = getSelectedSchoolYear()) {
  const requestId = ++dataRequestId;
  const count = document.getElementById("dataRecordCount");
  count.textContent = "Loading Firestore records...";
  try {
    const result = await fetchDataPreview(schoolYear, dataFilters());
    if (requestId !== dataRequestId) return;
    dataRecords = result.items || [];
    count.textContent = `${Number(result.total || 0).toLocaleString()} records ready`;
    document.getElementById("dataFilterSummary").textContent = `${schoolYear || "Current school year"} · Filtered preview and exports are ready`;
  } catch (error) {
    if (requestId !== dataRequestId) return;
    dataRecords = [];
    count.textContent = "Unable to load records";
    document.getElementById("dataFilterSummary").textContent = error.message;
  }
}

export async function downloadData(fullMasterlist, format) {
  if (activeExport) return;
  const button = fullMasterlist ? document.getElementById("downloadAllBtn") : document.getElementById("downloadFilteredBtn");
  const original = button.textContent;
  activeExport = { cancelled: false };
  button.disabled = true;
  button.textContent = "Preparing...";
  setExportStatus("Preparing download...", 0);
  try {
    updateExportProgress("Fetching records...", 5);
    const records = await fetchAllDataRecords(getSelectedSchoolYear(), fullMasterlist ? {} : dataFilters());
    if (!records.length) throw new Error("No learner records match the selected filters.");
    const filters = fullMasterlist ? {} : dataFilters();
    const suffix = fullMasterlist ? "masterlist" : exportFilterName(filters);
    const filename = `San-Roque-${suffix}-${getSelectedSchoolYear() || "current"}`;
    updateExportProgress(`Generating ${format.toUpperCase()} file...`, 90);
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    if (format === "csv") downloadBlob(buildCsv(records), `${filename}.csv`, "text/csv;charset=utf-8");
    else downloadBlob(buildExcel(records, getSelectedSchoolYear()), `${filename}.xls`, "application/vnd.ms-excel");
    updateExportProgress("Download started.", 100);
    showToast(`${records.length.toLocaleString()} learner records downloaded.`, "success");
  } catch (error) {
    if (error.message !== "Download cancelled.") showToast(error.message, "error");
  } finally {
    activeExport = null;
    button.disabled = false;
    button.textContent = original;
    window.setTimeout(() => setExportStatus("", 0, true), 1200);
  }
}

export function setExportStatus(message, percent, hidden = false) {
  const status = document.getElementById("dataExportStatus");
  if (!status) return;
  status.hidden = hidden;
  if (hidden) return;
  document.getElementById("dataExportStatusText").textContent = message;
  document.getElementById("dataExportProgressText").textContent = `${Math.round(percent)}%`;
  document.getElementById("dataExportProgress").style.width = `${Math.max(0, Math.min(100, percent))}%`;
}

export function updateExportProgress(message, percent) {
  if (activeExport) setExportStatus(message, percent);
}

export function cancelDataExport() {
  if (activeExport) activeExport.cancelled = true;
}

export async function downloadArchive(archive, label) {
  const button = document.getElementById(archive === "dropout" ? "downloadDropoutBtn" : "downloadTransferredOutBtn");
  const original = button.textContent;
  button.disabled = true;
  button.textContent = "Preparing...";
  try {
    const schoolYear = getSelectedSchoolYear();
    const records = await LPSApi.getArchiveRecords(archive, schoolYear);
    if (!records.length) throw new Error(`No records found in the ${label} archive.`);
    downloadBlob(buildExcel(records, schoolYear || "Current school year"), `San-Roque-${label}-${(schoolYear || "current").replace(/\s+/g, "")}.xls`, "application/vnd.ms-excel");
    showToast(`${records.length.toLocaleString()} ${label} records downloaded.`, "success");
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}

export function exportFilterName(filters) {
  if (filters.gradeLevel) return filters.gradeLevel.toLowerCase().replace(/\s+/g, "-");
  if (filters.program) return filters.program.toLowerCase() + "-learners";
  if (filters.gender) return filters.gender.toLowerCase() + "-learners";
  return "filtered-learners";
}

export function exportColumns(records) {
  const extras = new Set();
  records.forEach((record) => Object.keys(record.extra || {}).forEach((key) => extras.add(key)));
  return DATA_FIELDS.concat([...extras].map((key) => [key, humanizeDataHeader(key)]));
}

export function humanizeDataHeader(value) {
  return String(value).replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function exportValue(record, key) {
  if (key === "is4Ps" || key === "isIP" || key === "isSNED" || key === "isARAL" || key === "isMuslim") return record[key] ? "Yes" : "No";
  if (key === "dateAdded") return formatAppDate(record[key], "");
  if (record[key] != null && record[key] !== "") return record[key];
  return record.extra?.[key] || "";
}

export function buildExcel(records, schoolYear) {
  const columns = exportColumns(records);
  const header = columns.map(([, label]) => `<th>${escapeHtml(label)}</th>`).join("");
  const rows = records.map((record) => `<tr>${columns.map(([key]) => `<td${key === "learnerId" ? " class=\"text-cell\"" : ""}>${escapeHtml(String(exportValue(record, key)))}</td>`).join("")}</tr>`).join("");
  return `<html><head><meta charset="UTF-8"><style>.text-cell{mso-number-format:'\\@';}</style></head><body><h2>San Roque Elementary School - Learner Masterlist</h2><p>School year: ${escapeHtml(schoolYear || "Current")}</p><table border="1"><thead><tr>${header}</tr></thead><tbody>${rows}</tbody></table></body></html>`;
}

export function buildCsv(records) {
  const columns = exportColumns(records);
  const cell = (value) => `"${String(value == null ? "" : value).replace(/"/g, '""')}"`;
  const textCell = (value) => {
    const text = String(value == null ? "" : value);
    return text ? cell(`'${text}`) : cell("");
  };
  return [
    columns.map(([, label]) => cell(label)).join(","),
    ...records.map((record) => columns.map(([key]) => key === "learnerId"
      ? textCell(exportValue(record, key))
      : cell(exportValue(record, key))).join(",")),
  ].join("\r\n");
}

export function downloadBlob(content, filename, type) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([content], { type }));
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}
