export const PROFILE_PERIODS = [
  { key: 'bosy', label: 'BOSY' },
  { key: 'mosy', label: 'MOSY' },
  { key: 'eosy', label: 'EOSY' },
];

export const CRLA_CATEGORIES = [
  { label: 'Grade Ready', color: '#2f6fed' },
  { label: 'Transitioning', color: '#168b8b' },
  { label: 'Developing', color: '#d69425' },
  { label: 'High Emerging', color: '#d65f4c' },
  { label: 'Low Emerging', color: '#56845a' },
];

export const PHIL_IRI_CATEGORIES = [
  { label: 'Independent', color: '#2f6fed' },
  { label: 'Instructional', color: '#d69425' },
  { label: 'Frustration', color: '#d65f4c' },
];

export const RMA_CATEGORIES = [
  { label: 'Not Proficient', color: '#d65f4c' },
  { label: 'Low Proficient', color: '#d69425' },
  { label: 'Nearly-Proficient', color: '#168b8b' },
  { label: 'Proficient', color: '#2f6fed' },
  { label: 'High-Proficient', color: '#56845a' },
];

export function normalizeProfileCategory(value) {
  const normalized = String(value ?? '').trim().toLowerCase().replace(/[^a-z]/g, '');
  return normalized === 'highlyproficient' ? 'highproficient' : normalized;
}

export function buildProfileGradeDistribution(records = [], categories = [], period = 'bosy', gradeLevels = []) {
  const categoryByKey = new Map(categories.map((category) => [normalizeProfileCategory(category.label), category.label]));
  const totals = Object.fromEntries(gradeLevels.map((grade) => [grade, 0]));
  const counts = Object.fromEntries(gradeLevels.map((grade) => [grade, Object.fromEntries(categories.map(({ label }) => [label, 0]))]));

  records.forEach((record) => {
    const grade = String(record?.gradeLevel ?? '').trim();
    const label = categoryByKey.get(normalizeProfileCategory(record?.[period]));
    if (!Object.prototype.hasOwnProperty.call(totals, grade) || !label) return;
    counts[grade][label] += 1;
    totals[grade] += 1;
  });

  return {
    totals,
    categories: categories.map(({ label, color }) => ({
      label,
      color,
      counts: Object.fromEntries(gradeLevels.map((grade) => [grade, counts[grade][label]])),
      percentages: Object.fromEntries(gradeLevels.map((grade) => [
        grade,
        totals[grade] ? counts[grade][label] / totals[grade] * 100 : 0,
      ])),
    })),
  };
}

export function buildProfileSummaryDistribution(records = [], categories = []) {
  const categoryByKey = new Map(categories.map((category) => [normalizeProfileCategory(category.label), category.label]));
  const totals = Object.fromEntries(PROFILE_PERIODS.map(({ key }) => [key, 0]));
  const counts = Object.fromEntries(PROFILE_PERIODS.map(({ key }) => [key, Object.fromEntries(categories.map(({ label }) => [label, 0]))]));

  records.forEach((record) => {
    PROFILE_PERIODS.forEach(({ key }) => {
      const label = categoryByKey.get(normalizeProfileCategory(record?.[key]));
      if (!label) return;
      counts[key][label] += 1;
      totals[key] += 1;
    });
  });

  return {
    totals,
    categories: categories.map(({ label, color }) => ({
      label,
      color,
      counts: Object.fromEntries(PROFILE_PERIODS.map(({ key }) => [key, counts[key][label]])),
      percentages: Object.fromEntries(PROFILE_PERIODS.map(({ key }) => [
        key,
        totals[key] ? counts[key][label] / totals[key] * 100 : 0,
      ])),
    })),
  };
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

function renderStackedBars(distribution, axisItems, title, axisTitle) {
  const width = Math.max(360, axisItems.length * 112 + 118);
  const left = 60;
  const top = 18;
  const barHeight = 240;
  const plotWidth = width - left - 18;
  const slot = plotWidth / axisItems.length;
  const barWidth = Math.min(58, slot * 0.62);
  const grid = [0, 25, 50, 75, 100].map((percent) => {
    const y = top + barHeight * (1 - percent / 100);
    return `<line x1="${left}" y1="${y}" x2="${width - 18}" y2="${y}" class="profile-chart-gridline"/><text x="${left - 8}" y="${y + 4}" text-anchor="end" class="profile-chart-axis-label">${percent}%</text>`;
  }).join('');
  const bars = axisItems.map(({ key, label }, index) => {
    const x = left + slot * index + (slot - barWidth) / 2;
    let y = top + barHeight;
    const segments = distribution.categories.map((category) => {
      const percent = distribution.totals[key] ? category.counts[key] / distribution.totals[key] * 100 : 0;
      if (!percent) return '';
      const height = barHeight * percent / 100;
      y -= height;
      const valueLabel = percent >= 13 ? `<text x="${x + barWidth / 2}" y="${y + height / 2 + 3}" text-anchor="middle" class="profile-chart-segment-label">${Math.round(percent)}%</text>` : '';
      return `<g><rect x="${x}" y="${y}" width="${barWidth}" height="${height}" fill="${category.color}"><title>${escapeHtml(label)} - ${escapeHtml(category.label)}: ${category.counts[key]} learners (${percent.toFixed(1)}%)</title></rect>${valueLabel}</g>`;
    }).join('');
    return `<g>${segments}<text x="${x + barWidth / 2}" y="${top + barHeight + 22}" text-anchor="middle" class="profile-chart-axis-label">${escapeHtml(label)}</text><text x="${x + barWidth / 2}" y="${top + barHeight + 39}" text-anchor="middle" class="profile-chart-value-label">${distribution.totals[key]}</text></g>`;
  }).join('');
  return `<svg class="profile-chart-svg" viewBox="0 0 ${width} 316" role="img" aria-label="${escapeHtml(title)} 100 percent stacked learner distribution by ${escapeHtml(axisTitle.toLowerCase())}">${grid}${bars}<text x="${left + plotWidth / 2}" y="310" text-anchor="middle" class="profile-chart-axis-title">${escapeHtml(axisTitle)}</text></svg>`;
}

function niceAxis(maxValue) {
  if (maxValue <= 0) return { maximum: 5, step: 1 };
  const roughStep = maxValue / 5;
  const magnitude = 10 ** Math.floor(Math.log10(roughStep));
  const fraction = roughStep / magnitude;
  const step = Math.max(1, (fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10) * magnitude);
  return { maximum: Math.ceil(maxValue / step) * step, step };
}

function renderTrendLines(distribution, axisItems, title, axisTitle) {
  const width = Math.max(420, axisItems.length * 112 + 120);
  const left = 62;
  const right = width - 24;
  const top = 22;
  const bottom = 276;
  const { maximum, step } = niceAxis(Math.max(...Object.values(distribution.totals).map(Number)));
  const yPosition = (value) => bottom - value / maximum * (bottom - top);
  const xPositions = axisItems.map((_, index) => left + (right - left) * (axisItems.length === 1 ? 0.5 : index / (axisItems.length - 1)));
  const grid = Array.from({ length: Math.floor(maximum / step) + 1 }, (_, index) => index * step).map((value) => {
    const y = yPosition(value);
    return `<line x1="${left}" y1="${y}" x2="${right}" y2="${y}" class="profile-chart-gridline"/><text x="${left - 9}" y="${y + 4}" text-anchor="end" class="profile-chart-axis-label">${value}</text>`;
  }).join('');
  const axisLabels = axisItems.map(({ label }, index) => `<text x="${xPositions[index]}" y="${bottom + 22}" text-anchor="middle" class="profile-chart-axis-label">${escapeHtml(label)}</text>`).join('');
  const series = distribution.categories.map((category, categoryIndex) => {
    const values = axisItems.map(({ key }) => category.counts[key]);
    const points = values.map((value, index) => ({ x: xPositions[index], y: yPosition(value), value, label: axisItems[index].label }));
    const path = points.length > 1 ? `<polyline points="${points.map(({ x, y }) => `${x},${y}`).join(' ')}" fill="none" stroke="${category.color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>` : '';
    const markers = points.map(({ x, y, value, label }) => {
      const labelOffset = categoryIndex % 2 === 0 ? -9 : 14;
      return `<g><circle cx="${x}" cy="${y}" r="4.5" fill="${category.color}"><title>${escapeHtml(category.label)} - ${escapeHtml(label)}: ${value} learners</title></circle><text x="${x}" y="${y + labelOffset}" text-anchor="middle" class="profile-chart-point-label" fill="${category.color}">${value}</text></g>`;
    }).join('');
    return `${path}${markers}`;
  }).join('');
  const legend = distribution.categories.map((category) => `<span class="profile-chart-legend-item"><i style="background:${category.color}"></i>${escapeHtml(category.label)}</span>`).join('');
  return `<svg class="profile-chart-svg" viewBox="0 0 ${width} 326" role="img" aria-label="${escapeHtml(title)} learner counts by ${escapeHtml(axisTitle.toLowerCase())}">${grid}${axisLabels}${series}<text x="18" y="${(top + bottom) / 2}" text-anchor="middle" class="profile-chart-axis-title" transform="rotate(-90 18 ${(top + bottom) / 2})">Number of Learners</text><text x="${(left + right) / 2}" y="318" text-anchor="middle" class="profile-chart-axis-title">${escapeHtml(axisTitle)}</text></svg><div class="profile-chart-legend">${legend}</div>`;
}

export function renderProfileDistributionCharts(targetId, records, indicator, categories, gradeLevels, period = 'bosy') {
  const target = document.getElementById(targetId);
  if (!target) return;
  const isSummary = period === 'summary';
  const periodLabel = PROFILE_PERIODS.find(({ key }) => key === period)?.label || 'Summary';
  const axisItems = isSummary
    ? PROFILE_PERIODS.map(({ key, label }) => ({ key, label }))
    : gradeLevels.map((grade) => ({ key: grade, label: grade }));
  const axisTitle = isSummary ? 'Assessment Period' : 'Grade Level';
  const distribution = isSummary
    ? buildProfileSummaryDistribution(records, categories)
    : buildProfileGradeDistribution(records, categories, period, gradeLevels);
  target.innerHTML = `<section class="profile-chart-group">
    <header class="profile-chart-heading"><div><h2>${escapeHtml(indicator)}</h2><p>${isSummary ? 'Summary across BOSY, MOSY, and EOSY' : `${escapeHtml(periodLabel)} assessment results by grade level`}</p></div></header>
    <div class="profile-visual-grid">
      <section class="profile-visual"><h3>100% stacked by ${isSummary ? 'period' : 'grade'}</h3>${renderStackedBars(distribution, axisItems, indicator, axisTitle)}</section>
      <section class="profile-visual"><h3>Learners by category</h3>${renderTrendLines(distribution, axisItems, indicator, axisTitle)}</section>
    </div>
  </section>`;
}