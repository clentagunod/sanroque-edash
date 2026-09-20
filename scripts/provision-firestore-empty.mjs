import { applicationDefault, cert, getApps, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { resolve } from "node:path";

function option(name, fallback = "") {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? String(process.argv[index + 1] || "").trim() : fallback;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function normalizeSchoolYear(value) {
  const text = String(value || "").trim();
  const match = text.match(/^(\d{4})[-/ ]?(\d{4})$/);
  return match ? `${match[1]}-${match[2]}` : text || "2026-2027";
}

function normalizeGrade(value) {
  const text = String(value || "").trim();
  const key = text.toLowerCase().replace(/\s+/g, " ");
  if (["kinder", "kindergarten", "kg", "0"].includes(key)) return "Kinder";
  const match = key.match(/^grade\s*(\d+)$/) || key.match(/^(\d+)$/);
  return match ? `Grade ${match[1]}` : text || "Grade 1";
}

function normalizeSection(value) {
  const text = String(value || "").trim();
  return text || "A";
}

function normalizeKey(value, fallback = "unassigned") {
  const key = String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return key || fallback;
}

function assignmentId(gradeLevel, section) {
  return `${normalizeKey(gradeLevel, "grade")}-${normalizeKey(section, "section")}`;
}

function parseAssignments(raw, fallbackSchoolYear) {
  if (!raw) return [];
  return raw
    .split(/[;,]/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [gradeLevel, section] = entry.split(":").map((part) => part.trim());
      if (!gradeLevel || !section) {
        throw new Error(`Invalid teacher assignment '${entry}'. Use format 'Grade 1:A;Grade 5:B'.`);
      }
      return {
        schoolYear: fallbackSchoolYear,
        gradeLevel: normalizeGrade(gradeLevel),
        section: normalizeSection(section),
      };
    });
}

function initializeAdmin(projectId) {
  if (getApps().length) return getFirestore();
  const serviceAccountPath = option("service-account", process.env.GOOGLE_APPLICATION_CREDENTIALS);
  const app = serviceAccountPath
    ? initializeApp({ credential: cert(resolve(serviceAccountPath)), projectId })
    : initializeApp({ credential: applicationDefault(), projectId });
  return getFirestore(app);
}

async function ensureDoc(ref, data) {
  await ref.set(data, { merge: true });
}

async function seedSchoolStructure(db, schoolYear) {
  await ensureDoc(db.collection("users").doc("structure-root"), {
    kind: "system",
    purpose: "database-structure",
    structureOnly: true,
    createdAt: FieldValue.serverTimestamp(),
  });

  await ensureDoc(db.collection("schoolYears").doc(schoolYear), {
    schoolYear,
    isCurrent: true,
    createdAt: FieldValue.serverTimestamp(),
  });

  await ensureDoc(db.collection("settings").doc("currentSchoolYear"), {
    value: schoolYear,
    updatedAt: FieldValue.serverTimestamp(),
  });

  await ensureDoc(db.collection("publicStats").doc("summary"), {
    schoolYear,
    syncStatus: "Ready",
    totalLearners: 0,
    programsTracked: 0,
    fourPsCount: 0,
    ipCount: 0,
    snedCount: 0,
    aralCount: 0,
    muslimCount: 0,
    maleCount: 0,
    femaleCount: 0,
    notTaggedCount: 0,
    gradeLevels: [],
    recentLearners: [],
    enrollmentData: {
      schoolYear,
      rows: [],
      gradeTotals: [],
      grandTotal: { male: 0, female: 0, total: 0 },
    },
    updatedAt: FieldValue.serverTimestamp(),
  });

  await ensureDoc(db.collection("Sections").doc(schoolYear), {
    schoolYear,
    structureVersion: 1,
    createdAt: FieldValue.serverTimestamp(),
  });

  await ensureDoc(db.collection("advisory").doc(schoolYear), {
    schoolYear,
    structureVersion: 1,
    createdAt: FieldValue.serverTimestamp(),
  });

  await ensureDoc(db.collection("Learners").doc(schoolYear), {
    schoolYear,
    createdAt: FieldValue.serverTimestamp(),
  });

  await ensureDoc(db.collection("Dropouts").doc(schoolYear), {
    schoolYear,
    createdAt: FieldValue.serverTimestamp(),
  });

  await ensureDoc(db.collection("TransferredOut").doc(schoolYear), {
    schoolYear,
    createdAt: FieldValue.serverTimestamp(),
  });
}

async function writeTeacherAssignmentIndex(db, schoolYear, teacherUid, teacherName, assignments) {
  const normalizedAssignments = assignments.map((assignment) => ({
    schoolYear,
    gradeLevel: normalizeGrade(assignment.gradeLevel),
    section: normalizeSection(assignment.section),
  }));

  const assignmentsRef = db
    .collection("advisory")
    .doc(schoolYear)
    .collection("users")
    .doc(teacherUid)
    .collection("assignments");

  const existingSnap = await assignmentsRef.get();
  const nextIds = new Set(normalizedAssignments.map((assignment) => assignmentId(assignment.gradeLevel, assignment.section)));

  const batch = db.batch();

  existingSnap.docs.forEach((doc) => {
    if (!nextIds.has(doc.id)) {
      batch.delete(doc.ref);
    }
  });

  normalizedAssignments.forEach((assignment) => {
    const id = assignmentId(assignment.gradeLevel, assignment.section);
    const payload = {
      schoolYear,
      teacherUid,
      teacherName,
      gradeLevel: assignment.gradeLevel,
      section: assignment.section,
      status: "Active",
      updatedAt: FieldValue.serverTimestamp(),
    };

    batch.set(assignmentsRef.doc(id), payload, { merge: true });

    const gradeKey = normalizeKey(assignment.gradeLevel, "grade");
    const sectionKey = normalizeKey(assignment.section, "section");
    batch.set(
      db.collection("Sections").doc(schoolYear).collection("grades").doc(gradeKey).collection("sections").doc(sectionKey).collection("teachers").doc(teacherUid),
      {
        teacherUid,
        teacherName,
        schoolYear,
        gradeLevel: assignment.gradeLevel,
        section: assignment.section,
        status: "Active",
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    batch.set(
      db.collection("Sections").doc(schoolYear).collection("directory").doc(`${gradeKey}-${sectionKey}-${normalizeKey(teacherName, teacherUid)}`),
      {
        teacherUid,
        teacherName,
        schoolYear,
        gradeLevel: assignment.gradeLevel,
        section: assignment.section,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  });

  await batch.commit();

  await db.collection("users").doc(teacherUid).set(
    {
      teacherAssignments: normalizedAssignments,
      teacherAssignment: normalizedAssignments[0] || null,
      role: "Teacher",
      status: "Active",
      name: teacherName,
      email: teacherName.includes("@") ? teacherName : undefined,
    },
    { merge: true }
  );
}

async function seedAdminUser(db, userUid, email, name) {
  await ensureDoc(db.collection("users").doc(userUid), {
    uid: userUid,
    name,
    email,
    role: "School Admin",
    status: "Active",
    createdAt: FieldValue.serverTimestamp(),
    teacherAssignments: [],
    teacherAssignment: null,
  });
}

async function seedTeacherUser(db, userUid, email, name, assignments) {
  const normalizedAssignments = assignments.map((assignment) => ({
    schoolYear: assignment.schoolYear,
    gradeLevel: normalizeGrade(assignment.gradeLevel),
    section: normalizeSection(assignment.section),
  }));

  await ensureDoc(db.collection("users").doc(userUid), {
    uid: userUid,
    name,
    email,
    role: "Teacher",
    status: "Active",
    createdAt: FieldValue.serverTimestamp(),
    teacherAssignments: normalizedAssignments,
    teacherAssignment: normalizedAssignments[0] || null,
  });

  await writeTeacherAssignmentIndex(db, normalizedAssignments[0]?.schoolYear || "2026-2027", userUid, name, normalizedAssignments);
}

async function main() {
  const projectId = option("project", process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT);
  if (!projectId) {
    throw new Error("Missing --project. Example: --project my-firebase-project");
  }

  const structureOnly = hasFlag("structure-only");
  const schoolYear = normalizeSchoolYear(option("school-year", "2026-2027"));
  const adminUid = option("admin-uid", "");
  const adminEmail = option("admin-email", "");
  const adminName = option("admin-name", "School Admin");
  const teacherUid = option("teacher-uid", "");
  const teacherEmail = option("teacher-email", "");
  const teacherName = option("teacher-name", "");
  const teacherAssignmentsRaw = option("teacher-assignments", "");

  const db = initializeAdmin(projectId);

  console.log(`Bootstrapping Firestore for project: ${projectId}`);
  console.log(`School year: ${schoolYear}`);
  console.log(structureOnly ? "Structure-only mode enabled; no seed records will be added." : "Seed mode enabled for app bootstrap.");

  await seedSchoolStructure(db, schoolYear);

  if (adminUid && adminEmail) {
    await seedAdminUser(db, adminUid, adminEmail, adminName);
    console.log(`Admin user created: ${adminName} (${adminUid})`);
  }

  if (!structureOnly && teacherUid && teacherEmail && teacherName && teacherAssignmentsRaw) {
    const assignments = parseAssignments(teacherAssignmentsRaw, schoolYear);
    await seedTeacherUser(db, teacherUid, teacherEmail, teacherName, assignments);
    console.log(`Teacher seeded: ${teacherName} (${teacherUid})`);
    console.log(`Advisory filter entries created for ${assignments.length} grade-section assignments.`);
  }

  console.log("Firestore structure created successfully.");
  console.log("Structure paths:");
  console.log("- users/{uid}");
  console.log("- schoolYears/{schoolYear}");
  console.log("- Sections/{schoolYear}/grades/{grade}/sections/{section}/teachers/{teacherUid}");
  console.log("- advisory/{schoolYear}/users/{teacherUid}/assignments/{grade-section}");
  console.log("- Learners/{schoolYear}/records/{learnerId}");
  console.log("- Dropouts/{schoolYear}/records/{learnerId}");
  console.log("- TransferredOut/{schoolYear}/records/{learnerId}");
  console.log("- settings/currentSchoolYear");
  console.log("- publicStats/summary");
  console.log("User profile remains the source of truth: users/{uid}.teacherAssignments");
}

main().catch((error) => {
  console.error("Firestore bootstrap failed:", error.message);
  process.exitCode = 1;
});
