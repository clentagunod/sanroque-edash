# Advisory Firestore Setup

This guide provisions and maintains the adviser-oriented learner directory:

```text
advisory/{schoolYear}
  /grades/{gradeKey}
    /sections/{sectionKey}
      /teachers/{teacherKey}
        /learners/{learnerId}
```

The documents under `grades`, `sections`, and `teachers` are structure metadata. Learner documents contain the same canonical fields as `Learners/{schoolYear}/records/{learnerId}` plus `advisoryTeacher` and `advisoryUpdatedAt`.

## 1. Prerequisites

1. Install Node.js 18 or newer.
2. Run `npm install` from the project root.
3. Enable Email/Password Authentication and Firestore in the Firebase project.
4. Publish `firestore.rules` before signing in with staff accounts.
5. Create the first Firebase Authentication user manually and note its UID.
6. Keep the service-account JSON outside the repository when possible. Never put it in a `VITE_*` variable.

The service account needs permission to read and write Firestore. On Windows PowerShell, set credentials for the current terminal with:

```powershell
$env:GOOGLE_APPLICATION_CREDENTIALS = "C:\secure\san-roque-service-account.json"
```

You may instead pass `--service-account` directly. The explicit option is convenient for one command, but the file should still remain outside source control.

## 2. Dry-run the initial structure

From the project root:

```powershell
npm run firestore:provision -- --project san-roque-es-dashboard --school-year 2026-2027 --make-current --dry-run
```

A dry run validates the arguments and prints the intended metadata writes. It does not contact Firestore or change data.

## 3. Provision a new project

After confirming the dry-run output, create the metadata and first admin profile:

```powershell
npm run firestore:provision -- `
  --project san-roque-es-dashboard `
  --school-year 2026-2027 `
  --make-current `
  --admin-uid FIREBASE_AUTH_UID `
  --admin-email admin@example.com `
  --admin-name "School Administrator" `
  --service-account "C:\secure\san-roque-service-account.json" `
  --deploy-rules
```

PowerShell uses the backtick for line continuation. Run the same command on one line if preferred.

The command creates or merges:

```text
publicStats/summary
schoolYears/2026-2027
settings/currentSchoolYear
users/FIREBASE_AUTH_UID
advisory/2026-2027
```

It never deletes learners, sections, users, or existing fields. The first admin is created in Firebase Authentication separately; the provisioner only creates the matching Firestore profile.

## 4. Add school years and sections

The admin console creates a new `schoolYears/{schoolYear}` document and an advisory year marker automatically. Add sections under **Admin Console → School structure**. Each section has:

- `schoolYear`
- `gradeLevel`
- `section`
- `adviser`

When an adviser is present, the application creates the matching advisory teacher structure. New active learners in that grade and section are copied into the adviser’s advisory collection automatically.

When creating a year from the admin console, the current section templates are copied. Review the adviser names before importing or entering learners.

## 5. Backfill existing learners

After sections and adviser names are configured, synchronize existing active learners:

```powershell
npm run firestore:provision -- `
  --project san-roque-es-dashboard `
  --school-year 2026-2027 `
  --sync-advisory `
  --service-account "C:\secure\san-roque-service-account.json"
```

To rebuild every school year already listed in `schoolYears`, omit `--school-year`:

```powershell
npm run firestore:provision -- `
  --project san-roque-es-dashboard `
  --sync-advisory `
  --service-account "C:\secure\san-roque-service-account.json"
```

The synchronizer reads `sections` and active `Learners` records, then writes advisory copies in batches of at most 450 operations. Learners without a matching section or adviser are left only in the master collection. Run the command again after changing adviser names or correcting learner grade/section values.

## 6. Create users and assignments

Use **Admin Console → Access management → Add User**:

- **School Admin**: full data access, no grade/section assignment required.
- **Registrar**: full learner data access, but no Admin Console or Audit Log access; no assignment required.
- **Teacher**: a school year and one grade/section assignment are required.
- **Visitor**: dashboard-only public access as supported by the application.

Teacher profiles store a `teacherAssignment` object on `users/{uid}`:

```text
teacherAssignment.schoolYear
teacherAssignment.gradeLevel
teacherAssignment.section
teacherAssignment.teacherName
teacherAssignment.teacherKey
teacherAssignment.gradeKey
teacherAssignment.sectionKey
```

The `teacherKey`, `gradeKey`, and `sectionKey` values are stable, lower-case path keys. Do not manually replace them with display labels.

## 7. Runtime behavior

Administrators and registrars read the unfiltered master collection:

```text
Learners/{schoolYear}/records/{learnerId}
```

Teachers read only their assigned advisory collection. Adds, edits, section changes, and deletes update the master record and advisory copy together. Records moved to dropout or transferred-out archives are removed from advisory reads. Firestore rules independently enforce the same role and assignment boundaries; client-side filtering is not the security boundary.

## 8. Verification checklist

1. Run the provisioning command with `--dry-run`.
2. Open Firestore and confirm `advisory/{schoolYear}` exists.
3. Configure one section with an adviser.
4. Run the backfill command and confirm one learner appears below the expected teacher path.
5. Create a Teacher user with the same school year, grade, section, and name.
6. Sign in as that teacher and confirm Masterlist/Data show only the assigned learners.
7. Add, edit, and delete a test learner as the teacher; confirm both master and advisory documents change.
8. Sign in as Registrar and confirm all learners are visible while Admin Console and Audit Log are unavailable.
9. Sign in as School Admin and confirm all learners, user management, and audit features remain available.
10. Run `npm run build` before deployment.

## 9. Operational notes

- Firestore collection IDs are case-sensitive. Keep `Learners`, `Dropouts`, `TransferredOut`, and `advisory` exactly as shown.
- Advisory data is a denormalized read model. The master learner record remains authoritative.
- If a section adviser is renamed or a learner is moved between sections, run the backfill command for that school year to remove stale copies and rebuild the correct paths.
- Keep backups private because advisory documents contain learner personally identifiable information.
- Deploy rules with `--deploy-rules` only after reviewing the project ID and credentials.

## 10. Fixing user deletion permissions

The Admin Console deletes Firebase Authentication accounts through the deployed `AuditLog.gs` Apps Script service. The service account stored in the Apps Script property `FIREBASE_SERVICE_ACCOUNT_JSON` must have this project-level IAM role:

```text
roles/firebaseauth.admin
```

For this project, verify that the JSON property uses the intended service-account email, for example:

```text
firebase-adminsdk-fbsvc@san-roque-es-dashboard.iam.gserviceaccount.com
```

### Google Cloud Console

1. Open **Google Cloud Console → IAM & Admin → IAM**.
2. Select project `san-roque-es-dashboard`.
3. Click **Grant access**.
4. Enter the `client_email` value from `FIREBASE_SERVICE_ACCOUNT_JSON` as the principal.
5. Assign **Firebase Authentication Admin** (`roles/firebaseauth.admin`).
6. Save the change and wait briefly for IAM propagation.

### Cloud Shell alternative

Run this in Google Cloud Shell or another machine with `gcloud` authenticated:

```bash
gcloud projects add-iam-policy-binding san-roque-es-dashboard \
  --member="serviceAccount:firebase-adminsdk-fbsvc@san-roque-es-dashboard.iam.gserviceaccount.com" \
  --role="roles/firebaseauth.admin"
```

Replace the service-account email if the `client_email` in the Apps Script property differs.

### Redeploy Apps Script

1. Open the Apps Script project containing `AuditLog.gs`.
2. Confirm **Project Settings → Script properties → FIREBASE_SERVICE_ACCOUNT_JSON** contains the same service-account JSON whose `client_email` received the role.
3. Select **Deploy → Manage deployments**.
4. Edit the existing Web App deployment, choose **New version**, and deploy.
5. Keep the existing execution identity and access settings.
6. Sign out and back in to the dashboard, then retry removing a test user.

Do not grant the role to the Firebase web API key or to the website user. It must be granted to the service-account principal used to sign the JWT in `AuditLog.gs`.

## 11. Provisioner Firestore write permission

The Node provisioner uses the service account passed with `--service-account`. It must be able to read, create, update, and delete Firestore documents for migrations. If provisioning reports `7 PERMISSION_DENIED` while writing `publicStats`, `sections`, or `Sections`, grant the same service account:

```text
roles/datastore.user
```

In Cloud Shell:

```bash
gcloud projects add-iam-policy-binding san-roque-es-dashboard \
  --member="serviceAccount:firebase-adminsdk-fbsvc@san-roque-es-dashboard.iam.gserviceaccount.com" \
  --role="roles/datastore.user"
```

Wait for IAM propagation, then rerun the migration command. The service account must also have `roles/firebaseauth.admin` if the deployed Apps Script deletes Authentication users.
