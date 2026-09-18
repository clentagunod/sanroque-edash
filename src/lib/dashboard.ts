// @ts-nocheck -- ported from the original site; behavior preserved, not yet fully typed.
import { LPSApi } from './sheets-api';
import { escapeHtml, formatAppDate, renderShell, todayFormatted } from './shell';
import { requireAuth } from './auth';
import { DEMO_SUMMARY, isSheetsApiConfigured } from './demo-data';
import { isTeacher, isVisitorSession, storedAppProfile } from './app-config';
import { Icon } from './icons';
import { fsGetLearners, fsGetPublicStats, fsNormalizeSchoolYear_, fsRefreshPublicStats, fsSubscribeLearners, fsSubscribePublicStats, fsSubscribeRecentLearners } from './firestore-api';
import { initYearSwitcher } from './school-year';

export let dashboardLearnerUnsubscribe = null;
export let dashboardPublicStatsUnsubscribe = null;
export let dashboardRecentLearnersUnsubscribe = null;
export const DASHBOARD_STATS_TIMEOUT_MS = 5000;

export function getDashboardPublicStats() {
  const timeout = new Promise((_, reject) => window.setTimeout(() => reject(new Error("Dashboard statistics timed out.")), DASHBOARD_STATS_TIMEOUT_MS));
  return Promise.race([fsGetPublicStats(), timeout]);
}

export async function initDashboard() {
  renderShell("dashboard");
  renderDashboardContext();
    const dateElement = document.getElementById("todayDate");
    if (dateElement) dateElement.textContent = "Today is " + todayFormatted();
  if (isVisitorSession()) {
    const learnerPanel = document.querySelector("#recentTableBody")?.closest(".panel");
    if (learnerPanel) learnerPanel.style.display = "none";
    if (typeof fsSubscribePublicStats === "function") {
      dashboardPublicStatsUnsubscribe?.();
      // A missing `publicStats/summary` doc (a brand-new school year, or one
      // that currently has zero learners) is a normal empty state, not a
      // failure — show zero-value stat cards instead of an error banner.
      getDashboardPublicStats()
        .then((stats) => renderVisitorDashboardSummary(stats || visitorFallbackSummary()))
        .catch((error) => showDashboardDataError("current school year", error));
      dashboardPublicStatsUnsubscribe = fsSubscribePublicStats(
        (stats) => renderVisitorDashboardSummary(stats || visitorFallbackSummary()),
        (error) => showDashboardDataError("current school year", error)
      );
      return;
    }
  }

  // Safety net: if nothing has painted the stat cards a few seconds after
  // the switcher settles (an edge case in year/stats resolution should never
  // leave the page stuck on its static "Loading…" placeholders), render an
  // explicit zero-state instead of spinning forever.
  let selectedSchoolYearForWatchdog = "";
  // Left running deliberately: it only ever acts if the stat cards are still
  // empty by the time it fires, which is harmless once real data has loaded.
  window.setTimeout(() => {
    const statGrid = document.getElementById("statGrid");
    if (statGrid && !statGrid.innerHTML.trim()) renderEmptyDashboard_(selectedSchoolYearForWatchdog);
  }, DASHBOARD_STATS_TIMEOUT_MS * 2);
  await initYearSwitcher((year) => {
    selectedSchoolYearForWatchdog = year;
    return loadDashboardData(year);
  });
}

export function renderDashboardContext() {
  const profile = storedAppProfile() || {};
  const welcome = document.getElementById("dashboardWelcome");
  const scope = document.getElementById("dashboardScope");
  if (!welcome || !scope) return;
  const displayName = String(profile.name || profile.email || "there").trim();
  welcome.textContent = `Welcome, ${displayName}`;
  if (isTeacher()) {
    const assignment = profile.teacherAssignment || {};
    scope.innerHTML = `<strong>Your teaching scope</strong><span>${escapeHtml(assignment.schoolYear || "Current school year")} · ${escapeHtml(assignment.gradeLevel || "Grade not assigned")} · ${escapeHtml(assignment.section || "Section not assigned")}</span><small>Dashboard totals, learner lists, and enrollment counts are limited to this assignment.</small>`;
  } else {
    scope.innerHTML = `<strong>School-wide registrar view</strong><span>All grades, sections, and active learners</span><small>Manage the complete masterlist and registrar data from the navigation.</small>`;
  }
}

export function renderDashboardSummary(summary, recentLearners = []) {
  const payload = {
    ...summary,
    recentLearners: Array.isArray(recentLearners) && recentLearners.length ? recentLearners : (summary?.recentLearners || []),
    lastSynced: summary?.updatedAt?.toDate ? `Updated ${summary.updatedAt.toDate().toLocaleString()}` : (summary?.lastSynced || "Live from Firestore"),
  };
  const demoBanner = document.getElementById("demoBanner");
  if (demoBanner) demoBanner.style.display = "none";
  renderStatCards(payload);
  renderDonut(payload);
  renderBarChart(payload);
  renderRecentTable(payload.recentLearners || []);
  renderProgramSummary(payload);
  const lastSynced = document.getElementById("lastSynced");
  if (lastSynced) lastSynced.textContent = payload.lastSynced;
  return payload;
}

export function renderVisitorDashboardSummary(summary) {
  const demoBanner = document.getElementById("demoBanner");
  if (demoBanner) demoBanner.style.display = "none";
  renderStatCards(summary);
  renderDonut(summary);
  renderBarChart(summary);
  renderProgramSummary(summary);
  const lastSynced = document.getElementById("lastSynced");
  if (lastSynced) lastSynced.textContent = summary.updatedAt?.toDate ? `Updated ${summary.updatedAt.toDate().toLocaleString()}` : "Live from Firestore";
}

/** Renders an all-zero dashboard so the page never gets stuck showing its
 *  initial "Loading…" placeholders — used as a last-resort safety net. */
export function renderEmptyDashboard_(schoolYear) {
  const demoBanner = document.getElementById("demoBanner");
  if (demoBanner) demoBanner.style.display = "none";
  const summary = visitorFallbackSummary();
  renderStatCards(summary);
  renderDonut(summary);
  renderBarChart(summary);
  renderRecentTable([]);
  renderProgramSummary(summary);
  const lastSynced = document.getElementById("lastSynced");
  if (lastSynced) lastSynced.textContent = schoolYear ? "No data yet for this school year" : "No data available";
}

export async function loadDashboardData(schoolYear) {
  if (isTeacher() && schoolYear && typeof fsSubscribeLearners === "function") {
    dashboardPublicStatsUnsubscribe?.();
    dashboardRecentLearnersUnsubscribe?.();
    dashboardLearnerUnsubscribe?.();
    const renderTeacherDashboard = (learners) => {
      const summary = summarizeFirestoreLearners(learners);
      renderStatCards(summary);
      renderDonut(summary);
      renderBarChart(summary);
      renderRecentTable(summary.recentLearners);
      renderProgramSummary(summary);
      const lastSynced = document.getElementById("lastSynced");
      if (lastSynced) lastSynced.textContent = summary.lastSynced;
    };
    const initialLearners = await fsGetLearners(schoolYear);
    renderTeacherDashboard(initialLearners);
    dashboardLearnerUnsubscribe = fsSubscribeLearners(schoolYear, renderTeacherDashboard, (error) => showDashboardDataError(schoolYear, error));
    return;
  }
  const renderPublicFallback = async (selectedYear = schoolYear) => {
    try {
      const publicStats = typeof fsGetPublicStats === "function" ? await getDashboardPublicStats().catch(() => null) : null;
      if (!publicStats) return false;
      const statsYear = typeof fsNormalizeSchoolYear_ === "function" ? fsNormalizeSchoolYear_(publicStats.schoolYear) : publicStats.schoolYear;
      const requestedYear = typeof fsNormalizeSchoolYear_ === "function" ? fsNormalizeSchoolYear_(selectedYear) : selectedYear;
      if (requestedYear && statsYear && statsYear !== requestedYear) return false;
      const summary = { ...publicStats, recentLearners: publicStats.recentLearners || [], lastSynced: publicStats.updatedAt?.toDate ? `Updated ${publicStats.updatedAt.toDate().toLocaleString()}` : "Live from Firestore" };
      const demoBanner = document.getElementById("demoBanner");
      if (demoBanner) demoBanner.style.display = "none";
      renderStatCards(summary);
      renderDonut(summary);
      renderBarChart(summary);
      renderRecentTable(summary.recentLearners || []);
      renderProgramSummary(summary);
      const lastSynced = document.getElementById("lastSynced");
      if (lastSynced) lastSynced.textContent = summary.lastSynced;
      return true;
    } catch (error) {
      return false;
    }
  };

  const fallbackReady = await renderPublicFallback(schoolYear).catch(() => false);
  if (fallbackReady) return;

  if (!isVisitorSession() && typeof fsSubscribeLearners === "function" && schoolYear) {
    let publicStats = typeof fsGetPublicStats === "function" ? await getDashboardPublicStats().catch(() => null) : null;
    // A staff member is signed in and allowed to write publicStats/summary —
    // if it doesn't exist yet (new deployment, or a year that has never had
    // an add/update/delete run through the app), recompute it now. This is
    // what lets "Continue as Visitor" show real data afterwards instead of
    // the "Public statistics have not been initialized yet." empty state.
    if (!publicStats && typeof fsRefreshPublicStats === "function") {
      publicStats = await fsRefreshPublicStats().catch(() => null);
    }
    const statsYear = typeof fsNormalizeSchoolYear_ === "function" ? fsNormalizeSchoolYear_(publicStats?.schoolYear) : publicStats?.schoolYear;
    const selectedYear = typeof fsNormalizeSchoolYear_ === "function" ? fsNormalizeSchoolYear_(schoolYear) : schoolYear;
    if (publicStats && statsYear === selectedYear && typeof fsSubscribeRecentLearners === "function") {
      dashboardLearnerUnsubscribe?.();
      dashboardLearnerUnsubscribe = null;
      dashboardPublicStatsUnsubscribe?.();
      dashboardRecentLearnersUnsubscribe?.();
      let recentLearners = [];
      let latestPublicStats = publicStats;
      const renderAggregate = (stats) => {
        if (!stats) return;
        latestPublicStats = stats;
        renderDashboardSummary({ ...stats, recentLearners }, recentLearners);
      };
      dashboardPublicStatsUnsubscribe = fsSubscribePublicStats((stats) => {
        if (!stats) return;
        latestPublicStats = stats;
        renderAggregate(stats);
      }, (error) => {
        showDashboardDataError(schoolYear, error);
        void renderPublicFallback(schoolYear);
      });
      dashboardRecentLearnersUnsubscribe = fsSubscribeRecentLearners(schoolYear, (learners) => {
        recentLearners = Array.isArray(learners) ? learners : [];
        renderAggregate(latestPublicStats || publicStats || {});
      }, (error) => {
        showDashboardDataError(schoolYear, error);
        void renderPublicFallback(schoolYear);
      });
      return;
    }
    if (dashboardLearnerUnsubscribe) dashboardLearnerUnsubscribe();
    dashboardPublicStatsUnsubscribe?.();
    dashboardRecentLearnersUnsubscribe?.();
    dashboardLearnerUnsubscribe = fsSubscribeLearners(
      schoolYear,
      (learners) => {
        const summary = summarizeFirestoreLearners(learners);
        const demoBanner = document.getElementById("demoBanner");
        if (demoBanner) demoBanner.style.display = "none";
        renderStatCards(summary);
        renderDonut(summary);
        renderBarChart(summary);
        renderRecentTable(summary.recentLearners);
        renderProgramSummary(summary);
        const lastSynced = document.getElementById("lastSynced");
        if (lastSynced) lastSynced.textContent = summary.lastSynced;
      },
      (error) => {
        showDashboardDataError(schoolYear, error);
        void renderPublicFallback(schoolYear);
      }
    );
    return;
  }

  let summary;
  try {
    summary = await Promise.race([
      LPSApi.getDashboardSummary(schoolYear),
      new Promise((_, reject) => window.setTimeout(() => reject(new Error("Dashboard data timed out.")), DASHBOARD_STATS_TIMEOUT_MS)),
    ]);
  } catch (e) {
    const fallbackSummary = await renderPublicFallback(schoolYear).catch(() => false);
    if (fallbackSummary) return;
    if (isSheetsApiConfigured()) {
      const banner = document.getElementById("demoBanner");
      if (banner) {
        banner.innerHTML = `<span>Unable to load live data for ${escapeHtml(schoolYear || "the selected school year")}: ${escapeHtml(e.message || "Please try again.")}</span>`;
        banner.style.display = "flex";
      }
      summary = isVisitorSession() ? visitorFallbackSummary() : null;
      if (!summary) return;
    } else {
      summary = DEMO_SUMMARY;
      document.getElementById("demoBanner").style.display = "flex";
    }
  }

  const demoBanner = document.getElementById("demoBanner");
  if (demoBanner && isSheetsApiConfigured()) demoBanner.style.display = "none";
  renderStatCards(summary);
  renderDonut(summary);
  renderBarChart(summary);
  renderRecentTable(summary.recentLearners || []);
  renderProgramSummary(summary);
  const lastSynced = document.getElementById("lastSynced");
  if (lastSynced) lastSynced.textContent = summary.lastSynced || "—";
}

export function showDashboardDataError(schoolYear, error) {
  const banner = document.getElementById("demoBanner");
  if (banner) {
    banner.innerHTML = `<span>Unable to load live data for ${escapeHtml(schoolYear || "the selected school year")}: ${escapeHtml(error.message || "Please try again.")}</span>`;
    banner.style.display = "flex";
  }
}

export function summarizeFirestoreLearners(learners) {
  const items = Array.isArray(learners) ? learners : [];
  const gradeCounts = {};
  items.forEach((learner) => {
    const grade = learner.gradeLevel || "—";
    gradeCounts[grade] = (gradeCounts[grade] || 0) + 1;
  });
  const recentLearners = items
    .slice()
    .sort((a, b) => (learnerDateValue(b.dateAdded || b.createdAt || b.addedAt) - learnerDateValue(a.dateAdded || a.createdAt || a.addedAt)) || String(b.learnerId || "").localeCompare(String(a.learnerId || "")))
    .slice(0, 5)
    .map((learner) => ({ ...learner, dateAdded: formatLearnerDate(learner.dateAdded || learner.createdAt || learner.addedAt) }));
  const taggedCount = items.filter((learner) => learner.is4Ps || learner.isIP || learner.isSNED || learner.isARAL || learner.isMuslim).length;

  return {
    totalLearners: items.length,
    maleCount: items.filter((learner) => learner.gender === "Male").length,
    femaleCount: items.filter((learner) => learner.gender === "Female").length,
    fourPsCount: items.filter((learner) => learner.is4Ps).length,
    ipCount: items.filter((learner) => learner.isIP).length,
    snedCount: items.filter((learner) => learner.isSNED).length,
    aralCount: items.filter((learner) => learner.isARAL).length,
    muslimCount: items.filter((learner) => learner.isMuslim).length,
    notTaggedCount: items.length - taggedCount,
    gradeLevels: Object.entries(gradeCounts).map(([label, value]) => ({ label, value })),
    recentLearners,
    lastSynced: "Live from Firestore",
  };
}

export function learnerDateValue(value) {
  if (value && typeof value.toDate === "function") return value.toDate().getTime();
  const time = Date.parse(value || "");
  return Number.isNaN(time) ? 0 : time;
}

export function formatLearnerDate(value) {
  return formatAppDate(value, "Not recorded");
}

export function visitorFallbackSummary() {
  return {
    totalLearners: 0,
    maleCount: 0,
    femaleCount: 0,
    fourPsCount: 0,
    ipCount: 0,
    snedCount: 0,
    aralCount: 0,
    muslimCount: 0,
    notTaggedCount: 0,
    gradeLevels: [],
    recentLearners: [],
    lastSynced: "Unavailable",
  };
}

export function renderStatCards(s) {
  const pct = (n) => (s.totalLearners ? ((n / s.totalLearners) * 100).toFixed(2) + "% of total learners" : "");
  document.getElementById("statGrid").innerHTML = `
    <div class="stat-card">
      <div class="stat-card-top"><div class="stat-icon total">${Icon.users}</div><span class="label">Total Learners</span></div>
      <div class="stat-value">${s.totalLearners.toLocaleString()}</div>
      <div class="stat-foot">All enrolled learners</div>
    </div>
    <div class="stat-card">
      <div class="stat-card-top"><div class="stat-icon male">${Icon.users}</div><span class="label">Male Learners</span></div>
      <div class="stat-value">${(s.maleCount || 0).toLocaleString()}</div>
      <div class="stat-foot">Gender recorded as Male</div>
    </div>
    <div class="stat-card">
      <div class="stat-card-top"><div class="stat-icon female">${Icon.users}</div><span class="label">Female Learners</span></div>
      <div class="stat-value">${(s.femaleCount || 0).toLocaleString()}</div>
      <div class="stat-foot">Gender recorded as Female</div>
    </div>
    <div class="stat-card">
      <div class="stat-card-top"><div class="stat-icon fourps">${Icon.heart}</div><span class="label">4Ps Beneficiaries</span></div>
      <div class="stat-value">${s.fourPsCount.toLocaleString()}</div>
      <div class="stat-foot">${pct(s.fourPsCount)}</div>
    </div>
    <div class="stat-card">
      <div class="stat-card-top"><div class="stat-icon ip">${Icon.leaf}</div><span class="label">IP Learners</span></div>
      <div class="stat-value">${s.ipCount.toLocaleString()}</div>
      <div class="stat-foot">${pct(s.ipCount)}</div>
    </div>
    <div class="stat-card">
      <div class="stat-card-top"><div class="stat-icon sned">${Icon.accessibility}</div><span class="label">SNED Learners</span></div>
      <div class="stat-value">${s.snedCount.toLocaleString()}</div>
      <div class="stat-foot">${pct(s.snedCount)}</div>
    </div>
    <div class="stat-card">
      <div class="stat-card-top"><div class="stat-icon aral">${Icon.alertTriangle}</div><span class="label">ARAL Tagged</span></div>
      <div class="stat-value">${s.aralCount.toLocaleString()}</div>
      <div class="stat-foot">${pct(s.aralCount)}</div>
    </div>
    <div class="stat-card">
      <div class="stat-card-top"><div class="stat-icon muslim">${Icon.users}</div><span class="label">Muslim Learners</span></div>
      <div class="stat-value">${(s.muslimCount || 0).toLocaleString()}</div>
      <div class="stat-foot">Identified learners</div>
    </div>
    `;
}

export function renderDonut(s) {
  const segments = [
    { label: "Not Tagged", value: s.notTaggedCount, color: "#2f6fed" },
    { label: "4Ps Beneficiaries", value: s.fourPsCount, color: "var(--tag-4ps)" },
    { label: "IP Learners", value: s.ipCount, color: "var(--tag-ip)" },
    { label: "SNED Learners", value: s.snedCount, color: "var(--tag-sned)" },
    { label: "ARAL Tagged", value: s.aralCount, color: "var(--tag-aral)" },
    { label: "Muslim Learners", value: s.muslimCount || 0, color: "var(--tag-muslim)" },
  ];
  const rawColors = { "Not Tagged": "#2f6fed", "4Ps Beneficiaries": "#d94f70", "IP Learners": "#1e8e5a", "SNED Learners": "#7c5cd1", "ARAL Tagged": "#e08a2b", "Muslim Learners": "#31527f" };
  const total = segments.reduce((sum, seg) => sum + seg.value, 0) || 1;

  const radius = 70, circumference = 2 * Math.PI * radius;
  let offset = 0;
  const circles = segments.map((seg) => {
    const fraction = seg.value / total;
    const length = fraction * circumference;
    const dashArray = `${length} ${circumference - length}`;
    const circle = `<circle cx="90" cy="90" r="${radius}" fill="none" stroke="${rawColors[seg.label]}" stroke-width="26"
      stroke-dasharray="${dashArray}" stroke-dashoffset="${-offset}" transform="rotate(-90 90 90)" />`;
    offset += length;
    return circle;
  }).join("");

  document.getElementById("donutSvg").innerHTML = `
    <svg viewBox="0 0 180 180" width="190" height="190">${circles}<circle cx="90" cy="90" r="44" fill="#fff" /></svg>`;

  document.getElementById("donutLegend").innerHTML = segments.map((seg) => `
    <div class="legend-row">
      <span class="legend-key"><span class="legend-dot" style="background:${rawColors[seg.label]}"></span>${seg.label}</span>
      <span class="legend-val">${seg.value.toLocaleString()} (${((seg.value / total) * 100).toFixed(1)}%)</span>
    </div>`).join("");
}

export function renderBarChart(s) {
  const levels = (s.gradeLevels || []).map((grade) => ({ label: grade.label || grade.gradeLevel || "—", value: Number(grade.value ?? grade.total) || 0 }));
  const max = Math.max(...levels.map((g) => g.value), 1);
  document.getElementById("gradeBarChart").innerHTML = levels.map((g) => `
    <div class="bar-col">
      <div class="bar-value">${g.value}</div>
      <div class="bar-rect" style="height:${(g.value / max) * 170}px"></div>
      <div class="bar-label">${g.label}</div>
    </div>`).join("");
}

export function renderRecentTable(learners) {
  if (isVisitorSession()) {
    document.getElementById("recentTableBody").innerHTML = `<tr><td colspan="3" class="state-row">Learner names are available only to authorized staff.</td></tr>`;
    const link = document.querySelector("#recentTableBody")?.closest(".panel-body")?.querySelector(".panel-link");
    if (link) link.remove();
    return;
  }

  const safeLearners = Array.isArray(learners) ? learners.filter((learner) => {
    const isNamed = Boolean((learner?.firstName || learner?.lastName || learner?.name || learner?.learnerId)?.toString().trim());
    const hasGrade = Boolean((learner?.gradeLevel || learner?.section)?.toString().trim());
    return isNamed || hasGrade;
  }) : [];

  const rows = safeLearners.map((l) => {
    const dateValue = formatAppDate(l.dateAdded, "Not recorded");
    return `
    <tr>
      <td class="cell-name">${escapeHtml(l.lastName || l.name || "Unknown")}, ${escapeHtml(l.firstName || "")}</td>
      <td>${escapeHtml(l.gradeLevel || "—")} - ${escapeHtml(l.section || "—")}</td>
      <td>${escapeHtml(dateValue)}</td>
    </tr>`;
  }).join("");

  document.getElementById("recentTableBody").innerHTML = rows || `<tr><td colspan="3" class="state-row">No learners added yet.</td></tr>`;
}

export function renderProgramSummary(s) {
  const rows = [
    { icon: "heart", cls: "fourps", title: "4Ps Beneficiaries", desc: "Learners tagged as 4Ps beneficiaries", count: s.fourPsCount, href: "program-4ps.html" },
    { icon: "leaf", cls: "ip", title: "IP Learners", desc: "Learners identified as Indigenous Peoples", count: s.ipCount, href: "program-ip.html" },
    { icon: "accessibility", cls: "sned", title: "SNED Learners", desc: "Learners with Special Educational Needs", count: s.snedCount, href: "program-sned.html" },
    { icon: "alertTriangle", cls: "aral", title: "ARAL Tagged Learners", desc: "Learners at Risk of Dropping Out / ARAL", count: s.aralCount, href: "program-aral.html" },
    { icon: "users", cls: "muslim", title: "Muslim Learners", desc: "Learners identified in the Muslim category", count: s.muslimCount || 0, href: "program-muslim.html" },
  ];
  document.getElementById("programSummary").innerHTML = rows.map((r) => `${isVisitorSession() ? "<div" : `<a href="${r.href}"`} class="summary-row" style="text-decoration:none;color:inherit;">
      <div class="summary-icon stat-icon ${r.cls}">${Icon[r.icon]}</div>
      <div class="summary-body">
        <div class="summary-title">${r.title}</div>
        <div class="summary-desc">${r.desc}</div>
      </div>
      <div class="summary-count" style="color:var(--tag-${r.cls === "fourps" ? "4ps" : r.cls})">${r.count.toLocaleString()}</div>
      ${isVisitorSession() ? "" : `<span class="summary-chev">${Icon.chevronRight}</span>`}
    ${isVisitorSession() ? "</div>" : "</a>`"}`).join("");
}
