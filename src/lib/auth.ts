// @ts-nocheck -- ported from the original site; behavior preserved, not yet fully typed.
import { appPageHref, showToast } from './shell';
import { LPSApi } from './sheets-api';
import { auth, authPersistenceReady, getPublicStats } from './firebase';
import { APP_LOGIN_PATH, APP_PAGE_PREFIX, appSessionId, clearVisitorSession, ensureVisitorSession, hasRealUserProfile, isVisitorSession, setAppUserProfile, storedAppProfile } from './app-config';
import { LPSCache } from './cache';

/**
 * ============================================================================
 * AUTH.JS
 * Two responsibilities, kept in one small file:
 *   1. Login page logic (only runs if #loginForm exists on the page).
 *   2. Auth guard + logout, used by every protected page (dashboard,
 *      masterlist, program pages, reports, manage-users).
 * ============================================================================
 */

export const LPS_SESSION_KEY = "lps_user_profile";
export const LPS_POST_LOGIN_NOTICE_KEY = "lps_post_login_notice";
export const LPS_GUEST_SESSION_KEY = "lps_guest_session";
let profileWatchUnsubscribe = null;

function watchTeacherProfile(userId, initialProfile) {
  profileWatchUnsubscribe?.();
  profileWatchUnsubscribe = null;
  if (initialProfile?.role !== "Teacher" || !userId) return;
  void import("./firestore-api").then(({ db }) => {
    const signature = (profile) => JSON.stringify(profile?.teacherAssignments || (profile?.teacherAssignment ? [profile.teacherAssignment] : []));
    const initialSignature = signature(initialProfile);
    profileWatchUnsubscribe = db.collection("users").doc(userId).onSnapshot((snapshot) => {
      const next = snapshot.data() || {};
      if (signature(next) === initialSignature) return;
      profileWatchUnsubscribe?.();
      profileWatchUnsubscribe = null;
      void auth.signOut().finally(() => {
        sessionStorage.removeItem(LPS_SESSION_KEY);
        window.location.replace(loginPageUrl("?auth=profile-updated"));
      });
    }, () => {});
  }).catch(() => {});
}

/**
 * The login page is intentionally theme-independent: it always renders in
 * light mode, even when the authenticated dashboards have dark mode enabled.
 * The inline scripts in index.html already skip adding `dark-mode-preload` /
 * `dark-mode` on the login routes — this helper is the safety net for in-app
 * navigations that mount the login page without a full document reload (e.g.
 * the router's catch-all "*" route redirecting to "/").
 */
export function forceLoginPageLightTheme() {
  try { document.body.classList.remove("dark-mode"); } catch (error) { /* DOM is always available here. */ }
  try { document.documentElement.classList.remove("dark-mode-preload"); } catch (error) { /* Ignore. */ }
}

/* ---------------------------------------------------------------------------
 * 1. LOGIN PAGE
 * ------------------------------------------------------------------------- */

export function initLoginPage() {
  const form = document.getElementById("loginForm");
  if (!form) return undefined;

  const emailInput = document.getElementById("email");
  const passwordInput = document.getElementById("password");
  const alertBox = document.getElementById("loginAlert");
  const submitBtn = document.getElementById("loginSubmit");

  async function refreshLoginStatsFromStats(stats = null) {
    const learnerCount = document.getElementById("loginLearnerCount");
    const programCount = document.getElementById("loginProgramCount");
    const syncStatus = document.getElementById("loginSyncStatus");
    try {
      const nextStats = stats || await getPublicStats() || {};
      if (learnerCount) learnerCount.textContent = Number(nextStats.totalLearners || 0).toLocaleString();
      if (programCount) programCount.textContent = Number(nextStats.programsTracked || 0).toLocaleString();
      if (syncStatus) syncStatus.textContent = nextStats.syncStatus || "Live";
    } catch (error) {
      if (syncStatus) syncStatus.textContent = "Unavailable";
    }
  }

  refreshLoginStatsFromStats();
  const statsInterval = window.setInterval(() => refreshLoginStatsFromStats(), 30000);
  let loginStatsUnsubscribe = null;
  void import('./firestore-api').then(({ fsSubscribePublicStats }) => {
    if (typeof fsSubscribePublicStats === "function") {
      loginStatsUnsubscribe = fsSubscribePublicStats((stats) => {
        if (stats) refreshLoginStatsFromStats(stats);
      }, () => {
        refreshLoginStatsFromStats();
      });
    }
  }).catch(() => {
    // Firestore is optional during a fresh page load; the fallback poller above
    // already keeps the summary refreshed at a slower cadence.
  });

  // If already signed in, skip straight to the dashboard.
  if (isVisitorSession()) {
    window.location.href = `${APP_PAGE_PREFIX}dashboard.html`;
    return;
  }
  let disposed = false;
  let unsubscribeAuth = () => {};
  authPersistenceReady.then(() => {
    if (disposed) return;
    unsubscribeAuth = auth.onAuthStateChanged((user) => {
    if (user && !user.isAnonymous) window.location.href = `${APP_PAGE_PREFIX}dashboard.html`;
    });
  });

  function showAlert(message) {
    alertBox.textContent = message;
    alertBox.classList.add("is-visible");
  }
  function hideAlert() {
    alertBox.classList.remove("is-visible");
  }

  if (new URLSearchParams(window.location.search).get("auth") === "required") {
    showAlert("Your hosted session was not restored. Confirm this site is added to Firebase Authorized domains, then sign in again.");
  }

  const onSubmit = async (e) => {
    e.preventDefault();
    hideAlert();

    const email = emailInput.value.trim();
    const password = passwordInput.value;

    if (!email || !password) {
      showAlert("Please enter both your email and password.");
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = "Signing in…";

    try {
      await authPersistenceReady;
      const credential = await auth.signInWithEmailAndPassword(email, password);
      clearVisitorSession();
      void LPSApi.recordAuditEvent("LOGIN", { ipSession: appSessionId() }).catch(() => {});
      // Cache a small display profile so pages can render a name and role
      // instantly without waiting on a Firestore lookup after the redirect.
      // Never store passwords here. Resolve the role with the fresh sign-in so
      // the very first dashboard already knows it — and so the topbar never
      // depends on a single profile fetch happening on the next page load.
      let sessionProfile = { email: credential.user.email, uid: credential.user.uid };
      try {
        const freshProfile = await LPSApi.getMyProfile(credential.user);
        if (freshProfile && typeof freshProfile === "object") {
          sessionProfile = {
            email: freshProfile.email || credential.user.email,
            uid: String(freshProfile.userId || freshProfile.uid || credential.user.uid),
            name: freshProfile.name || "",
            role: freshProfile.role || "",
            teacherAssignment: freshProfile.teacherAssignment || null,
            teacherAssignments: freshProfile.teacherAssignments || [],
          };
        }
      } catch (error) {
        // Best-effort: a failed profile lookup must never block a successful
        // sign-in. The auth guard on the next page retries automatically.
      }
      sessionStorage.setItem(LPS_SESSION_KEY, JSON.stringify(sessionProfile));
      sessionStorage.setItem(LPS_POST_LOGIN_NOTICE_KEY, "1");
      window.location.href = `${APP_PAGE_PREFIX}dashboard.html`;
    } catch (err) {
      submitBtn.disabled = false;
      submitBtn.textContent = "Sign in";
      showAlert(friendlyAuthError(err));
    }
  };
  form.addEventListener("submit", onSubmit);

  return () => {
    disposed = true;
    window.clearInterval(statsInterval);
    if (typeof loginStatsUnsubscribe === "function") loginStatsUnsubscribe();
    unsubscribeAuth();
    form.removeEventListener("submit", onSubmit);
  };
}

export function friendlyAuthError(err) {
  switch (err.code) {
    case "auth/invalid-email":
      return "That email address doesn't look right. Please check and try again.";
    case "auth/user-disabled":
      return "This account has been disabled. Please contact your school admin.";
    case "auth/user-not-found":
    case "auth/wrong-password":
    case "auth/invalid-credential":
      return "Incorrect email or password. Please try again.";
    case "auth/too-many-requests":
      return "Too many failed attempts. Please wait a moment before trying again.";
    case "auth/network-request-failed":
      return "Network error. Please check your internet connection.";
    default:
      return "We couldn't sign you in. Please try again, or contact your school admin.";
  }
}

/* ---------------------------------------------------------------------------
 * 2. AUTH GUARD for protected pages
 * ------------------------------------------------------------------------- */

/**
 * Call this at the top of every protected page. It resolves once we know
 * for sure whether a user is signed in, and redirects to the login page
 * if not — so page-specific scripts can safely assume `user` is real.
 */
export function requireAuth() {
  return new Promise((resolve) => {
    const handleSignedInUser = async (user, source = "auth-state") => {
      const cachedProfile = storedAppProfile();
      if (cachedProfile && (cachedProfile.uid === "guest" || cachedProfile.role === "Visitor" || cachedProfile.role === "visitor")) {
        clearVisitorSession();
      }
      const profile = cachedProfile && cachedProfile.uid !== "guest"
        ? {
            ...cachedProfile,
            email: cachedProfile.email || user?.email || "",
            uid: cachedProfile.uid || user?.uid || "",
            name: cachedProfile.name || "",
            role: cachedProfile.role || "",
          }
        : {
            email: user?.email || "",
            uid: user?.uid || "",
            name: "",
            role: "",
          };
      setAppUserProfile(profile);
      sessionStorage.setItem(
        LPS_SESSION_KEY,
        JSON.stringify({
          email: user?.email || profile.email || "",
          uid: user?.uid || profile.uid || "",
          role: profile.role || "",
          name: profile.name || cachedProfile?.name || "",
          teacherAssignment: profile.teacherAssignment || cachedProfile?.teacherAssignment || null,
        })
      );

      let freshProfile = null;
      try {
        // Pass the user we already know about so the profile can resolve even
        // while the Firestore SDK's own auth token is still warming up.
        freshProfile = await LPSApi.getMyProfile(user);
      } catch (error) {
        freshProfile = null;
      }

      const mergedProfile = {
        ...profile,
        ...(freshProfile || {}),
        name: freshProfile?.name || profile.name || "",
        email: freshProfile?.email || profile.email || user?.email || "",
        uid: freshProfile?.userId || freshProfile?.uid || profile.uid || user?.uid || "",
        role: freshProfile?.role || profile.role || cachedProfile?.role || "",
      };

      setAppUserProfile(mergedProfile);
      sessionStorage.setItem(
        LPS_SESSION_KEY,
        JSON.stringify({
          email: mergedProfile.email,
          uid: mergedProfile.uid,
          role: mergedProfile.role || "",
          name: mergedProfile.name || "",
          teacherAssignment: mergedProfile.teacherAssignment || null,
          teacherAssignments: mergedProfile.teacherAssignments || [],
        })
      );
      watchTeacherProfile(mergedProfile.uid, mergedProfile);

      if (source === "auth-state" && sessionStorage.getItem(LPS_POST_LOGIN_NOTICE_KEY) === "1") {
        sessionStorage.removeItem(LPS_POST_LOGIN_NOTICE_KEY);
        window.setTimeout(() => showToast(
          "Some workspace components may take a moment to initialize. If anything remains incomplete, refresh this tab.",
          "info",
          { title: "Welcome back", actionLabel: "Refresh tab", onAction: () => window.location.reload(), duration: 12000 }
        ), 350);
      }

      resolve(user);
    };

    ensureVisitorSession();
    if (isVisitorSession()) {
      const pageName = window.location.pathname.split(/[\\/]/).pop().toLowerCase();
      if (!["dashboard.html", "enrollment-data.html"].includes(pageName)) {
        window.location.replace(appPageHref("dashboard.html"));
        return;
      }
      setAppUserProfile({ email: "", uid: "guest", role: "Visitor" });
      resolve({ uid: "guest", email: null, isGuest: true });
      return;
    }

    const storedRealProfile = storedAppProfile();
    if (storedRealProfile && hasRealUserProfile(storedRealProfile)) {
      const user = { uid: storedRealProfile.uid || "session-user", email: storedRealProfile.email || "", isGuest: false };
      handleSignedInUser(user, "stored-profile");
      return;
    }

    const currentUser = auth.currentUser;
    if (currentUser && currentUser.uid && currentUser.uid !== "guest" && !currentUser.isAnonymous) {
      handleSignedInUser(currentUser, "current-user");
      return;
    }

    authPersistenceReady.then(() => {
      let unsubscribe = () => {};
      unsubscribe = auth.onAuthStateChanged(async (user) => {
        unsubscribe();
        if (!user || user.isAnonymous) {
          if (user?.isAnonymous) void auth.signOut();
          window.location.replace(loginPageUrl("?auth=required"));
          return;
        }
        handleSignedInUser(user, "auth-state");
      });
    });
  });
}

export function initials(email) {
  if (!email) return "?";
  const name = email.split("@")[0].replace(/[._]/g, " ");
  const parts = name.trim().split(" ").filter(Boolean);
  const letters = parts.slice(0, 2).map((p) => p[0].toUpperCase());
  return letters.join("") || "?";
}

export function displayNameFromEmail(email) {
  if (!email) return "User";
  const name = email.split("@")[0].replace(/[._]/g, " ");
  return name.replace(/\b\w/g, (c) => c.toUpperCase());
}

export function loginPageUrl(query = "") {
  const loginUrl = new URL(APP_LOGIN_PATH, window.location.href);
  if (window.location.hostname.endsWith(".ct.ws")) {
    loginUrl.protocol = "http:";
    loginUrl.pathname = "/";
  }
  loginUrl.search = query;
  return loginUrl.href;
}

export async function handleLogout() {
  const button = document.getElementById("logoutBtn");
  if (button?.disabled) return;
  if (button) {
    button.disabled = true;
    button.innerHTML = '<span class="inline-spinner" aria-hidden="true"></span>';
    button.title = "Signing out…";
    button.setAttribute("aria-label", "Signing out");
    button.setAttribute("aria-busy", "true");
  }
  try {
    void LPSApi.recordAuditEvent("LOGOUT", { ipSession: appSessionId() }).catch(() => {});
    if (!isVisitorSession()) {
      await Promise.race([
        auth.signOut(),
        new Promise((resolve) => window.setTimeout(resolve, 3000)),
      ]);
    }
  } finally {
    clearVisitorSession();
    sessionStorage.removeItem(LPS_SESSION_KEY);
    sessionStorage.removeItem(LPS_GUEST_SESSION_KEY);
    localStorage.removeItem(LPS_GUEST_SESSION_KEY);
    if (typeof LPSCache !== "undefined") LPSCache.clear();
    window.location.replace(loginPageUrl());
  }
}
