// @ts-nocheck -- ported from the original site; behavior preserved, not yet fully typed.
const env = import.meta.env;

// Set VITE_MAINTENANCE_MODE=true in Vercel to show the maintenance page
// without changing the application code that you use locally.
export const MAINTENANCE_MODE = env.VITE_MAINTENANCE_MODE === "true";
export const TEST_MODE_ENABLED = env.VITE_TEST_MODE === "true";
const LOCAL_MAINTENANCE_ANIMATION_URL = "/assets/maintenance.json";

export const APP_CONFIG = Object.freeze({
  maintenanceMode: MAINTENANCE_MODE,
    testMode: TEST_MODE_ENABLED,
  // Keep the animation in the deployed app by default. A VITE_* override is
  // still supported when a different local filename or remote asset is needed.
  maintenanceAnimationUrl: env.VITE_MAINTENANCE_ANIMATION_URL || LOCAL_MAINTENANCE_ANIMATION_URL,
  firebase: {
    apiKey: env.VITE_FIREBASE_API_KEY || "",
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || "",
    projectId: env.VITE_FIREBASE_PROJECT_ID || "",
    storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET || "",
    messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID || "",
    appId: env.VITE_FIREBASE_APP_ID || "",
  },
  // Set this after deploying apps-script/AuditLog.gs as a Web App.
  auditLogApiUrl: env.VITE_AUDIT_LOG_API_URL || "",
  feedbackApiUrl: env.VITE_FEEDBACK_API_URL || "",
  // Paste the Google Sheets backup URL here after creating the backup sheet.
  backupSpreadsheetUrl: env.VITE_BACKUP_SPREADSHEET_URL || "",
  assetsPath: "assets/",
  pagePath: "pages/",
});

export const APP_IS_PAGES_ROUTE = /[\\/]pages[\\/]/i.test(window.location.pathname);
export const APP_PAGE_PREFIX = APP_IS_PAGES_ROUTE ? "" : "pages/";
export const APP_ASSET_PREFIX = APP_IS_PAGES_ROUTE ? "../assets/" : "assets/";
export const APP_LOGIN_PATH = APP_IS_PAGES_ROUTE ? "../index.html" : "index.html";
export let APP_USER_PROFILE = null;
export function setAppUserProfile(profile) { APP_USER_PROFILE = profile; }
export const VISITOR_SESSION_VALUE = String(Date.now() + 30 * 60 * 1000);

export function storedAppProfile() {
  try { return JSON.parse(sessionStorage.getItem("lps_user_profile") || "null"); } catch (error) { return null; }
}

export function hasVisitorEntryMarker() {
  return new URLSearchParams(window.location.search).get("visitor") === "1";
}

export function clearVisitorSession() {
  try {
    sessionStorage.removeItem("lps_guest_session");
    localStorage.removeItem("lps_guest_session");
    const profile = storedAppProfile();
    const isGuestProfile = !!profile && (
      profile.uid === "guest"
      || profile.role === "Visitor"
      || profile.role === "visitor"
      || (!profile.email && !profile.uid && profile.role === "Visitor")
    );
    if (isGuestProfile || !profile) {
      sessionStorage.removeItem("lps_user_profile");
    }
  } catch (error) {
    // Storage may be unavailable in private browsing or locked-down browser modes.
  }
}

export function ensureVisitorSession(force = false) {
  if (!force && !hasVisitorEntryMarker()) return false;
  try {
    const expiry = String(Date.now() + 30 * 60 * 1000);
    sessionStorage.setItem("lps_guest_session", "1");
    localStorage.setItem("lps_guest_session", expiry);
    sessionStorage.setItem("lps_user_profile", JSON.stringify({ email: "", uid: "guest", role: "Visitor" }));
  } catch (error) {
    // The auth guard will show the regular login flow if browser storage is unavailable.
  }
  return true;
}

export function appSessionId() {
  const key = "lps_session_id";
  try {
    let value = sessionStorage.getItem(key);
    if (!value) {
      value = `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      sessionStorage.setItem(key, value);
    }
    return value;
  } catch (error) {
    return "browser-session";
  }
}

export function normalizedAppRole(role) {
  const value = String(role || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  if (value === "schooladmin" || value === "admin" || value === "schooladministrator") return "School Admin";
  if (value === "registrar") return "Registrar";
  if (value === "teacher") return "Teacher";
  if (value === "visitor") return "Visitor";
  return String(role || "").trim();
}

export function appRole() {
  const profile = APP_USER_PROFILE || storedAppProfile() || {};
  return normalizedAppRole(profile.role);
}

function normalizeTeacherGradeValue(value) {
  const text = String(value || '').trim();
  const normalized = text.toLowerCase().replace(/\s+/g, ' ');
  if (['kinder', 'kindergarten', 'kg', '0'].includes(normalized)) return 'Kinder';
  const match = normalized.match(/^grade\s*(\d+)$/) || normalized.match(/^(\d+)$/);
  return match ? `Grade ${match[1]}` : text;
}

export function normalizeTeacherAssignmentRecord(assignment, fallback = {}) {
  if (!assignment || typeof assignment !== 'object') return null;
  const schoolYear = String(assignment.schoolYear || fallback.schoolYear || '').trim();
  const gradeLevel = normalizeTeacherGradeValue(assignment.gradeLevel || assignment.gradeKey || fallback.gradeLevel || '');
  const section = String(assignment.section || assignment.sectionKey || fallback.section || '').trim();
  const teacherName = String(assignment.teacherName || assignment.adviser || fallback.teacherName || fallback.name || '').trim();
  if (!schoolYear || !gradeLevel || !section) return null;
  return {
    schoolYear,
    gradeLevel,
    section,
    ...(teacherName ? { teacherName } : {}),
  };
}

export function normalizeTeacherAssignmentsForStorage(assignments = []) {
  const unique = new Map();
  const candidates = Array.isArray(assignments) ? assignments : [assignments];
  candidates.forEach((assignment) => {
    const normalized = normalizeTeacherAssignmentRecord(assignment);
    if (!normalized) return;
    const key = [normalized.schoolYear, normalized.gradeLevel, normalized.section].join('|').toLowerCase();
    if (!unique.has(key)) unique.set(key, normalized);
  });
  return [...unique.values()];
}

/**
 * Builds the exact-match key Firestore security rules use to authorize a
 * teacher's read/write against a learner's { schoolYear, gradeLevel, section }.
 *
 * WHY THIS EXISTS: the rules cannot reliably compare two Firestore maps for
 * "does this assignment cover this grade/section" — map equality requires an
 * IDENTICAL key set, and a stored assignment carries an extra `teacherName`
 * field (added by the admin console) that a hand-built comparison map in the
 * rules would not have. That mismatch silently made every teacher write fail
 * with permission-denied, no matter how correct the assignment looked. A flat
 * string key sidesteps map-shape entirely: two strings are simply equal or
 * they aren't, and the check scales to any number of assignments as a single
 * `in` lookup instead of one `hasAny` per possible field-shape combination.
 *
 * MUST stay in sync with `learnerAssignmentKey()` in firestore.rules — same
 * delimiter, same field order, same source values (the normalized
 * schoolYear/gradeLevel/section on the assignment, not raw user input).
 */
export function teacherAssignmentSecurityKey(assignment) {
  const normalizeKeyPart = (value) => String(value ?? '').trim().replace(/\s+/g, ' ');
  const schoolYear = normalizeKeyPart(assignment?.schoolYear).replace(/[–—]/g, '-').replace(/\s*[\/-]\s*/g, '-');
  const gradeLevel = normalizeKeyPart(assignment?.gradeLevel);
  const section = normalizeKeyPart(assignment?.section);
  if (!schoolYear || !gradeLevel || !section) return null;
  return `${schoolYear}::${gradeLevel}::${section}`;
}

/** Flat, de-duplicated key list for every assignment — see teacherAssignmentSecurityKey(). */
export function teacherAssignmentSecurityKeys(assignments = []) {
  const keys = (Array.isArray(assignments) ? assignments : [assignments])
    .map(teacherAssignmentSecurityKey)
    .filter(Boolean);
  return [...new Set(keys)];
}

export function teacherAssignmentsForProfile(profile = APP_USER_PROFILE || storedAppProfile() || {}) {
  const source = profile && typeof profile === 'object' ? profile : {};
  const rawAssignments = Array.isArray(source.teacherAssignments) ? source.teacherAssignments : [];
  // `teacherAssignment` is the legacy single-assignment field. The admin
  // console mirrors the FIRST item of `teacherAssignments` into it, so reading
  // both would always duplicate the first section for multi-section teachers.
  // When the canonical list exists we use it exclusively and only fall back to
  // the legacy field for profiles that predate multi-section support.
  const candidates = rawAssignments.length
    ? rawAssignments
    : source.teacherAssignment ? [source.teacherAssignment] : [];
  const normalized = normalizeTeacherAssignmentsForStorage(candidates);
  // De-duplicate defensively: a malformed/legacy profile may contain the same
  // section more than once, and the advisory coverage summary must reflect
  // exactly what this teacher's account covers — one row per section.
  return normalized;
}

export function teacherCoverageSummary(profile = APP_USER_PROFILE || storedAppProfile() || {}) {
  const assignments = teacherAssignmentsForProfile(profile);
  return assignments.map((assignment) => {
    const gradeLevel = String(assignment.gradeLevel || assignment.gradeKey || "Grade not assigned").trim();
    const sectionValue = String(assignment.section || assignment.sectionKey || "").trim();
    const sectionLabel = sectionValue ? `Section ${sectionValue}` : "Section not assigned";
    return {
      schoolYear: String(assignment.schoolYear || "Current school year").trim() || "Current school year",
      gradeLevel,
      section: sectionLabel,
    };
  });
}

export function hasRealUserProfile(profile) {
  if (!profile || typeof profile !== "object") return false;
  const uid = String(profile.uid || "").trim();
  const email = String(profile.email || "").trim();
  if (uid && uid !== "guest") return true;
  return Boolean(email && email.includes("@"));
}

export function isVisitorSession() {
  try {
    const activeUser = typeof firebase !== "undefined" && firebase.auth ? firebase.auth().currentUser : null;
    const profile = storedAppProfile();
    const hasSignedInUser = !!(activeUser && activeUser.uid && activeUser.uid !== "guest") || hasRealUserProfile(profile);
    if (hasSignedInUser) {
      clearVisitorSession();
      return false;
    }

    const localValue = Number(localStorage.getItem("lps_guest_session"));
    if (Number.isFinite(localValue) && localValue < Date.now()) {
      localStorage.removeItem("lps_guest_session");
      sessionStorage.removeItem("lps_guest_session");
      sessionStorage.removeItem("lps_user_profile");
      return false;
    }

    if (profile && (profile.uid === "guest" || profile.role === "Visitor" || profile.role === "visitor")) {
      return true;
    }

    if (hasVisitorEntryMarker()) {
      ensureVisitorSession();
      return true;
    }

    const sessionGuest = sessionStorage.getItem("lps_guest_session") === "1";
    const localGuest = Number.isFinite(localValue) && localValue > Date.now();

    if (!localGuest && sessionGuest) {
      const guestProfile = storedAppProfile();
      if (!guestProfile || guestProfile.uid !== "guest") {
        sessionStorage.removeItem("lps_guest_session");
        return false;
      }
    }

    return Boolean(localGuest || (sessionGuest && storedAppProfile()?.uid === "guest"));
  } catch (error) {
    return false;
  }
}
export function canManageLearners() { return ["School Admin", "Registrar", "Teacher"].includes(appRole()); }
export function isSchoolAdmin() { return appRole() === "School Admin"; }
export function isRegistrar() { return appRole() === "Registrar"; }
export function isTeacher() { return appRole() === "Teacher"; }
export function canViewGradesProfile() {
  const role = appRole();
  return !role || ["School Admin", "Registrar", "Teacher"].includes(role);
}

export function paginationPageNumbers(page, pageCount) {
  const windowSize = 5;
  const safePage = Math.max(1, Math.min(pageCount, Number(page) || 1));
  const groupStart = Math.min(safePage, Math.max(1, pageCount - windowSize + 1));
  const groupEnd = Math.min(pageCount, groupStart + windowSize - 1);
  const pages = [];
  for (let value = groupStart; value <= groupEnd; value += 1) pages.push(value);
  return pages;
}

export function formSnapshot(form) {
  if (!form) return "";
  return JSON.stringify([...form.elements].map((field) => ({
    id: field.id || field.name || "",
    type: field.type || "",
    value: field.type === "checkbox" || field.type === "radio" ? field.checked : field.value,
  })));
}

export function confirmDiscardChanges(form, initialSnapshot, itemName = "form") {
  if (formSnapshot(form) === initialSnapshot) return true;
  return window.confirm(`You have unsaved changes in this ${itemName}.\n\nDo you want to discard them and close? Your changes will not be saved.`);
}
