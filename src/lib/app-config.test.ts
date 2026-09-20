import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockAuth = {
  currentUser: null,
  setPersistence: vi.fn().mockResolvedValue(undefined),
  onAuthStateChanged: vi.fn(),
  signInWithEmailAndPassword: vi.fn(),
  signOut: vi.fn(),
};

const mockAuthNamespace = {
  Persistence: {
    LOCAL: 'local',
    SESSION: 'session',
  },
};

const mockDb = {
  enablePersistence: vi.fn().mockResolvedValue(undefined),
  collection: vi.fn(() => ({ doc: vi.fn(() => ({ get: vi.fn() })) })),
};

vi.stubGlobal('firebase', {
  apps: [],
  initializeApp: vi.fn(() => ({ auth: () => mockAuth, firestore: () => mockDb })),
  auth: Object.assign(vi.fn(() => mockAuth), { Auth: mockAuthNamespace }),
  firestore: vi.fn(() => mockDb),
});

const { ensureVisitorSession, isVisitorSession } = await import('./app-config');
const { LPSApi } = await import('./sheets-api');
const { loadDashboardData, renderRecentTable } = await import('./dashboard');
const { sentenceCaseName } = await import('./learner-list');
const firestoreApi = await import('./firestore-api');
const demoData = await import('./demo-data');

describe('visitor session handling', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    window.history.pushState({}, '', '/');
    sessionStorage.clear();
    localStorage.clear();
  });

  it('keeps the login page accessible when a stale guest session is left behind', () => {
    localStorage.setItem('lps_guest_session', String(Date.now() - 60_000));
    sessionStorage.setItem('lps_guest_session', '1');
    sessionStorage.setItem('lps_user_profile', JSON.stringify({ email: '', uid: 'guest', role: 'Visitor' }));

    expect(isVisitorSession()).toBe(false);
  });

  it('prefers a real signed-in user over a stale visitor marker', () => {
    localStorage.setItem('lps_guest_session', String(Date.now() + 60_000));
    sessionStorage.setItem('lps_guest_session', '1');
    sessionStorage.setItem('lps_user_profile', JSON.stringify({ email: 'admin@school.test', uid: 'user-123' }));

    expect(isVisitorSession()).toBe(false);
    expect(localStorage.getItem('lps_guest_session')).toBeNull();
    expect(sessionStorage.getItem('lps_guest_session')).toBeNull();
  });

  it('treats a real user profile as authenticated even when the visitor marker is still present', () => {
    localStorage.setItem('lps_guest_session', String(Date.now() + 60_000));
    sessionStorage.setItem('lps_guest_session', '1');
    sessionStorage.setItem('lps_user_profile', JSON.stringify({ email: 'admin@school.test' }));

    expect(isVisitorSession()).toBe(false);
    expect(localStorage.getItem('lps_guest_session')).toBeNull();
    expect(sessionStorage.getItem('lps_guest_session')).toBeNull();
  });

  it('creates a visitor session immediately when the visitor flow is started', () => {
    window.history.pushState({}, '', '/');

    expect(ensureVisitorSession(true)).toBe(true);
    expect(isVisitorSession()).toBe(true);
    expect(JSON.parse(sessionStorage.getItem('lps_user_profile') || '{}')).toMatchObject({ uid: 'guest', role: 'Visitor' });
  });

  it('hides the dashboard welcome copy for visitor sessions', async () => {
    document.body.innerHTML = `
      <section class="dashboard-context">
        <div>
          <p class="dashboard-welcome" id="dashboardWelcome">Welcome</p>
          <p class="dashboard-context-title">Your operational overview</p>
        </div>
        <div class="dashboard-scope" id="dashboardScope">School-wide registrar view</div>
      </section>
    `;
    sessionStorage.setItem('lps_user_profile', JSON.stringify({ email: '', uid: 'guest', role: 'Visitor' }));
    sessionStorage.setItem('lps_guest_session', '1');
    localStorage.setItem('lps_guest_session', String(Date.now() + 60_000));

    const { renderDashboardContext } = await import('./dashboard');
    renderDashboardContext();

    expect(document.querySelector('.dashboard-context')).toBeNull();
  });

  it('renders cached public stats immediately when the live dashboard listeners are stalled', async () => {
    document.body.innerHTML = `
      <div id="demoBanner"></div>
      <div id="statGrid"></div>
      <div id="donutSvg"></div>
      <div id="donutLegend"></div>
      <div id="gradeBarChart"></div>
      <div id="recentTableBody"></div>
      <div id="programSummary"></div>
      <div id="lastSynced"></div>
    `;

    vi.spyOn(firestoreApi, 'fsGetPublicStats').mockResolvedValue({
      totalLearners: 1,
      maleCount: 1,
      femaleCount: 0,
      fourPsCount: 0,
      ipCount: 0,
      snedCount: 0,
      aralCount: 0,
      muslimCount: 0,
      notTaggedCount: 1,
      gradeLevels: [{ label: 'Grade 1', value: 1 }],
      recentLearners: [],
      schoolYear: '2026-2027',
      updatedAt: { toDate: () => new Date('2026-09-13T00:00:00Z') },
    });
    vi.spyOn(firestoreApi, 'fsSubscribeLearners').mockReturnValue(() => {});
    vi.spyOn(firestoreApi, 'fsSubscribePublicStats').mockReturnValue(() => {});
    vi.spyOn(firestoreApi, 'fsSubscribeRecentLearners').mockReturnValue(() => {});
    LPSApi.getDashboardSummary = vi.fn().mockRejectedValue(new Error('stalled'));

    await loadDashboardData('2026-2027');

    expect(document.getElementById('lastSynced')?.textContent).toContain('Updated');
    expect(document.getElementById('statGrid')?.innerHTML).toContain('1');
  });

  it('lists all teacher advisory assignments in the dashboard context', async () => {
    document.body.innerHTML = `
      <section class="dashboard-context">
        <div>
          <p class="dashboard-welcome" id="dashboardWelcome">Welcome</p>
        </div>
        <div class="dashboard-scope" id="dashboardScope"></div>
      </section>
    `;

    sessionStorage.setItem('lps_user_profile', JSON.stringify({
      email: 'teacher@test.edu',
      uid: 'teacher-1',
      name: 'Jane Teacher',
      role: 'Teacher',
      teacherAssignments: [
        { schoolYear: '2026-2027', gradeLevel: 'Grade 1', section: 'A' },
        { schoolYear: '2026-2027', gradeLevel: 'Grade 5', section: 'B' },
      ],
    }));

    const { renderDashboardContext } = await import('./dashboard');
    renderDashboardContext();

    const scope = document.getElementById('dashboardScope');
    expect(scope?.textContent).toContain('2026-2027');
    expect(scope?.textContent).toContain('Grade 1');
    expect(scope?.textContent).toContain('Section A');
    expect(scope?.textContent).toContain('Grade 5');
    expect(scope?.textContent).toContain('Section B');
  });

  it('limits teacher learner grade and section choices to their assigned coverage', async () => {
    document.body.innerHTML = `
      <form id="learnerForm">
        <div class="field-grid">
          <div class="field"><select id="f_gradeLevel"><option value="">Select…</option></select></div>
          <div class="field"><input id="f_section" /></div>
        </div>
      </form>
    `;

    sessionStorage.setItem('lps_user_profile', JSON.stringify({
      email: 'teacher@test.edu',
      uid: 'teacher-1',
      name: 'Jane Teacher',
      role: 'Teacher',
      teacherAssignments: [
        { schoolYear: '2026-2027', gradeLevel: 'Grade 1', section: 'A' },
        { schoolYear: '2026-2027', gradeLevel: 'Grade 1', section: 'B' },
        { schoolYear: '2026-2027', gradeLevel: 'Grade 5', section: 'C' },
      ],
    }));

    const { applyTeacherLearnerScope, teacherAssignedGradeOptions, teacherAssignedSectionsForGrade } = await import('./learner-list');
    const scope = applyTeacherLearnerScope();

    expect(scope).toHaveLength(3);
    expect(teacherAssignedGradeOptions()).toEqual(['Grade 1', 'Grade 5']);
    expect(teacherAssignedSectionsForGrade('Grade 1')).toEqual(['A', 'B']);
    expect(teacherAssignedSectionsForGrade('Grade 5')).toEqual(['C']);
    expect(document.getElementById('f_teacherAssignment')).not.toBeNull();
    expect(document.getElementById('f_teacherAssignment')?.options.length).toBe(3);
  });

  it('does not duplicate the first advisory assignment when both field layouts exist', async () => {
    const { teacherAssignmentsForProfile } = await import('./app-config');
    // The admin console mirrors the first list item into `teacherAssignment`,
    // so legacy + current fields both being present must NOT double the list.
    const assignments = teacherAssignmentsForProfile({
      role: 'Teacher',
      teacherAssignment: { schoolYear: '2026-2027', gradeLevel: 'Grade 1', section: 'A' },
      teacherAssignments: [
        { schoolYear: '2026-2027', gradeLevel: 'Grade 1', section: 'A' },
        { schoolYear: '2026-2027', gradeLevel: 'Grade 5', section: 'B' },
      ],
    });

    expect(assignments.map((a) => `${a.gradeLevel} ${a.section}`)).toEqual(['Grade 1 A', 'Grade 5 B']);
  });

  it('falls back to the legacy single assignment field when the list is absent', async () => {
    const { teacherAssignmentsForProfile } = await import('./app-config');
    const assignments = teacherAssignmentsForProfile({
      role: 'Teacher',
      teacherAssignment: { schoolYear: '2026-2027', gradeLevel: 'Grade 2', section: 'C' },
    });

    expect(assignments.map((a) => `${a.gradeLevel} ${a.section}`)).toEqual(['Grade 2 C']);
  });

  it('builds a rules-matching security key regardless of extra fields on the assignment (regression: teacherName previously broke map-equality checks in firestore.rules)', async () => {
    const { teacherAssignmentSecurityKey, teacherAssignmentSecurityKeys } = await import('./app-config');

    // The stored assignment always carries teacherName once saved through the
    // admin console — the key must ignore it and depend only on
    // schoolYear/gradeLevel/section, matching learnerAssignmentKey() in
    // firestore.rules.
    expect(teacherAssignmentSecurityKey({ schoolYear: '2026-2027', gradeLevel: 'Grade 1', section: 'A', teacherName: 'Ms. Cruz' }))
      .toBe('2026-2027::Grade 1::A');

    // Missing any required part yields no key (never a partial/garbage key).
    expect(teacherAssignmentSecurityKey({ schoolYear: '2026-2027', gradeLevel: 'Grade 1' })).toBeNull();

    // A multi-section teacher gets one de-duplicated key per assignment.
    const keys = teacherAssignmentSecurityKeys([
      { schoolYear: '2026-2027', gradeLevel: 'Grade 1', section: 'A', teacherName: 'Ms. Cruz' },
      { schoolYear: '2026-2027', gradeLevel: 'Grade 5', section: 'B', teacherName: 'Ms. Cruz' },
      { schoolYear: '2026-2027', gradeLevel: ' Grade 1 ', section: ' A ', teacherName: 'Ms. Cruz' },
    ]);
    expect(keys).toEqual(['2026-2027::Grade 1::A', '2026-2027::Grade 5::B']);
  });

  it('stores teacher coverage in a normalized multi-section shape that avoids legacy duplicate keys', async () => {
    const { normalizeTeacherAssignmentsForStorage } = await import('./app-config');
    const assignments = normalizeTeacherAssignmentsForStorage([
      { schoolYear: '2026-2027', gradeLevel: 'Grade 1', section: 'A', teacherName: 'Jane Teacher', teacherKey: 'jane-teacher', gradeKey: 'grade-1', sectionKey: 'a' },
      { schoolYear: '2026-2027', gradeLevel: 'Grade 5', section: 'B', teacherName: 'Jane Teacher', teacherKey: 'jane-teacher', gradeKey: 'grade-5', sectionKey: 'b' },
      { schoolYear: '2026-2027', gradeLevel: 'Grade 1', section: 'A', teacherName: 'Jane Teacher', teacherKey: 'jane-teacher', gradeKey: 'grade-1', sectionKey: 'a' },
    ]);

    expect(assignments).toEqual([
      { schoolYear: '2026-2027', gradeLevel: 'Grade 1', section: 'A', teacherName: 'Jane Teacher' },
      { schoolYear: '2026-2027', gradeLevel: 'Grade 5', section: 'B', teacherName: 'Jane Teacher' },
    ]);
  });

  it('keeps a teacher scoped to their assignments even when the profile has no teacherName stored', async () => {
    sessionStorage.setItem('lps_user_profile', JSON.stringify({
      uid: 'teacher-uid-123',
      userId: 'teacher-uid-123',
      name: 'Jane Teacher',
      role: 'Teacher',
      teacherAssignments: [
        { schoolYear: '2026-2027', gradeLevel: 'Grade 1', section: 'A' },
        { schoolYear: '2026-2027', gradeLevel: 'Grade 5', section: 'B' },
      ],
    }));

    const { fsTeacherAssignments_ } = await import('./firestore-api');
    const assignments = fsTeacherAssignments_();

    expect(assignments).toHaveLength(2);
describe('teacher advisory-index independence (firestore)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    sessionStorage.clear();
    localStorage.clear();
  });

  it('keeps the advisory learners index out of a teacher learner write path', async () => {
    sessionStorage.setItem('lps_user_profile', JSON.stringify({
      email: 'teacher@test.edu',
      uid: 'teacher-1',
      name: 'Jane Teacher',
      role: 'Teacher',
      teacherAssignments: [{ schoolYear: '2026-2027', gradeLevel: 'Grade 1', section: 'A' }],
    }));

    const { fsAdvisoryIndexWriteEnabled_, fsSyncAdvisoryLearner_ } = await import('./firestore-api');
    const { db } = await import('./firebase');
    const collectionNames = [];
    vi.spyOn(db, 'collection').mockImplementation((name) => {
      collectionNames.push(name);
      return { doc: vi.fn(() => ({ get: vi.fn().mockResolvedValue({ exists: false }) })) };
    });

    // The teacher never maintains the derived index...
    expect(fsAdvisoryIndexWriteEnabled_()).toBe(false);
    // ...so the advisory sync short-circuits, never throws, and never reads/writes advisory.
    await expect(fsSyncAdvisoryLearner_('2026-2027', { learnerId: '123456789012', gradeLevel: 'Grade 1', section: 'A' })).resolves.toBeUndefined();
    expect(collectionNames).not.toContain('advisory');
  });

  it('lets non-teacher users keep maintaining the advisory learners index', async () => {
    sessionStorage.setItem('lps_user_profile', JSON.stringify({
      email: 'admin@school.test',
      uid: 'admin-1',
      name: 'School Admin',
      role: 'School Admin',
    }));

    const { fsAdvisoryIndexWriteEnabled_ } = await import('./firestore-api');
    expect(fsAdvisoryIndexWriteEnabled_()).toBe(true);
  });

  it('reads a teacher transfer list straight from Learners, never from advisory', async () => {
    sessionStorage.setItem('lps_user_profile', JSON.stringify({
      email: 'teacher@test.edu',
      uid: 'teacher-1',
      name: 'Jane Teacher',
      role: 'Teacher',
      teacherAssignments: [{ schoolYear: '2026-2027', gradeLevel: 'Grade 1', section: 'A' }],
    }));

    const firestoreApi = await import('./firestore-api');
    const { db } = await import('./firebase');
    const collectionNames = [];
    const learnersQuery = {
      where: vi.fn(() => ({
        where: vi.fn(() => ({
          get: vi.fn().mockResolvedValue({
            docs: [{ id: 'lrn-0001', data: () => ({ learnerId: 'lrn-0001', gradeLevel: 'Grade 1', section: 'A', transferType: 'Transfer In', transferIn: true }) }],
          }),
        })),
      })),
    };
    vi.spyOn(db, 'collection').mockImplementation((name) => {
      collectionNames.push(name);
      if (name === 'Learners') {
        return { doc: vi.fn(() => ({ collection: vi.fn(() => learnersQuery) })) };
      }
      if (name === 'TransferredOut') {
        return { doc: vi.fn(() => ({ collection: vi.fn(() => ({ get: vi.fn().mockResolvedValue({ docs: [] }) })) })) };
      }
      return { doc: vi.fn(() => ({ get: vi.fn().mockResolvedValue({ exists: false }), collection: vi.fn(() => ({ get: vi.fn().mockResolvedValue({ docs: [] }) })) })) };
    });

    const records = await firestoreApi.fsGetTransferRecords('2026-2027');
    expect(collectionNames).not.toContain('advisory');
    expect(collectionNames).toContain('Learners');
    expect(collectionNames).toContain('TransferredOut');
    expect(records.some((record) => record.learnerId === 'lrn-0001')).toBe(true);
  });

  it('reads a teacher drop-out list straight from Learners + Dropouts, never from advisory', async () => {
    sessionStorage.setItem('lps_user_profile', JSON.stringify({
      email: 'teacher@test.edu',
      uid: 'teacher-1',
      name: 'Jane Teacher',
      role: 'Teacher',
      teacherAssignments: [{ schoolYear: '2026-2027', gradeLevel: 'Grade 1', section: 'A' }],
    }));

    const firestoreApi = await import('./firestore-api');
    const { db } = await import('./firebase');
    const collectionNames = [];
    const learnersQuery = {
      where: vi.fn(() => ({
        where: vi.fn(() => ({
          get: vi.fn().mockResolvedValue({
            docs: [{ id: 'lrn-0002', data: () => ({ learnerId: 'lrn-0002', gradeLevel: 'Grade 1', section: 'A', enrollmentStatus: 'DROPPED_OUT', eosyStatus: 'Dropped Out' }) }],
          }),
        })),
      })),
    };
    vi.spyOn(db, 'collection').mockImplementation((name) => {
      collectionNames.push(name);
      if (name === 'Learners') {
        return { doc: vi.fn(() => ({ collection: vi.fn(() => learnersQuery) })) };
      }
      if (name === 'Dropouts') {
        return { doc: vi.fn(() => ({ collection: vi.fn(() => ({ get: vi.fn().mockResolvedValue({ docs: [] }) })) })) };
      }
      return { doc: vi.fn(() => ({ get: vi.fn().mockResolvedValue({ exists: false }), collection: vi.fn(() => ({ get: vi.fn().mockResolvedValue({ docs: [] }) })) })) };
    });

    const records = await firestoreApi.fsGetArchiveRecords('dropout', '2026-2027');
    expect(collectionNames).not.toContain('advisory');
    expect(collectionNames).toContain('Learners');
    expect(collectionNames).toContain('Dropouts');
    expect(records.some((record) => record.learnerId === 'lrn-0002')).toBe(true);
  });
});
    expect(assignments.map((assignment) => `${assignment.gradeLevel}-${assignment.section}`)).toEqual(['Grade 1-A', 'Grade 5-B']);
    expect(assignments.every((assignment) => assignment.teacherKey)).toBe(true);
  });

  it('rejects duplicate user records before creating a second Firebase auth account', async () => {
    const firestoreApi = await import('./firestore-api');
    const { db } = await import('./firebase');
    vi.spyOn(db, 'collection').mockImplementation((name) => {
      if (name === 'users') {
        return {
          where: vi.fn(() => ({
            limit: vi.fn(() => ({
              get: vi.fn(() => Promise.resolve({ empty: false, docs: [{ id: 'existing-user' }] })),
            })),
          })),
          doc: vi.fn(() => ({ set: vi.fn(), get: vi.fn() })),
        };
      }
      return {
        doc: vi.fn(() => ({ get: vi.fn(), set: vi.fn() })),
      };
    });

    await expect(firestoreApi.fsAddUser({
      name: 'Existing User',
      email: 'existing@example.com',
      password: '123456',
      role: 'Teacher',
      status: 'Active',
    })).rejects.toThrow('already exists');
  });

  it('removes the Firestore profile even when auth deletion fails', async () => {
    const firestoreApi = await import('./firestore-api');
    const { db } = await import('./firebase');
    const deleteDoc = vi.fn().mockResolvedValue(undefined);

    vi.spyOn(db, 'collection').mockImplementation((name) => {
      if (name === 'users') {
        return {
          doc: vi.fn((userId) => ({
            get: vi.fn().mockResolvedValue({ exists: true, data: () => ({ role: 'Teacher', status: 'Active', teacherAssignments: [] }) }),
            delete: deleteDoc,
          })),
        };
      }
      return {
        doc: vi.fn(() => ({ get: vi.fn().mockResolvedValue({ exists: false }), set: vi.fn(), delete: vi.fn() })),
      };
    });

    const { LPSApi } = await import('./sheets-api');
    vi.spyOn(LPSApi, 'deleteAuthUsers').mockRejectedValue(new Error('audit log unavailable'));

    await expect(firestoreApi.fsDeleteUser('u-123')).resolves.toMatchObject({ deleted: true });
    expect(deleteDoc).toHaveBeenCalledTimes(1);
  });

  it('shows a learner even when the recent list has no valid dateAdded value', () => {
    document.body.innerHTML = '<div id="recentTableBody"></div>';

    renderRecentTable([{ firstName: 'Ana', lastName: 'Dela Cruz', gradeLevel: 'Grade 1', section: 'A', dateAdded: '' }]);

    expect(document.getElementById('recentTableBody')?.textContent).toContain('Dela Cruz');
    expect(document.getElementById('recentTableBody')?.textContent).not.toContain('No learners added yet.');
  });

  it('renders the newest public stats snapshot alongside fresh recent learners', async () => {
    const { renderDashboardSummary } = await import('./dashboard');

    document.body.innerHTML = `
      <div id="demoBanner"></div>
      <div id="statGrid"></div>
      <div id="donutSvg"></div>
      <div id="donutLegend"></div>
      <div id="gradeBarChart"></div>
      <div id="recentTableBody"></div>
      <div id="programSummary"></div>
      <div id="lastSynced"></div>
    `;

    renderDashboardSummary({
      totalLearners: 20,
      maleCount: 11,
      femaleCount: 9,
      fourPsCount: 4,
      ipCount: 0,
      snedCount: 0,
      aralCount: 0,
      muslimCount: 0,
      notTaggedCount: 16,
      gradeLevels: [{ label: 'Grade 1', value: 20 }],
      recentLearners: [],
      updatedAt: { toDate: () => new Date('2026-09-14T00:00:00Z') },
    }, [{ firstName: 'Ana', lastName: 'Dela Cruz', gradeLevel: 'Grade 1', section: 'A', dateAdded: new Date('2026-09-14T00:00:00Z') }]);

    expect(document.getElementById('statGrid')?.textContent).toContain('20');
    expect(document.getElementById('recentTableBody')?.textContent).toContain('Dela Cruz');
    expect(document.getElementById('lastSynced')?.textContent).toContain('2026');
  });

  it('deletes a learner through the Firestore delete path when the masterlist confirms removal', async () => {
    document.body.innerHTML = `
      <div id="deleteModalBackdrop" class="is-open"></div>
      <button id="deleteModalConfirm"></button>
    `;
    vi.spyOn(demoData, 'isSheetsApiConfigured').mockReturnValue(false);
    const deleteLearnerSpy = vi.spyOn(firestoreApi, 'fsDeleteLearner').mockResolvedValue({ deleted: true });
    const deleteLearnersSpy = vi.spyOn(firestoreApi, 'fsDeleteLearners').mockResolvedValue({ deleted: 2 });
    vi.spyOn(LPSApi, 'deleteLearner').mockResolvedValue({ deleted: true });
    vi.spyOn(LPSApi, 'deleteLearners').mockResolvedValue({ deleted: 2 });

    const { LL, confirmDelete } = await import('./learner-list');
    LL.loadedSchoolYear = '2026-2027';
    LL.deletingId = 'LRN-001';
    LL.deletingName = 'Ana Dela Cruz';
    LL.selectedIds.clear();

    await confirmDelete();

    expect(deleteLearnerSpy).toHaveBeenCalledWith('2026-2027', 'LRN-001');
    expect(deleteLearnersSpy).not.toHaveBeenCalled();
  });

  it('deletes the correct learner document for a real "YYYY-YYYY" school year (regression: a school-year-shaped ID must never be mistaken for the learner ID)', async () => {
    const ref = { get: vi.fn().mockResolvedValue({ exists: true, data: () => ({ learnerId: 'LRN-001' }) }), delete: vi.fn().mockResolvedValue(undefined) };
    const recordsCollection = { doc: vi.fn(() => ref) };
    mockDb.collection.mockImplementation(() => ({
      doc: vi.fn(() => ({ collection: vi.fn(() => recordsCollection) })),
    }));
    vi.spyOn(firestoreApi, 'fsRefreshPublicStats').mockResolvedValue({ updatedAt: new Date() });

    await firestoreApi.fsDeleteLearner('2026-2027', 'LRN-001');

    expect(ref.delete).toHaveBeenCalled();
    expect(recordsCollection.doc).toHaveBeenCalledWith('LRN-001');
  });

  it('throws instead of silently no-oping when the learner document no longer exists', async () => {
    const ref = { get: vi.fn().mockResolvedValue({ exists: false, data: () => undefined }), delete: vi.fn().mockResolvedValue(undefined) };
    const recordsCollection = { doc: vi.fn(() => ref) };
    mockDb.collection.mockImplementation(() => ({
      doc: vi.fn(() => ({ collection: vi.fn(() => recordsCollection) })),
    }));

    await expect(firestoreApi.fsDeleteLearner('2026-2027', 'LRN-404')).rejects.toThrow();
    expect(ref.delete).not.toHaveBeenCalled();
  });

  it('uses the stored profile role instead of leaving the role as "Loading role…"', async () => {
    document.body.innerHTML = `
      <div id="sidebarMount"></div>
      <div id="topbarMount"></div>
      <div class="main-area"></div>
    `;
    sessionStorage.setItem('lps_user_profile', JSON.stringify({ email: 'admin@school.test', uid: 'user-123', role: 'School Admin' }));

    const { renderShell } = await import('./shell');
    renderShell('dashboard', 'Dashboard');

    expect(document.getElementById('topbarRole')?.textContent).toBe('School Admin');
  });

  it('prefers the real Firestore profile name and admin role over the email-based fallback', async () => {
    document.body.innerHTML = `
      <div id="sidebarMount"></div>
      <div id="topbarMount"></div>
      <div class="main-area"></div>
    `;
    sessionStorage.setItem('lps_user_profile', JSON.stringify({
      email: 'admin@school.test',
      uid: 'user-123',
      name: 'Example Admin',
      role: 'School Admin',
    }));

    const { renderShell } = await import('./shell');
    renderShell('dashboard', 'Dashboard');

    expect(document.querySelector('.topbar-user-text .name')?.textContent).toBe('Example Admin');
    expect(document.getElementById('topbarRole')?.textContent).toBe('School Admin');
    expect(document.querySelector('.account-menu-heading strong')?.textContent).toBe('Example Admin');
  });

  it('prefers the real Firestore role over a stale cached School Staff role when updating the username', async () => {
    const { buildUpdatedProfile } = await import('./shell');

    const profile = buildUpdatedProfile(
      { email: 'admin@school.test', uid: 'user-123', role: 'School Staff', name: 'Old Name' },
      { email: 'admin@school.test', uid: 'user-123', role: 'School Admin', name: 'Example Admin' },
      { name: 'Example Admin' }
    );

    expect(profile.role).toBe('School Admin');
    expect(profile.name).toBe('Example Admin');
  });
});

describe('learner name formatting', () => {
  it('capitalizes each word in parent or guardian names', () => {
    expect(sentenceCaseName('DELA CRUZ, JUAN')).toBe('Dela Cruz, Juan');
  });
});

describe('credential / role resolution', () => {
  const defaultCollection = () => ({ doc: vi.fn(() => ({ get: vi.fn() })) });

  beforeEach(() => {
    mockAuth.currentUser = null;
    mockAuth.onAuthStateChanged.mockImplementation(() => undefined);
    mockDb.collection.mockImplementation(defaultCollection);
  });

  it('keeps the Firestore override wired onto the shared LPSApi credentials path', async () => {
    const { LPSApi } = await import('./sheets-api');
    // auth.ts now loads firestore-api everywhere (even the login page), so the
    // credential lookup used by requireAuth/renderShell must be the Firestore
    // implementation — never the Sheets one that fails with an empty URL.
    expect(LPSApi.getMyProfile).toBe(firestoreApi.fsGetMyProfile);
  });

  it('resolves the profile from the passed Firebase user before auth restore', async () => {
    const docMock = {
      exists: true,
      id: 'user-123',
      data: () => ({ name: 'Example Admin', email: 'admin@school.test', role: 'School Admin', status: 'Active' }),
    };
    mockDb.collection.mockImplementation(() => ({
      doc: vi.fn(() => ({ get: vi.fn().mockResolvedValue(docMock) })),
    }));

    const profile = await firestoreApi.fsGetMyProfile({ uid: 'user-123', email: 'admin@school.test' });

    expect(profile.role).toBe('School Admin');
    expect(profile.uid).toBe('user-123');
    expect(profile.name).toBe('Example Admin');
    // No "Not signed in." even though firebase.auth().currentUser is null.
    expect(mockAuth.currentUser).toBeNull();
  });

  it('shows "Visitor" for a signed-in user with no Firestore profile document yet', async () => {
    mockDb.collection.mockImplementation(() => ({
      doc: vi.fn(() => ({ get: vi.fn().mockResolvedValue({ exists: false, id: 'brand-new-1', data: () => undefined }) })),
    }));

    const profile = await firestoreApi.fsGetMyProfile({ uid: 'brand-new-1', email: 'new.teacher@school.test' });

    expect(profile.role).toBe('Visitor');
  });

  it('keeps the stored role instead of flipping to "Role unavailable" when the fetch fails', async () => {
    document.body.innerHTML = `
      <div id="sidebarMount"></div>
      <div id="topbarMount"></div>
      <div class="main-area"></div>
    `;
    sessionStorage.setItem('lps_user_profile', JSON.stringify({ email: 'admin@school.test', uid: 'user-123', role: 'School Admin' }));
    // No currentUser and no passed user -> fsGetMyProfile throws -> the shell
    // must keep showing the role we already resolved, never the dead-end label.
    mockAuth.currentUser = null;

    const { renderShell } = await import('./shell');
    renderShell('dashboard', 'Dashboard');
    await new Promise((resolve) => setTimeout(resolve, 5));

    expect(document.getElementById('topbarRole')?.textContent).toBe('School Admin');
    expect(document.getElementById('topbarRole')?.textContent).not.toBe('Role unavailable');
  });

  it('recovers the role once the Firebase session finishes restoring', async () => {
    document.body.innerHTML = `
      <div id="sidebarMount"></div>
      <div id="topbarMount"></div>
      <div class="main-area"></div>
    `;
    // Fresh login: the session has no role yet and the auth session has not
    // been restored, so the first fetch fails. The shell must subscribe to the
    // auth state and retry instead of leaving "Role unavailable" forever.
    sessionStorage.setItem('lps_user_profile', JSON.stringify({ email: 'admin@school.test', uid: 'retry-user-9' }));
    mockAuth.currentUser = null;
    mockAuth.onAuthStateChanged.mockImplementation((callback) => {
      Promise.resolve().then(() => callback({ uid: 'retry-user-9', email: 'admin@school.test' }));
      return () => {};
    });
    mockDb.collection.mockImplementation(() => ({
      doc: vi.fn(() => ({
        get: vi.fn().mockResolvedValue({
          exists: true,
          id: 'retry-user-9',
          data: () => ({ name: 'Retry Admin', email: 'admin@school.test', role: 'School Admin', status: 'Active' }),
        }),
      })),
    }));

    const { renderShell } = await import('./shell');
    renderShell('dashboard', 'Dashboard');
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(document.getElementById('topbarRole')?.textContent).toBe('School Admin');
    // The resolved role must be persisted so later page loads show it instantly.
    expect(JSON.parse(sessionStorage.getItem('lps_user_profile') || '{}').role).toBe('School Admin');
  });
});

describe('login page theme independence', () => {
  it('keeps the login page light even when a dark theme is applied to the document', async () => {
    // Simulate the state a dark-mode user would have: the inline index.html
    // scripts (or a previous authenticated page) added these classes.
    document.body.classList.add('dark-mode');
    document.documentElement.classList.add('dark-mode-preload');

    const { forceLoginPageLightTheme } = await import('./auth');
    forceLoginPageLightTheme();

    expect(document.body.classList.contains('dark-mode')).toBe(false);
    expect(document.documentElement.classList.contains('dark-mode-preload')).toBe(false);
  });

  it('leaves the saved dark preference untouched so dashboards still use it', async () => {
    localStorage.setItem('lps_theme', 'dark');

    const { forceLoginPageLightTheme } = await import('./auth');
    forceLoginPageLightTheme();

    expect(localStorage.getItem('lps_theme')).toBe('dark');
  });
});
