import { applicationDefault, cert, getApps, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

function option(name, fallback = "") {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? String(process.argv[index + 1] || "").trim() : fallback;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function usage() {
  console.log(`Usage:
  npm run firestore:provision -- --project <firebase-project-id> [options]

Options:
  --school-year <YYYY-YYYY>  Seed a school year document
  --admin-uid <uid>          Seed users/{uid} as School Admin
  --admin-email <email>      Email for the seeded admin profile
  --admin-name <name>        Name for the seeded admin profile
  --sync-advisory             Build advisory records from learners and sections
  --migrate-sections          Move the legacy sections collection into Sections/{schoolYear}/grades/{grade}/sections/{section}/teachers/{teacher}
  --delete-legacy-sections    Delete the legacy lowercase sections documents after migration
  --rebuild-advisory          Replace advisory data for the selected school years from the new Sections hierarchy
  --service-account <path>   Service-account JSON path; otherwise ADC is used
  --make-current             Mark the supplied school year as current
  --deploy-rules             Deploy firestore.rules through the Firebase CLI
  --dry-run                  Print planned writes without changing Firestore
`);
}

function normalizeSchoolYear(value) {
  const match = String(value || "").trim().match(/^(\d{4})[-/]?(\d{4})$/);
  return match ? `${match[1]}-${match[2]}` : "";
}

function normalizeValue(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function advisoryKey(value, fallback = "unassigned") {
  const key = normalizeValue(value).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return key || fallback;
}

function advisoryLearnersCollection(db, schoolYear, gradeLevel, section, teacherName) {
  return db.collection("advisory").doc(schoolYear)
    .collection("grades").doc(advisoryKey(gradeLevel))
    .collection("sections").doc(advisoryKey(section))
    .collection("teachers").doc(advisoryKey(teacherName))
    .collection("learners");
}

function normalizeGrade(value) {
  const text = String(value || "").trim();
  const key = text.toLowerCase().replace(/\s+/g, " ");
  if (["kinder", "kindergarten", "kg", "0"].includes(key)) return "Kinder";
  const match = key.match(/^grade\s*(\d+)$/) || key.match(/^(\d+)$/);
  return match ? `Grade ${match[1]}` : text;
}

function structuredSectionsCollection(db, schoolYear, gradeLevel) {
  return db.collection("Sections").doc(schoolYear).collection("grades").doc(advisoryKey(gradeLevel));
}

async function readStructuredSections(db, schoolYear) {
  const directory = await db.collection("Sections").doc(schoolYear).collection("directory").get();
  if (!directory.empty) return directory.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  const grades = await db.collection("Sections").doc(schoolYear).collection("grades").get();
  const sections = [];
  for (const gradeDoc of grades.docs) {
    const sectionDocs = await gradeDoc.ref.collection("sections").get();
    for (const sectionDoc of sectionDocs.docs) {
      const teacherDocs = await sectionDoc.ref.collection("teachers").get();
      teacherDocs.docs.forEach((teacherDoc) => sections.push({ id: `${gradeDoc.id}/${sectionDoc.id}/${teacherDoc.id}`, ...teacherDoc.data() }));
    }
  }
  return sections;
}

function isActiveLearner(learner) {
  const enrollmentStatus = String(learner?.enrollmentStatus || "ACTIVE").toUpperCase().replace(/[ -]+/g, "_");
  const eosyStatus = String(learner?.eosyStatus || "").toLowerCase().replace(/[_-]+/g, " ");
  return enrollmentStatus !== "TRANSFERRED_OUT" && enrollmentStatus !== "DROPPED_OUT" && eosyStatus !== "dropped out" && !learner?.transferOut;
}

async function refreshPublicStats(db, schoolYear) {
  const years = (await db.collection("schoolYears").get()).docs.map((doc) => ({ schoolYear: doc.id, ...doc.data() }));
  const current = years.find((year) => year.isCurrent) || years.find((year) => year.schoolYear === schoolYear) || years[0];
  if (!current) return;
  const learnerSnapshot = await db.collection("Learners").doc(current.schoolYear).collection("records").get();
  const learners = learnerSnapshot.docs.map((doc) => ({ learnerId: doc.id, ...doc.data() })).filter(isActiveLearner);
  const sections = await readStructuredSections(db, current.schoolYear);
  const rows = sections.map((section) => ({ ...section, male: 0, female: 0, total: 0 }));
  learners.forEach((learner) => {
    const row = rows.find((item) => normalizeValue(item.gradeLevel) === normalizeValue(learner.gradeLevel) && normalizeValue(item.section) === normalizeValue(learner.section));
    if (!row) return;
    row.total += 1;
    if (learner.gender === "Male") row.male += 1;
    if (learner.gender === "Female") row.female += 1;
  });
  const programFields = ["is4Ps", "isIP", "isSNED", "isARAL", "isMuslim"];
  const taggedCount = learners.filter((learner) => programFields.some((field) => learner[field])).length;
  const gradeLevels = {};
  learners.forEach((learner) => { const grade = learner.gradeLevel || "—"; gradeLevels[grade] = (gradeLevels[grade] || 0) + 1; });
  await db.collection("publicStats").doc("summary").set({
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
    gradeLevels: Object.entries(gradeLevels).map(([label, value]) => ({ label, value })),
    recentLearners: learners.slice().sort((a, b) => String(b.dateAdded || "").localeCompare(String(a.dateAdded || ""))).slice(0, 5),
    enrollmentData: {
      schoolYear: current.schoolYear,
      rows,
      gradeTotals: [],
      grandTotal: { male: rows.reduce((sum, row) => sum + row.male, 0), female: rows.reduce((sum, row) => sum + row.female, 0), total: rows.reduce((sum, row) => sum + row.total, 0) },
    },
    schoolYear: current.schoolYear,
    syncStatus: "Live",
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
}

async function migrateLegacySections(db, deleteLegacy) {
  const legacySnapshot = await db.collection("sections").get();
  const records = new Map();
  legacySnapshot.docs.forEach((doc) => {
    const data = doc.data() || {};
    const schoolYear = normalizeSchoolYear(data.schoolYear);
    const gradeLevel = normalizeGrade(data.gradeLevel);
    const section = String(data.section || "").trim();
    const adviser = String(data.adviser || data.teacher || "").trim();
    if (!schoolYear || !gradeLevel || !section || !adviser) return;
    records.set(`${schoolYear}|${normalizeValue(gradeLevel)}|${normalizeValue(section)}|${normalizeValue(adviser)}`, { schoolYear, gradeLevel, section, adviser });
  });
  const operations = [];
  records.forEach((record) => {
    const gradeRef = structuredSectionsCollection(db, record.schoolYear, record.gradeLevel);
    const sectionRef = gradeRef.collection("sections").doc(advisoryKey(record.section));
    const teacherRef = sectionRef.collection("teachers").doc(advisoryKey(record.adviser));
    const directoryRef = db.collection("Sections").doc(record.schoolYear).collection("directory").doc(`${advisoryKey(record.gradeLevel)}-${advisoryKey(record.section)}-${advisoryKey(record.adviser)}`);
    operations.push((batch) => batch.set(db.collection("Sections").doc(record.schoolYear), {
      schoolYear: record.schoolYear,
      structureVersion: 1,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true }));
    operations.push((batch) => batch.set(gradeRef, {
      gradeLevel: record.gradeLevel,
      schoolYear: record.schoolYear,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true }));
    operations.push((batch) => batch.set(sectionRef, {
      section: record.section,
      gradeLevel: record.gradeLevel,
      schoolYear: record.schoolYear,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true }));
    operations.push((batch) => batch.set(teacherRef, {
      teacherName: record.adviser,
      adviser: record.adviser,
      section: record.section,
      gradeLevel: record.gradeLevel,
      schoolYear: record.schoolYear,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true }));
    operations.push((batch) => batch.set(directoryRef, {
      teacherName: record.adviser,
      adviser: record.adviser,
      section: record.section,
      gradeLevel: record.gradeLevel,
      schoolYear: record.schoolYear,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true }));
  });
  await commitOperations(db, operations);
  if (deleteLegacy) {
    const deleteOperations = legacySnapshot.docs.map((doc) => (batch) => batch.delete(doc.ref));
    await commitOperations(db, deleteOperations);
  }
  return { legacy: legacySnapshot.size, migrated: records.size, deleted: deleteLegacy ? legacySnapshot.size : 0 };
}

async function commitOperations(db, operations) {
  const chunkSize = 450;
  for (let index = 0; index < operations.length; index += chunkSize) {
    const batch = db.batch();
    operations.slice(index, index + chunkSize).forEach((operation) => operation(batch));
    await batch.commit();
  }
}

async function provisionAdvisory(db, schoolYear, syncLearners) {
  const sections = await readStructuredSections(db, schoolYear);
  const users = (await db.collection("users").get()).docs
    .map((doc) => doc.data() || {})
    .filter((user) => user.role === "Teacher" && user.status === "Active")
    .map((user) => {
      const assignment = user.teacherAssignment || {};
      if (normalizeSchoolYear(assignment.schoolYear) !== schoolYear || !assignment.gradeLevel || !assignment.section) return null;
      return {
        schoolYear,
        gradeLevel: normalizeGrade(assignment.gradeLevel),
        section: String(assignment.section).trim(),
        adviser: String(assignment.teacherName || user.name || "").trim(),
      };
    })
    .filter((section) => section && section.adviser);
  const sectionKeys = new Set(sections.map((section) => `${normalizeValue(section.gradeLevel)}|${normalizeValue(section.section)}|${normalizeValue(section.adviser || section.teacherName)}`));
  users.forEach((section) => {
    const key = `${normalizeValue(section.gradeLevel)}|${normalizeValue(section.section)}|${normalizeValue(section.adviser)}`;
    if (!sectionKeys.has(key)) sections.push(section);
  });
  const operations = [];
  operations.push((batch) => batch.set(db.collection("advisory").doc(schoolYear), {
    schoolYear,
    structureVersion: 1,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true }));

  sections.forEach((section) => {
    const gradeLevel = String(section.gradeLevel || "").trim();
    const sectionName = String(section.section || "").trim();
    const teacherName = String(section.adviser || section.teacher || "").trim();
    if (!gradeLevel || !sectionName || !teacherName) return;
    const teacherRef = advisoryLearnersCollection(db, schoolYear, gradeLevel, sectionName, teacherName).parent;
    const directoryRef = db.collection("Sections").doc(schoolYear).collection("directory").doc(`${advisoryKey(gradeLevel)}-${advisoryKey(sectionName)}-${advisoryKey(teacherName)}`);
    operations.push((batch) => batch.set(teacherRef, {
      teacherName,
      gradeLevel,
      section: sectionName,
      schoolYear,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true }));
    operations.push((batch) => batch.set(directoryRef, {
      teacherName,
      adviser: teacherName,
      section: sectionName,
      gradeLevel,
      schoolYear,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true }));
  });
  await commitOperations(db, operations);
  if (!syncLearners) return { sections: sections.length, learners: 0 };

  const learners = (await db.collection("Learners").doc(schoolYear).collection("records").get()).docs;
  const learnerOperations = [];
  learners.forEach((learnerDoc) => {
    const learner = learnerDoc.data() || {};
    const matchingSections = sections.filter((candidate) =>
      normalizeValue(candidate.gradeLevel) === normalizeValue(learner.gradeLevel)
      && normalizeValue(candidate.section) === normalizeValue(learner.section)
      && String(candidate.adviser || candidate.teacher || "").trim());
    matchingSections.forEach((section) => {
      const teacherName = String(section.adviser || section.teacher).trim();
      const ref = advisoryLearnersCollection(db, schoolYear, section.gradeLevel, section.section, teacherName).doc(learnerDoc.id);
      learnerOperations.push((batch) => batch.set(ref, {
        ...learner,
        learnerId: learnerDoc.id,
        schoolYear,
        advisoryTeacher: teacherName,
        advisoryUpdatedAt: FieldValue.serverTimestamp(),
      }, { merge: true }));
    });
  });
  await commitOperations(db, learnerOperations);
  return { sections: sections.length, learners: learnerOperations.length };
}

function initializeAdmin(projectId) {
  if (getApps().length) return getFirestore();
  const serviceAccountPath = option("service-account", process.env.GOOGLE_APPLICATION_CREDENTIALS);
  const app = serviceAccountPath
    ? initializeApp({ credential: cert(resolve(serviceAccountPath)), projectId })
    : initializeApp({ credential: applicationDefault(), projectId });
  return getFirestore(app);
}

async function main() {
  if (hasFlag("help")) return usage();
  const projectId = option("project", process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT);
  const schoolYearInput = option("school-year");
  const schoolYear = normalizeSchoolYear(schoolYearInput);
  const adminUid = option("admin-uid");
  const adminEmail = option("admin-email");
  const adminName = option("admin-name", "Administrator");
  const makeCurrent = hasFlag("make-current");
  const syncAdvisory = hasFlag("sync-advisory");
  const migrateSections = hasFlag("migrate-sections");
  const deleteLegacySections = hasFlag("delete-legacy-sections");
  const rebuildAdvisory = hasFlag("rebuild-advisory");
  const deployRules = hasFlag("deploy-rules");

  if (!projectId) throw new Error("Missing --project. Example: --project san-roque-es-dashboard");
  if (schoolYearInput && !schoolYear) throw new Error("--school-year must use YYYY-YYYY.");
  if (makeCurrent && !schoolYear) throw new Error("--make-current requires --school-year.");
  if (adminEmail && !adminUid) throw new Error("--admin-email requires --admin-uid.");
  if (adminUid && !adminEmail) throw new Error("--admin-uid requires --admin-email.");
  if (deleteLegacySections && !migrateSections) throw new Error("--delete-legacy-sections requires --migrate-sections.");
  if (rebuildAdvisory && !migrateSections) throw new Error("--rebuild-advisory requires --migrate-sections.");

  console.log(`Project: ${projectId}`);
  console.log("Provisioning: publicStats/summary");
  if (schoolYear) console.log(`Provisioning: schoolYears/${schoolYear}, settings/currentSchoolYear`);
  if (adminUid) console.log(`Provisioning: users/${adminUid}`);
  if (syncAdvisory) console.log(`Provisioning: advisory/${schoolYear || "all school years"}`);
  if (migrateSections) console.log(`Migrating: sections -> Sections${deleteLegacySections ? " (delete legacy)" : ""}`);
  if (rebuildAdvisory) console.log(`Rebuilding: advisory/${schoolYear || "all school years"}`);
  if (hasFlag("dry-run")) return console.log("Dry run complete; no writes made.");

  const db = initializeAdmin(projectId);
  const batch = db.batch();
  batch.set(db.collection("publicStats").doc("summary"), {
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
    enrollmentData: { schoolYear: schoolYear || "", rows: [], gradeTotals: [], grandTotal: { male: 0, female: 0, total: 0 } },
    schoolYear: schoolYear || "",
    syncStatus: "Unavailable",
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  if (schoolYear) {
    if (makeCurrent) {
      const years = await db.collection("schoolYears").get();
      years.docs.forEach((doc) => batch.set(doc.ref, { isCurrent: doc.id === schoolYear }, { merge: true }));
    }
    batch.set(db.collection("schoolYears").doc(schoolYear), { schoolYear, isCurrent: makeCurrent }, { merge: true });
    batch.set(db.collection("settings").doc("currentSchoolYear"), { value: schoolYear }, { merge: true });
  }

  if (adminUid) {
    batch.set(db.collection("users").doc(adminUid), {
      name: adminName,
      email: adminEmail,
      role: "School Admin",
      status: "Active",
      createdAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  }

  await batch.commit();
  if (migrateSections) {
    const result = await migrateLegacySections(db, deleteLegacySections);
    console.log(`Sections migration: ${result.migrated} normalized records from ${result.legacy} legacy documents; ${result.deleted} deleted.`);
  }
  if (syncAdvisory) {
    const years = schoolYear ? [schoolYear] : (await db.collection("schoolYears").get()).docs.map((doc) => doc.id);
    for (const year of years) {
      if (rebuildAdvisory) await db.recursiveDelete(db.collection("advisory").doc(year));
      const result = await provisionAdvisory(db, year, true);
      console.log(`Advisory ${year}: ${result.sections} sections, ${result.learners} learners.`);
    }
  }
  await refreshPublicStats(db, schoolYear);
  if (deployRules) {
    if (process.platform === "win32") {
      const commandShell = process.env.ComSpec || "cmd.exe";
      const command = `npx.cmd --yes firebase-tools deploy --only firestore:rules --project ${projectId}`;
      execFileSync(commandShell, ["/d", "/s", "/c", command], { stdio: "inherit" });
    } else {
      execFileSync("npx", ["--yes", "firebase-tools", "deploy", "--only", "firestore:rules", "--project", projectId], { stdio: "inherit" });
    }
  }
  console.log("Firestore provisioning complete.");
  console.log("Learner, dropout, transferred-out, and advisory learner paths are maintained when records are written.");
}

main().catch((error) => {
  console.error(`Provisioning failed: ${error.message}`);
  process.exitCode = 1;
});