import { describe, expect, it } from 'vitest';
import { buildProfileGradeDistribution, buildProfileSummaryDistribution, CRLA_CATEGORIES, PHIL_IRI_CATEGORIES, renderProfileDistributionCharts, RMA_CATEGORIES } from './profile-charts';

describe('profile chart distributions', () => {
  it('calculates selected-period category counts and shares by grade', () => {
    const grades = ['Grade 1', 'Grade 2', 'Grade 3'];
    const distribution = buildProfileGradeDistribution([
      { gradeLevel: 'Grade 1', bosy: 'Grade Ready', mosy: 'Transitioning' },
      { gradeLevel: 'Grade 1', bosy: 'Transitioning', mosy: 'Transitioning' },
      { gradeLevel: 'Grade 2', bosy: 'Developing', mosy: 'Unknown' },
      { gradeLevel: 'Grade 3', bosy: '', mosy: 'High Emerging' },
    ], CRLA_CATEGORIES, 'bosy', grades);

    expect(distribution.totals).toEqual({ 'Grade 1': 2, 'Grade 2': 1, 'Grade 3': 0 });
    expect(distribution.categories[0].counts).toEqual({ 'Grade 1': 1, 'Grade 2': 0, 'Grade 3': 0 });
    expect(distribution.categories[0].percentages).toEqual({ 'Grade 1': 50, 'Grade 2': 0, 'Grade 3': 0 });
    expect(distribution.categories[2].counts['Grade 2']).toBe(1);
  });

  it('counts the legacy Highly-Proficient spelling in the requested High-Proficient band', () => {
    const distribution = buildProfileGradeDistribution([
      { gradeLevel: 'Grade 1', bosy: 'Highly-Proficient' },
      { gradeLevel: 'Grade 1', bosy: 'High-Proficient' },
    ], RMA_CATEGORIES, 'bosy', ['Grade 1']);
    const highProficient = distribution.categories.find(({ label }) => label === 'High-Proficient');

    expect(highProficient?.counts['Grade 1']).toBe(2);
    expect(highProficient?.percentages['Grade 1']).toBe(100);
  });

  it('aggregates summary counts across all grades for each assessment period', () => {
    const distribution = buildProfileSummaryDistribution([
      { gradeLevel: 'Grade 1', bosy: 'Grade Ready', mosy: 'Transitioning', eosy: 'Developing' },
      { gradeLevel: 'Grade 2', bosy: 'Grade Ready', mosy: '', eosy: 'Developing' },
      { gradeLevel: 'Grade 3', bosy: '', mosy: 'High Emerging', eosy: '' },
    ], CRLA_CATEGORIES);

    expect(distribution.totals).toEqual({ bosy: 2, mosy: 2, eosy: 2 });
    expect(distribution.categories[0].counts).toEqual({ bosy: 2, mosy: 0, eosy: 0 });
    expect(distribution.categories[1].counts).toEqual({ bosy: 0, mosy: 1, eosy: 0 });
    expect(distribution.categories[2].counts).toEqual({ bosy: 0, mosy: 0, eosy: 2 });
  });

  it('counts Phil-IRI Non reader records across all assessment periods', () => {
    const distribution = buildProfileSummaryDistribution([
      { gradeLevel: 'Grade 4', bosy: 'Non reader', mosy: 'Independent', eosy: 'Non reader' },
      { gradeLevel: 'Grade 5', bosy: 'Instructional', mosy: 'Non reader', eosy: 'Frustration' },
    ], PHIL_IRI_CATEGORIES);
    const nonReader = distribution.categories.find(({ label }) => label === 'Non reader');

    expect(nonReader?.counts).toEqual({ bosy: 1, mosy: 1, eosy: 1 });
  });

  it('renders stacked bars and count trend lines by grade', () => {
    document.body.innerHTML = '<div id="profile-charts"></div>';
    renderProfileDistributionCharts('profile-charts', [
      { gradeLevel: 'Grade 1', bosy: 'Grade Ready' },
      { gradeLevel: 'Grade 2', bosy: 'Transitioning' },
      { gradeLevel: 'Grade 3', bosy: 'Developing' },
    ], 'CRLA', CRLA_CATEGORIES, ['Grade 1', 'Grade 2', 'Grade 3'], 'bosy');

    const chart = document.getElementById('profile-charts');
    expect(chart?.querySelectorAll('.profile-chart-svg')).toHaveLength(2);
    expect(chart?.querySelector('.profile-chart-svg')?.getAttribute('aria-label')).toContain('100 percent stacked');
    expect(chart?.querySelectorAll('polyline')).toHaveLength(CRLA_CATEGORIES.length);
    expect(chart?.textContent).toContain('Grade Ready');
    expect(chart?.textContent).toContain('100% stacked by grade');
    expect(chart?.textContent).toContain('Number of Learners');
  });

  it('renders Summary with assessment periods on the X axis', () => {
    document.body.innerHTML = '<div id="profile-summary"></div>';
    renderProfileDistributionCharts('profile-summary', [
      { gradeLevel: 'Grade 1', bosy: 'Grade Ready', mosy: 'Transitioning', eosy: 'Developing' },
      { gradeLevel: 'Grade 2', bosy: 'Transitioning', mosy: 'Grade Ready', eosy: 'Developing' },
    ], 'CRLA', CRLA_CATEGORIES, ['Grade 1', 'Grade 2', 'Grade 3'], 'summary');

    const chart = document.getElementById('profile-summary');
    const lineChart = chart?.querySelectorAll('.profile-chart-svg')[1];
    expect(chart?.textContent).toContain('Summary across BOSY, MOSY, and EOSY');
    expect(lineChart?.getAttribute('aria-label')).toContain('assessment period');
    expect(lineChart?.textContent).toContain('BOSY');
    expect(lineChart?.textContent).toContain('MOSY');
    expect(lineChart?.textContent).toContain('EOSY');
    expect(lineChart?.querySelectorAll('polyline')).toHaveLength(CRLA_CATEGORIES.length);
  });
});