const PUBLIC_STATS_FIELDS = [
  'totalLearners',
  'programsTracked',
  'fourPsCount',
  'ipCount',
  'snedCount',
  'aralCount',
  'muslimCount',
  'maleCount',
  'femaleCount',
  'notTaggedCount',
  'gradeLevels',
  'enrollmentData',
  'schoolYear',
  'syncStatus',
  'updatedAt',
] as const;

const PROGRAM_FIELDS = [
  ['is4Ps', 'fourPsCount'],
  ['isIP', 'ipCount'],
  ['isSNED', 'snedCount'],
  ['isARAL', 'aralCount'],
  ['isMuslim', 'muslimCount'],
] as const;

type PublicLearner = Record<string, unknown>;

interface EnrollmentRow extends Record<string, unknown> {
  gradeLevel?: string;
  section?: string;
  male?: number;
  female?: number;
  total?: number;
}

interface EnrollmentData {
  rows?: EnrollmentRow[];
  gradeTotals?: Array<{ gradeLevel: string; male: number; female: number; total: number }>;
  grandTotal?: { male: number; female: number; total: number };
}

interface PublicStatsAggregate extends Record<string, unknown> {
  totalLearners?: number;
  maleCount?: number;
  femaleCount?: number;
  taggedCount?: number;
  gradeLevels?: Array<{ label: string; value: number }>;
  enrollmentData?: EnrollmentData;
}

export function publicStatsPayload(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

  const source = value as Record<string, unknown>;
  const payload: Record<string, unknown> = {};
  PUBLIC_STATS_FIELDS.forEach((field) => {
    if (!Object.prototype.hasOwnProperty.call(source, field)) return;
    const fieldValue = source[field];
    payload[field] = field === 'updatedAt' && fieldValue && typeof fieldValue === 'object'
      && 'toDate' in fieldValue && typeof fieldValue.toDate === 'function'
      ? fieldValue.toDate().toISOString()
      : fieldValue;
  });
  return payload;
}

export function isPublicActiveLearner(learner: PublicLearner | null | undefined) {
  if (!learner || typeof learner !== 'object') return false;
  const enrollmentStatus = String(learner.enrollmentStatus || 'ACTIVE').toUpperCase().replace(/[ -]+/g, '_');
  const eosyStatus = String(learner.eosyStatus || '').toLowerCase().replace(/[_-]+/g, ' ');
  return enrollmentStatus !== 'TRANSFERRED_OUT'
    && enrollmentStatus !== 'DROPPED_OUT'
    && eosyStatus !== 'dropped out'
    && !learner.transferOut;
}

export function buildPublicStatsDelta(
  stats: PublicStatsAggregate,
  changes: Array<{ before?: PublicLearner | null; after?: PublicLearner | null }>,
  normalizeGrade: (grade: string) => string,
) {
  let totalLearners = Number(stats.totalLearners || 0);
  let maleCount = Number(stats.maleCount || 0);
  let femaleCount = Number(stats.femaleCount || 0);
  let taggedCount = Number(stats.taggedCount || 0);
  const programCounts: Record<string, number> = Object.fromEntries(PROGRAM_FIELDS.map(([, field]) => [field, Number(stats[field] || 0)]));
  const gradeCounts = Object.fromEntries((stats.gradeLevels || []).map(({ label, value }) => [label, Number(value || 0)]));
  const enrollmentData: EnrollmentData | null = stats.enrollmentData ? JSON.parse(JSON.stringify(stats.enrollmentData)) : null;
  const normalizeValue = (value: unknown) => String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

  const adjustEnrollment = (learner: PublicLearner | null | undefined, amount: number) => {
    if (!enrollmentData?.rows || !isPublicActiveLearner(learner)) return;
    const gradeLevel = normalizeGrade(String(learner.gradeLevel || ''));
    const section = String(learner.section || '').trim();
    if (!gradeLevel || !section) return;
    const row = enrollmentData.rows.find((item) =>
      normalizeValue(item.gradeLevel) === normalizeValue(gradeLevel)
      && normalizeValue(item.section) === normalizeValue(section)
    );
    if (!row) return;
    const gender = normalizeValue(learner.gender);
    if (gender === 'male') row.male = Math.max(0, Number(row.male || 0) + amount);
    if (gender === 'female') row.female = Math.max(0, Number(row.female || 0) + amount);
    row.total = Math.max(0, Number(row.total || 0) + amount);
  };

  changes.forEach(({ before, after }) => {
    const beforeActive = isPublicActiveLearner(before);
    const afterActive = isPublicActiveLearner(after);
    totalLearners += Number(afterActive) - Number(beforeActive);
    maleCount += Number(afterActive && after?.gender === 'Male') - Number(beforeActive && before?.gender === 'Male');
    femaleCount += Number(afterActive && after?.gender === 'Female') - Number(beforeActive && before?.gender === 'Female');
    taggedCount += Number(afterActive && PROGRAM_FIELDS.some(([field]) => after?.[field]))
      - Number(beforeActive && PROGRAM_FIELDS.some(([field]) => before?.[field]));
    PROGRAM_FIELDS.forEach(([field, countField]) => {
      programCounts[countField] += Number(Boolean(afterActive && after?.[field])) - Number(Boolean(beforeActive && before?.[field]));
    });
    if (beforeActive) {
      const grade = String(before?.gradeLevel || '—');
      gradeCounts[grade] = Math.max(0, (gradeCounts[grade] || 0) - 1);
    }
    if (afterActive) {
      const grade = String(after?.gradeLevel || '—');
      gradeCounts[grade] = (gradeCounts[grade] || 0) + 1;
    }
    adjustEnrollment(before, -1);
    adjustEnrollment(after, 1);
  });

  const result: Record<string, unknown> = {
    totalLearners: Math.max(0, totalLearners),
    maleCount: Math.max(0, maleCount),
    femaleCount: Math.max(0, femaleCount),
    taggedCount: Math.min(Math.max(0, totalLearners), Math.max(0, taggedCount)),
    gradeLevels: Object.entries(gradeCounts)
      .filter(([, value]) => Number(value) > 0)
      .map(([label, value]) => ({ label, value })),
    ...programCounts,
  };
  const nextTotalLearners = Math.max(0, totalLearners);
  const nextTaggedCount = Math.min(nextTotalLearners, Math.max(0, taggedCount));
  result.notTaggedCount = nextTotalLearners - nextTaggedCount;
  result.programsTracked = PROGRAM_FIELDS.filter(([, field]) => programCounts[field] > 0).length;

  if (enrollmentData?.rows) {
    enrollmentData.grandTotal = enrollmentData.rows.reduce((total: { male: number; female: number; total: number }, row) => ({
      male: total.male + Number(row.male || 0),
      female: total.female + Number(row.female || 0),
      total: total.total + Number(row.total || 0),
    }), { male: 0, female: 0, total: 0 });
    const gradeOrder = ['Kinder', 'Grade 1', 'Grade 2', 'Grade 3', 'Grade 4', 'Grade 5', 'Grade 6'];
    enrollmentData.gradeTotals = [...new Set(enrollmentData.rows.map((row) => row.gradeLevel))]
      .sort((first, second) => {
        const firstIndex = gradeOrder.indexOf(String(first));
        const secondIndex = gradeOrder.indexOf(String(second));
        return (firstIndex < 0 ? gradeOrder.length : firstIndex) - (secondIndex < 0 ? gradeOrder.length : secondIndex)
          || String(first).localeCompare(String(second));
      })
      .map((gradeLevel) => {
        const normalizedGradeLevel = String(gradeLevel || '');
        const gradeRows = enrollmentData.rows?.filter((row) => row.gradeLevel === normalizedGradeLevel) || [];
        return {
          gradeLevel: normalizedGradeLevel,
          male: gradeRows.reduce((sum, row) => sum + Number(row.male || 0), 0),
          female: gradeRows.reduce((sum, row) => sum + Number(row.female || 0), 0),
          total: gradeRows.reduce((sum, row) => sum + Number(row.total || 0), 0),
        };
      });
    result.enrollmentData = enrollmentData;
  }
  return result;
}
