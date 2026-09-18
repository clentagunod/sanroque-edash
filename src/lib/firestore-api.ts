// @ts-nocheck -- ported from the original site; behavior preserved, not yet fully typed.
import { LPSApi } from './sheets-api';
import { displayNameFromEmail } from './auth';
import { PROGRAM_FIELD_MAP } from './learner-list';
import { auth, db, getUserCreationAuth, userCreationAuth } from './firebase';
import { appRole, appSessionId, isTeacher, isVisitorSession, setAppUserProfile, storedAppProfile } from './app-config';
import { LPSCache } from './cache';

/**
 * ============================================================================
 * FIRESTORE-API.JS
 * ============================================================================
 * The live-data counterpart to sheets-api.js. Loaded AFTER sheets-api.js on
 * every page, so it can override specific LPSApi methods with a Firestore
 * implementation while everything else keeps working against Google Sheets
 * until Phase 2 migrates it. No other file needs to change for the parts
 * covered here — pages keep calling `LPSApi.getUsers()`, etc.
 *
 * WHAT LIVES IN FIRESTORE (this file):
 *   - users            → accounts, roles, status (see README Part 2)
 *   - schoolYears       → { label, isCurrent }
 *   - sections          → { schoolYear, gradeLevel, section, adviser }
 *   - settings          → key/value app settings (e.g. currentSchoolYear)
 *   - Learners/{year}/records/{lrn}
 *   - Dropouts/{year}/records/{lrn}
 *   - TransferredOut/{year}/records/{lrn}
 *
 * WHAT STAYS OUTSIDE FIRESTORE:
 *   - AuditLog   (apps-script/AuditLog.gs)
 *   - Feedback   (apps-script/Feedback.gs)
 *
 * Firestore Security Rules (firestore.rules) are the real access control —
 * this file assumes a signed-in Firebase user and lets the rules reject
 * anything a role shouldn't be able to do.
 * ============================================================================
 */

export const FS_USERS = "users";
export const FS_SCHOOL_YEARS = "schoolYears";
export const FS_SECTIONS = "Sections";
export const FS_SETTINGS = "settings";
export const FS_LEARNERS = "Learners";
export const FS_DROPOUTS = "Dropouts";
export const FS_TRANSFERRED_OUT = "TransferredOut";
export const FS_ADVISORY = "advisory";
export const FS_LEARNER_FIELD_ORDER = [
  "firstName", "lastName", "middleName", "age", "birthDate", "learnerId", "name", "gradeLevel", "section", "gender",
  "guardian", "contact", "enrollmentStatus", "eosyStatus", "schoolYear", "dateAdded", "is4Ps", "isIP", "isSNED", "isARAL", "isMuslim",
  "bosyHeight", "bosyWeight", "bosyNutritionalStatus", "mosyHeight", "mosyWeight", "mosyNutritionalStatus", "eosyHeight", "eosyWeight", "eosyNutritionalStatus",
  "bosyCRLA", "mosyCRLA", "eosyCRLA", "bosyPhilIRI", "mosyPhilIRI", "eosyPhilIRI", "bosyRMA", "mosyRMA", "eosyRMA",
  "filipino", "english", "math", "science", "aralPan", "esp", "music", "arts", "pe", "health", "epp", "motherTongue",
  "transferType", "transferIn", "transferOut", "transferSchool", "transferDate", "transferReason", "transferNotes", "extra",
];

export function fsCanonicalLearner_(learner) {
  const result = {};
  FS_LEARNER_FIELD_ORDER.forEach((field) => { result[field] = learner[field] ?? (field === "extra" ? {} : ""); });
  return result;
}

export function fsLearnersCollection_(schoolYear) {
  const year = String(schoolYear || "").trim();
  if (!year) throw new Error("A school year is required to read learner records.");
  return db.collection(FS_LEARNERS).doc(year).collection("records");
}

export function fsAdvisoryKey_(value, fallback = "unassigned") {
  const key = fsNormalizeValue_(value).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return key || fallback;
}

export function fsTeacherAssignment_() {
  if (!isTeacher()) return null;
  const profile = storedAppProfile() || {};
  const assignment = profile.teacherAssignment || {};
  const schoolYear = fsNormalizeSchoolYear_(assignment.schoolYear || profile.schoolYear);
  const gradeLevel = fsNormalizeGrade_(assignment.gradeLevel || profile.gradeLevel);
  const section = String(assignment.section || profile.section || "").trim();
  const teacherName = String(assignment.teacherName || profile.name || "").trim();
  const teacherKey = fsAdvisoryKey_(assignment.teacherKey || teacherName);
  return schoolYear && gradeLevel && section && teacherName ? {
    schoolYear, gradeLevel, section, teacherName, teacherKey,
    gradeKey: fsAdvisoryKey_(gradeLevel),
    sectionKey: fsAdvisoryKey_(section),
  } : null;
}

export function fsAdvisoryLearnersCollection_(assignment) {
  return db.collection(FS_ADVISORY).doc(assignment.schoolYear)
    .collection("grades").doc(assignment.gradeKey || fsAdvisoryKey_(assignment.gradeLevel))
    .collection("sections").doc(assignment.sectionKey || fsAdvisoryKey_(assignment.section))
    .collection("teachers").doc(assignment.teacherKey)
    .collection("learners");
}

async function fsDeleteAdvisoryTeacher_(schoolYear, gradeKey, sectionKey, teacherKey) {
  const teacherRef = db.collection(FS_ADVISORY).doc(schoolYear)
    .collection("grades").doc(gradeKey)
    .collection("sections").doc(sectionKey)
    .collection("teachers").doc(teacherKey);
  const learnerSnapshot = await teacherRef.collection("learners").get();
  const refs = [...learnerSnapshot.docs.map((doc) => doc.ref), teacherRef];
  for (let index = 0; index < refs.length; index += 450) {
    const batch = db.batch();
    refs.slice(index, index + 450).forEach((ref) => batch.delete(ref));
    await batch.commit();
  }
}

async function fsPopulateAdvisoryTeacher_(target) {
  const learners = await fsGetAllLearners_(target.schoolYear);
  const matchingLearners = learners.filter((learner) => fsIsActiveLearner_(learner)
    && fsNormalizeValue_(fsNormalizeGrade_(learner.gradeLevel)) === fsNormalizeValue_(target.gradeLevel)
    && fsNormalizeValue_(learner.section) === fsNormalizeValue_(target.section));
  for (let index = 0; index < matchingLearners.length; index += 450) {
    const batch = db.batch();
    matchingLearners.slice(index, index + 450).forEach((learner) => batch.set(
      fsAdvisoryLearnersCollection_(target).doc(String(learner.learnerId)),
      { ...learner, advisoryTeacher: target.teacherName, advisoryUpdatedAt: firebase.firestore.FieldValue.serverTimestamp() },
      { merge: true }
    ));
    await batch.commit();
  }
}

export function fsArchiveCollection_(archive, schoolYear) {
  const year = String(schoolYear || "").trim();
  if (!year) throw new Error("A school year is required to read archived learner records.");
  const root = String(archive || "").toLowerCase() === "dropout" ? FS_DROPOUTS : FS_TRANSFERRED_OUT;
  return db.collection(root).doc(year).collection("records");
}

export function fsError_(context, error) {
  console.error(context, error);
  if (error && error.code === "permission-denied") {
    return new Error("You don't have permission to do that. Contact your school admin if this seems wrong.");
  }
  return new Error(error && error.message ? error.message : `${context} failed.`);
}

export function fsInvalidateReadCaches_(schoolYear = "") {
  if (typeof LPSCache === "undefined") return;
  LPSCache.clear("firestore_learners_");
  LPSCache.clear("firestore_advisory_");
  LPSCache.clear("firestore_sections_");
  LPSCache.clear("firestore_profile_");
  LPSCache.remove("firestore_public_stats");
  LPSCache.remove("firestore_users");
  LPSCache.remove("firestore_school_years");
  if (schoolYear) LPSCache.remove(`firestore_learners_${schoolYear}`);
}

/** Best-effort audit log write to the existing Sheets-backed AuditLog. Never blocks the caller. */
export function fsAudit_(action, details) {
  if (typeof LPSApi !== "undefined" && LPSApi.recordAuditEvent) {
    LPSApi.recordAuditEvent(action, { ipSession: typeof appSessionId === "function" ? appSessionId() : "", ...details }).catch(() => {});
  }
}

/* ---------------------------------------------------------------------------
 * SHARED LIVE DATA REGISTRY
 * ---------------------------------------------------------------------------
 * One Firestore onSnapshot per (collection, year) is shared by every page and
 * subscriber in this tab, so ten pages watching the same learners year use ONE
 * listener instead of ten separate query streams.
 *
 * Every snapshot:
 *   1. is kept in memory (fsLiveData_) so one-shot readers (fsGetLearners,
 *      fsGetSections, fsGetUsers, publicStats, school years) return instantly
 *      instead of issuing their own redundant query, and
 *   2. seeds the shared LPSCache so a brand-new page load renders the freshest
 *      data already seen this session and then receives push updates.
 *
 * Subscriptions are ref-counted: the underlying listener is torn down only
 * when the last subscriber unsubscribes. A new subscriber immediately receives
 * the latest snapshot (fast first paint, then live updates).
 * ------------------------------------------------------------------------- */

const fsLiveStores_ = new Map();

function fsLiveKey_(kind, id) {
  return `${kind}${id || id === 0 ? `|${String(id).trim()}` : ""}`;
}

function fsLiveData_(kind, id) {
  const entry = fsLiveStores_.get(fsLiveKey_(kind, id));
  return entry ? entry.data : null;
}

function fsLiveSet_(key, data, cacheKey) {
  const entry = fsLiveStores_.get(key);
  if (!entry) return;
  entry.data = data;
  if (cacheKey && typeof LPSCache !== "undefined" && typeof LPSCache.write === "function") {
    try { LPSCache.write(cacheKey, data, 600000); } catch (error) { /* Seeding the cache is optional. */ }
  }
  entry.listeners.forEach((listener) => {
    try { listener(data); } catch (error) { /* A renderer must never break the store. */ }
  });
}

function fsLiveError_(key, error) {
  const entry = fsLiveStores_.get(key);
  if (!entry) return;
  entry.onErrors.forEach((listener) => {
    try { listener(error); } catch (e) { /* Ignore viewer errors. */ }
  });
}

function fsSubscribeLive_(key, startListener, onChange, onError) {
  let entry = fsLiveStores_.get(key);
  if (!entry) {
    entry = { data: null, listeners: new Set(), onErrors: new Set(), unsub: null, started: false };
    fsLiveStores_.set(key, entry);
  }
  if (!entry.started) {
    entry.started = true;
    try { entry.unsub = startListener(key); }
    catch (error) { fsLiveError_(key, error); }
  }
  if (typeof onChange === "function") entry.listeners.add(onChange);
  if (typeof onError === "function") entry.onErrors.add(onError);
  if (entry.data !== null && typeof onChange === "function") {
    try { onChange(entry.data); } catch (error) { /* Already rendered? Ignore replays. */ }
  }
  return () => {
    if (typeof onChange === "function") entry.listeners.delete(onChange);
    if (typeof onError === "function") entry.onErrors.delete(onError);
    if (entry.listeners.size === 0 && entry.onErrors.size === 0) {
      if (entry.unsub) { try { entry.unsub(); } catch (error) { /* Ignore teardown errors. */ } }
      fsLiveStores_.delete(key);
    }
  };
}

function fsSubscribeLiveLearners_(schoolYear, onChange, onError) {
  const assignment = fsTeacherAssignment_();
  const advisoryRead = assignment && assignment.schoolYear === fsNormalizeSchoolYear_(schoolYear);
  const key = fsLiveKey_(advisoryRead ? "advisory-learners" : "learners", advisoryRead ? `${schoolYear}|${assignment.teacherKey}` : schoolYear);
  const collection = advisoryRead ? fsAdvisoryLearnersCollection_(assignment) : fsLearnersCollection_(schoolYear);
  return fsSubscribeLive_(key, () =>
    collection.onSnapshot(
      (snapshot) => fsLiveSet_(key, snapshot.docs.map((doc) => ({ learnerId: doc.id, ...doc.data() })).filter(fsIsActiveLearner_), `firestore_learners_${schoolYear}`),
      (error) => fsLiveError_(key, fsError_("Live learner updates", error))
    ), onChange, onError);
}

function fsSubscribeTeacherLearners_(schoolYear, onChange, onError) {
  const userId = String(auth.currentUser?.uid || "").trim();
  if (!userId) return fsSubscribeLiveLearners_(schoolYear, onChange, onError);
  let learnerUnsubscribe = null;
  let stopped = false;
  let activePath = "";
  const userRef = db.collection(FS_USERS).doc(userId);
  const updateProfile = (data) => {
    const current = storedAppProfile() || {};
    const profile = { ...current, ...data, uid: userId, userId };
    setAppUserProfile(profile);
    try { sessionStorage.setItem("lps_user_profile", JSON.stringify(profile)); } catch (error) { /* Ignore unavailable storage. */ }
  };
  const rebind = (data) => {
    updateProfile(data || {});
    const assignment = fsTeacherAssignment_();
    const path = assignment && assignment.schoolYear === fsNormalizeSchoolYear_(schoolYear)
      ? `${assignment.schoolYear}|${assignment.gradeKey}|${assignment.sectionKey}|${assignment.teacherKey}` : "unassigned";
    if (path === activePath) return;
    activePath = path;
    learnerUnsubscribe?.();
    learnerUnsubscribe = null;
    if (stopped) return;
    if (!assignment) {
      if (typeof onChange === "function") onChange([]);
      return;
    }
    learnerUnsubscribe = fsSubscribeLiveLearners_(schoolYear, onChange, onError);
  };
  const userUnsubscribe = userRef.onSnapshot((snapshot) => {
    if (!snapshot.exists) return rebind({});
    rebind({ ...snapshot.data(), userId, uid: userId });
  }, (error) => {
    if (typeof onError === "function") onError(fsError_("Live teacher assignment updates", error));
  });
  return () => {
    stopped = true;
    learnerUnsubscribe?.();
    userUnsubscribe?.();
  };
}

/* ---------------------------------------------------------------------------
 * USERS (fully migrated to Firestore)
 * ------------------------------------------------------------------------- */

/**
 * Reads the signed-in user's own profile from Firestore. Falls back to a
 * "Visitor" profile if no matching document exists yet (e.g. the very first
 * admin, before anyone has added them — see README Part 2, "Bootstrapping
 * the first admin").
 *
 * `user` is optional but recommended: callers that already know who is signed
 * in (e.g. `requireAuth`, which restores the session from storage) should
 * pass that user through. Firestore reads still go out with the SDK's own
 * auth token, but this lets the profile resolve even in the brief window
 * while the Firebase Auth SDK is still restoring the persisted session and
 * `firebase.auth().currentUser` is not set yet.
 */
export async function fsGetMyProfile(user = null) {
  const activeUser = user || firebase.auth().currentUser;
  const userId = String(activeUser?.uid || "").trim();
  if (!activeUser || !userId || userId === "guest") throw new Error("Not signed in.");
  const email = String(activeUser.email || "");
  const load = async () => {
    const doc = await db.collection(FS_USERS).doc(userId).get();
    const fallback = {
      userId,
      uid: userId,
      name: displayNameFromEmail(email),
      email,
      role: "Visitor",
      status: "Active",
    };
    if (!doc.exists) return fallback;
    const data = doc.data() || {};
    return {
      userId: doc.id || userId,
      ...data,
      uid: userId,
      email: data.email || email,
      name: data.name || displayNameFromEmail(email),
      role: data.role || "Visitor",
      status: data.status || "Active",
    };
  };
  return load();
}

export async function fsGetUsers() {
  // A live snapshot already in memory is fresher than any cache entry — use it.
  const live = fsLiveData_("users", "");
  if (Array.isArray(live)) return live;
  const load = async () => {
    const snapshot = await db.collection(FS_USERS).orderBy("name").get();
    return snapshot.docs.map((doc) => ({ userId: doc.id, ...doc.data() }));
  };
  return typeof LPSCache === "undefined" ? load() : LPSCache.getOrLoad("firestore_users", load, 30000, 120000);
}

export async function fsAddUser(record) {
  let createdUser = null;
  let creationAuth = null;
  try {
    const email = String(record.email || "").trim();
    const password = String(record.password || "");
    if (!email || password.length < 6) throw new Error("A valid email and a password of at least 6 characters are required.");
    creationAuth = getUserCreationAuth();
    await creationAuth.setPersistence(firebase.auth.Auth.Persistence.NONE);
    const credential = await creationAuth.createUserWithEmailAndPassword(email, password);
    createdUser = credential.user;
    const userId = createdUser.uid;
    await db.collection(FS_USERS).doc(userId).set({
      name: record.name,
      email,
      role: record.role,
      status: record.status || "Invited",
      teacherAssignment: record.role === "Teacher" ? record.teacherAssignment : null,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    await fsRefreshTeacherAdvisory_(null, { ...record, role: record.role, status: record.status || "Invited", teacherAssignment: record.teacherAssignment }, userId);
    try { await creationAuth.signOut(); } catch (signOutError) { /* Secondary auth cleanup is best effort. */ }
    fsInvalidateReadCaches_();
    fsAudit_("USER_ADD", { sheet: "users", recordId: userId, newValue: JSON.stringify({ name: record.name, email, role: record.role, status: record.status || "Invited" }) });
    return { userId };
  } catch (error) {
    if (createdUser) {
      try { await createdUser.delete(); } catch (deleteError) { console.error("Could not roll back Firebase user creation.", deleteError); }
    }
    try { await creationAuth?.signOut(); } catch (signOutError) { /* Preserve the original error. */ }
    if (error.code === "auth/email-already-in-use") throw new Error("That email already has a Firebase Authentication account.");
    if (error.code === "auth/weak-password") throw new Error("Firebase requires a stronger password.");
    throw fsError_("Add user", error);
  }
}

export async function fsUpdateUser(userId, record) {
  try {
    const ref = db.collection(FS_USERS).doc(userId);
    const before = await ref.get();
    await ref.set({ name: record.name, email: record.email, role: record.role, status: record.status, teacherAssignment: record.role === "Teacher" ? record.teacherAssignment : null }, { merge: true });
    await fsRefreshTeacherAdvisory_(before.exists ? before.data() : null, { ...record, teacherAssignment: record.role === "Teacher" ? record.teacherAssignment : null }, userId);
    fsInvalidateReadCaches_();
    fsAudit_("USER_UPDATE", {
      sheet: "users", recordId: userId,
      oldValue: before.exists ? JSON.stringify(before.data()) : "",
      newValue: JSON.stringify(record),
    });
    return { updated: true };
  } catch (error) {
    throw fsError_("Update user", error);
  }
}

function fsTeacherTargetFromUser_(user, userId) {
  const assignment = user?.teacherAssignment || {};
  if (user?.role !== "Teacher" || user?.status !== "Active" || !assignment.schoolYear || !assignment.gradeLevel || !assignment.section) return null;
  const teacherName = String(assignment.teacherName || user.name || "").trim();
  if (!teacherName) return null;
  return {
    schoolYear: fsNormalizeSchoolYear_(assignment.schoolYear),
    gradeLevel: fsNormalizeGrade_(assignment.gradeLevel),
    section: String(assignment.section).trim(),
    teacherName,
    teacherKey: fsAdvisoryKey_(assignment.teacherKey || teacherName || userId),
    gradeKey: fsAdvisoryKey_(fsNormalizeGrade_(assignment.gradeLevel)),
    sectionKey: fsAdvisoryKey_(String(assignment.section).trim()),
  };
}

async function fsRefreshTeacherAdvisory_(beforeUser, afterUser, userId) {
  const oldTarget = fsTeacherTargetFromUser_(beforeUser, userId);
  const newTarget = fsTeacherTargetFromUser_(afterUser, userId);
  const targets = [oldTarget, newTarget].filter(Boolean).filter((target, index, all) => all.findIndex((item) => item.schoolYear === target.schoolYear && item.teacherKey === target.teacherKey) === index);
  if (!targets.length) return;
  const years = [...new Set(targets.map((target) => target.schoolYear))];
  const learnersByYear = await Promise.all(years.map(async (year) => [year, await fsGetAllLearners_(year)]));
  const learners = new Map(learnersByYear);
  const maxBatchWrites = 450;
  let batch = db.batch();
  let writes = 0;
  const commitBatch = async () => {
    if (!writes) return;
    await batch.commit();
    batch = db.batch();
    writes = 0;
  };
  const sameTarget = (left, right) => left && right
    && left.schoolYear === right.schoolYear
    && left.gradeKey === right.gradeKey
    && left.sectionKey === right.sectionKey
    && left.teacherKey === right.teacherKey;
  if (newTarget) {
    const yearRef = db.collection(FS_SECTIONS).doc(newTarget.schoolYear);
    const gradeRef = yearRef.collection("grades").doc(newTarget.gradeKey);
    const sectionRef = gradeRef.collection("sections").doc(newTarget.sectionKey);
    const metadata = {
      schoolYear: newTarget.schoolYear,
      gradeLevel: newTarget.gradeLevel,
      section: newTarget.section,
      teacherName: newTarget.teacherName,
      adviser: newTarget.teacherName,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    };
    [
      [yearRef, { schoolYear: newTarget.schoolYear, structureVersion: 1, updatedAt: firebase.firestore.FieldValue.serverTimestamp() }],
      [gradeRef, { schoolYear: newTarget.schoolYear, gradeLevel: newTarget.gradeLevel, updatedAt: firebase.firestore.FieldValue.serverTimestamp() }],
      [sectionRef, { schoolYear: newTarget.schoolYear, gradeLevel: newTarget.gradeLevel, section: newTarget.section, updatedAt: firebase.firestore.FieldValue.serverTimestamp() }],
      [sectionRef.collection("teachers").doc(newTarget.teacherKey), metadata],
      [yearRef.collection("directory").doc(`${newTarget.gradeKey}-${newTarget.sectionKey}-${newTarget.teacherKey}`), metadata],
    ].forEach(([ref, value]) => {
      batch.set(ref, value, { merge: true });
      writes += 1;
    });
  }
  for (const target of targets) {
    if (!sameTarget(target, newTarget)) continue;
    const targetLearners = (learners.get(target.schoolYear) || []).filter((learner) => fsIsActiveLearner_(learner)
      && fsNormalizeValue_(fsNormalizeGrade_(learner.gradeLevel)) === fsNormalizeValue_(fsNormalizeGrade_(target.gradeLevel))
      && fsNormalizeValue_(learner.section) === fsNormalizeValue_(target.section));
    for (const learner of targetLearners) {
      if (writes >= maxBatchWrites) await commitBatch();
      batch.set(fsAdvisoryLearnersCollection_(target).doc(String(learner.learnerId)), {
        ...learner,
        advisoryTeacher: target.teacherName,
        advisoryUpdatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
      writes += 1;
    }
  }
  await commitBatch();
  fsInvalidateReadCaches_();
}

export async function fsUpdateMyProfileName(name) {
  const user = firebase.auth().currentUser;
  const value = String(name || "").trim();
  if (!user) throw new Error("Not signed in.");
  if (value.length < 2) throw new Error("Username must be at least 2 characters.");
  if (value.length > 80) throw new Error("Username must be 80 characters or fewer.");
  try {
    const ref = db.collection(FS_USERS).doc(user.uid);
    const before = await ref.get();
    await ref.update({ name: value });
    fsInvalidateReadCaches_();
    const merged = { ...(before.exists ? before.data() : {}), name: value, email: user.email || before.data()?.email || "", uid: user.uid || before.id, role: before.data()?.role || "School Staff" };
    fsAudit_("USER_UPDATE", { sheet: "users", recordId: user.uid, newValue: JSON.stringify(merged) });
    return merged;
  } catch (error) {
    throw fsError_("Update username", error);
  }
}

export async function fsDeleteUser(userId) {
  try {
    await LPSApi.deleteAuthUsers([userId]);
    await db.collection(FS_USERS).doc(userId).delete();
    fsInvalidateReadCaches_();
    fsAudit_("USER_DELETE", { sheet: "users", recordId: userId });
    return { deleted: true };
  } catch (error) {
    throw fsError_("Remove user", error);
  }
}

export async function fsDeleteUsers(userIds) {
  try {
    await LPSApi.deleteAuthUsers(userIds);
    const batch = db.batch();
    userIds.forEach((id) => batch.delete(db.collection(FS_USERS).doc(id)));
    await batch.commit();
    fsInvalidateReadCaches_();
    fsAudit_("USER_DELETE", { sheet: "users", recordId: userIds.join(", ") });
    return { deleted: userIds.length };
  } catch (error) {
    throw fsError_("Remove users", error);
  }
}

/** Live updates for the Manage Users table — shares one listener per browser tab and seeds the users cache. Returns an unsubscribe function. */
export function fsSubscribeUsers(onChange, onError) {
  const key = fsLiveKey_("users", "");
  return fsSubscribeLive_(key, () =>
    db.collection(FS_USERS).orderBy("name").onSnapshot(
      (snapshot) => fsLiveSet_(key, snapshot.docs.map((doc) => ({ userId: doc.id, ...doc.data() })), "firestore_users"),
      (error) => fsLiveError_(key, fsError_("Live user updates", error))
    ), onChange, onError);
}

// Swap the Sheets-backed implementations for the Firestore-backed ones.
// Every page keeps calling LPSApi.* exactly as before.
//
// This is exposed as an explicit function AND attempted at module load:
// - The module-load attempt covers the common (safe) import order, where
//   sheets-api has already finished evaluating before firestore-api's body
//   runs (e.g. pages that import firestore-api directly).
// - `initFirestoreApi()` is also called from main.tsx once every module has
//   loaded. That guarantees the overrides are installed on the login page
//   too — without dragging firestore-api into auth.ts, which would create a
//   sheets-api → shell → auth → firestore-api → sheets-api circular import
//   where LPSApi may not exist yet and the patch would silently be skipped
//   (or throw) depending on load order.
export function initFirestoreApi() {
  if (typeof LPSApi === "undefined" || typeof LPSApi.getMyProfile !== "function") return;
  LPSApi.getMyProfile = fsGetMyProfile;
  LPSApi.getUsers = fsGetUsers;
  LPSApi.addUser = fsAddUser;
  LPSApi.updateUser = fsUpdateUser;
  LPSApi.updateMyProfileName = fsUpdateMyProfileName;
  LPSApi.deleteUser = fsDeleteUser;
  LPSApi.deleteUsers = fsDeleteUsers;
}

if (typeof LPSApi !== "undefined") {
  try {
    initFirestoreApi();
  } catch (error) {
    // A cycle may still have LPSApi uninitialized; main.tsx calls
    // initFirestoreApi() again once every module has finished loading.
  }
}

/* ---------------------------------------------------------------------------
 * SCHOOL YEARS / SECTIONS / SETTINGS (small, low-write reference data —
 * cheap to keep live in Firestore so every page reflects the current school
 * year instantly instead of waiting on a Sheets round trip)
 * ------------------------------------------------------------------------- */

export async function fsGetSchoolYears() {
  // A live snapshot already in memory is fresher than any cache entry — use it.
  const live = fsLiveData_("schoolYears", "");
  if (Array.isArray(live)) return live;
  const load = async () => {
    const snapshot = await db.collection(FS_SCHOOL_YEARS).get();
    const years = snapshot.docs
      .map((doc) => ({ schoolYear: doc.id, ...doc.data() }))
      .filter((year) => String(year.schoolYear || "").trim())
      .sort((a, b) => fsSchoolYearSortValue_(b.schoolYear) - fsSchoolYearSortValue_(a.schoolYear));
    if (years.length) return years;
    const current = await fsGetSetting("currentSchoolYear");
    return current ? [{ schoolYear: String(current), isCurrent: true }] : [];
  };
  return typeof LPSCache === "undefined" ? load() : LPSCache.getOrLoad("firestore_school_years", load, 30000, 120000);
}

/**
 * Returns the aggregate `publicStats/summary` document, or `null` when it
 * has not been created yet (e.g. a brand-new deployment, or a school year
 * that currently has zero learners and has never triggered a recompute).
 *
 * IMPORTANT: this intentionally never throws for a "not found" doc — a
 * missing aggregate is a normal, valid state (zero learners), not an error.
 * Callers (dashboard, year switcher) must treat `null` as "show zero/empty
 * data", not as a failure. Genuine Firestore errors (network, permissions)
 * still reject the returned promise.
 */
export async function fsGetPublicStats() {
  // A live snapshot already in memory is fresher than any cache entry — use it.
  const live = fsLiveData_("publicStats", "summary");
  if (live) return live;
  const readStats = async () => {
    const snapshot = await db.collection("publicStats").doc("summary").get();
    return snapshot.exists ? snapshot.data() : null;
  };
  if (typeof LPSCache === "undefined") return readStats();
  // A `null` result (no doc yet) must never be cached as a hard failure —
  // getOrLoad() only caches resolved values, so this is safe: the next call
  // will simply check Firestore again instead of being stuck on a stale miss.
  return LPSCache.getOrLoad("firestore_public_stats", readStats, 300000, 3600000);
}

export async function fsGetPublicEnrollmentData() {
  const stats = await fsGetPublicStats();
  return (stats && stats.enrollmentData) || { schoolYear: stats?.schoolYear || "", rows: [], gradeTotals: [], grandTotal: { male: 0, female: 0, total: 0 } };
}

export function fsSubscribePublicStats(onChange, onError) {
  const key = fsLiveKey_("publicStats", "summary");
  return fsSubscribeLive_(key, () =>
    db.collection("publicStats").doc("summary").onSnapshot(
      (snapshot) => fsLiveSet_(key, snapshot.exists ? snapshot.data() : null, "firestore_public_stats"),
      (error) => fsLiveError_(key, fsError_("Live public statistics", error))
    ), onChange, onError);
}

/** Live school-year metadata. Mirrors fsGetSchoolYears' shape (merged with the
 *  `currentSchoolYear` setting) and shares ONE Firestore listener per tab. */
export function fsSubscribeSchoolYears(onChange, onError) {
  const key = fsLiveKey_("schoolYears", "");
  return fsSubscribeLive_(key, () => {
    let years = [];
    let currentSetting = null;
    const emit = () => {
      let merged = [];
      if (years.length) merged = years;
      else if (currentSetting) merged = [{ schoolYear: String(currentSetting), isCurrent: true }];
      fsLiveSet_(key, merged, "firestore_school_years");
    };
    const unsubYears = db.collection(FS_SCHOOL_YEARS).onSnapshot(
      (snapshot) => {
        years = snapshot.docs
          .map((doc) => ({ schoolYear: doc.id, ...doc.data() }))
          .filter((year) => String(year.schoolYear || "").trim())
          .sort((a, b) => fsSchoolYearSortValue_(b.schoolYear) - fsSchoolYearSortValue_(a.schoolYear));
        emit();
      },
      (error) => fsLiveError_(key, fsError_("Live school years", error))
    );
    const unsubSetting = db.collection(FS_SETTINGS).doc("currentSchoolYear").onSnapshot(
      (snapshot) => {
        currentSetting = snapshot.exists ? snapshot.data().value : null;
        emit();
      },
      (error) => fsLiveError_(key, fsError_("Live school years", error))
    );
    return () => { unsubYears(); unsubSetting(); };
  }, onChange, onError);
}

/** Live section directory for a school year — used by the enrollment page. */
export function fsSubscribeSections(schoolYear, onChange, onError) {
  const key = fsLiveKey_("sections", schoolYear);
  return fsSubscribeLive_(key, () => {
    const query = db.collection(FS_SECTIONS).doc(String(schoolYear || "")).collection("directory");
    return query.onSnapshot(
      (snapshot) => fsLiveSet_(key, snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })), `firestore_sections_${schoolYear || "all"}`),
      (error) => fsLiveError_(key, fsError_("Live sections", error))
    );
  }, onChange, onError);
}

export async function fsRefreshPublicStats() {
  const years = await fsGetSchoolYears();
  const current = years.find((year) => year.isCurrent) || years[0];
  const learnersByYear = await Promise.all(years.map((year) => fsGetAllLearners_(year.schoolYear)));
  const learners = current ? learnersByYear[years.findIndex((year) => year.schoolYear === current.schoolYear)] || [] : [];
  const programFields = ["is4Ps", "isIP", "isSNED", "isARAL", "isMuslim"];
  const gradeCounts = {};
  learners.forEach((learner) => {
    const grade = learner.gradeLevel || "—";
    gradeCounts[grade] = (gradeCounts[grade] || 0) + 1;
  });
  const taggedCount = learners.filter((learner) => programFields.some((field) => learner[field])).length;
  const enrollmentData = current ? await fsGetEnrollmentData(current.schoolYear, learners) : { schoolYear: "", rows: [], gradeTotals: [], grandTotal: { male: 0, female: 0, total: 0 } };
  const recentLearners = learners
    .slice()
    .sort((a, b) => fsRecentLearnerSortValue_(b.dateAdded) - fsRecentLearnerSortValue_(a.dateAdded))
    .slice(0, 5)
    .map((learner) => ({ ...learner, dateAdded: fsLearnerDate_(learner.dateAdded) }));
  const stats = {
    totalLearners: learners.length,
    programsTracked: programFields.filter((field) => learners.some((learner) => learner[field])).length,
    fourPsCount: learners.filter((learner) => learner.is4Ps).length,
    ipCount: learners.filter((learner) => learner.isIP).length,
    snedCount: learners.filter((learner) => learner.isSNED).length,
    aralCount: learners.filter((learner) => learner.isARAL).length,
    muslimCount: learners.filter((learner) => learner.isMuslim).length,
    maleCount: learners.filter((learner) => learner.gender === "Male").length,
    femaleCount: learners.filter((learner) => learner.gender === "Female").length,
    notTaggedCount: learners.length - taggedCount,
    gradeLevels: Object.entries(gradeCounts).map(([label, value]) => ({ label, value })),
    recentLearners,
    enrollmentData,
    schoolYear: current?.schoolYear || "",
    syncStatus: current ? "Live" : "Unavailable",
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
  };
  await db.collection("publicStats").doc("summary").set(stats, { merge: true });
  if (typeof LPSCache !== "undefined") LPSCache.write("firestore_public_stats", stats, 300000);
  return stats;
}

export function fsPublicActive_(learner) {
  const enrollmentStatus = String(learner?.enrollmentStatus || "ACTIVE").toUpperCase().replace(/[ -]+/g, "_");
  const eosyStatus = String(learner?.eosyStatus || "").toLowerCase().replace(/[_-]+/g, " ");
  return enrollmentStatus !== "TRANSFERRED_OUT" && enrollmentStatus !== "DROPPED_OUT" && eosyStatus !== "dropped out" && !learner?.transferOut;
}

export function fsPublicMetricDelta_(before, after, field) {
  return Number(Boolean(fsPublicActive_(after) && after?.[field])) - Number(Boolean(fsPublicActive_(before) && before?.[field]));
}

export async function fsUpdatePublicStatsForChange_(schoolYear, before, after) {
  const ref = db.collection("publicStats").doc("summary");
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) return;
    const stats = snapshot.data();
    if (stats.schoolYear && stats.schoolYear !== schoolYear) return;
    const fields = [["is4Ps", "fourPsCount"], ["isIP", "ipCount"], ["isSNED", "snedCount"], ["isARAL", "aralCount"], ["isMuslim", "muslimCount"]];
    const update = {};
    update.totalLearners = Number(stats.totalLearners || 0) + Number(fsPublicActive_(after)) - Number(fsPublicActive_(before));
    update.maleCount = Number(stats.maleCount || 0) + (fsPublicActive_(after) && after?.gender === "Male" ? 1 : 0) - (fsPublicActive_(before) && before?.gender === "Male" ? 1 : 0);
    update.femaleCount = Number(stats.femaleCount || 0) + (fsPublicActive_(after) && after?.gender === "Female" ? 1 : 0) - (fsPublicActive_(before) && before?.gender === "Female" ? 1 : 0);
    fields.forEach(([field, countField]) => { update[countField] = Number(stats[countField] || 0) + fsPublicMetricDelta_(before, after, field); });
    update.notTaggedCount = Math.max(0, update.totalLearners - fields.reduce((count, [, countField]) => count + Number(update[countField] || 0), 0));
    const gradeCounts = Object.fromEntries((stats.gradeLevels || []).map((item) => [item.label, Number(item.value || 0)]));
    if (fsPublicActive_(before) && before?.gradeLevel) gradeCounts[before.gradeLevel] = Math.max(0, (gradeCounts[before.gradeLevel] || 0) - 1);
    if (fsPublicActive_(after) && after?.gradeLevel) gradeCounts[after.gradeLevel] = (gradeCounts[after.gradeLevel] || 0) + 1;
    update.gradeLevels = Object.entries(gradeCounts).filter(([, value]) => value > 0).map(([label, value]) => ({ label, value }));
    const enrollmentData = stats.enrollmentData ? JSON.parse(JSON.stringify(stats.enrollmentData)) : null;
    if (enrollmentData?.rows) {
      const adjustRows = (learner, amount) => {
        if (!fsPublicActive_(learner)) return;
        const row = enrollmentData.rows.find((item) => item.gradeLevel === learner.gradeLevel && item.section === learner.section);
        if (!row) return;
        row[learner.gender === "Male" ? "male" : "female"] = Math.max(0, Number(row[learner.gender === "Male" ? "male" : "female"] || 0) + amount);
        row.total = Math.max(0, Number(row.total || 0) + amount);
      };
      adjustRows(before, -1);
      adjustRows(after, 1);
      enrollmentData.grandTotal = enrollmentData.rows.reduce((total, row) => ({ male: total.male + Number(row.male || 0), female: total.female + Number(row.female || 0), total: total.total + Number(row.total || 0) }), { male: 0, female: 0, total: 0 });
      update.enrollmentData = enrollmentData;
    }
    update.updatedAt = firebase.firestore.FieldValue.serverTimestamp();
    transaction.set(ref, update, { merge: true });
  });
  if (typeof LPSCache !== "undefined") LPSCache.remove("firestore_public_stats");
}

export function fsSchoolYearSortValue_(value) {
  const match = String(value || "").match(/(\d{4})\D+(\d{4})/);
  return match ? Number(match[1]) * 10000 + Number(match[2]) : 0;
}

export function fsNormalizeSchoolYear_(value) {
  const text = String(value || "").trim().replace(/[–—]/g, "-").replace(/\s+/g, "");
  const match = text.match(/^(\d{4})[-/]?(\d{4})$/);
  return match ? `${match[1]}-${match[2]}` : String(value || "").trim();
}

export async function fsCreateSchoolYear(schoolYear, makeCurrent = false, copyFromYear = "") {
  const normalized = fsNormalizeSchoolYear_(schoolYear);
  if (!/^\d{4}-\d{4}$/.test(normalized)) throw new Error("School year must use the format YYYY-YYYY.");
  const existing = await db.collection(FS_SCHOOL_YEARS).doc(normalized).get();
  if (existing.exists) throw new Error(`School year ${normalized} already exists.`);
  await db.collection(FS_SCHOOL_YEARS).doc(normalized).set({ schoolYear: normalized, isCurrent: Boolean(makeCurrent) }, { merge: true });
  await db.collection(FS_ADVISORY).doc(normalized).set({ schoolYear: normalized, structureVersion: 1, updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
  let copiedSections = 0;
  const currentYear = (await fsGetSchoolYears()).find((year) => year.isCurrent)?.schoolYear || "";
  const sourceYear = fsNormalizeSchoolYear_(copyFromYear || currentYear);
  if (sourceYear && sourceYear !== normalized) {
    const source = await fsGetSections(sourceYear);
    if (source.length) {
      await Promise.all(source.map((section) => fsSaveSection({
        schoolYear: normalized,
        gradeLevel: section.gradeLevel,
        section: section.section,
        adviser: section.adviser || section.teacherName || "",
      })));
      copiedSections = source.length;
    }
  }
  if (makeCurrent) await fsSetCurrentSchoolYear(normalized);
  fsInvalidateReadCaches_();
  return { schoolYear: normalized, isCurrent: Boolean(makeCurrent), copiedSections };
}

export async function fsSetCurrentSchoolYear(schoolYear) {
  const normalized = fsNormalizeSchoolYear_(schoolYear);
  if (!/^\d{4}-\d{4}$/.test(normalized)) throw new Error("School year must use the format YYYY-YYYY.");
  const target = await db.collection(FS_SCHOOL_YEARS).doc(normalized).get();
  if (!target.exists) throw new Error(`School year ${normalized} was not found.`);
  const years = await db.collection(FS_SCHOOL_YEARS).get();
  const batch = db.batch();
  years.docs.forEach((doc) => batch.set(doc.ref, { isCurrent: doc.id === normalized }, { merge: true }));
  batch.set(db.collection(FS_SETTINGS).doc("currentSchoolYear"), { value: normalized }, { merge: true });
  await batch.commit();
  fsInvalidateReadCaches_();
  return { schoolYear: normalized, isCurrent: true };
}

export async function fsGetSections(schoolYear) {
  // A live snapshot already in memory is fresher than any cache entry — use it.
  const live = fsLiveData_("sections", schoolYear);
  if (Array.isArray(live)) return live;
  const load = async () => {
    const years = schoolYear ? [String(schoolYear)] : (await fsGetSchoolYears()).map((year) => year.schoolYear);
    const sections = new Map();
    for (const year of years) {
      const snapshot = await db.collection(FS_SECTIONS).doc(year).collection("directory").get();
      snapshot.docs.forEach((doc) => {
        const data = doc.data();
        const key = fsSectionId_(year, data.gradeLevel, data.section);
        const existing = sections.get(key);
        sections.set(key, existing ? { ...existing, adviser: existing.adviser || data.adviser || data.teacherName || "" } : { ...data, id: fsSectionId_(year, data.gradeLevel, data.section, data.adviser || data.teacherName) });
      });
    }
    return [...sections.values()];
  };
  return typeof LPSCache === "undefined" ? load() : LPSCache.getOrLoad(`firestore_sections_${schoolYear || "all"}`, load, 30000, 120000);
}

export function fsSectionId_(schoolYear, gradeLevel, section, adviser = "") {
  return `${schoolYear}|${fsAdvisoryKey_(gradeLevel)}|${fsAdvisoryKey_(section)}|${fsAdvisoryKey_(adviser || "unassigned")}`;
}

export async function fsSaveSection(section) {
  const schoolYear = fsNormalizeSchoolYear_(section.schoolYear);
  const gradeLevel = fsNormalizeGrade_(section.gradeLevel);
  const sectionName = String(section.section || "").trim();
  const adviser = String(section.adviser || "").trim();
  if (!/^\d{4}-\d{4}$/.test(schoolYear) || !gradeLevel || !sectionName) throw new Error("School year, grade level, and section name are required.");
  const gradeRef = db.collection(FS_SECTIONS).doc(schoolYear).collection("grades").doc(fsAdvisoryKey_(gradeLevel));
  const sectionRef = gradeRef.collection("sections").doc(fsAdvisoryKey_(sectionName));
  const teacherRef = sectionRef.collection("teachers").doc(fsAdvisoryKey_(adviser || "unassigned"));
  const directory = db.collection(FS_SECTIONS).doc(schoolYear).collection("directory");
  if (section.id) {
    const [, oldGradeKey, oldSectionKey, oldTeacherKey] = String(section.id).split("|");
    const newTeacherKey = fsAdvisoryKey_(adviser || "unassigned");
    if (oldGradeKey && oldSectionKey && oldTeacherKey) {
      await fsDeleteAdvisoryTeacher_(schoolYear, oldGradeKey, oldSectionKey, oldTeacherKey);
      const oldSectionRef = db.collection(FS_SECTIONS).doc(schoolYear).collection("grades").doc(oldGradeKey).collection("sections").doc(oldSectionKey);
      if (oldGradeKey !== fsAdvisoryKey_(gradeLevel) || oldSectionKey !== fsAdvisoryKey_(sectionName)) await oldSectionRef.delete();
      await oldSectionRef.collection("teachers").doc(oldTeacherKey).delete();
      await directory.doc(`${oldGradeKey}-${oldSectionKey}-${oldTeacherKey}`).delete();
    }
  }
  await db.collection(FS_SECTIONS).doc(schoolYear).set({ schoolYear, structureVersion: 1, updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
  await gradeRef.set({ schoolYear, gradeLevel, updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
  await sectionRef.set({ schoolYear, gradeLevel, section: sectionName, updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
  if (adviser) {
    await teacherRef.set({ teacherName: adviser, adviser, schoolYear, gradeLevel, section: sectionName, updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
    await directory.doc(`${fsAdvisoryKey_(gradeLevel)}-${fsAdvisoryKey_(sectionName)}-${fsAdvisoryKey_(adviser)}`).set({ teacherName: adviser, adviser, schoolYear, gradeLevel, section: sectionName, updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
    await fsPopulateAdvisoryTeacher_({ schoolYear, gradeLevel, section: sectionName, teacherName: adviser, teacherKey: fsAdvisoryKey_(adviser), gradeKey: fsAdvisoryKey_(gradeLevel), sectionKey: fsAdvisoryKey_(sectionName) });
  } else {
    await directory.doc(`${fsAdvisoryKey_(gradeLevel)}-${fsAdvisoryKey_(sectionName)}-unassigned`).set({ schoolYear, gradeLevel, section: sectionName, updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
  }
  fsInvalidateReadCaches_(schoolYear);
  return { id: `${schoolYear}|${fsAdvisoryKey_(gradeLevel)}|${fsAdvisoryKey_(sectionName)}|${fsAdvisoryKey_(adviser || "unassigned")}`, schoolYear, gradeLevel, section: sectionName, adviser };
}

export async function fsDeleteSection(sectionId) {
  if (!sectionId) throw new Error("A section ID is required.");
  const [schoolYear, gradeKey, sectionKey, teacherKey] = String(sectionId).split("|");
  if (!schoolYear || !gradeKey || !sectionKey || !teacherKey) throw new Error("Invalid section ID.");
  const sectionRef = db.collection(FS_SECTIONS).doc(schoolYear).collection("grades").doc(gradeKey).collection("sections").doc(sectionKey);
  await fsDeleteAdvisoryTeacher_(schoolYear, gradeKey, sectionKey, teacherKey);
  await sectionRef.collection("teachers").doc(teacherKey).delete();
  await sectionRef.delete();
  await db.collection(FS_SECTIONS).doc(schoolYear).collection("directory").doc(`${gradeKey}-${sectionKey}-${teacherKey}`).delete();
  fsInvalidateReadCaches_();
  return { deleted: true };
}

export function fsNormalizeGrade_(value) {
  const text = String(value || "").trim();
  const key = text.toLowerCase().replace(/\s+/g, " ");
  if (["kinder", "kindergarten", "kg", "0"].includes(key)) return "Kinder";
  const match = key.match(/^grade\s*(\d+)$/) || key.match(/^(\d+)$/);
  return match ? `Grade ${match[1]}` : text;
}

export function fsNormalizeValue_(value) {
  return String(value == null ? "" : value).trim().toLowerCase().replace(/\s+/g, " ");
}

export async function fsGetEnrollmentData(schoolYear, learnersOverride = null) {
  const [sections, learners] = await Promise.all([fsGetSections(schoolYear), learnersOverride || fsGetLearners(schoolYear)]);
  const sectionMap = new Map();
  sections.forEach((section) => {
    if (section.schoolYear && fsNormalizeValue_(section.schoolYear) !== fsNormalizeValue_(schoolYear)) return;
    const gradeLevel = fsNormalizeGrade_(section.gradeLevel);
    const sectionName = String(section.section || "").trim();
    if (!gradeLevel || !sectionName) return;
    sectionMap.set(`${fsNormalizeValue_(gradeLevel)}|${fsNormalizeValue_(sectionName)}`, {
      schoolYear,
      gradeLevel,
      section: sectionName,
      adviser: String(section.adviser || section.teacher || "").trim(),
    });
  });
  const counts = new Map();
  learners.forEach((learner) => {
    if (String(learner.enrollmentStatus || "ACTIVE").toUpperCase() === "TRANSFERRED_OUT" || learner.transferOut) return;
    const gradeLevel = fsNormalizeGrade_(learner.gradeLevel);
    const sectionName = String(learner.section || "").trim();
    if (!gradeLevel || !sectionName) return;
    const key = `${fsNormalizeValue_(gradeLevel)}|${fsNormalizeValue_(sectionName)}`;
    const count = counts.get(key) || { male: 0, female: 0, total: 0 };
    count.total += 1;
    if (fsNormalizeValue_(learner.gender) === "male") count.male += 1;
    if (fsNormalizeValue_(learner.gender) === "female") count.female += 1;
    counts.set(key, count);
  });
  const rows = [...sectionMap.entries()].map(([key, section]) => ({ ...section, ...(counts.get(key) || { male: 0, female: 0, total: 0 }) }));
  const gradeOrder = ["Kinder", "Grade 1", "Grade 2", "Grade 3", "Grade 4", "Grade 5", "Grade 6"];
  rows.sort((a, b) => (gradeOrder.indexOf(a.gradeLevel) - gradeOrder.indexOf(b.gradeLevel)) || a.section.localeCompare(b.section));
  const gradeTotals = gradeOrder.map((gradeLevel) => {
    const gradeRows = rows.filter((row) => row.gradeLevel === gradeLevel);
    return {
      gradeLevel,
      male: gradeRows.reduce((sum, row) => sum + row.male, 0),
      female: gradeRows.reduce((sum, row) => sum + row.female, 0),
      total: gradeRows.reduce((sum, row) => sum + row.total, 0),
    };
  }).filter((row) => row.total > 0 || rows.some((item) => item.gradeLevel === row.gradeLevel));
  const grandTotal = gradeTotals.reduce((total, row) => ({
    male: total.male + row.male,
    female: total.female + row.female,
    total: total.total + row.total,
  }), { male: 0, female: 0, total: 0 });
  return { schoolYear, rows, gradeTotals, grandTotal };
}

export async function fsSyncEnrollmentData(schoolYear) {
  const result = await fsGetEnrollmentData(schoolYear);
  return { updated: 0, skipped: result.rows.length, schoolYear: result.schoolYear };
}

export function fsLearnerName_(learner) {
  return learner.name || [learner.firstName, learner.middleName, learner.lastName].filter(Boolean).join(" ").trim();
}

export function fsBmi_(height, weight) {
  const heightMeters = Number(height) / 100;
  const kilograms = Number(weight);
  return heightMeters > 0 && kilograms > 0 ? Math.round((kilograms / (heightMeters * heightMeters)) * 100) / 100 : "";
}

export function fsProfileChange_(learner, fields) {
  const values = fields.map((field) => learner[field]);
  if (!values[0] && !values[1] && !values[2]) return "No change recorded";
  if (values[2] && values[0] && values[2] !== values[0]) return `${values[0]} → ${values[2]}`;
  return "Profile recorded";
}

export async function fsGetNutritionStatus(schoolYear) {
  const learners = await fsGetLearners(schoolYear);
  return learners.map((learner) => ({
    ...learner,
    name: fsLearnerName_(learner),
    bosyBmi: fsBmi_(learner.bosyHeight, learner.bosyWeight),
    mosyBmi: fsBmi_(learner.mosyHeight, learner.mosyWeight),
    eosyBmi: fsBmi_(learner.eosyHeight, learner.eosyWeight),
    heightChange: Number(learner.eosyHeight) && Number(learner.bosyHeight) ? Number(learner.eosyHeight) - Number(learner.bosyHeight) : null,
    weightChange: Number(learner.eosyWeight) && Number(learner.bosyWeight) ? Number(learner.eosyWeight) - Number(learner.bosyWeight) : null,
    statusChange: fsProfileChange_(learner, ["bosyNutritionalStatus", "mosyNutritionalStatus", "eosyNutritionalStatus"]),
  }));
}

export async function fsGetReadingProfiles(schoolYear) {
  const learners = await fsGetLearners(schoolYear);
  return learners.map((learner) => {
    const hasCrla = learner.bosyCRLA || learner.mosyCRLA || learner.eosyCRLA;
    const hasPhilIri = learner.bosyPhilIRI || learner.mosyPhilIRI || learner.eosyPhilIRI;
    const prefix = hasCrla ? "CRLA" : "Phil-IRI";
    const fields = hasCrla ? ["bosyCRLA", "mosyCRLA", "eosyCRLA"] : ["bosyPhilIRI", "mosyPhilIRI", "eosyPhilIRI"];
    return {
      ...learner, name: fsLearnerName_(learner), reference: prefix,
      bosy: learner[fields[0]] || "", mosy: learner[fields[1]] || "", eosy: learner[fields[2]] || "",
      change: fsProfileChange_(learner, fields),
    };
  }).filter((learner) => learner.bosy || learner.mosy || learner.eosy);
}

export async function fsGetMathProfiles(schoolYear) {
  const learners = await fsGetLearners(schoolYear);
  return learners.map((learner) => ({
    ...learner, name: fsLearnerName_(learner),
    bosy: learner.bosyRMA || "", mosy: learner.mosyRMA || "", eosy: learner.eosyRMA || "",
    change: fsProfileChange_(learner, ["bosyRMA", "mosyRMA", "eosyRMA"]),
  })).filter((learner) => learner.bosy || learner.mosy || learner.eosy);
}

export async function fsGetGradesProfiles(schoolYear) {
  const learners = await fsGetLearners(schoolYear);
  return learners.map((learner) => ({ ...learner, name: fsLearnerName_(learner) }));
}

export async function fsGetTransferRecords(schoolYear, type = "all", gradeLevel = "", gender = "") {
  const assignment = fsTeacherAssignment_();
  const [activeSnapshot, archivedSnapshot] = await Promise.all([
    assignment && assignment.schoolYear === fsNormalizeSchoolYear_(schoolYear)
      ? fsAdvisoryLearnersCollection_(assignment).get()
      : fsLearnersCollection_(schoolYear).get(),
    fsArchiveCollection_("transferredOut", schoolYear).get(),
  ]);
  const learners = [
    ...activeSnapshot.docs.map((doc) => ({ learnerId: doc.id, schoolYear, ...doc.data() })),
    ...archivedSnapshot.docs.map((doc) => ({ learnerId: doc.id, schoolYear, ...doc.data() })),
  ];
  const scopedLearners = assignment
    ? learners.filter((learner) => fsNormalizeValue_(learner.gradeLevel) === fsNormalizeValue_(assignment.gradeLevel)
      && fsNormalizeValue_(learner.section) === fsNormalizeValue_(assignment.section))
    : learners;
  const normalizedType = String(type || "all").trim().toLowerCase();
  const requestedType = normalizedType === "in" || normalizedType === "transfer in" ? "Transfer In"
    : normalizedType === "out" || normalizedType === "transfer out" ? "Transfer Out" : "";
  const seen = new Set();
  return scopedLearners.filter((learner) => {
    const transferType = learner.transferType || (learner.transferIn ? "Transfer In" : learner.transferOut ? "Transfer Out" : "");
    const uniqueKey = `${learner.learnerId}|${transferType}`;
    if (!transferType || seen.has(uniqueKey)) return false;
    seen.add(uniqueKey);
    return (!requestedType || transferType === requestedType)
      && (!gradeLevel || fsNormalizeGrade_(learner.gradeLevel) === fsNormalizeGrade_(gradeLevel))
      && (!gender || fsNormalizeValue_(learner.gender) === fsNormalizeValue_(gender));
  }).map((learner) => ({ ...learner, name: fsLearnerName_(learner), transferType: learner.transferType || (learner.transferIn ? "Transfer In" : "Transfer Out") }));
}

export async function fsGetArchiveRecords(archive, schoolYear) {
  const archiveName = String(archive || "").toLowerCase();
  const snapshot = await fsArchiveCollection_(archiveName, schoolYear).get();
  const records = snapshot.docs.map((doc) => ({ learnerId: doc.id, schoolYear, ...doc.data() }));
  const assignment = fsTeacherAssignment_();
  const scopedRecords = assignment
    ? records.filter((record) => fsNormalizeValue_(record.gradeLevel) === fsNormalizeValue_(assignment.gradeLevel)
      && fsNormalizeValue_(record.section) === fsNormalizeValue_(assignment.section))
    : records;
  if (archiveName !== "dropout") return scopedRecords;
  // Compatibility for records tagged before archive transitions were added.
  const activeSnapshot = assignment && assignment.schoolYear === fsNormalizeSchoolYear_(schoolYear)
    ? await fsAdvisoryLearnersCollection_(assignment).get()
    : await fsLearnersCollection_(schoolYear).get();
  const legacyDropouts = activeSnapshot.docs
    .map((doc) => ({ learnerId: doc.id, schoolYear, ...doc.data() }))
    .filter((learner) => fsLearnerArchiveType_(learner) === "dropout");
  const scopedLegacyDropouts = assignment
    ? legacyDropouts.filter((record) => fsNormalizeValue_(record.gradeLevel) === fsNormalizeValue_(assignment.gradeLevel)
      && fsNormalizeValue_(record.section) === fsNormalizeValue_(assignment.section))
    : legacyDropouts;
  const seen = new Set(scopedRecords.map((record) => record.learnerId));
  return scopedRecords.concat(scopedLegacyDropouts.filter((record) => !seen.has(record.learnerId)));
}

export async function fsUpdateArchiveRecord(archive, schoolYear, learnerId, learner) {
  const archiveName = String(archive || "").toLowerCase();
  const collection = archiveName === "learners" ? fsLearnersCollection_(schoolYear) : fsArchiveCollection_(archiveName, schoolYear);
  const ref = collection.doc(learnerId);
  const before = await ref.get();
  if (!before.exists) throw new Error("Archived learner record was not found.");
  const update = { ...fsCanonicalLearner_(learner), schoolYear };
  await ref.set(update, { merge: true });
  fsInvalidateReadCaches_(schoolYear);
  void fsUpdatePublicStatsForChange_(schoolYear, {}, {}).catch(() => {});
  fsAudit_("LEARNER_UPDATE", { sheet: `${archiveName}_${schoolYear}`, recordId: learnerId, oldValue: JSON.stringify(before.data()), newValue: JSON.stringify(learner) });
  return { updated: true };
}

export async function fsDeleteArchiveRecord(archive, schoolYear, learnerId) {
  const archiveName = String(archive || "").toLowerCase();
  if (archiveName === "learners") return fsDeleteLearner(schoolYear, learnerId);
  const collection = fsArchiveCollection_(archiveName, schoolYear);
  const ref = collection.doc(String(learnerId || "").trim());
  try {
    const snapshot = await ref.get();
    if (!snapshot.exists) throw new Error("This archived learner was already removed or could not be found.");
    await ref.delete();
    fsInvalidateReadCaches_(schoolYear);
    await fsRefreshPublicStats();
    fsAudit_("LEARNER_DELETE", { sheet: `${archiveName}_${schoolYear}`, recordId: learnerId, oldValue: JSON.stringify(snapshot.data()) });
    return { deleted: true };
  } catch (error) {
    throw fsError_("Remove archived learner", error);
  }
}

export async function fsGetReportsData(schoolYear) {
  const learners = await fsGetLearners(schoolYear);
  const gradeOrder = ["Kinder", "Grade 1", "Grade 2", "Grade 3", "Grade 4", "Grade 5", "Grade 6"];
  const breakdown = gradeOrder.map((gradeLevel) => {
    const rows = learners.filter((learner) => fsNormalizeGrade_(learner.gradeLevel) === gradeLevel);
    return {
      gradeLevel, total: rows.length, male: rows.filter((row) => row.gender === "Male").length, female: rows.filter((row) => row.gender === "Female").length,
      fourPs: rows.filter((row) => row.is4Ps).length, ip: rows.filter((row) => row.isIP).length, sned: rows.filter((row) => row.isSNED).length,
      aral: rows.filter((row) => row.isARAL).length, muslim: rows.filter((row) => row.isMuslim).length,
    };
  }).filter((row) => row.total);
  const tagged = learners.filter((learner) => learner.is4Ps || learner.isIP || learner.isSNED || learner.isARAL || learner.isMuslim).length;
  return {
    schoolYear, learners: learners.map((learner) => ({ ...learner, name: fsLearnerName_(learner) })), breakdown,
    totalLearners: learners.length, fourPsCount: learners.filter((row) => row.is4Ps).length, ipCount: learners.filter((row) => row.isIP).length,
    snedCount: learners.filter((row) => row.isSNED).length, aralCount: learners.filter((row) => row.isARAL).length, muslimCount: learners.filter((row) => row.isMuslim).length,
    maleCount: learners.filter((row) => row.gender === "Male").length, femaleCount: learners.filter((row) => row.gender === "Female").length,
    notTaggedCount: learners.length - tagged, gradeLevels: breakdown.map((row) => ({ label: row.gradeLevel, value: row.total })),
  };
}

export async function fsGetSetting(key) {
  const doc = await db.collection(FS_SETTINGS).doc(key).get();
  return doc.exists ? doc.data().value : null;
}

if (typeof LPSApi !== "undefined") {
  LPSApi.getPublicStats = fsGetPublicStats;
  LPSApi.getPublicEnrollmentData = fsGetPublicEnrollmentData;
  LPSApi.refreshPublicStats = fsRefreshPublicStats;
  LPSApi.getSchoolYears = fsGetSchoolYears;
  LPSApi.createSchoolYear = fsCreateSchoolYear;
  LPSApi.setCurrentSchoolYear = fsSetCurrentSchoolYear;
  LPSApi.getSections = fsGetSections;
  LPSApi.saveSection = fsSaveSection;
  LPSApi.deleteSection = fsDeleteSection;
  LPSApi.getSetting = fsGetSetting;
  LPSApi.getEnrollmentData = (schoolYear) => isVisitorSession() ? fsGetPublicEnrollmentData() : fsGetEnrollmentData(schoolYear);
  LPSApi.syncEnrollmentData = fsSyncEnrollmentData;
  LPSApi.getNutritionStatus = fsGetNutritionStatus;
  LPSApi.getReadingProfiles = fsGetReadingProfiles;
  LPSApi.getMathProfiles = fsGetMathProfiles;
  LPSApi.getGradesProfiles = fsGetGradesProfiles;
  LPSApi.getTransferRecords = fsGetTransferRecords;
  LPSApi.getReportsData = fsGetReportsData;
  LPSApi.getArchiveRecords = fsGetArchiveRecords;
  LPSApi.updateArchiveRecord = fsUpdateArchiveRecord;
  LPSApi.deleteArchiveRecord = fsDeleteArchiveRecord;
}

/* ---------------------------------------------------------------------------
 * LEARNERS (Phase 2 scaffolding)
 * ------------------------------------------------------------------------- */
// These helpers are ready to use but NOT yet wired into learner-list.js,
// data.js, dashboard.js, etc. — those pages still read/write learners
// through sheets-api.js today. Switching a page over is a matter of
// replacing its LPSApi.getLearners(...)-style calls with the equivalent
// fs* call below, one page at a time. See README.md and SETUP_GUIDE.md,
// Part 5, for the recommended order and a worked example (dashboard.js).

export async function fsGetLearners(schoolYear) {
  const assignment = fsTeacherAssignment_();
  if (assignment && assignment.schoolYear === fsNormalizeSchoolYear_(schoolYear)) {
    const loadAdvisory = async () => {
      const snapshot = await fsAdvisoryLearnersCollection_(assignment).get();
      return snapshot.docs.map((doc) => ({ learnerId: doc.id, ...doc.data() })).filter(fsIsActiveLearner_);
    };
    return typeof LPSCache === "undefined" ? loadAdvisory() : LPSCache.getOrLoad(`firestore_advisory_${schoolYear}_${assignment.teacherKey}`, loadAdvisory, 15000, 60000);
  }
  // A live snapshot already in memory is fresher than any cache entry — use it.
  const live = fsLiveData_("learners", schoolYear);
  if (Array.isArray(live)) return live;
  const load = async () => {
    const snapshot = await fsLearnersCollection_(schoolYear).get();
    return snapshot.docs.map((doc) => ({ learnerId: doc.id, ...doc.data() })).filter(fsIsActiveLearner_);
  };
  return typeof LPSCache === "undefined" ? load() : LPSCache.getOrLoad(`firestore_learners_${schoolYear}`, load, 15000, 60000);
}

export function fsIsActiveLearner_(learner) {
  const enrollmentStatus = String(learner?.enrollmentStatus || "ACTIVE").toUpperCase().replace(/[ -]+/g, "_");
  const eosyStatus = String(learner?.eosyStatus || "").toLowerCase().replace(/[_-]+/g, " ");
  return enrollmentStatus !== "TRANSFERRED_OUT" && enrollmentStatus !== "DROPPED_OUT" && eosyStatus !== "dropped out" && !learner?.transferOut;
}

export function fsLearnerArchiveType_(learner) {
  const enrollmentStatus = String(learner?.enrollmentStatus || "").toUpperCase().replace(/[ -]+/g, "_");
  const eosyStatus = String(learner?.eosyStatus || "").toLowerCase().replace(/[_-]+/g, " ");
  const transferType = String(learner?.transferType || "").trim().toLowerCase();
  if (learner?.transferOut || enrollmentStatus === "TRANSFERRED_OUT" || transferType === "transfer out") return "transferredOut";
  if (enrollmentStatus === "DROPPED_OUT" || eosyStatus === "dropped out") return "dropout";
  return "";
}

export async function fsGetAllLearners_(schoolYear) {
  const snapshot = await fsLearnersCollection_(schoolYear).get();
  return snapshot.docs.map((doc) => {
    const data = doc.data();
    return { ...data, learnerId: doc.id, dateAdded: data.dateAdded || data.createdAt || data.addedAt || "" };
  });
}

export function fsLearnerDate_(value) {
  if (value && typeof value.toDate === "function") return value.toDate().toISOString();
  if (value && typeof value === "object" && Number.isFinite(Number(value.seconds ?? value._seconds))) {
    return new Date(Number(value.seconds ?? value._seconds) * 1000).toISOString();
  }
  return value || "";
}

export async function fsGetLearner(learnerId, schoolYear) {
  const assignment = fsTeacherAssignment_();
  const collection = assignment && assignment.schoolYear === fsNormalizeSchoolYear_(schoolYear)
    ? fsAdvisoryLearnersCollection_(assignment)
    : fsLearnersCollection_(schoolYear);
  const doc = await collection.doc(learnerId).get();
  return doc.exists ? { ...doc.data(), learnerId: doc.id, dateAdded: fsLearnerDate_(doc.data().dateAdded || doc.data().createdAt || doc.data().addedAt) } : null;
}

export async function fsGetLearnerPage(options = {}) {
  const allLearners = (await fsGetLearners(options.schoolYear)).map((learner) => ({
    ...learner,
    dateAdded: fsLearnerDate_(learner.dateAdded || learner.createdAt || learner.addedAt),
  }));
  const query = String(options.search || "").toLowerCase();
  const filtered = allLearners.filter((learner) => {
    const programField = options.program && PROGRAM_FIELD_MAP[options.program];
    return (!query || `${learner.firstName || ""} ${learner.lastName || ""} ${learner.learnerId}`.toLowerCase().includes(query))
      && (!options.gradeLevel || learner.gradeLevel === options.gradeLevel)
      && (!options.gender || learner.gender === options.gender)
      && (!programField || learner[programField]);
  });
  const page = Math.max(1, Number(options.page) || 1);
  const pageSize = Math.min(100, Number(options.pageSize) || 10);
  return { items: filtered.slice((page - 1) * pageSize, page * pageSize), total: filtered.length, page, pageSize };
}

export async function fsGetLearnerSchema(schoolYear) {
  const learners = await fsGetLearners(schoolYear);
  const knownFields = new Set([
    "learnerId", "firstName", "middleName", "lastName", "birthDate", "age", "gradeLevel", "section", "gender",
    "enrollmentStatus", "eosyStatus", "guardian", "contact", "dateAdded", "is4Ps", "isIP", "isSNED", "isARAL", "isMuslim",
    "extra",
  ]);
  const extraFields = new Set();
  learners.forEach((learner) => {
    Object.keys(learner).forEach((field) => { if (!knownFields.has(field)) extraFields.add(field); });
    Object.keys(learner.extra || {}).forEach((field) => extraFields.add(field));
  });
  return { extraFields: [...extraFields] };
}

/** Real-time learner list — the dashboard, masterlist, reports, and data pages
 *  share ONE Firestore listener per school year and update instantly when any
 *  device adds/edits/removes a learner, with no manual refresh. */
export function fsSubscribeLearners(schoolYear, onChange, onError) {
  return isTeacher() ? fsSubscribeTeacherLearners_(schoolYear, onChange, onError) : fsSubscribeLiveLearners_(schoolYear, onChange, onError);
}

function fsRecentLearnerSortValue_(value) {
  if (value && typeof value.toDate === "function") return value.toDate().getTime();
  const time = Date.parse(value || "");
  return Number.isNaN(time) ? 0 : time;
}

export function fsSubscribeRecentLearners(schoolYear, onChange, onError) {
  // Derived from the SAME shared learners store as fsSubscribeLearners — the
  // dashboard no longer needs a second Firestore query for the "recent" list.
  return fsSubscribeLiveLearners_(schoolYear, (learners) => {
    const recent = (learners || []).slice()
      .sort((a, b) => (fsRecentLearnerSortValue_(b.dateAdded || b.createdAt || b.addedAt) - fsRecentLearnerSortValue_(a.dateAdded || a.createdAt || a.addedAt))
        || String(b.learnerId || "").localeCompare(String(a.learnerId || "")))
      .slice(0, 5)
      .map((learner) => ({ ...learner, dateAdded: fsLearnerDate_(learner.dateAdded || learner.createdAt || learner.addedAt) }));
    if (typeof onChange === "function") onChange(recent);
  }, onError);
}

export async function fsAdvisoryTargets_(schoolYear, learner) {
  const gradeLevel = fsNormalizeGrade_(learner?.gradeLevel);
  const section = String(learner?.section || "").trim();
  if (!gradeLevel || !section) return [];
  const [sections, users] = await Promise.all([fsGetSections(schoolYear), fsGetUsers()]);
  const targets = new Map();
  const signedInAssignment = fsTeacherAssignment_();
  if (signedInAssignment && signedInAssignment.schoolYear === fsNormalizeSchoolYear_(schoolYear)
    && fsNormalizeValue_(signedInAssignment.gradeLevel) === fsNormalizeValue_(gradeLevel)
    && fsNormalizeValue_(signedInAssignment.section) === fsNormalizeValue_(section)) {
    return [signedInAssignment];
  }
  sections.filter((item) => fsNormalizeValue_(item.gradeLevel) === fsNormalizeValue_(gradeLevel)
    && fsNormalizeValue_(item.section) === fsNormalizeValue_(section)).forEach((item) => {
    const teacherName = String(item.adviser || item.teacher || "").trim();
    if (teacherName) targets.set(fsAdvisoryKey_(teacherName), { schoolYear, gradeLevel, section, teacherName, teacherKey: fsAdvisoryKey_(teacherName), gradeKey: fsAdvisoryKey_(gradeLevel), sectionKey: fsAdvisoryKey_(section) });
  });
  (users || []).filter((user) => user.role === "Teacher" && user.status === "Active").forEach((user) => {
    const assignment = user.teacherAssignment || {};
    if (fsNormalizeSchoolYear_(assignment.schoolYear) !== fsNormalizeSchoolYear_(schoolYear)
      || fsNormalizeValue_(assignment.gradeLevel) !== fsNormalizeValue_(gradeLevel)
      || fsNormalizeValue_(assignment.section) !== fsNormalizeValue_(section)) return;
    const teacherName = String(assignment.teacherName || user.name || "").trim();
    if (teacherName) targets.set(fsAdvisoryKey_(assignment.teacherKey || teacherName), { schoolYear, gradeLevel, section, teacherName, teacherKey: fsAdvisoryKey_(assignment.teacherKey || teacherName), gradeKey: fsAdvisoryKey_(gradeLevel), sectionKey: fsAdvisoryKey_(section) });
  });
  return [...targets.values()];
}

export async function fsSyncAdvisoryLearner_(batch, schoolYear, learner, previousLearner = null) {
  const currentTargets = fsIsActiveLearner_(learner) ? await fsAdvisoryTargets_(schoolYear, learner) : [];
  const previousTargets = previousLearner ? await fsAdvisoryTargets_(schoolYear, previousLearner) : [];
  const currentKeys = new Set(currentTargets.map((target) => target.teacherKey));
  previousTargets.forEach((target) => {
    if (!currentKeys.has(target.teacherKey)) {
      batch.delete(fsAdvisoryLearnersCollection_(target).doc(String(previousLearner.learnerId)));
    }
  });
  currentTargets.forEach((target) => batch.set(fsAdvisoryLearnersCollection_(target).doc(String(learner.learnerId)), {
    ...learner,
    advisoryTeacher: target.teacherName,
    advisoryUpdatedAt: firebase.firestore.FieldValue.serverTimestamp(),
  }, { merge: true }));
}

export async function fsAddLearner(schoolYear, learner) {
  try {
    const learnerId = String(learner.learnerId || "").trim();
    if (!/^\d{12}$/.test(learnerId)) throw new Error("A valid 12-digit LRN is required.");
    const archiveType = fsLearnerArchiveType_(learner);
    const collection = archiveType ? fsArchiveCollection_(archiveType, schoolYear) : fsLearnersCollection_(schoolYear);
    const ref = collection.doc(learnerId);
    const canonical = { ...fsCanonicalLearner_(learner), learnerId, schoolYear, dateAdded: firebase.firestore.FieldValue.serverTimestamp() };
    if (archiveType) await ref.set(canonical);
    else {
      const batch = db.batch();
      batch.set(ref, canonical);
      await fsSyncAdvisoryLearner_(batch, schoolYear, { ...canonical, learnerId: ref.id });
      await batch.commit();
    }
    fsInvalidateReadCaches_(schoolYear);
    void fsRefreshPublicStats().catch(() => {});
    fsAudit_("LEARNER_ADD", { sheet: archiveType ? `${archiveType}_${schoolYear}` : `learners_${schoolYear}`, recordId: ref.id, newValue: JSON.stringify(learner) });
    return { learnerId: ref.id };
  } catch (error) {
    throw fsError_("Add learner", error);
  }
}

export async function fsUpdateLearner(schoolYear, learnerId, learner) {
  try {
    const ref = fsLearnersCollection_(schoolYear).doc(learnerId);
    const before = await ref.get();
    const update = fsCanonicalLearner_(learner);
    if (!Object.prototype.hasOwnProperty.call(learner, "dateAdded")) delete update.dateAdded;
    const merged = { ...(before.exists ? before.data() : {}), ...update, learnerId, schoolYear };
    const archiveType = fsLearnerArchiveType_(merged);
    if (archiveType) {
      const batch = db.batch();
      batch.set(fsArchiveCollection_(archiveType, schoolYear).doc(learnerId), { ...merged, schoolYear }, { merge: true });
      batch.delete(ref);
      await fsSyncAdvisoryLearner_(batch, schoolYear, null, merged);
      await batch.commit();
    } else {
      const batch = db.batch();
      batch.set(ref, update, { merge: true });
      await fsSyncAdvisoryLearner_(batch, schoolYear, merged, before.exists ? before.data() : null);
      await batch.commit();
    }
    fsInvalidateReadCaches_(schoolYear);
    void fsRefreshPublicStats().catch(() => {});
    fsAudit_("LEARNER_UPDATE", {
      sheet: archiveType ? `${archiveType}_${schoolYear}` : `learners_${schoolYear}`, recordId: learnerId,
      oldValue: before.exists ? JSON.stringify(before.data()) : "",
      newValue: JSON.stringify(learner),
    });
    return { updated: true };
  } catch (error) {
    throw fsError_("Update learner", error);
  }
}

/**
 * Deletes one learner. Signature is always `(schoolYear, learnerId)` —
 * matching every call site (learner-list.ts's confirmDelete, the LPSApi
 * bridge below). A previous version of this function tried to guess which
 * argument was which via regex heuristics; that guesswork silently matched
 * a "YYYY-YYYY" school year as the learner ID (since it didn't fit either
 * heuristic pattern), so it deleted the wrong — usually non-existent —
 * document. Firestore's `.delete()` on a non-existent document succeeds
 * without error, so the UI reported success while nothing was actually
 * removed. Explicit, validated positional arguments avoid that failure
 * mode entirely.
 */
export async function fsDeleteLearner(schoolYear, learnerId) {
  const targetYear = String(schoolYear || "").trim();
  const targetId = String(learnerId || "").trim();
  if (!targetYear) throw new Error("A school year is required to delete a learner.");
  if (!targetId) throw new Error("A learner ID is required to delete a learner.");
  try {
    const ref = fsLearnersCollection_(targetYear).doc(targetId);
    const before = await ref.get();
    if (!before.exists) throw new Error("This learner record was already removed or could not be found.");
    if (typeof db.batch !== "function") {
      await ref.delete();
      fsInvalidateReadCaches_(targetYear);
      return { deleted: true };
    }
    const batch = db.batch();
    batch.delete(ref);
    await fsSyncAdvisoryLearner_(batch, targetYear, null, before.data());
    await batch.commit();
    fsInvalidateReadCaches_(targetYear);
    void fsRefreshPublicStats().catch(() => {});
    fsAudit_("LEARNER_DELETE", { sheet: `learners_${targetYear}`, recordId: targetId, oldValue: JSON.stringify(before.data()) });
    return { deleted: true };
  } catch (error) {
    throw fsError_("Remove learner", error);
  }
}

/** Bulk-deletes learners. Signature is always `(schoolYear, learnerIds)`. */
export async function fsDeleteLearners(schoolYear, learnerIds) {
  const targetYear = String(schoolYear || "").trim();
  const targetIds = Array.isArray(learnerIds) ? learnerIds.map((id) => String(id || "").trim()).filter(Boolean) : [];
  if (!targetYear) throw new Error("A school year is required to delete learners.");
  if (!targetIds.length) throw new Error("At least one learner must be selected.");
  try {
    // Firestore batches cap out at 500 writes; chunk defensively so bulk
    // removal keeps working even for a very large selection.
    const maxBatchWrites = 450;
    let batch = db.batch();
    let batchWrites = 0;
    const commitBatch = async () => {
      if (!batchWrites) return;
      await batch.commit();
      batch = db.batch();
      batchWrites = 0;
    };
    for (const learnerId of targetIds) {
      const ref = fsLearnersCollection_(targetYear).doc(learnerId);
      const snapshot = await ref.get();
      batch.delete(ref);
      batchWrites += 1;
      if (snapshot.exists) {
        const advisoryTargets = await fsAdvisoryTargets_(targetYear, snapshot.data());
        for (const target of advisoryTargets) {
          if (batchWrites >= maxBatchWrites) await commitBatch();
          batch.delete(fsAdvisoryLearnersCollection_(target).doc(learnerId));
          batchWrites += 1;
        }
      }
    }
    await commitBatch();
    fsInvalidateReadCaches_(targetYear);
    void fsRefreshPublicStats().catch(() => {});
    fsAudit_("LEARNER_DELETE", { sheet: `learners_${targetYear}`, recordId: targetIds.join(", ") });
    return { deleted: targetIds.length };
  } catch (error) {
    throw fsError_("Remove learners", error);
  }
}

if (typeof LPSApi !== "undefined") {
  LPSApi.getLearners = fsGetLearnerPage;
  LPSApi.getLearner = fsGetLearner;
  LPSApi.getLearnerSchema = fsGetLearnerSchema;
  LPSApi.getEnrollmentSections = fsGetSections;
  LPSApi.addLearner = (learner, schoolYear) => fsAddLearner(schoolYear, learner);
  LPSApi.updateLearner = (learnerId, learner, schoolYear) => fsUpdateLearner(schoolYear, learnerId, learner);
  LPSApi.deleteLearner = (learnerId, schoolYear) => fsDeleteLearner(schoolYear, learnerId);
  LPSApi.deleteLearners = (learnerIds, schoolYear) => fsDeleteLearners(schoolYear, learnerIds);
  LPSApi.deleteArchiveRecord = (archive, schoolYear, learnerId) => fsDeleteArchiveRecord(archive, schoolYear, learnerId);
}
