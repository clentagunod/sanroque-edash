// @ts-nocheck -- ported from the original site; behavior preserved, not yet fully typed.
import { escapeHtml, renderShell, showToast } from './shell';
import { LPSApi } from './sheets-api';
import { requireAuth } from './auth';
import { canManageLearners, isTeacher, isVisitorSession, storedAppProfile, teacherAssignmentsForProfile } from './app-config';
import { getSelectedSchoolYear, initYearSwitcher, setSelectedSchoolYear } from './school-year';
import { fsSubscribeLearners, fsSubscribePublicStats, fsSyncEnrollmentData } from './firestore-api';

export let enrollmentRequestId = 0;
export let visitorEnrollmentUnsubscribe = null;
/** Live learner subscription for the selected year — enrollment counts update instantly on any learner change. */
export let enrollmentLearnerUnsubscribe = null;

export const ENROLLMENT_GRADE_ORDER = ["Kinder", "Grade 1", "Grade 2", "Grade 3", "Grade 4", "Grade 5", "Grade 6"];

export function enrollmentGradeLabel(value) {
  const text = String(value || "").trim();
  const key = text.toLowerCase().replace(/\s+/g, " ");
  if (key === "kinder" || key === "kindergarten" || key === "kg") return "Kinder";
  const match = key.match(/^grade\s*(\d+)$/);
  return match ? `Grade ${match[1]}` : text;
}

export function initEnrollmentData() {
  renderShell("enrollment-data", "Enrollment Data");
  const syncButton = document.getElementById("syncEnrollmentBtn");
    if (syncButton && !canManageLearners()) syncButton.remove();
    if (syncButton && typeof fsSyncEnrollmentData === "function") syncButton.textContent = "Refresh counts";
    if (isVisitorSession() && typeof fsSubscribePublicStats === "function") {
      const renderVisitorSummary = (stats) => {
        if (!stats) {
          showVisitorEnrollmentError("Visitor statistics are not initialized yet. Ask a School Admin to open Admin Console once.");
          return;
        }
        const summary = stats.enrollmentData || stats;
        if (!summary || !Array.isArray(summary.rows)) {
          showVisitorEnrollmentError("The current enrollment summary has not been initialized yet. Ask a School Admin to refresh Admin Console.");
          return;
        }
        setSelectedSchoolYear(stats.schoolYear || summary.schoolYear || "");
        renderEnrollmentData(summary);
      };

      const loadVisitorSummaryOnce = async () => {
        try {
          const stats = await Promise.race([
            LPSApi.getPublicStats ? LPSApi.getPublicStats() : Promise.resolve(null),
            new Promise((resolve) => setTimeout(() => resolve(null), 3000)),
          ]);
          if (stats) {
            renderVisitorSummary(stats);
            return;
          }
          showVisitorEnrollmentError("Visitor statistics are not initialized yet. Ask a School Admin to open Admin Console once.");
        } catch (error) {
          showVisitorEnrollmentError(error.message || "Visitor statistics are unavailable right now.");
        }
      };

      void loadVisitorSummaryOnce();
      visitorEnrollmentUnsubscribe?.();
      visitorEnrollmentUnsubscribe = fsSubscribePublicStats((stats) => {
        renderVisitorSummary(stats);
      }, (error) => showVisitorEnrollmentError(error.message));
      initYearSwitcher(() => {});
      return;
    }
  initYearSwitcher((year) => {
    enrollmentLearnerUnsubscribe?.();
    enrollmentLearnerUnsubscribe = year ? fsSubscribeLearners(year, () => loadEnrollmentData(year, true), () => {}) : null;
    return loadEnrollmentData(year);
  });
}

  function showVisitorEnrollmentError(message) {
    const body = document.getElementById("enrollmentTableBody");
    const alert = document.getElementById("enrollmentAlert");
    if (body) body.innerHTML = `<tr><td colspan="6" class="state-row error">${escapeHtml(message)}</td></tr>`;
    if (alert) { alert.textContent = message; alert.style.display = "flex"; }
  }

export async function loadEnrollmentData(schoolYear = getSelectedSchoolYear(), quiet = false) {
  const body = document.getElementById("enrollmentTableBody");
  const requestId = ++enrollmentRequestId;
  const alert = document.getElementById("enrollmentAlert");
  if (!quiet) body.innerHTML = `<tr><td colspan="6" class="state-row">Loading enrollment data...</td></tr>`;
  if (alert && !quiet) alert.style.display = "none";

  try {
    if (!schoolYear) {
      throw new Error(isVisitorSession()
        ? "Visitor statistics are not initialized yet. Ask a School Admin to open Admin Console once."
        : "No school year is configured in Firestore.");
    }
    const result = await LPSApi.getEnrollmentData(schoolYear);
    if (requestId !== enrollmentRequestId) return;
    renderEnrollmentData(result);
    if (canManageLearners()) {
      await Promise.resolve(LPSApi.refreshPublicStats ? LPSApi.refreshPublicStats() : null).catch(() => {});
      const syncResult = await syncEnrollmentCounts(true, schoolYear);
      if (syncResult && syncResult.updated) {
        const refreshed = await LPSApi.getEnrollmentData(schoolYear);
        if (requestId === enrollmentRequestId) renderEnrollmentData(refreshed);
      }
    }
  } catch (error) {
    if (requestId !== enrollmentRequestId) return;
    body.innerHTML = `<tr><td colspan="6" class="state-row error">${escapeHtml(error.message || "Unable to load enrollment data.")}</td></tr>`;
    document.getElementById("enrollmentTitle").textContent = schoolYear || "School year unavailable";
    document.getElementById("enrollmentTotalMale").textContent = "—";
    document.getElementById("enrollmentTotalFemale").textContent = "—";
    document.getElementById("enrollmentGrandTotal").textContent = "—";
    if (alert) {
      alert.textContent = error.message || "Enrollment data is unavailable for this school year. Check the Enrollment_Year registry and sheet name, then try again.";
      alert.style.display = "flex";
    }
  }
}

export async function syncEnrollmentCounts(showFeedback, schoolYear = getSelectedSchoolYear()) {
  const button = document.getElementById("syncEnrollmentBtn");
  if (button) { button.disabled = true; button.textContent = "Syncing..."; }
  try {
    const result = await LPSApi.syncEnrollmentData(schoolYear);
    if (showFeedback) showToast(typeof fsSyncEnrollmentData === "function" ? "Enrollment counts refreshed from Firestore." : `${result.updated} enrollment section${result.updated === 1 ? "" : "s"} synced to the sheet.`, "success");
    return result;
  } catch (error) {
    if (showFeedback && !/not authorized|permission|role/i.test(error.message || "")) showToast(error.message, "error");
  } finally {
    if (button) { button.disabled = false; button.textContent = "Sync counts to sheet"; }
  }
}

export function renderEnrollmentData(result) {
  const body = document.getElementById("enrollmentTableBody");
  const profile = storedAppProfile() || {};
  const assignments = isTeacher() ? teacherAssignmentsForProfile(profile) : [];
  const rows = (Array.isArray(result.rows) ? result.rows : []).filter((row) => !assignments.length || assignments.some((assignment) => String(row.gradeLevel || "").trim().toLowerCase() === String(assignment.gradeLevel || "").trim().toLowerCase() && String(row.section || "").trim().toLowerCase() === String(assignment.section || "").trim().toLowerCase()));
  const totalsByGrade = new Map((result.gradeTotals || []).map((row) => [enrollmentGradeLabel(row.gradeLevel), row]));
  const html = [];
  const gradeOrder = [...new Set(rows.map((row) => enrollmentGradeLabel(row.gradeLevel)))].sort((a, b) => {
    const first = ENROLLMENT_GRADE_ORDER.indexOf(a);
    const second = ENROLLMENT_GRADE_ORDER.indexOf(b);
    return (first < 0 ? Number.MAX_SAFE_INTEGER : first) - (second < 0 ? Number.MAX_SAFE_INTEGER : second) || a.localeCompare(b);
  });

  gradeOrder.forEach((gradeLevel) => {
    const gradeRows = rows.filter((row) => enrollmentGradeLabel(row.gradeLevel) === gradeLevel);
    if (!gradeRows.length) return;
    gradeRows.forEach((row) => html.push(`
      <tr>
        <td>${escapeHtml(gradeLevel)}</td>
        <td class="cell-name">${escapeHtml(row.section)}</td>
        <td class="enrollment-adviser">${escapeHtml(row.adviser || "—")}</td>
        <td class="number-cell">${Number(row.male || 0).toLocaleString()}</td>
        <td class="number-cell">${Number(row.female || 0).toLocaleString()}</td>
        <td class="number-cell total-cell">${Number(row.total || 0).toLocaleString()}</td>
      </tr>`));
    const subtotal = assignments.length ? {
      male: gradeRows.reduce((sum, row) => sum + Number(row.male || 0), 0),
      female: gradeRows.reduce((sum, row) => sum + Number(row.female || 0), 0),
      total: gradeRows.reduce((sum, row) => sum + Number(row.total || 0), 0),
    } : totalsByGrade.get(gradeLevel);
    if (subtotal) html.push(`
      <tr class="subtotal-row">
        <td colspan="3">${escapeHtml(gradeLevel)} total</td>
        <td class="number-cell">${Number(subtotal.male || 0).toLocaleString()}</td>
        <td class="number-cell">${Number(subtotal.female || 0).toLocaleString()}</td>
        <td class="number-cell">${Number(subtotal.total || 0).toLocaleString()}</td>
      </tr>`);
  });

  const grandTotal = assignments.length ? rows.reduce((total, row) => ({ male: total.male + Number(row.male || 0), female: total.female + Number(row.female || 0), total: total.total + Number(row.total || 0) }), { male: 0, female: 0, total: 0 }) : result.grandTotal;
  if (html.length && grandTotal) html.push(`
    <tr class="grand-total-row">
      <td colspan="3">Grand total</td>
      <td class="number-cell">${Number(grandTotal.male || 0).toLocaleString()}</td>
      <td class="number-cell">${Number(grandTotal.female || 0).toLocaleString()}</td>
      <td class="number-cell">${Number(grandTotal.total || 0).toLocaleString()}</td>
    </tr>`);

  body.innerHTML = html.join("") || `<tr><td colspan="6" class="state-row">No enrollment sections found for this school year.</td></tr>`;
  document.getElementById("enrollmentTitle").textContent = result.schoolYear || "School year";
  document.getElementById("enrollmentTotalMale").textContent = Number(grandTotal?.male || 0).toLocaleString();
  document.getElementById("enrollmentTotalFemale").textContent = Number(grandTotal?.female || 0).toLocaleString();
  document.getElementById("enrollmentGrandTotal").textContent = Number(grandTotal?.total || 0).toLocaleString();
}
