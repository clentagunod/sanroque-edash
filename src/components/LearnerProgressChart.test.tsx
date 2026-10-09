import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import LearnerProgressChart, { type LearnerProgressDatum } from './LearnerProgressChart';

const mountedRoots: ReturnType<typeof createRoot>[] = [];
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

afterEach(() => {
  act(() => mountedRoots.splice(0).forEach((root) => root.unmount()));
  document.body.innerHTML = '';
});

describe('LearnerProgressChart', () => {
  it('renders period percentage lines and preserves the stacked distribution chart', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoots.push(root);
    const data: LearnerProgressDatum[] = [
      { subject: 'Reading', grade: 'Grade 1', period: 'BOSY', category: 'Grade Ready', count: 2 },
      { subject: 'Reading', grade: 'Grade 1', period: 'BOSY', category: 'Transitioning', count: 2 },
      { subject: 'Reading', grade: 'Grade 1', period: 'MOSY', category: 'Grade Ready', count: 3 },
      { subject: 'Reading', grade: 'Grade 1', period: 'MOSY', category: 'Transitioning', count: 1 },
      { subject: 'Reading', grade: 'Grade 2', period: 'BOSY', category: 'Grade Ready', count: 1 },
    ];

    await act(async () => {
      root.render(createElement(LearnerProgressChart, {
        title: 'CRLA',
        data,
        categories: [
          { label: 'Grade Ready', color: '#2f6fed' },
          { label: 'Transitioning', color: '#168b8b' },
        ],
        gradeLevels: ['Grade 1', 'Grade 2', 'Grade 3'],
      }));
    });

    expect(container.querySelectorAll('.profile-chart-svg')).toHaveLength(2);
    expect(container.querySelectorAll('.learner-progress-visuals polyline')).toHaveLength(2);
    expect(container.textContent).toContain('100% stacked by assessment period');
    expect(container.textContent).toContain('Category progress (%)');
    expect(container.querySelector('.learner-progress-summary h3')?.textContent).toBe('Summary');
    expect(container.querySelector('.learner-progress-summary')?.textContent).toContain('BOSY');
    expect(container.querySelector('.learner-progress-summary')?.textContent).toContain('5learners assessed');
    expect(container.querySelector('.learner-progress-summary')?.textContent).toContain('Grade Ready (60%)');
    expect(container.textContent).toContain('% of Learners');
    expect(container.textContent).toContain('All grades');
    expect(container.querySelector('[aria-label="CRLA learner category percentages by assessment period"]')).not.toBeNull();
    expect(container.querySelector('circle title')?.textContent).toContain('60%');

    const point = container.querySelector('circle[aria-label]');
    await act(async () => {
      point?.dispatchEvent(new MouseEvent('pointerover', {
        bubbles: true,
        clientX: 100,
        clientY: 120,
      }));
    });
    expect(container.querySelector('.learner-progress-tooltip')?.textContent).toContain('Subject: Reading');
    expect(container.querySelector('.learner-progress-tooltip')?.textContent).toContain('Period: BOSY');
    expect(container.querySelector('.learner-progress-tooltip')?.textContent).toContain('Assessment total: 5 learners');
    expect(container.querySelector('.learner-progress-tooltip')?.textContent).toContain('Share: 60%');

    const gradeOneTab = [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
      .find((tab) => tab.textContent === 'Grade 1');
    await act(async () => gradeOneTab?.click());
    expect(gradeOneTab?.getAttribute('aria-selected')).toBe('true');
    expect(container.querySelector('circle title')?.textContent).toContain('50%');
  });
});