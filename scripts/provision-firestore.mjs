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
  const deployRules = hasFlag("deploy-rules");

  if (!projectId) throw new Error("Missing --project. Example: --project san-roque-es-dashboard");
  if (schoolYearInput && !schoolYear) throw new Error("--school-year must use YYYY-YYYY.");
  if (makeCurrent && !schoolYear) throw new Error("--make-current requires --school-year.");
  if (adminEmail && !adminUid) throw new Error("--admin-email requires --admin-uid.");
  if (adminUid && !adminEmail) throw new Error("--admin-uid requires --admin-email.");

  console.log(`Project: ${projectId}`);
  console.log("Provisioning: publicStats/summary");
  if (schoolYear) console.log(`Provisioning: schoolYears/${schoolYear}, settings/currentSchoolYear`);
  if (adminUid) console.log(`Provisioning: users/${adminUid}`);
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
  if (deployRules) {
    const firebaseCommand = process.platform === "win32" ? "npx.cmd" : "npx";
    execFileSync(firebaseCommand, ["--yes", "firebase-tools", "deploy", "--only", "firestore:rules", "--project", projectId], { stdio: "inherit" });
  }
  console.log("Firestore provisioning complete.");
  console.log("Learner, dropout, transferred-out, and section paths are created when their first records are written.");
}

main().catch((error) => {
  console.error(`Provisioning failed: ${error.message}`);
  process.exitCode = 1;
});