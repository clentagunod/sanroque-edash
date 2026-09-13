// @ts-nocheck -- ported from the original site; behavior preserved, not yet fully typed.
import { LPSApi } from './sheets-api';
import { isVisitorSession } from './app-config';
import { fsNormalizeSchoolYear_, fsSubscribeSchoolYears } from './firestore-api';
import { escapeHtml } from './shell';

/**
 * Shared school-year selector used by dashboard, reports, and learner lists.
 */

export let selectedSchoolYear = "";
export function setSelectedSchoolYear(year) { selectedSchoolYear = year; }
export let availableSchoolYears = [];
/** Live subscription that keeps the year picker in sync when an admin adds a year or marks a new one current. */
export let schoolYearsLiveUnsubscribe = null;
export const SCHOOL_YEAR_REQUEST_TIMEOUT_MS = 5000;
// The year picker is re-initialized fresh on every page load (dashboard,
// masterlist, program pages, reports each run their own script context), so
// without persisting the choice here, switching years on one page has no
// way to reach any other page — they'd just fall back to whichever year is
// flagged "current" in the Sheet. Storing it lets every page pick up the
// same selection for the rest of the browser session.
export const SCHOOL_YEAR_STORAGE_KEY = "lps_selected_school_year";

export function getSelectedSchoolYear() {
  return selectedSchoolYear;
}

export function readStoredSchoolYear_() {
  try {
    return sessionStorage.getItem(SCHOOL_YEAR_STORAGE_KEY) || "";
  } catch (error) {
    return "";
  }
}

export function writeStoredSchoolYear_(year) {
  try {
    sessionStorage.setItem(SCHOOL_YEAR_STORAGE_KEY, year || "");
  } catch (error) {
    // Private browsing or storage limits must not break the switcher.
  }
}

/** Only show the "Current" badge when the selected year actually is the
 * one flagged current in the Sheet — otherwise it wrongly implies an empty
 * or past year's data is the live one. */
export function updateYearBadge_(mount, years, selected) {
  const badge = mount.querySelector(".year-current-badge");
  if (!badge) return;
  const match = years.find((year) => year.schoolYear === selected);
  const isCurrent = !!(match && match.isCurrent);
  badge.style.display = isCurrent ? "" : "none";
  badge.textContent = "Current";
}

export async function initYearSwitcher(onChange) {
  const mount = document.getElementById("yearSwitcherMount");
  if (!mount) return;

  selectedSchoolYear = "";
  availableSchoolYears = [];

  if (isVisitorSession()) {
    try {
      const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error("Public school-year data timed out.")), SCHOOL_YEAR_REQUEST_TIMEOUT_MS));
      const stats = await Promise.race([LPSApi.getPublicStats(), timeout]);
      // `stats` is legitimately null when publicStats/summary hasn't been
      // created yet (e.g. zero learners) — that's an empty state, not an
      // error, so fall through to "" rather than throwing.
      selectedSchoolYear = typeof fsNormalizeSchoolYear_ === "function"
        ? fsNormalizeSchoolYear_(stats?.schoolYear)
        : String(stats?.schoolYear || "").trim();
      if (selectedSchoolYear) {
        mount.innerHTML = `<div class="year-switcher year-switcher-readonly"><div class="year-switcher-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4.5" width="18" height="16" rx="2"/><path d="M16 3v3M8 3v3M3 9.5h18"/></svg></div><div class="year-switcher-copy"><span>Academic period</span><label>Current school year</label></div><strong class="year-readonly-value">${escapeHtml(selectedSchoolYear)}</strong><span class="year-current-badge">Current</span></div>`;
      }
    } catch (error) {
      mount.innerHTML = `<div class="form-alert" style="display:flex;">Current school-year information is temporarily unavailable.</div>`;
    }
    if (typeof onChange === "function") await onChange(selectedSchoolYear);
    return;
  }

  try {
    if (typeof LPSApi === "undefined" || typeof LPSApi.getSchoolYears !== "function") {
      if (typeof onChange === "function") await onChange("");
      return;
    }
    const timeout = new Promise((_, reject) => {
      setTimeout(() => reject(new Error("School-year metadata timed out.")), SCHOOL_YEAR_REQUEST_TIMEOUT_MS);
    });
    availableSchoolYears = await Promise.race([LPSApi.getSchoolYears(), timeout]);
  } catch (error) {
    // The data request below will show its own error/demo state. A failed
    // year lookup must not prevent the page from rendering at all.
    mount.innerHTML = "";
    if (typeof onChange === "function") await onChange("");
    return;
  }

  if (!Array.isArray(availableSchoolYears) || availableSchoolYears.length === 0) {
    mount.innerHTML = "";
    selectedSchoolYear = "";
    if (typeof onChange === "function") await onChange("");
    return;
  }

  availableSchoolYears = availableSchoolYears.map((year) => ({
    ...year,
    schoolYear: typeof fsNormalizeSchoolYear_ === "function" ? fsNormalizeSchoolYear_(year.schoolYear) : String(year.schoolYear || "").trim(),
  })).filter((year, index, years) => year.schoolYear && years.findIndex((item) => item.schoolYear === year.schoolYear) === index);
  const stored = readStoredSchoolYear_();
  const storedMatch = stored && availableSchoolYears.find((year) => year.schoolYear === stored);
  const fallback = availableSchoolYears.find((year) => year.isCurrent) || availableSchoolYears[0];
  const current = storedMatch || fallback;
  selectedSchoolYear = current.schoolYear || "";
  writeStoredSchoolYear_(selectedSchoolYear);
  mount.innerHTML = `
    <div class="year-switcher">
      <div class="year-switcher-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="4.5" width="18" height="16" rx="2"/><path d="M16 3v3M8 3v3M3 9.5h18"/><path d="M8 13h.01M12 13h.01M16 13h.01M8 17h.01M12 17h.01"/>
        </svg>
      </div>
      <div class="year-switcher-copy">
        <span>Academic period</span>
        <label for="schoolYearSelect">School year</label>
      </div>
      <div class="year-select-wrap">
        <select id="schoolYearSelect" aria-label="School year"></select>
      </div>
      <span class="year-current-badge"></span>
    </div>`;

  const select = document.getElementById("schoolYearSelect");
  select.innerHTML = availableSchoolYears
    .map((year) => `<option value="${escapeHtml(year.schoolYear)}">${escapeHtml(year.schoolYear)}</option>`)
    .join("");
  select.value = selectedSchoolYear;
  updateYearBadge_(mount, availableSchoolYears, selectedSchoolYear);
  select.addEventListener("change", () => {
    selectedSchoolYear = select.value;
    writeStoredSchoolYear_(selectedSchoolYear);
    select.disabled = true;
    select.setAttribute("aria-busy", "true");
    const badge = mount.querySelector(".year-current-badge");
    if (badge) {
      badge.classList.add("is-loading");
      badge.innerHTML = `<span class="inline-spinner" aria-hidden="true"></span> Loading`;
    }
    if (typeof onChange === "function") {
      Promise.resolve(onChange(selectedSchoolYear)).finally(() => {
        select.disabled = false;
        select.removeAttribute("aria-busy");
        if (badge) badge.classList.remove("is-loading");
        updateYearBadge_(mount, availableSchoolYears, selectedSchoolYear);
      });
    }
  });

  if (typeof onChange === "function") await onChange(selectedSchoolYear);

  // Keep the picker live: when an admin adds a school year or marks another
  // one as current on another device, this page updates without a refresh.
  schoolYearsLiveUnsubscribe?.();
  schoolYearsLiveUnsubscribe = typeof fsSubscribeSchoolYears === "function"
    ? fsSubscribeSchoolYears((years) => syncSchoolYearsLive(mount, onChange, years), () => {})
    : null;

}

/** Applies a fresh school-year snapshot to the mounted picker in place — the
 *  user's selection stays put unless the selected year was removed. */
export function syncSchoolYearsLive(mount, onChange, years) {
  if (!mount || !Array.isArray(years) || !years.length) return;
  const normalized = years
    .map((year) => ({
      ...year,
      schoolYear: typeof fsNormalizeSchoolYear_ === "function" ? fsNormalizeSchoolYear_(year.schoolYear) : String(year.schoolYear || "").trim(),
    }))
    .filter((year, index, all) => year.schoolYear && all.findIndex((item) => item.schoolYear === year.schoolYear) === index);
  if (!normalized.length) return;

  const prevSelected = selectedSchoolYear;
  const stillExists = prevSelected && normalized.some((year) => year.schoolYear === prevSelected);
  if (!stillExists) {
    // The selected year disappeared (admin removed it) — fall back to current.
    const fallback = normalized.find((year) => year.isCurrent) || normalized[0];
    selectedSchoolYear = fallback ? fallback.schoolYear || "" : "";
    writeStoredSchoolYear_(selectedSchoolYear);
  }

  availableSchoolYears = normalized;
  const select = document.getElementById("schoolYearSelect");
  if (select) {
    const prevValue = select.value;
    select.innerHTML = normalized
      .map((year) => `<option value="${escapeHtml(year.schoolYear)}">${escapeHtml(year.schoolYear)}</option>`)
      .join("");
    select.value = normalized.some((year) => year.schoolYear === prevValue) ? prevValue : selectedSchoolYear;
  }
  updateYearBadge_(mount, normalized, selectedSchoolYear);

  if (!stillExists && typeof onChange === "function") {
    void Promise.resolve(onChange(selectedSchoolYear));
  }
}