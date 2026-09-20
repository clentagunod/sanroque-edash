// @ts-nocheck -- ported from the original site; behavior preserved, not yet fully typed.
import { LPSApi } from './sheets-api';
import { APP_CONFIG, APP_ASSET_PREFIX, APP_PAGE_PREFIX, APP_USER_PROFILE, appRole, canViewGradesProfile, isSchoolAdmin, isVisitorSession, normalizedAppRole, setAppUserProfile } from './app-config';
import { LPS_SESSION_KEY, displayNameFromEmail, handleLogout, initials } from './auth';
import { Icon } from './icons';
import { auth, db } from './firebase';

/**
 * ============================================================================
 * SHELL.JS
 * Renders the sidebar + topbar that every authenticated page shares, so the
 * nav markup lives in exactly one place. Each page just needs:
 *   <div id="sidebarMount"></div>
 *   <div id="topbarMount"></div>
 * and a call to renderShell("dashboard", "Dashboard").
 * ============================================================================
 */

export const NAV_ITEMS = [
  { group: null, key: "dashboard", label: "Dashboard", icon: "dashboard", href: "dashboard.html" },
  { group: null, key: "masterlist", label: "Learner Masterlist", icon: "users", href: "masterlist.html" },
  { group: null, key: "enrollment-data", label: "Enrollment Data", icon: "sheet", href: "enrollment-data.html" },
  { group: null, key: "data", label: "Data", icon: "download", href: "data.html" },
  { group: "Programs", key: "4ps", label: "4Ps Beneficiaries", icon: "heart", href: "program-4ps.html" },
  { group: "Programs", key: "ip", label: "IP Learners", icon: "leaf", href: "program-ip.html" },
  { group: "Programs", key: "sned", label: "SNED Learners", icon: "accessibility", href: "program-sned.html" },
  { group: "Programs", key: "aral", label: "ARAL Tagged Learners", icon: "alertTriangle", href: "program-aral.html" },
  { group: "Programs", key: "muslim", label: "Muslim Learners", icon: "userRound", href: "program-muslim.html" },
  { group: "Nutritional Status", key: "nutrition", label: "Nutritional Status", icon: "activity", href: "nutritional-status.html" },
    { group: "Statistics", key: "reports", label: "Statistics", icon: "barChart", href: "reports.html" },
    { group: "Statistics", key: "eosy", label: "EOSY Status Report", icon: "clipboard", href: "eosy-report.html" },
  { group: "Profiles", key: "grades", label: "Grades Profile", icon: "graduationCap", href: "grades-profile.html" },
  { group: "Profiles", key: "reading", label: "Reading Profile", icon: "book", href: "reading-profile.html" },
  { group: "Profiles", key: "math", label: "Math Profile", icon: "math", href: "math-profile.html" },
  { group: "Other", key: "transfer-info", label: "Transfer Info", icon: "transfer", href: "transfer-info.html" },
  { group: "Other", key: "dropout", label: "Dropout", icon: "alertTriangle", href: "dropout.html" },
  { group: "Utilities", key: "grade-calculator", label: "Grade Calculator", icon: "sigma", href: "grade-calculator.html" },
  { group: "Utilities", key: "bmi-calculator", label: "BMI Calculator", icon: "calculator", href: "bmi-calculator.html" },
  { group: "Utilities", key: "eduai", label: "EduAI", icon: "sparkles", href: "eduai.html" },
  { group: "Settings", key: "users", label: "Admin Console", icon: "settings", href: "manage-users.html" },
  { group: "Settings", key: "audit-log", label: "Audit Log", icon: "clipboard", href: "audit-log.html" },
  { group: "Settings", key: "feedback", label: "Feedback", icon: "message", href: "feedback.html" },
];

export function appPageHref(fileName) {
  return `${APP_PAGE_PREFIX}${fileName}${isVisitorSession() ? "?visitor=1" : ""}`;
}

export const THEME_STORAGE_KEY = "lps_theme";
if ("scrollRestoration" in history) history.scrollRestoration = "manual";
export function debounce(fn, delay) {
  let timeoutId;
  return (...args) => { clearTimeout(timeoutId); timeoutId = setTimeout(() => fn(...args), delay); };
}

export function setButtonLoading(button, label = "Working…") {
  if (!button) return;
  if (!button.dataset.idleHtml) button.dataset.idleHtml = button.innerHTML;
  button.disabled = true;
  button.classList.add("is-loading");
  button.setAttribute("aria-busy", "true");
  button.innerHTML = `<span class="inline-spinner" aria-hidden="true"></span><span>${label}</span>`;
}

export function clearButtonLoading(button) {
  if (!button) return;
  button.disabled = false;
  button.classList.remove("is-loading");
  button.removeAttribute("aria-busy");
  if (button.dataset.idleHtml) button.innerHTML = button.dataset.idleHtml;
}

export let activeNetworkRequests = 0;
export let networkLoadingTimer = null;
export let activeExportIndicator = null;

export function startExportIndicator(label, button, onCancel = () => {}) {
  if (activeExportIndicator) return null;
  const panel = document.createElement("div");
  panel.className = "export-indicator";
  panel.setAttribute("role", "status");
  panel.setAttribute("aria-live", "polite");
  panel.innerHTML = `<div class="export-indicator-head"><div class="export-indicator-title"><span class="export-indicator-icon">${Icon.download}</span><strong class="export-indicator-label"></strong></div><span class="export-indicator-percent">0%</span></div><div class="export-indicator-track"><span></span></div><div class="export-indicator-foot"><span class="export-indicator-detail"></span><button type="button" class="export-indicator-cancel">Cancel</button></div>`;
  document.body.appendChild(panel);
  const state = {
    cancelled: false,
    update(message, percent) {
      panel.querySelector(".export-indicator-label").textContent = message;
      panel.querySelector(".export-indicator-percent").textContent = `${Math.round(percent)}%`;
      panel.querySelector(".export-indicator-track span").style.width = `${Math.max(0, Math.min(100, percent))}%`;
    },
    finish(message = "Download started.") {
      state.update(message, 100);
      panel.classList.add("is-complete");
      window.setTimeout(() => state.close(), 1100);
    },
    close() {
      if (!panel.isConnected) return;
      panel.remove();
      if (button) {
        button.disabled = false;
        button.removeAttribute("aria-busy");
      }
      if (activeExportIndicator === state) activeExportIndicator = null;
    },
    cancel() {
      if (state.cancelled) return;
      state.cancelled = true;
      onCancel();
      state.close();
    },
  };
  panel.querySelector(".export-indicator-cancel").addEventListener("click", state.cancel);
  if (button) {
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
  }
  activeExportIndicator = state;
  state.update(label, 0);
  return state;
}

export function ensureNetworkLoader() {
  let loader = document.getElementById("networkLoader");
  if (!loader) {
    loader = document.createElement("div");
    loader.id = "networkLoader";
    loader.className = "network-loader";
    loader.setAttribute("role", "progressbar");
    loader.setAttribute("aria-label", "Loading");
    loader.innerHTML = '<span class="network-loader-glow"></span><span class="network-loader-label">Updating</span>';
    document.body.appendChild(loader);
  }
  return loader;
}

export function beginNetworkLoading() {
  activeNetworkRequests += 1;
  window.clearTimeout(networkLoadingTimer);
  networkLoadingTimer = window.setTimeout(() => ensureNetworkLoader().classList.add("is-visible"), 180);
}

export function endNetworkLoading() {
  activeNetworkRequests = Math.max(0, activeNetworkRequests - 1);
  if (activeNetworkRequests > 0) return;
  window.clearTimeout(networkLoadingTimer);
  document.getElementById("networkLoader")?.classList.remove("is-visible");
}

export function applySavedTheme() {
  let theme = "light";
  try { theme = localStorage.getItem(THEME_STORAGE_KEY) || "light"; } catch (error) { /* Storage is optional. */ }
  document.body.classList.toggle("dark-mode", theme === "dark");
  document.documentElement.classList.remove("dark-mode-preload");
}

export function updateThemeToggle(button) {
  if (!button) return;
  const dark = document.body.classList.contains("dark-mode");
  button.innerHTML = dark ? Icon.sun : Icon.moon;
  button.title = dark ? "Switch to light mode" : "Switch to dark mode";
  button.setAttribute("aria-label", button.title);
  button.setAttribute("aria-pressed", String(dark));
}

export function renderShell(activeKey, pageTitleForMobile) {
  applySavedTheme();
  const scrollKey = `lps_scroll_${window.location.pathname}`;
  let savedScroll = 0;
  try { savedScroll = Number(sessionStorage.getItem(scrollKey) || 0); } catch (error) { savedScroll = 0; }
  const sidebarMount = document.getElementById("sidebarMount");
  const topbarMount = document.getElementById("topbarMount");
  const mainArea = document.querySelector(".main-area");
  if (!sidebarMount || !topbarMount || !mainArea) return;
  let testModeStamp = document.getElementById("testModeStamp");
  if (APP_CONFIG.testMode && !testModeStamp) {
    testModeStamp = document.createElement("div");
    testModeStamp.id = "testModeStamp";
    testModeStamp.className = "test-mode-stamp";
    testModeStamp.textContent = "TEST MODE";
    document.body.appendChild(testModeStamp);
  } else if (!APP_CONFIG.testMode) {
    testModeStamp?.remove();
  }

  let navHtml = "";
  let lastGroup = null;
  NAV_ITEMS.filter((item) => {
    if (isVisitorSession()) return ["dashboard", "enrollment-data"].includes(item.key);
    if (["users", "audit-log"].includes(item.key)) return isSchoolAdmin();
    if (item.key === "grades") return canViewGradesProfile();
    return true;
  }).map((item) => {
    if (appRole() === "Teacher" && item.key === "feedback") return { ...item, group: "Feedback" };
    return item;
  }).forEach((item) => {
    if (item.group !== lastGroup) {
      navHtml += `<div class="nav-group-label">${item.group ? item.group.toUpperCase() : "MAIN"}</div>`;
      lastGroup = item.group;
    }
    navHtml += `
      <a class="nav-item ${item.key === activeKey ? "is-active" : ""}" href="${appPageHref(item.href)}">
        ${Icon[item.icon]}
        <span>${item.label}</span>
      </a>`;
  });

  sidebarMount.innerHTML = `
    <aside class="sidebar" id="sidebar">
      <div class="sidebar-brand">
        <div class="sidebar-brand-mark">
          <img src="${APP_ASSET_PREFIX}school-logo.png" alt="" width="26" height="26" style="border-radius:50%;object-fit:cover;" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';" />
          <span style="display:none;">${Icon.book.replace("currentColor", "#fff")}</span>
        </div>
        <div class="sidebar-brand-text">
          <div class="name">San Roque ES</div>
          <div class="sub">Realtime Enrollment</div>
        </div>
      </div>
      <nav class="sidebar-nav">${navHtml}</nav>
    </aside>`;

  const session = JSON.parse(sessionStorage.getItem(LPS_SESSION_KEY) || "null");
  const email = session ? session.email : (auth.currentUser && auth.currentUser.email) || "";
  const visitorSession = isVisitorSession();
  const sessionName = session?.name ? String(session.name).trim() : "";
  const hasRealSessionProfile = !!(session && session.uid && session.uid !== "guest");
  const displayName = visitorSession ? "" : (APP_USER_PROFILE?.name || sessionName || (hasRealSessionProfile ? "" : displayNameFromEmail(email)));

  topbarMount.innerHTML = `
    <header class="topbar">
      <button class="topbar-menu-btn" id="menuToggle" aria-label="Toggle navigation">${Icon.menu}</button>
      <h2 style="font-size:16px; ${pageTitleForMobile ? "" : "visibility:hidden;"}">${pageTitleForMobile || ""}</h2>
      <div class="topbar-user">
        <button class="topbar-theme-toggle" id="themeToggle" type="button" title="Switch to dark mode" aria-label="Switch to dark mode">${document.body.classList.contains("dark-mode") ? Icon.sun : Icon.moon}</button>
        ${visitorSession ? "" : `<div class="account-menu-wrap">
          <button class="account-menu-trigger" id="accountMenuTrigger" type="button" aria-haspopup="true" aria-expanded="false">
            <span class="account-menu-trigger-icon">${Icon.userRound}</span><span>Account</span><span class="account-menu-chevron">${Icon.chevronRight}</span>
          </button>
          <div class="account-menu" id="accountMenu" hidden>
            <div class="account-menu-heading"><span class="account-menu-label">Account settings</span><strong>${escapeHtml(displayName)}</strong><small>${escapeHtml(email)}</small></div>
            <button type="button" class="account-menu-item" data-account-action="password"><span class="account-menu-item-icon">${Icon.lock || Icon.settings}</span><span><strong>Change password</strong><small>Update your sign-in password</small></span>${Icon.chevronRight}</button>
            <button type="button" class="account-menu-item" data-account-action="name"><span class="account-menu-item-icon">${Icon.userRound}</span><span><strong>Change username</strong><small>Update your dashboard name</small></span>${Icon.chevronRight}</button>
          </div>
        </div>`}
        <div class="topbar-avatar">${initials(email)}</div>
        <div class="topbar-user-text">
          <div class="name">${displayName}</div>
          <div class="role" id="topbarRole">Loading role…</div>
        </div>
        <button class="topbar-logout" id="logoutBtn" title="Sign out" aria-label="Sign out">${Icon.logout}</button>
      </div>
    </header>`;

  document.getElementById("logoutBtn").addEventListener("click", handleLogout);
  wireAccountMenu();
  const themeToggle = document.getElementById("themeToggle");
  if (themeToggle) {
    updateThemeToggle(themeToggle);
    themeToggle.addEventListener("click", () => {
      const dark = !document.body.classList.contains("dark-mode");
      document.body.classList.toggle("dark-mode", dark);
      try { localStorage.setItem(THEME_STORAGE_KEY, dark ? "dark" : "light"); } catch (error) { /* Storage is optional. */ }
      updateThemeToggle(themeToggle);
    });
  }

  const roleEl = document.getElementById("topbarRole");
  const storedProfile = JSON.parse(sessionStorage.getItem(LPS_SESSION_KEY) || "null");
  const storedRole = normalizedAppRole(APP_USER_PROFILE?.role || storedProfile?.role || "");

  if (roleEl && isVisitorSession()) roleEl.textContent = "Visitor";
  else if (roleEl && storedRole) roleEl.textContent = storedRole;

  const canLoadProfile = !!(storedProfile || APP_USER_PROFILE || auth.currentUser);
  if (roleEl && typeof LPSApi !== "undefined" && canLoadProfile) {
    const refreshTopbarRole = (knownUser) => {
      LPSApi.getMyProfile(knownUser || auth.currentUser)
        .then((profile) => {
          if (!profile || typeof profile !== "object") return;
          const freshRole = normalizedAppRole(profile.role || "");
          if (freshRole) {
            roleEl.textContent = freshRole;
            roleEl.title = "";
            // Persist the freshly-known role (and profile) so later page loads
            // show it instantly, even if the next profile refresh is slow or
            // briefly unavailable. A role we already resolved once must never
            // be replaced by "Role unavailable".
            setAppUserProfile({ ...APP_USER_PROFILE, ...profile, role: freshRole });
            try {
              sessionStorage.setItem(LPS_SESSION_KEY, JSON.stringify({
                ...JSON.parse(sessionStorage.getItem(LPS_SESSION_KEY) || "{}"),
                ...profile,
                uid: profile.userId || profile.uid || storedProfile?.uid || "",
                email: profile.email || storedProfile?.email || "",
                name: profile.name || storedProfile?.name || "",
                role: freshRole,
              }));
            } catch (error) { /* Optional cache only — the label is already correct. */ }
          }
          if (profile.name && !document.querySelector('.topbar-user-text .name')?.textContent) {
            document.querySelector('.topbar-user-text .name').textContent = profile.name;
          }
        })
        .catch((error) => {
          // Keep showing the best role we know; "Role unavailable" is the true
          // last resort (no stored role AND the fetch failed) and always
          // carries the underlying reason as a tooltip.
          roleEl.textContent = storedRole || "Role unavailable";
          roleEl.title = error.message || "Could not load your role.";
          if (!auth.currentUser) {
            // The Firebase Auth SDK may still be restoring the persisted
            // session (that restore is asynchronous and can lag a page load).
            // Instead of leaving the label stuck on "Role unavailable", wait
            // for the real sign-in to arrive and retry the profile fetch once.
            const authUnsub = typeof auth.onAuthStateChanged === "function"
              ? auth.onAuthStateChanged((nextUser) => {
                  if (!nextUser) return;
                  authUnsub?.();
                  refreshTopbarRole(nextUser);
                })
              : null;
          }
        });
    };
    refreshTopbarRole();
  }

  const menuToggle = document.getElementById("menuToggle");
  const sidebarEl = document.getElementById("sidebar");
  if (menuToggle) {
    menuToggle.addEventListener("click", () => sidebarEl.classList.toggle("is-open"));
  }

  if (!mainArea.querySelector(".site-footer")) {
    const footer = document.createElement("footer");
    footer.className = "site-footer app-site-footer";
    footer.innerHTML = '<p>© 2026 San Roque Elementary School · Courtesy of <a href="https://github.com/clentagunod" target="_blank" rel="noopener noreferrer">ClentIndustries</a></p>';
    mainArea.appendChild(footer);
  }

  window.requestAnimationFrame(() => window.scrollTo(0, savedScroll));
  if (!window.__lpsScrollPersistenceBound) {
    window.__lpsScrollPersistenceBound = true;
    let scrollTimer = 0;
    window.addEventListener("scroll", () => {
      window.clearTimeout(scrollTimer);
      scrollTimer = window.setTimeout(() => {
        try { sessionStorage.setItem(`lps_scroll_${window.location.pathname}`, String(window.scrollY)); } catch (error) { /* Storage is optional. */ }
      }, 120);
    }, { passive: true });
  }

  window.setTimeout(() => {
    const loadingState = document.querySelector(".state-row")?.textContent || "";
    const extraFieldsLoading = document.querySelector(".extra-fields-loading");
    if (loadingState.includes("Loading") || extraFieldsLoading) {
      showToast(
        "This section is taking longer than expected. Refresh the tab to try loading it again.",
        "info",
        { title: "Still loading", actionLabel: "Refresh tab", onAction: () => window.location.reload(), duration: 12000 }
      );
    }
  }, 8000);
}

export function todayFormatted() {
  return formatAppDate(new Date());
}

export function formatAppDate(value, fallback = "—") {
  if (!value) return fallback;
  let date;
  if (value && typeof value.toDate === "function") date = value.toDate();
  else if (value && typeof value === "object" && Number.isFinite(Number(value.seconds ?? value._seconds))) {
    date = new Date(Number(value.seconds ?? value._seconds) * 1000);
  }
  else if (typeof value === "number" && value > 20000 && value < 100000) date = new Date(Date.UTC(1899, 11, 30) + value * 86400000);
  else if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) date = new Date(`${value}T00:00:00`);
  else date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function appDateInputValue(value) {
  if (!value) return "";
  let date;
  if (value && typeof value.toDate === "function") date = value.toDate();
  else if (/^\d{4}-\d{2}-\d{2}/.test(String(value))) return String(value).slice(0, 10);
  else date = new Date(value);
  return Number.isNaN(date?.getTime()) ? "" : date.toISOString().slice(0, 10);
}

/* ---- Toasts --------------------------------------------------------- */

export function ensureToastStack() {
  let stack = document.querySelector(".toast-stack");
  if (!stack) {
    stack = document.createElement("div");
    stack.className = "toast-stack";
    document.body.appendChild(stack);
  }
  return stack;
}

export function showToast(message, type = "info", options = {}) {
  const stack = ensureToastStack();
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.setAttribute("role", type === "error" ? "alert" : "status");

  const copy = document.createElement("div");
  copy.className = "toast-copy";
  if (options.title) {
    const title = document.createElement("strong");
    title.textContent = options.title;
    copy.appendChild(title);
  }
  const text = document.createElement("span");
  text.textContent = message;
  copy.appendChild(text);
  el.appendChild(copy);

  if (options.actionLabel && typeof options.onAction === "function") {
    const action = document.createElement("button");
    action.className = "toast-action";
    action.type = "button";
    action.textContent = options.actionLabel;
    action.addEventListener("click", options.onAction);
    el.appendChild(action);
  }

  const close = document.createElement("button");
  close.className = "toast-close";
  close.type = "button";
  close.setAttribute("aria-label", "Dismiss notification");
  close.textContent = "x";
  close.addEventListener("click", () => el.remove());
  el.appendChild(close);
  stack.appendChild(el);
  setTimeout(() => el.remove(), options.duration || 3800);
}

/* ---- Small formatting helpers used across pages ----------------------- */

export function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str == null ? "" : String(str);
  return div.innerHTML;
}

export function programBadges(learner) {
  const map = [
    ["is4Ps", "4Ps Beneficiary", "badge-4ps"],
    ["isIP", "IP Learner", "badge-ip"],
    ["isSNED", "SNED", "badge-sned"],
    ["isARAL", "ARAL Tagged", "badge-aral"],
    ["isMuslim", "Muslim Learner", "badge-muslim"],
  ];
  const active = map.filter(([key]) => !!learner[key]);
  if (active.length === 0) return `<span class="badge badge-neutral">Not Tagged</span>`;
  return active.map(([, label, cls]) => `<span class="badge ${cls}">${label}</span>`).join(" ");
}

export function wireAccountMenu() {
  const trigger = document.getElementById("accountMenuTrigger");
  const menu = document.getElementById("accountMenu");
  if (!trigger || !menu) return;
  const close = () => { menu.hidden = true; trigger.setAttribute("aria-expanded", "false"); };
  trigger.addEventListener("click", (event) => {
    event.stopPropagation();
    menu.hidden = !menu.hidden;
    trigger.setAttribute("aria-expanded", String(!menu.hidden));
  });
  menu.querySelectorAll("[data-account-action]").forEach((button) => button.addEventListener("click", () => {
    close();
    openAccountModal(button.dataset.accountAction);
  }));
  document.addEventListener("click", (event) => {
    if (!menu.contains(event.target) && event.target !== trigger) close();
  });
}

export function ensureAccountModal() {
  if (document.getElementById("accountModalBackdrop")) return;
  document.body.insertAdjacentHTML("beforeend", `<div class="modal-backdrop" id="accountModalBackdrop"><div class="modal account-modal"><div class="modal-header"><div><span class="eyebrow-label">Personal account</span><h3 id="accountModalTitle">Account settings</h3></div><button class="modal-close" type="button" id="accountModalClose" aria-label="Close">${Icon.close || "×"}</button></div><form id="accountForm"><div class="modal-body" id="accountModalBody"></div><div class="modal-footer"><button class="btn btn-secondary" type="button" id="accountModalCancel">Cancel</button><button class="btn btn-primary" type="submit" id="accountModalSave">Save changes</button></div></form></div></div>`);
  document.getElementById("accountModalClose").addEventListener("click", closeAccountModal);
  document.getElementById("accountModalCancel").addEventListener("click", closeAccountModal);
  document.getElementById("accountModalBackdrop").addEventListener("click", (event) => { if (event.target.id === "accountModalBackdrop") closeAccountModal(); });
  document.getElementById("accountForm").addEventListener("submit", submitAccountChange);
}

export function openAccountModal(action) {
  ensureAccountModal();
  const title = document.getElementById("accountModalTitle");
  const body = document.getElementById("accountModalBody");
  const isPassword = action === "password";
  title.textContent = isPassword ? "Change password" : "Change username";
  body.innerHTML = isPassword
    ? `<div class="account-modal-intro"><span class="account-modal-intro-icon">${Icon.lock || Icon.settings}</span><p>Choose a strong password for your Firebase sign-in account.</p></div><div class="field"><label for="accountCurrentPassword">Current password</label><input id="accountCurrentPassword" type="password" autocomplete="current-password" required /></div><div class="field"><label for="accountNewPassword">New password</label><input id="accountNewPassword" type="password" minlength="6" autocomplete="new-password" required /><small class="field-hint">Use at least 6 characters.</small></div><div class="field"><label for="accountConfirmPassword">Confirm new password</label><input id="accountConfirmPassword" type="password" autocomplete="new-password" required /></div>`
    : `<div class="account-modal-intro"><span class="account-modal-intro-icon">${Icon.userRound}</span><p>This name appears in your dashboard and in Manage Users. Your sign-in email will stay unchanged.</p></div><div class="field"><label for="accountNewName">Username</label><input id="accountNewName" maxlength="80" value="${escapeHtml(APP_USER_PROFILE?.name || "")}" required /><small class="field-hint">This changes your display name only, not your email address.</small></div>`;
  document.getElementById("accountForm").dataset.action = action;
  document.getElementById("accountModalBackdrop").classList.add("is-open");
  body.querySelector("input")?.focus();
}

export function closeAccountModal() { document.getElementById("accountModalBackdrop")?.classList.remove("is-open"); }

export function buildUpdatedProfile(currentProfile = {}, freshProfile = {}, updateResult = {}) {
  const preferredRole = freshProfile?.role || updateResult?.role || currentProfile.role || "School Staff";
  const preferredName = updateResult?.name || freshProfile?.name || currentProfile.name || "";
  const preferredEmail = freshProfile?.email || currentProfile.email || updateResult?.email || auth.currentUser?.email || "";
  const preferredUid = freshProfile?.userId || freshProfile?.uid || currentProfile.uid || updateResult?.uid || auth.currentUser?.uid || "";

  return {
    ...currentProfile,
    ...freshProfile,
    ...updateResult,
    name: preferredName,
    email: preferredEmail,
    uid: preferredUid,
    role: preferredRole,
  };
}

export async function submitAccountChange(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = document.getElementById("accountModalSave");
  setButtonLoading(button, "Saving changes…");
  try {
    if (form.dataset.action === "password") {
      const current = document.getElementById("accountCurrentPassword").value;
      const next = document.getElementById("accountNewPassword").value;
      const confirm = document.getElementById("accountConfirmPassword").value;
      if (next !== confirm) throw new Error("The new passwords do not match.");
      const user = auth.currentUser;
      const credential = firebase.auth.EmailAuthProvider.credential(user.email, current);
      await user.reauthenticateWithCredential(credential);
      await user.updatePassword(next);
      showToast("Password changed successfully.", "success");
    } else {
      const result = await updateOwnProfileName(document.getElementById("accountNewName").value);
      const currentProfile = JSON.parse(sessionStorage.getItem(LPS_SESSION_KEY) || "null") || APP_USER_PROFILE || {};
      const freshProfile = typeof LPSApi !== "undefined" && LPSApi.getMyProfile ? await LPSApi.getMyProfile(auth.currentUser).catch(() => null) : null;
      const nextProfile = buildUpdatedProfile(currentProfile, freshProfile, result);
      setAppUserProfile(nextProfile);
      try {
        sessionStorage.setItem(LPS_SESSION_KEY, JSON.stringify({
          ...JSON.parse(sessionStorage.getItem(LPS_SESSION_KEY) || "{}"),
          ...nextProfile,
          name: nextProfile.name,
        }));
      } catch (error) { /* Ignore optional cache update. */ }
      document.querySelector(".topbar-user-text .name").textContent = nextProfile.name;
      showToast("Username updated successfully.", "success");
    }
    closeAccountModal();
  } catch (error) {
    const message = error.code === "auth/wrong-password" || error.code === "auth/invalid-credential" ? "The current password is incorrect." : error.message || "Account update failed.";
    showToast(message, "error");
  } finally { clearButtonLoading(button); }
}

export async function updateOwnProfileName(name) {
  const user = auth.currentUser;
  const value = String(name || "").trim();
  if (!user) throw new Error("Not signed in.");
  if (value.length < 2) throw new Error("Username must be at least 2 characters.");
  if (value.length > 80) throw new Error("Username must be 80 characters or fewer.");
  if (typeof LPSApi !== "undefined" && LPSApi.updateMyProfileName) return LPSApi.updateMyProfileName(value);
  await db.collection("users").doc(user.uid).update({ name: value });
  return { name: value };
}