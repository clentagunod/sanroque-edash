// @ts-nocheck -- ported from the original site; behavior preserved, not yet fully typed.
import { APP_CONFIG, isVisitorSession } from './app-config';
import { LPSCache } from './cache';
import { beginNetworkLoading, endNetworkLoading } from './shell';
import { SHEETS_API_URL, auth, authPersistenceReady } from './firebase';

/**
 * ============================================================================
 * SHEETS-API.JS
 * A thin, typed-by-convention wrapper around the Google Apps Script Web App
 * that sits in front of the Google Sheet (see apps-script/Code.gs and
 * SETUP_GUIDE.md Part 2). Every page calls functions from this file instead
 * of writing fetch() calls directly — so if the backend URL or shape ever
 * changes, you only edit it here.
 *
 * All requests send the signed-in user's Firebase ID token, which Code.gs
 * verifies before touching the spreadsheet. This is what stops someone from
 * calling your Apps Script URL directly without logging in.
 * ============================================================================
 */

export const REQUEST_TIMEOUT_MS = 15000;
export const CLIENT_CACHE_TTL_MS = 60000;
export const LEARNER_CACHE_TTL_MS = 30000;
export const LEARNER_STALE_CACHE_MS = 300000;
// Retry only retryable HTTP responses. Network timeouts are returned promptly
// because repeating a 15-second timeout makes the whole site feel hung.
export const RETRY_ATTEMPTS = 1; // additional attempt after the first try
export const RETRY_BASE_DELAY_MS = 500;
export const RETRIABLE_STATUS = new Set([429, 500, 502, 503, 504]);

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchOnce(url, options) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  if (typeof beginNetworkLoading === "function") beginNetworkLoading();
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error("The Google Sheets service took too long to respond. Please try again.");
    }
    throw new Error("Could not reach the Google Sheets service. Check your connection and try again.");
  } finally {
    clearTimeout(timeoutId);
    if (typeof endNetworkLoading === "function") endNetworkLoading();
  }
}

/**
 * Fetch with a bounded timeout plus automatic retry-with-backoff for
 * transient failures (network errors, timeouts, and 429/5xx responses).
 * Non-retriable failures (4xx other than 429, or a successful response)
 * return/throw immediately on the first attempt.
 *
 * IMPORTANT: retries only run for GET (read) calls. POST writes (addLearner,
 * updateLearner, ...) are NOT idempotent — if a write actually reached the
 * server and only the response was lost, retrying it would silently create
 * a duplicate row. Writes get exactly one attempt; the user sees the error
 * and can safely retry manually after checking the sheet.
 */
export async function fetchWithTimeout(url, options) {
  const retriesAllowed = !options || options.method === "GET";
  const attempts = retriesAllowed ? RETRY_ATTEMPTS : 0;
  let lastError;
  for (let attempt = 0; attempt <= attempts; attempt++) {
    try {
      const res = await fetchOnce(url, options);
      if (res.ok || !RETRIABLE_STATUS.has(res.status) || attempt === attempts) {
        return res;
      }
      lastError = new Error(`The Google Sheets service returned HTTP ${res.status}.`);
    } catch (error) {
      throw error;
    }
    // Jittered exponential backoff: 500ms, 1000ms (± up to 30%).
    const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt) * (0.85 + Math.random() * 0.3);
    await sleep(delay);
  }
  throw lastError;
}

export const LPSApi = (() => {
  async function authHeaderToken() {
    await authPersistenceReady;
    let user = auth.currentUser;
    if (!user && typeof auth.onAuthStateChanged === "function") {
      user = await new Promise((resolve) => {
        let settled = false;
        const unsubscribe = auth.onAuthStateChanged((nextUser) => {
          if (settled) return;
          settled = true;
          unsubscribe?.();
          resolve(nextUser || null);
        });
        window.setTimeout(() => {
          if (settled) return;
          settled = true;
          unsubscribe?.();
          resolve(null);
        }, 5000);
      });
    }
    if (!user) throw new Error("Not signed in.");
    return user.getIdToken();
  }

  /**
   * GET-style calls. Apps Script Web Apps handle GET reliably from the
   * browser (no CORS preflight), so all read operations use GET with query
   * parameters, and all write operations use POST with a JSON body.
   */
  async function get(action, params = {}) {
    if (isVisitorSession()) {
      const publicActions = { getGuestDashboardSummary: true, getGuestEnrollmentData: true };
      if (!publicActions[action]) throw new Error("Visitors can only view dashboard summaries and enrollment data.");
      const publicUrl = new URL(SHEETS_API_URL);
      publicUrl.searchParams.set("action", action);
      Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined && v !== null && v !== "") publicUrl.searchParams.set(k, v);
      });
      const publicRes = await fetchWithTimeout(publicUrl.toString(), { method: "GET", redirect: "follow" });
      return parseResponse(publicRes);
    }
    const token = await authHeaderToken();
    const url = new URL(SHEETS_API_URL);
    url.searchParams.set("action", action);
    url.searchParams.set("token", token);
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, v);
    });

    const res = await fetchWithTimeout(url.toString(), { method: "GET", redirect: "follow" });
    return parseResponse(res);
  }

  async function post(action, payload = {}) {
    const token = await authHeaderToken();
    // Apps Script Web Apps redirect POSTs, and a JSON content-type triggers
    // a CORS preflight it can't answer — so we send text/plain and let
    // Code.gs JSON.parse the body itself. This is the standard workaround.
    const res = await fetchWithTimeout(SHEETS_API_URL, {
      method: "POST",
      redirect: "follow",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action, token, ...payload }),
    });
    return parseResponse(res);
  }

  async function parseResponse(res) {
    if (!res.ok) {
      throw new Error(`The Google Sheets service returned HTTP ${res.status}.`);
    }
    let data;
    try {
      data = await res.json();
    } catch (e) {
      throw new Error("The server sent back something unexpected. Please try again.");
    }
    if (!data.ok) {
      throw new Error(data.error || "The request failed. Please try again.");
    }
    return data.data;
  }

  return {
    // ---- School years -------------------------------------------------------
    // Every read/write below accepts an optional schoolYear; omit it to use
    // whichever year is currently flagged "current" in the SchoolYears sheet.
    getSchoolYears: () => LPSCache.getOrLoad("school_years", () => get("getSchoolYears"), CLIENT_CACHE_TTL_MS, 30000),
    createSchoolYear: async (schoolYear, makeCurrent = false, copyFromYear = "") => {
      const result = await post("createSchoolYear", { schoolYear, makeCurrent, copyFromYear });
      LPSCache.remove("school_years");
      return result;
    },
    setCurrentSchoolYear: async (schoolYear) => {
      const result = await post("setCurrentSchoolYear", { schoolYear });
      LPSCache.remove("school_years");
      return result;
    },

    // ---- Dashboard -------------------------------------------------------
    getDashboardSummary: (schoolYear = "") => LPSCache.getOrLoad("dashboard_" + (schoolYear || "current"), () => get(isVisitorSession() ? "getGuestDashboardSummary" : "getDashboardSummary", { schoolYear }), 30000, 0),

    // ---- Learner masterlist / program lists -------------------------------
    // program: "" (all), "4Ps", "IP", "SNED", "ARAL"
    getLearners: (options = {}) => {
      const params = {
        program: options.program || "",
        search: options.search || "",
        gradeLevel: options.gradeLevel || "",
        gender: options.gender || "",
        page: options.page || 1,
        pageSize: options.pageSize || 10,
        schoolYear: options.schoolYear || "",
      };
      const key = "learners_" + JSON.stringify(params);
      return LPSCache.getOrLoad(key, () => get("getLearners", params), LEARNER_CACHE_TTL_MS, LEARNER_STALE_CACHE_MS);
    },
    getLearnerPage: (options = {}) => {
      return get("getLearners", {
        program: options.program || "",
        search: options.search || "",
        gradeLevel: options.gradeLevel || "",
        gender: options.gender || "",
        page: options.page || 1,
        pageSize: Math.min(100, options.pageSize || 100),
        schoolYear: options.schoolYear || "",
      });
    },

    getLearner: (learnerId, schoolYear = "") => get("getLearner", { learnerId, schoolYear }),
    getNextLearnerId: (schoolYear = "") => get("getNextLearnerId", { schoolYear }),
    getLearnerSchema: (schoolYear = "") => get("getLearnerSchema", { schoolYear }),

    addLearner: async (learner, schoolYear = "") => {
      const result = await post("addLearner", { learner, schoolYear });
      LPSCache.clear("learners_");
      LPSCache.clear("dashboard_");
      return result;
    },
    updateLearner: async (learnerId, learner, schoolYear = "") => {
      const result = await post("updateLearner", { learnerId, learner, schoolYear });
      LPSCache.clear("learners_");
      LPSCache.clear("dashboard_");
      return result;
    },
    deleteLearner: async (learnerId, schoolYear = "") => {
      const result = await post("deleteLearner", { learnerId, schoolYear });
      LPSCache.clear("learners_");
      LPSCache.clear("dashboard_");
      return result;
    },
    deleteLearners: async (learnerIds, schoolYear = "") => {
      const result = await post("deleteLearners", { learnerIds, schoolYear });
      LPSCache.clear("learners_");
      LPSCache.clear("dashboard_");
      return result;
    },

    // ---- Reports -----------------------------------------------------------
    getReportsData: (schoolYear = "") => get("getReportsData", { schoolYear }),
    getArchiveRecords: (archive, schoolYear = "") => get("getArchiveRecords", { archive, schoolYear }),
    getEnrollmentData: (schoolYear = "") => get(isVisitorSession() ? "getGuestEnrollmentData" : "getEnrollmentData", { schoolYear }),
    getEnrollmentSections: (schoolYear = "") => get("getEnrollmentSections", { schoolYear }),
    syncEnrollmentData: (schoolYear = "") => post("syncEnrollmentData", { schoolYear }),
    getMyProfile: () => {
      return LPSCache.getOrLoad("my_profile", () => get("getMyProfile"), 300000, 300000);
    },
    getNutritionStatus: (schoolYear = "") => get("getNutritionStatus", { schoolYear }),
    getReadingProfiles: (schoolYear = "") => get("getReadingProfiles", { schoolYear }),
    getMathProfiles: (schoolYear = "") => get("getMathProfiles", { schoolYear }),
    getGradesProfiles: (schoolYear = "") => get("getGradesProfiles", { schoolYear }),
    getTransferRecords: (schoolYear = "", type = "", gradeLevel = "", gender = "") => get("getTransferRecords", { schoolYear, type, gradeLevel, gender }),

    // ---- Manage Users (school admin only; enforced server-side too) --------
    getUsers: () => get("getUsers"),
    getAuditLogs: async () => {
      const token = await authHeaderToken();
      const url = new URL(APP_CONFIG.auditLogApiUrl);
      url.searchParams.set("action", "getAuditLogs");
      url.searchParams.set("token", token);
      return parseResponse(await fetchWithTimeout(url.toString(), { method: "GET", redirect: "follow" }));
    },
    getFirestoreUsage: async () => {
      const token = await authHeaderToken();
      const url = new URL(APP_CONFIG.auditLogApiUrl);
      url.searchParams.set("action", "getFirestoreUsage");
      url.searchParams.set("token", token);
      return parseResponse(await fetchWithTimeout(url.toString(), { method: "GET", redirect: "follow" }));
    },
    recordAuditEvent: async (auditAction, details = {}) => {
      const token = await authHeaderToken();
      const res = await fetchWithTimeout(APP_CONFIG.auditLogApiUrl, {
        method: "POST", redirect: "follow", headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ action: "recordAuditEvent", token, auditAction, ...details }),
      });
      return parseResponse(res);
    },
    addUser: (userRecord) => post("addUser", { userRecord }),
    updateUser: (userId, userRecord) => post("updateUser", { userId, userRecord }),
    deleteAuthUsers: (userIds) => {
      const tokenPromise = authHeaderToken();
      return tokenPromise.then((token) => fetchWithTimeout(APP_CONFIG.auditLogApiUrl, {
        method: "POST", redirect: "follow", headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ action: "deleteAuthUsers", token, userIds }),
      })).then(parseResponse).then((result) => {
        const requested = (userIds || []).map((id) => String(id || "").trim()).filter(Boolean);
        const deleted = Array.isArray(result?.deletedUserIds) ? result.deletedUserIds.map((id) => String(id || "").trim()) : [];
        if (requested.length && requested.some((id) => !deleted.includes(id))) {
          throw new Error("Firebase Authentication did not confirm deletion for every selected user. The Firestore profiles were left unchanged.");
        }
        return result;
      });
    },
    deleteUser: (userId) => post("deleteUser", { userId }),
    deleteUsers: (userIds) => post("deleteUsers", { userIds }),
  };
})();