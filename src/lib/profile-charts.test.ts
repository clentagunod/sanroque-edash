import { describe, expect, it } from 'vitest';
import { buildProfileProgressData, CRLA_CATEGORIES, initProfileSectionTabs, PHIL_IRI_CATEGORIES, RMA_CATEGORIES } from './profile-charts';

describe('profile chart distributions', () => {
  it('switches between profile graph and learner sections with keyboard support', () => {
    document.body.innerHTML = `
      <button id="readingGraphsTab" aria-selected="true" tabindex="0"></button>
      <button id="readingLearnersTab" aria-selected="false" tabindex="-1"></button>
      <section id="readingGraphsPanel"></section>
      <section id="readingLearnersPanel" hidden></section>`;
    initProfileSectionTabs('reading');

    const graphsTab = document.getElementById('readingGraphsTab') as HTMLButtonElement;
    const learnersTab = document.getElementById('readingLearnersTab') as HTMLButtonElement;
    const graphsPanel = document.getElementById('readingGraphsPanel') as HTMLElement;
    const learnersPanel = document.getElementById('readingLearnersPanel') as HTMLElement;

    learnersTab.click();
    expect(learnersTab.getAttribute('aria-selected')).toBe('true');
    expect(learnersTab.tabIndex).toBe(0);
    expect(learnersPanel.hidden).toBe(false);
    expect(graphsPanel.hidden).toBe(true);

    learnersTab.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    expect(graphsTab.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(graphsTab);
    expect(graphsPanel.hidden).toBe(false);
    expect(learnersPanel.hidden).toBe(true);
  });

  it('aggregates one category count per grade and assessment period', () => {
    const data = buildProfileProgressData([
      { gradeLevel: 'Grade 1', bosy: 'Grade Ready', mosy: 'Transitioning', eosy: 'Developing' },
      { gradeLevel: 'Grade 1', bosy: 'Grade Ready', mosy: 'Transitioning', eosy: '' },
      { gradeLevel: 'Grade 2', bosy: 'Transitioning', mosy: 'Grade Ready', eosy: 'Developing' },
      { gradeLevel: 'Grade 4', bosy: 'Grade Ready', mosy: 'Grade Ready', eosy: 'Grade Ready' },
    ], CRLA_CATEGORIES, ['Grade 1', 'Grade 2', 'Grade 3'], 'Reading');

    expect(data).toContainEqual({
      subject: 'Reading', grade: 'Grade 1', period: 'BOSY', category: 'Grade Ready', count: 2,
    });
    expect(data).toContainEqual({
      subject: 'Reading', grade: 'Grade 1', period: 'MOSY', category: 'Transitioning', count: 2,
    });
    expect(data).toContainEqual({
      subject: 'Reading', grade: 'Grade 2', period: 'EOSY', category: 'Developing', count: 1,
    });
    expect(data.find(({ grade, period, category }) => grade === 'Grade 1' && period === 'EOSY' && category === 'Developing')?.count).toBe(1);
    expect(data).toHaveLength(3 * 3 * CRLA_CATEGORIES.length);
    expect(data.some(({ grade }) => grade === 'Grade 4')).toBe(false);
  });

  it('uses RMA categories for math data and normalizes legacy values', () => {
    const data = buildProfileProgressData([
      { gradeLevel: 'Grade 1', bosy: 'Highly-Proficient' },
      { gradeLevel: 'Grade 6', bosy: 'High-Proficient' },
    ], RMA_CATEGORIES, ['Grade 1', 'Grade 2', 'Grade 3', 'Grade 4', 'Grade 5', 'Grade 6'], 'Math');
    const highProficient = data.filter(({ period, category }) => period === 'BOSY' && category === 'High-Proficient');

    expect(highProficient.find(({ grade }) => grade === 'Grade 1')?.count).toBe(1);
    expect(highProficient.find(({ grade }) => grade === 'Grade 6')?.count).toBe(1);
    expect(data).toHaveLength(6 * 3 * RMA_CATEGORIES.length);
  });

  it('keeps Phil-IRI on its own category set', () => {
    const data = buildProfileProgressData([
      { gradeLevel: 'Grade 4', bosy: 'Non reader', mosy: 'Independent', eosy: 'Non reader' },
      { gradeLevel: 'Grade 5', bosy: 'Instructional', mosy: 'Non reader', eosy: 'Frustration' },
    ], PHIL_IRI_CATEGORIES, ['Grade 4', 'Grade 5', 'Grade 6'], 'Reading');
    const nonReader = data.filter(({ category }) => category === 'Non reader');

    expect(nonReader.find(({ grade, period }) => grade === 'Grade 4' && period === 'BOSY')?.count).toBe(1);
    expect(nonReader.find(({ grade, period }) => grade === 'Grade 5' && period === 'MOSY')?.count).toBe(1);
    expect(nonReader).toHaveLength(3 * 3);
  });
});