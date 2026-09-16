// @ts-nocheck -- ported from the original site; behavior preserved, not yet fully typed.
const env = import.meta.env;

// Set VITE_MAINTENANCE_MODE=true in Vercel to show the maintenance page
// without changing the application code that you use locally.
export const MAINTENANCE_MODE = env.VITE_MAINTENANCE_MODE === "true";
const LOCAL_MAINTENANCE_ANIMATION_URL = "/assets/maintenance.json";

export const APP_CONFIG = Object.freeze({
  maintenanceMode: MAINTENANCE_MODE,
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

export function appRole() { return normalizedAppRole(APP_USER_PROFILE?.role); }

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
