import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import LearnerProgressChart, { type LearnerProgressCategory, type LearnerProgressDatum } from '../components/LearnerProgressChart';

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
  { label: 'Non reader', color: '#64748b' },
];

export const RMA_CATEGORIES = [
  { label: 'Not Proficient', color: '#d65f4c' },
  { label: 'Low Proficient', color: '#d69425' },
  { label: 'Nearly-Proficient', color: '#168b8b' },
  { label: 'Proficient', color: '#2f6fed' },
  { label: 'High-Proficient', color: '#56845a' },
];

export function normalizeProfileCategory(value: unknown) {
  const normalized = String(value ?? '').trim().toLowerCase().replace(/[^a-z]/g, '');
  return normalized === 'highlyproficient' ? 'highproficient' : normalized;
}

export function initProfileSectionTabs(prefix: 'reading' | 'math') {
  const tabs = [
    document.getElementById(`${prefix}GraphsTab`),
    document.getElementById(`${prefix}LearnersTab`),
  ];
  const panels = [
    document.getElementById(`${prefix}GraphsPanel`),
    document.getElementById(`${prefix}LearnersPanel`),
  ];
  if (tabs.some((tab) => !tab) || panels.some((panel) => !panel)) return;

  const activate = (index: number, moveFocus = false) => {
    tabs.forEach((tab, tabIndex) => {
      const isActive = tabIndex === index;
      tab.setAttribute('aria-selected', String(isActive));
      tab.tabIndex = isActive ? 0 : -1;
      panels[tabIndex].hidden = !isActive;
    });
    if (moveFocus) tabs[index].focus();
  };

  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => activate(index));
    tab.addEventListener('keydown', (event: KeyboardEvent) => {
      let nextIndex: number | undefined;
      if (event.key === 'ArrowRight') nextIndex = (index + 1) % tabs.length;
      if (event.key === 'ArrowLeft') nextIndex = (index + tabs.length - 1) % tabs.length;
      if (event.key === 'Home') nextIndex = 0;
      if (event.key === 'End') nextIndex = tabs.length - 1;
      if (nextIndex === undefined) return;
      event.preventDefault();
      activate(nextIndex, true);
    });
  });
}

export function buildProfileProgressData(
  records: Array<Record<string, unknown>> = [],
  categories: LearnerProgressCategory[] = [],
  gradeLevels: string[] = [],
  subject = '',
): LearnerProgressDatum[] {
  const categoryByKey = new Map(categories.map(({ label }) => [normalizeProfileCategory(label), label]));
  const counts = new Map<string, number>();

  records.forEach((record) => {
    const grade = String(record?.gradeLevel ?? '').trim();
    if (!gradeLevels.includes(grade)) return;
    PROFILE_PERIODS.forEach(({ key, label }) => {
      const category = categoryByKey.get(normalizeProfileCategory(record?.[key]));
      if (!category) return;
      const countKey = `${grade}\u0000${label}\u0000${category}`;
      counts.set(countKey, (counts.get(countKey) ?? 0) + 1);
    });
  });

  return gradeLevels.flatMap((grade) => PROFILE_PERIODS.flatMap(({ label: period }) => (
    categories.map(({ label: category }) => ({
      subject,
      grade,
      period: period as LearnerProgressDatum['period'],
      category,
      count: counts.get(`${grade}\u0000${period}\u0000${category}`) ?? 0,
    }))
  )));
}

const chartRoots = new WeakMap<HTMLElement, Root>();

export function renderProfileDistributionCharts(
  targetId: string,
  records: Array<Record<string, unknown>>,
  indicator: string,
  categories: LearnerProgressCategory[],
  gradeLevels: string[],
  tabGradeLevels = gradeLevels,
  subject = indicator,
) {
  const target = document.getElementById(targetId);
  if (!target) return;
  let root = chartRoots.get(target);
  if (!root) {
    root = createRoot(target);
    chartRoots.set(target, root);
  }
  root.render(createElement(LearnerProgressChart, {
    title: indicator,
    data: buildProfileProgressData(records, categories, gradeLevels, subject),
    categories,
    gradeLevels,
    tabGradeLevels,
  }));
}