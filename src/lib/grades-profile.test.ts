import { describe, expect, it, vi } from 'vitest';

vi.mock('./enrollment-data', () => ({ enrollmentGradeLabel: (grade: string) => grade }));
vi.mock('./sheets-api', () => ({ LPSApi: {} }));
vi.mock('./auth', () => ({ requireAuth: vi.fn() }));
vi.mock('./school-year', () => ({ getSelectedSchoolYear: vi.fn(), initYearSwitcher: vi.fn() }));
vi.mock('./shell', () => ({
  escapeHtml: (value: unknown) => String(value ?? ''),
  renderShell: vi.fn(),
  showToast: vi.fn(),
  startExportIndicator: vi.fn(),
}));
vi.mock('./app-config', () => ({ paginationPageNumbers: vi.fn(() => []) }));

import {
  createGradeProfileFromLearner,
  gradeSubjectsForFilter,
} from './grades-profile';

describe('grade profile curricula', () => {
  it('shows only the selected grade subject assignment', () => {
    const assignments = {
      'Grade 4': { configured: true, subjectIds: ['math', 'eppTle'] },
      'Grade 5': { configured: true, subjectIds: ['science'] },
    };

    expect(gradeSubjectsForFilter('Grade 4', assignments, true).map(({ id }) => id))
      .toEqual(['math', 'eppTle']);
  });

  it('shows the unique union of assigned subjects for all grades', () => {
    const assignments = {
      'Grade 4': { configured: true, subjectIds: ['math', 'eppTle'] },
      'Grade 5': { configured: true, subjectIds: ['science', 'math'] },
    };

    expect(gradeSubjectsForFilter('', assignments, true).map(({ id }) => id))
      .toEqual(['math', 'science', 'eppTle']);
  });

  it('fails closed for unconfigured grades and averages only assigned subjects', () => {
    expect(gradeSubjectsForFilter('Grade 6', {}, true)).toEqual([]);
    const profile = createGradeProfileFromLearner({
      learnerId: '123456789012',
      gradeLevel: 'Grade 4',
      math: '90',
      science: '70',
    }, ['math']);

    expect(profile.math).toBe('90');
    expect(profile.science).toBe('70');
    expect(profile.average).toBe(90);
  });
});
