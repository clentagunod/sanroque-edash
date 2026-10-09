import { useMemo, useState, type CSSProperties, type FocusEvent, type PointerEvent } from 'react';

export const LEARNER_PROGRESS_PERIODS = [
  { key: 'BOSY', label: 'BOSY' },
  { key: 'MOSY', label: 'MOSY' },
  { key: 'EOSY', label: 'EOSY' },
] as const;

export interface LearnerProgressDatum {
  subject: string;
  grade: string;
  period: (typeof LEARNER_PROGRESS_PERIODS)[number]['key'];
  category: string;
  count: number;
}

export interface LearnerProgressCategory {
  label: string;
  color: string;
}

interface LearnerProgressChartProps {
  title: string;
  data: LearnerProgressDatum[];
  categories: LearnerProgressCategory[];
  gradeLevels: string[];
  tabGradeLevels?: string[];
}

interface ChartTooltip {
  x: number;
  y: number;
  title: string;
  details: string[];
  color: string;
}

const CHART_WIDTH = 520;
const CHART_HEIGHT = 360;
const PLOT = { left: 60, right: 18, top: 24, bottom: 286 };
const PERIOD_KEYS = LEARNER_PROGRESS_PERIODS.map(({ key }) => key);

function displayPercent(value: number) {
  return `${Number.isInteger(value) ? value : value.toFixed(1)}%`;
}

export default function LearnerProgressChart({
  title,
  data,
  categories,
  gradeLevels,
  tabGradeLevels = gradeLevels,
}: LearnerProgressChartProps) {
  const [selectedGrade, setSelectedGrade] = useState('all');
  const [tooltip, setTooltip] = useState<ChartTooltip | null>(null);
  const visibleGrades = useMemo(
    () => selectedGrade === 'all' ? gradeLevels : [selectedGrade],
    [gradeLevels, selectedGrade],
  );
  const distribution = useMemo(() => {
    const totals = Object.fromEntries(PERIOD_KEYS.map((period) => [period, 0])) as Record<string, number>;
    const counts = Object.fromEntries(PERIOD_KEYS.map((period) => [
      period,
      Object.fromEntries(categories.map(({ label }) => [label, 0])),
    ])) as Record<string, Record<string, number>>;

    data.forEach((item) => {
      if (!visibleGrades.includes(item.grade) || counts[item.period]?.[item.category] === undefined) return;
      counts[item.period][item.category] += item.count;
      totals[item.period] += item.count;
    });

    return {
      totals,
      categories: categories.map((category) => ({
        ...category,
        counts: PERIOD_KEYS.map((period) => counts[period][category.label]),
        gradeCounts: PERIOD_KEYS.map((period) => Object.fromEntries(
          gradeLevels.map((grade) => [grade, data
            .filter((item) => item.grade === grade && item.period === period && item.category === category.label)
            .reduce((sum, item) => sum + item.count, 0)]),
        )),
        percentages: PERIOD_KEYS.map((period) => totals[period]
          ? counts[period][category.label] / totals[period] * 100
          : 0),
      })),
    };
  }, [categories, data, gradeLevels, visibleGrades]);

  const xPositions = PERIOD_KEYS.map((_, index) => (
    PLOT.left + (CHART_WIDTH - PLOT.left - PLOT.right) * index / (PERIOD_KEYS.length - 1)
  ));
  const yPosition = (value: number) => PLOT.bottom - value / 100 * (PLOT.bottom - PLOT.top);
  const slotWidth = (CHART_WIDTH - PLOT.left - PLOT.right) / PERIOD_KEYS.length;
  const barWidth = Math.min(62, slotWidth * 0.55);
  const hasData = Object.values(distribution.totals).some((total) => total > 0);
  const gradeDescription = selectedGrade === 'all'
    ? `All grades (${gradeLevels.map((grade) => grade.replace('Grade ', '')).join(', ')})`
    : selectedGrade;
  const periodSummaries = LEARNER_PROGRESS_PERIODS.map(({ key, label }, index) => {
    const leadingCategory = distribution.categories.reduce<typeof distribution.categories[number] | null>(
      (leading, category) => category.counts[index] > (leading?.counts[index] ?? -1) ? category : leading,
      null,
    );
    return {
      label,
      total: distribution.totals[key],
      leadingCategory: leadingCategory && distribution.totals[key] > 0 ? leadingCategory : null,
    };
  });
  const comparableTrend = distribution.totals.BOSY > 0 && distribution.totals.EOSY > 0
    ? distribution.categories.map((category) => ({
      label: category.label,
      color: category.color,
      change: category.percentages[2] - category.percentages[0],
    }))
    : [];
  const largestIncrease = comparableTrend.reduce<typeof comparableTrend[number] | null>(
    (largest, item) => item.change > (largest?.change ?? 0) ? item : largest,
    null,
  );
  const largestDecrease = comparableTrend.reduce<typeof comparableTrend[number] | null>(
    (largest, item) => item.change < (largest?.change ?? 0) ? item : largest,
    null,
  );

  function showTooltip(
    event: PointerEvent<SVGElement> | FocusEvent<SVGElement>,
    details: Omit<ChartTooltip, 'x' | 'y'>,
  ) {
    const chart = event.currentTarget.closest('.learner-progress-chart');
    if (!chart) return;
    const chartRect = chart.getBoundingClientRect();
    const targetRect = event.currentTarget.getBoundingClientRect();
    const pointerEvent = event as PointerEvent<SVGElement>;
    const clientX = pointerEvent.clientX || targetRect.left + targetRect.width / 2;
    const clientY = pointerEvent.clientY || targetRect.top + targetRect.height / 2;
    const tooltipWidth = Math.min(260, chartRect.width - 16);
    const x = Math.max(8, Math.min(clientX - chartRect.left + 12, chartRect.width - tooltipWidth - 8));
    const y = Math.max(8, Math.min(clientY - chartRect.top + 12, chartRect.height - 110));
    setTooltip({ ...details, x, y });
  }

  function tooltipProps(
    titleText: string,
    category: { label: string; color: string; counts: number[]; percentages?: number[]; gradeCounts: Record<string, number>[] },
    periodIndex: number,
    period: string,
  ) {
    const gradeBreakdown = selectedGrade === 'all'
      ? gradeLevels.map((grade) => `${grade}: ${category.gradeCounts[periodIndex][grade]}`).join(' · ')
      : '';
    const percent = category.percentages?.[periodIndex]
      ?? (distribution.totals[period] ? category.counts[periodIndex] / distribution.totals[period] * 100 : 0);
    const details = [
      `Subject: ${data[0]?.subject || title}`,
      gradeDescription,
      `Period: ${period}`,
      `Assessment total: ${distribution.totals[period]} learners`,
      `Category count: ${category.counts[periodIndex]} learners`,
      `Share: ${displayPercent(percent)}`,
      ...(gradeBreakdown ? [`By grade: ${gradeBreakdown}`] : []),
    ];
    const show = (event: PointerEvent<SVGElement> | FocusEvent<SVGElement>) => showTooltip(event, {
      title: titleText,
      details,
      color: category.color,
    });
    return {
      onPointerEnter: show,
      onPointerMove: show,
      onPointerLeave: () => setTooltip(null),
      onFocus: show,
      onBlur: () => setTooltip(null),
    };
  }

  return (
    <section className="learner-progress-chart" aria-label={`${title} progress chart`}>
      <header className="learner-progress-heading">
        <h2>{title}</h2>
        <p>Learner distribution across BOSY, MOSY, and EOSY</p>
      </header>
      <div className="learner-progress-tabs" role="tablist" aria-label={`${title} grade level`}>
        {tabGradeLevels.map((grade) => (
          <button
            key={grade}
            type="button"
            role="tab"
            aria-selected={selectedGrade === grade}
            className={selectedGrade === grade ? 'is-active' : ''}
            onClick={() => setSelectedGrade(grade)}
          >
            {grade}
          </button>
        ))}
        <button
          type="button"
          role="tab"
          aria-selected={selectedGrade === 'all'}
          className={selectedGrade === 'all' ? 'is-active' : ''}
          onClick={() => setSelectedGrade('all')}
        >
          All grades
        </button>
      </div>
      {!hasData && <p className="learner-progress-empty" role="status">No assessment results are available for this grade selection.</p>}
      <div className="learner-progress-visuals">
        <section className="learner-progress-visual">
          <h3>100% stacked by assessment period</h3>
          <svg
            className="profile-chart-svg"
            viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
            role="img"
            aria-label={`${title} 100 percent stacked learner distribution by assessment period`}
          >
            {[0, 25, 50, 75, 100].map((percent) => {
              const y = yPosition(percent);
              return (
                <g key={percent}>
                  <line x1={PLOT.left} y1={y} x2={CHART_WIDTH - PLOT.right} y2={y} className="profile-chart-gridline" />
                  <text x={PLOT.left - 9} y={y + 4} textAnchor="end" className="profile-chart-axis-label">{percent}%</text>
                </g>
              );
            })}
            {LEARNER_PROGRESS_PERIODS.map(({ key, label }, periodIndex) => {
              const x = PLOT.left + slotWidth * periodIndex + (slotWidth - barWidth) / 2;
              let y = PLOT.bottom;
              const segments = distribution.categories.map((category) => {
                const percent = distribution.totals[key]
                  ? category.counts[periodIndex] / distribution.totals[key] * 100
                  : 0;
                const height = (PLOT.bottom - PLOT.top) * percent / 100;
                y -= height;
                return height > 0 ? (
                  <rect
                    key={category.label}
                    x={x}
                    y={y}
                    width={barWidth}
                    height={height}
                    fill={category.color}
                    tabIndex={0}
                    aria-label={`${label}, ${category.label}, ${gradeDescription}: ${category.counts[periodIndex]} learners, ${displayPercent(percent)}`}
                    {...tooltipProps(`${label} · ${category.label}`, {
                      ...category,
                      gradeCounts: category.gradeCounts,
                    }, periodIndex, key)}
                  >
                    <title>{`${label} - ${category.label}: ${category.counts[periodIndex]} learners (${displayPercent(percent)})`}</title>
                  </rect>
                ) : null;
              });
              return (
                <g key={key}>
                  {segments}
                  <text x={x + barWidth / 2} y={PLOT.bottom + 22} textAnchor="middle" className="profile-chart-axis-label">{label}</text>
                  <text x={x + barWidth / 2} y={PLOT.bottom + 39} textAnchor="middle" className="profile-chart-value-label">{distribution.totals[key]}</text>
                </g>
              );
            })}
            <text
              x={PLOT.left + (CHART_WIDTH - PLOT.left - PLOT.right) / 2}
              y="352"
              textAnchor="middle"
              className="profile-chart-axis-title"
            >
              Assessment Period
            </text>
          </svg>
        </section>
        <section className="learner-progress-visual">
          <h3>Category progress (%)</h3>
          <svg
            className="profile-chart-svg"
            viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
            role="img"
            aria-label={`${title} learner category percentages by assessment period`}
          >
            {[0, 25, 50, 75, 100].map((percent) => {
              const y = yPosition(percent);
              return (
                <g key={percent}>
                  <line x1={PLOT.left} y1={y} x2={CHART_WIDTH - PLOT.right} y2={y} className="profile-chart-gridline" />
                  <text x={PLOT.left - 9} y={y + 4} textAnchor="end" className="profile-chart-axis-label">{percent}%</text>
                </g>
              );
            })}
            {LEARNER_PROGRESS_PERIODS.map(({ label }, index) => (
              <text key={label} x={xPositions[index]} y={PLOT.bottom + 22} textAnchor="middle" className="profile-chart-axis-label">{label}</text>
            ))}
            {distribution.categories.map((category, categoryIndex) => {
              const points = category.percentages.map((value, index) => ({
                x: xPositions[index],
                y: yPosition(value),
                value,
                count: category.counts[index],
                period: LEARNER_PROGRESS_PERIODS[index].label,
              }));
              return (
                <g key={category.label}>
                  <polyline
                    points={points.map(({ x, y }) => `${x},${y}`).join(' ')}
                    fill="none"
                    stroke={category.color}
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  {points.map(({ x, y, value, count, period }, index) => {
                    const offset = categoryIndex % 2 === 0 ? -9 : 14;
                    return (
                      <g key={period}>
                        <circle
                          cx={x}
                          cy={y}
                          r="5"
                          fill={category.color}
                          tabIndex={0}
                          aria-label={`${period}, ${category.label}, ${gradeDescription}: ${count} learners, ${displayPercent(value)}`}
                          {...tooltipProps(`${period} · ${category.label}`, category, index, LEARNER_PROGRESS_PERIODS[index].key)}
                        >
                          <title>{`${category.label} - ${period}: ${displayPercent(value)} (${count} learners)`}</title>
                        </circle>
                        <text
                          x={x}
                          y={y + offset}
                          textAnchor="middle"
                          className="profile-chart-point-label"
                          fill={category.color}
                        >
                          {displayPercent(value)}
                        </text>
                      </g>
                    );
                  })}
                </g>
              );
            })}
            <text
              x="18"
              y={(PLOT.top + PLOT.bottom) / 2}
              textAnchor="middle"
              className="profile-chart-axis-title"
              transform={`rotate(-90 18 ${(PLOT.top + PLOT.bottom) / 2})`}
            >
              % of Learners
            </text>
            <text
              x={PLOT.left + (CHART_WIDTH - PLOT.left - PLOT.right) / 2}
              y="352"
              textAnchor="middle"
              className="profile-chart-axis-title"
            >
              Assessment Period
            </text>
          </svg>
          <div className="profile-chart-legend">
            {categories.map(({ label, color }) => (
              <span className="profile-chart-legend-item" key={label}>
                <i style={{ background: color }} />
                {label}
              </span>
            ))}
          </div>
        </section>
      </div>
      <section className="learner-progress-summary" aria-label={`${title} graph summary`}>
        <header>
          <h3>Summary</h3>
          <p>{gradeDescription} · Based on the graph above</p>
        </header>
        <div className="learner-progress-summary-periods">
          {periodSummaries.map(({ label, total, leadingCategory }) => (
            <article className="learner-progress-summary-card" key={label}>
              <span className="learner-progress-summary-period">{label}</span>
              <strong>{total.toLocaleString()}</strong>
              <span className="learner-progress-summary-caption">learners assessed</span>
              {leadingCategory ? (
                <span className="learner-progress-summary-leader">
                  Leading: {leadingCategory.label} ({displayPercent(leadingCategory.percentages[PERIOD_KEYS.indexOf(label as (typeof PERIOD_KEYS)[number])])})
                </span>
              ) : (
                <span className="learner-progress-summary-leader">No assessment data</span>
              )}
            </article>
          ))}
        </div>
        <div className="learner-progress-summary-insights" aria-live="polite">
          {largestIncrease && largestIncrease.change > 0 && (
            <p>
              <span style={{ background: largestIncrease.color }} />
              <strong>{largestIncrease.label}</strong> had the largest increase from BOSY to EOSY
              ({largestIncrease.change > 0 ? '+' : ''}{largestIncrease.change.toFixed(1)} percentage points).
            </p>
          )}
          {largestDecrease && largestDecrease.change < 0 && (
            <p>
              <span style={{ background: largestDecrease.color }} />
              <strong>{largestDecrease.label}</strong> had the largest decrease from BOSY to EOSY
              ({largestDecrease.change.toFixed(1)} percentage points).
            </p>
          )}
          {comparableTrend.length === 0 && (
            <p>Trend comparison will be available when both BOSY and EOSY have assessment data.</p>
          )}
        </div>
      </section>
      {tooltip && (
        <div
          className="learner-progress-tooltip"
          role="tooltip"
          style={{ left: tooltip.x, top: tooltip.y, '--tooltip-accent': tooltip.color } as CSSProperties}
        >
          <strong>{tooltip.title}</strong>
          {tooltip.details.map((detail) => <span key={detail}>{detail}</span>)}
        </div>
      )}
    </section>
  );
}