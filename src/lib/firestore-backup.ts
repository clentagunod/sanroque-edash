// @ts-nocheck -- ported from the original site; behavior preserved, not yet fully typed.
import { FS_DROPOUTS, FS_LEARNERS, FS_SCHOOL_YEARS, FS_SETTINGS, FS_TRANSFERRED_OUT, FS_USERS, fsGetSections } from './firestore-api';
import { APP_CONFIG } from './app-config';
import { clearButtonLoading, setButtonLoading, showToast } from './shell';
import { auth, db } from './firebase';

export const BACKUP_LEARNER_FIELDS = [
  ["learnerId", "LRN"], ["firstName", "First Name"], ["lastName", "Last Name"], ["middleName", "Middle Name"], ["age", "Age"], ["birthDate", "Birthdate"],
  ["name", "Full Name"], ["gradeLevel", "Grade Level"], ["section", "Section"], ["gender", "Gender"], ["guardian", "Guardian"], ["contact", "Contact"],
  ["enrollmentStatus", "Enrollment Status"], ["eosyStatus", "EOSY Status"], ["schoolYear", "School Year"], ["dateAdded", "Date Added"],
  ["is4Ps", "4Ps"], ["isIP", "IP"], ["isSNED", "SNED"], ["isARAL", "ARAL"], ["isMuslim", "Muslim"],
  ["bosyHeight", "BOSY Height"], ["bosyWeight", "BOSY Weight"], ["bosyNutritionalStatus", "BOSY Nutritional Status"],
  ["mosyHeight", "MOSY Height"], ["mosyWeight", "MOSY Weight"], ["mosyNutritionalStatus", "MOSY Nutritional Status"],
  ["eosyHeight", "EOSY Height"], ["eosyWeight", "EOSY Weight"], ["eosyNutritionalStatus", "EOSY Nutritional Status"],
  ["bosyCRLA", "BOSY CRLA"], ["mosyCRLA", "MOSY CRLA"], ["eosyCRLA", "EOSY CRLA"],
  ["bosyPhilIRI", "BOSY Phil-IRI"], ["mosyPhilIRI", "MOSY Phil-IRI"], ["eosyPhilIRI", "EOSY Phil-IRI"],
  ["bosyRMA", "BOSY RMA"], ["mosyRMA", "MOSY RMA"], ["eosyRMA", "EOSY RMA"],
  ["filipino", "Filipino"], ["english", "English"], ["math", "Math"], ["science", "Science"], ["aralPan", "Aral Pan"], ["esp", "ESP"],
  ["music", "Music"], ["arts", "Arts"], ["pe", "PE"], ["health", "Health"], ["epp", "EPP"], ["motherTongue", "Mother Tongue"],
  ["transferType", "Transfer Type"], ["transferIn", "Transfer In"], ["transferOut", "Transfer Out"], ["transferSchool", "Transfer School"],
  ["transferDate", "Transfer Date"], ["transferReason", "Transfer Reason"], ["transferNotes", "Transfer Notes"],
];

export function backupValue(value) {
  if (value && typeof value.toDate === "function") return value.toDate().toISOString();
  if (value && typeof value === "object") return JSON.stringify(value);
  return value == null ? "" : value;
}

export async function backupCollection(collection) {
  const snapshot = await collection.get();
  return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}

export async function collectFirestoreBackup() {
  const yearsSnapshot = await db.collection(FS_SCHOOL_YEARS).get();
  const years = yearsSnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })).sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const [users, sections, publicStats] = await Promise.all([
    backupCollection(db.collection(FS_USERS)),
    fsGetSections(""),
    backupCollection(db.collection("publicStats")),
  ]);
  const settings = [];
  const currentYear = await db.collection(FS_SETTINGS).doc("currentSchoolYear").get();
  if (currentYear.exists) settings.push({ id: currentYear.id, ...currentYear.data() });
  const yearData = await Promise.all(years.map(async (year) => {
    const [learners, dropouts, transfers] = await Promise.all([
      backupCollection(db.collection(FS_LEARNERS).doc(year.id).collection("records")),
      backupCollection(db.collection(FS_DROPOUTS).doc(year.id).collection("records")),
      backupCollection(db.collection(FS_TRANSFERRED_OUT).doc(year.id).collection("records")),
    ]);
    return { schoolYear: year.id, learners, dropouts, transfers };
  }));
  return { exportedAt: new Date().toISOString(), years, users, sections, settings, publicStats, yearData };
}

export function backupEscape(value) {
  return String(value == null ? "" : value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function backupHumanize(value) {
  return String(value).replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function backupSheet(name, records, preferredFields = []) {
  const rows = Array.isArray(records) ? records : [];
  const keys = [...preferredFields.map(([key]) => key), ...new Set(rows.flatMap((row) => Object.keys(row)))].filter((key, index, all) => all.indexOf(key) === index);
  const headers = keys.map((key) => preferredFields.find(([field]) => field === key)?.[1] || backupHumanize(key));
  const body = rows.map((row) => `<tr>${keys.map((key) => `<td>${backupEscape(backupValue(row[key]))}</td>`).join("")}</tr>`).join("");
  return `<section><h2>${backupEscape(name)}</h2><table border="1"><thead><tr>${headers.map((header) => `<th>${backupEscape(header)}</th>`).join("")}</tr></thead><tbody>${body}</tbody></table></section>`;
}

export function buildFirestoreBackupWorkbook(backup) {
  const sheets = [
    backupSheet("SchoolYears", backup.years), backupSheet("Users", backup.users), backupSheet("Sections", backup.sections),
    backupSheet("Settings", backup.settings), backupSheet("PublicStats", backup.publicStats),
  ];
  backup.yearData.forEach((year) => {
    const suffix = String(year.schoolYear).replace(/[^0-9A-Za-z]/g, "_");
    sheets.push(backupSheet(`Learners_${suffix}`, year.learners, BACKUP_LEARNER_FIELDS));
    sheets.push(backupSheet(`Dropouts_${suffix}`, year.dropouts, BACKUP_LEARNER_FIELDS));
    sheets.push(backupSheet(`TransferredOut_${suffix}`, year.transfers, BACKUP_LEARNER_FIELDS));
  });
  return `<html><head><meta charset="UTF-8"><style>body{font-family:Arial;color:#16213a}h1{font-size:20px}h2{font-size:15px;margin-top:26px}table{border-collapse:collapse;font-size:11px}th{background:#e8f0fe;font-weight:bold}th,td{padding:5px;border:1px solid #cbd5e1;white-space:nowrap}</style></head><body><h1>San Roque ES Firestore Backup</h1><p>Exported: ${backupEscape(backup.exportedAt)}. Learner sheets are organized by school year; LRN is the first learner column.</p>${sheets.join("")}</body></html>`;
}

export async function downloadFirestoreBackup() {
  const button = document.getElementById("downloadFirestoreBackupBtn");
  const status = document.getElementById("firestoreBackupStatus");
  setButtonLoading(button, "Backing up to Sheets…");
  if (status) { status.hidden = false; status.textContent = "Reading users, school years, sections, learners, and archives…"; }
  try {
    const endpoint = APP_CONFIG.backupSpreadsheetUrl;
    if (!endpoint || !auth.currentUser) throw new Error("The Google Sheets backup service is not configured.");
    const url = new URL(endpoint);
    url.searchParams.set("action", "runBackup");
    url.searchParams.set("token", await auth.currentUser.getIdToken());
    const response = await fetch(url.toString(), { method: "GET", redirect: "follow" });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || "The Google Sheets backup failed.");
    if (status) status.textContent = result.data.message;
    const backupUrl = result.data.url;
    const link = document.getElementById("openBackupSpreadsheetBtn");
    if (link && backupUrl) link.href = backupUrl;
    showToast("Complete Firestore backup written to Google Sheets.", "success");
    return;
  } catch (error) {
    if (status) status.textContent = error.message || "Backup could not be created.";
    showToast(error.message || "Backup could not be created.", "error");
  } finally {
    clearButtonLoading(button);
  }
}
