export const CURRICULUM_GRADE_LEVELS = [
  'Kinder',
  'Grade 1',
  'Grade 2',
  'Grade 3',
  'Grade 4',
  'Grade 5',
  'Grade 6',
] as const;

export const CURRICULUM_SUBJECTS = [
  { id: 'literacyLanguageCommunication', label: 'Literacy, Language, and Communication' },
  { id: 'socioEmotionalDevelopment', label: 'Socio-Emotional Development' },
  { id: 'valuesDevelopment', label: 'Values Development' },
  { id: 'physicalHealthMotorDevelopment', label: 'Physical Health and Motor Development' },
  { id: 'aestheticCreativeDevelopment', label: 'Aesthetic/Creative Development' },
  { id: 'cognitiveDevelopment', label: 'Cognitive Development' },
  { id: 'filipino', label: 'Filipino' },
  { id: 'english', label: 'English' },
  { id: 'math', label: 'Math' },
  { id: 'science', label: 'Science' },
  { id: 'gmrc', label: 'GMRC' },
  { id: 'language', label: 'Language' },
  { id: 'readingLiteracy', label: 'Reading and Literacy' },
  { id: 'makabansa', label: 'Makabansa' },
  { id: 'aralPan', label: 'Aral Pan' },
  { id: 'eppTle', label: 'EPP/TLE' },
  { id: 'tle', label: 'TLE' },
  { id: 'valuesEducation', label: 'Values Education' },
  { id: 'mapeh', label: 'MAPEH' },
  { id: 'esp', label: 'ESP' },
  { id: 'music', label: 'Music' },
  { id: 'arts', label: 'Arts' },
  { id: 'pe', label: 'Physical Education' },
  { id: 'health', label: 'Health' },
  { id: 'epp', label: 'EPP' },
  { id: 'motherTongue', label: 'Mother Tongue' },
] as const;

export const LEGACY_CURRICULUM_SUBJECT_IDS = [
  'filipino',
  'english',
  'math',
  'science',
  'aralPan',
  'esp',
  'music',
  'arts',
  'pe',
  'health',
  'epp',
  'motherTongue',
] as const;

export function normalizeCurriculumGrade(value: unknown) {
  const text = String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (['kinder', 'kindergarten', 'kg', '0'].includes(text)) return 'Kinder';
  const match = text.match(/^grade\s*(\d+)$/) || text.match(/^(\d+)$/);
  return match ? `Grade ${match[1]}` : String(value ?? '').trim();
}

export function normalizeCurriculumSubjectIds(values: unknown) {
  if (!Array.isArray(values)) return [];
  const allowedIds = new Set<string>(CURRICULUM_SUBJECTS.map(({ id }) => id));
  return [...new Set(values.filter((value): value is string => (
    typeof value === 'string' && allowedIds.has(value)
  )))];
}

export function curriculumSubjectIdsForGrade(
  assignments: Record<string, { configured?: boolean; subjectIds?: unknown }> | null | undefined,
  gradeLevel: unknown,
  useLegacyFallback = false,
) {
  if (useLegacyFallback) return [...LEGACY_CURRICULUM_SUBJECT_IDS];
  const assignment = assignments?.[normalizeCurriculumGrade(gradeLevel)];
  return assignment?.configured === true ? normalizeCurriculumSubjectIds(assignment.subjectIds) : [];
}
