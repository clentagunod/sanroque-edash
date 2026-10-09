import { describe, expect, it } from 'vitest';
import {
  CURRICULUM_GRADE_LEVELS,
  CURRICULUM_SUBJECTS,
  LEGACY_CURRICULUM_SUBJECT_IDS,
  curriculumSubjectIdsForGrade,
  normalizeCurriculumGrade,
  normalizeCurriculumSubjectIds,
} from './curriculum-subjects';

describe('curriculum subject catalog', () => {
  it('provides a unique shared subject pool and supported elementary grades', () => {
    const subjectIds = CURRICULUM_SUBJECTS.map(({ id }) => id);

    expect(new Set(subjectIds).size).toBe(subjectIds.length);
    expect(CURRICULUM_GRADE_LEVELS).toEqual([
      'Kinder', 'Grade 1', 'Grade 2', 'Grade 3', 'Grade 4', 'Grade 5', 'Grade 6',
    ]);
    expect(LEGACY_CURRICULUM_SUBJECT_IDS.every((id) => subjectIds.includes(id))).toBe(true);
    expect(CURRICULUM_SUBJECTS.map(({ label }) => label)).toEqual(expect.arrayContaining([
      'Literacy, Language, and Communication',
      'GMRC',
      'Reading and Literacy',
      'EPP/TLE',
      'Values Education',
      'MAPEH',
    ]));
  });

  it('normalizes grade aliases and only retains unique known subject IDs', () => {
    expect(normalizeCurriculumGrade(' Kindergarten ')).toBe('Kinder');
    expect(normalizeCurriculumGrade('grade 4')).toBe('Grade 4');
    expect(normalizeCurriculumSubjectIds(['math', 'math', 'unknown'])).toEqual(['math']);
    expect(normalizeCurriculumSubjectIds('math')).toEqual([]);
  });

  it('fails closed for unconfigured grades and preserves the non-Firestore legacy fields', () => {
    expect(curriculumSubjectIdsForGrade({}, 'Grade 1')).toEqual([]);
    expect(curriculumSubjectIdsForGrade({
      'Grade 1': { configured: false, subjectIds: ['math'] },
      'Grade 2': { configured: true, subjectIds: ['math', 'unknown'] },
    }, 'Grade 1')).toEqual([]);
    expect(curriculumSubjectIdsForGrade({
      'Grade 2': { configured: true, subjectIds: ['math', 'unknown'] },
    }, 'Grade 2')).toEqual(['math']);
    expect(curriculumSubjectIdsForGrade({}, 'Grade 1', true)).toEqual([...LEGACY_CURRICULUM_SUBJECT_IDS]);
  });
});
