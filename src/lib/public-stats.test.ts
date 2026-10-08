import { describe, expect, it } from 'vitest';
import { buildPublicStatsDelta, isPublicActiveLearner, publicStatsPayload } from './public-stats';

function initialStats() {
  return {
    totalLearners: 2,
    maleCount: 1,
    femaleCount: 1,
    taggedCount: 1,
    notTaggedCount: 1,
    programsTracked: 1,
    fourPsCount: 1,
    ipCount: 0,
    snedCount: 0,
    aralCount: 0,
    muslimCount: 0,
    gradeLevels: [{ label: 'Grade 1', value: 2 }],
    enrollmentData: {
      rows: [{ gradeLevel: 'Grade 1', section: 'A', adviser: 'Teacher', male: 1, female: 1, total: 2 }],
      gradeTotals: [{ gradeLevel: 'Grade 1', male: 1, female: 1, total: 2 }],
      grandTotal: { male: 1, female: 1, total: 2 },
    },
  };
}

const normalizeGrade = (grade: string) => grade.trim();

describe('public stats payload', () => {
  it('only includes aggregate fields and omits learner-identifying data', () => {
    const payload = publicStatsPayload({
      totalLearners: 8,
      schoolYear: '2026-2027',
      recentLearners: [{ learnerId: '123456789012', firstName: 'Private' }],
      guardian: 'Private',
    });

    expect(payload).toEqual({ totalLearners: 8, schoolYear: '2026-2027' });
    expect(payload).not.toHaveProperty('recentLearners');
    expect(payload).not.toHaveProperty('guardian');
  });

  it('serializes the aggregate update timestamp for HTTP clients', () => {
    const timestamp = { toDate: () => new Date('2026-10-08T00:00:00.000Z') };
    expect(publicStatsPayload({ updatedAt: timestamp })).toEqual({
      updatedAt: '2026-10-08T00:00:00.000Z',
    });
  });

  it('returns null for an uninitialized aggregate', () => {
    expect(publicStatsPayload(null)).toBeNull();
  });

  it('applies a learner addition without rescanning the roster', () => {
    const update = buildPublicStatsDelta(initialStats(), [{
      before: null,
      after: { gradeLevel: 'Grade 1', section: 'A', gender: 'Male', is4Ps: true, isIP: true },
    }], normalizeGrade);

    expect(update).toMatchObject({
      totalLearners: 3,
      maleCount: 2,
      taggedCount: 2,
      notTaggedCount: 1,
      fourPsCount: 2,
      ipCount: 1,
      programsTracked: 2,
      gradeLevels: [{ label: 'Grade 1', value: 3 }],
    });
    expect(update.enrollmentData.grandTotal).toEqual({ male: 2, female: 1, total: 3 });
  });

  it('moves an edited learner between grades and sections and updates tag counts', () => {
    const update = buildPublicStatsDelta(initialStats(), [{
      before: { gradeLevel: 'Grade 1', section: 'A', gender: 'Female', is4Ps: true },
      after: { gradeLevel: 'Grade 2', section: 'B', gender: 'Male' },
    }], normalizeGrade);

    expect(update).toMatchObject({
      totalLearners: 2,
      maleCount: 2,
      femaleCount: 0,
      taggedCount: 0,
      notTaggedCount: 2,
      fourPsCount: 0,
      programsTracked: 0,
      gradeLevels: [{ label: 'Grade 1', value: 1 }, { label: 'Grade 2', value: 1 }],
    });
    expect(update.enrollmentData.rows).toEqual([
      { gradeLevel: 'Grade 1', section: 'A', adviser: 'Teacher', male: 1, female: 0, total: 1 },
    ]);
  });

  it('does not treat a missing or inactive learner as enrolled', () => {
    expect(isPublicActiveLearner(null)).toBe(false);
    expect(isPublicActiveLearner({ enrollmentStatus: 'DROPPED_OUT' })).toBe(false);
    const update = buildPublicStatsDelta(initialStats(), [{ before: null, after: null }], normalizeGrade);

    expect(update.totalLearners).toBe(2);
    expect(update.taggedCount).toBe(1);
  });

  it('keeps learners without a grade in the same fallback bucket as a full rebuild', () => {
    const update = buildPublicStatsDelta(initialStats(), [{
      before: null,
      after: { gender: 'Male' },
    }], normalizeGrade);

    expect(update.gradeLevels).toContainEqual({ label: '—', value: 1 });
  });
});
