import { describe, expect, it, vi } from 'vitest';

const mockAuth = {
  currentUser: null,
  setPersistence: vi.fn().mockResolvedValue(undefined),
  onAuthStateChanged: vi.fn(),
  signInWithEmailAndPassword: vi.fn(),
  signOut: vi.fn(),
};
const mockDb = {
  enablePersistence: vi.fn().mockResolvedValue(undefined),
  collection: vi.fn(() => ({ doc: vi.fn(() => ({ get: vi.fn() })) })),
};

vi.stubGlobal('firebase', {
  apps: [],
  initializeApp: vi.fn(() => ({ auth: () => mockAuth, firestore: () => mockDb })),
  auth: Object.assign(vi.fn(() => mockAuth), { Auth: { Persistence: { LOCAL: 'local', SESSION: 'session' } } }),
  firestore: vi.fn(() => mockDb),
});

const {
  buildLearnerDetailSections,
  ensureLearnerInspectModal,
  renderLearnerDetailSections,
  renderLearnersTable,
} = await import('./learner-list');

describe('learner inspection details', () => {
  it('shows an inspect action in the shared learner table and provides an accessible dialog', () => {
    document.body.innerHTML = '<table><tbody id="learnersTableBody"></tbody></table>';
    ensureLearnerInspectModal();
    renderLearnersTable([{
      learnerId: '123456789012',
      firstName: 'Alex',
      lastName: 'Reyes',
      gradeLevel: 'Grade 2',
      section: 'A',
    }]);

    const inspectButton = document.querySelector<HTMLButtonElement>('[data-inspect="123456789012"]');
    expect(inspectButton?.getAttribute('aria-label')).toBe('Inspect Alex Reyes');
    expect(inspectButton?.querySelector('svg')).not.toBeNull();
    expect(document.querySelector('#learnerInspectBackdrop [role="dialog"]')?.getAttribute('aria-modal')).toBe('true');
  });

  it('groups available learner information and includes custom fields and false program flags', () => {
    const sections = buildLearnerDetailSections({
      learnerId: '123456789012',
      firstName: 'Alex',
      gradeLevel: 'Grade 2',
      guardian: 'Jamie',
      is4Ps: false,
      bosyRMA: 'Proficient',
      bosyHeight: 120,
      math: 94,
      extra: { customNote: 'Needs reading support' },
    });

    expect(sections.find(({ title }) => title === 'Personal information')?.fields)
      .toContainEqual({ key: 'learnerId', label: 'Learner ID', value: '123456789012' });
    expect(sections.find(({ title }) => title === 'Programs')?.fields)
      .toContainEqual({ key: 'is4Ps', label: '4Ps beneficiary', value: 'No' });
    expect(sections.find(({ title }) => title === 'Learning assessments')?.fields)
      .toContainEqual({ key: 'bosyRMA', label: 'BOSY RMA', value: 'Proficient' });
    expect(sections.find(({ title }) => title === 'Nutrition')?.fields)
      .toContainEqual({ key: 'bosyHeight', label: 'BOSY Height', value: '120' });
    expect(sections.find(({ title }) => title === 'Academic grades')?.fields)
      .toContainEqual({ key: 'math', label: 'Math', value: '94' });
    expect(sections.find(({ title }) => title === 'Additional information')?.fields)
      .toContainEqual({ key: 'customNote', label: 'Custom Note', value: 'Needs reading support' });
  });

  it('escapes learner-provided values in the details panel', () => {
    document.body.innerHTML = renderLearnerDetailSections({
      firstName: '<img src=x onerror=alert(1)>',
      guardian: 'Jamie & Alex',
    });

    expect(document.querySelector('.learner-inspect-section img')).toBeNull();
    expect(document.body.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(document.body.innerHTML).toContain('&lt;img');
    expect(document.body.innerHTML).toContain('Jamie &amp; Alex');
  });
});
