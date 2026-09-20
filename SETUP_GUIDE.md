# Setup and Reuse Guide

This guide explains how to reuse the San Roque ES Dashboard with a new Firebase project, Firestore database, Google Sheets services, and hosting provider.

## 1. Requirements

Install these tools before starting:

- Node.js 18 or newer
- npm
- A Firebase account and project
- Google Apps Script access
- A hosting provider account if the site will be deployed publicly

Install project dependencies:

```bash
npm install
```

## 2. Create The Firebase Project

1. Open the [Firebase Console](https://console.firebase.google.com/) and create or select a project.
2. Go to **Project settings** and create a Web App under **Your apps**.
3. Copy the web app configuration into a local `.env.local` file at the project root:

```dotenv
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your-project-id
VITE_FIREBASE_STORAGE_BUCKET=...
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
```

Start from `.env.example`. `.env.local` is ignored by Git. The Firebase web configuration is intended to be public and will be included in the browser bundle; it is protected by Firebase Authentication and Firestore Rules, not by hiding the web `apiKey`. Never place service-account credentials in this file or anywhere under `src/` or `public/`.

## 3. Enable Firebase Services

### Authentication

1. Firebase Console → **Build → Authentication**.
2. Click **Get started**.
3. Enable **Email/Password** sign-in.
4. Add the first administrator manually under **Users**.

### Firestore

1. Firebase Console → **Build → Firestore Database**.
2. Create the database in production mode.
3. Choose a region appropriate for your users, such as `asia-southeast1`.
4. Publish the contents of [firestore.rules](firestore.rules) in the Firestore **Rules** tab.

Firestore is the primary database for users, learners, school years, sections, settings, archived dropout records, transferred-out records, and aggregate public statistics.

### Repeatable Firestore Provisioning

The repository includes a Node-based bootstrap command for switching to a new Firebase project. It creates the metadata documents used by the application and can deploy the Firestore security rules. It does not copy learner data or create Firebase Authentication accounts.

Install dependencies first:

```bash
npm install
```

Authenticate the Firebase Admin SDK using one of these supported methods:

- Set `GOOGLE_APPLICATION_CREDENTIALS` to a service-account JSON file outside the repository.
- Or use Google Application Default Credentials, for example after `gcloud auth application-default login`.

Preview the writes without changing Firestore:

```bash
npm run firestore:provision -- --project your-new-project-id --school-year 2026-2027 --dry-run
```

For a new project, create the first user in **Firebase Authentication** first, copy its UID, then provision its Firestore profile:

```bash
npm run firestore:provision -- --project your-new-project-id --school-year 2026-2027 --make-current --admin-uid FIREBASE_AUTH_UID --admin-email admin@example.com --admin-name "School Administrator" --deploy-rules
```

The command safely uses merge writes, so rerunning it will not delete learners, sections, or existing user fields. It creates or updates:

```text
publicStats/summary
schoolYears/{schoolYear}
settings/currentSchoolYear
users/{adminUid}                 # only when --admin-uid is supplied
```

The `Learners/{year}/records`, `Dropouts/{year}/records`, `TransferredOut/{year}/records`, and section paths are created when the application writes their first document. The `--deploy-rules` option uses the Firebase CLI via `npx`; the project configuration points it at [firestore.rules](firestore.rules).

Never commit a service-account JSON file or place its path in a `VITE_*` variable. The existing `.gitignore` excludes `service-account*.json`, but credentials should preferably live outside the project directory.

## 4. Create The First School Admin

The first user must be created manually because Firestore rules require an active School Admin before an administrator can create other profiles.

1. Firebase Console → **Authentication → Users → Add user**.
2. Create the administrator's email and temporary password.
3. Copy the new user's UID.
4. Firestore Console → **Data** → create a `users` collection.
5. Create a document whose ID is the Firebase Auth UID.
6. Add these fields:

```text
name    string  Administrator name
email   string  administrator@example.com
role    string  School Admin
status  string  Active
```

The administrator can now sign in and use the Admin Console to manage users and school structure.

## 5. Configure The Application

Set these values in `.env.local` for local development:

- `VITE_FIREBASE_*`: the Firebase Web App configuration.
- `VITE_AUDIT_LOG_API_URL`: deployed `/exec` URL for `apps-script/AuditLog.gs`.
- `VITE_FEEDBACK_API_URL`: deployed `/exec` URL for `apps-script/Feedback.gs`.
- `VITE_BACKUP_SPREADSHEET_URL`: optional link to the backup spreadsheet or backup service.
- `VITE_TEST_MODE`: set to `true` to show the low-contrast TEST MODE stamp across authenticated pages; leave `false` to hide it.

The application database does not require a Google Sheets URL. The current Firestore integration is initialized by `src/main.tsx` and `src/lib/firestore-api.ts`.

## 6. Deploy The AuditLog Service

`apps-script/AuditLog.gs` is a standalone Google Apps Script Web App. It stores controlled audit metadata in a Google Sheet and also provides the Firebase Auth account deletion endpoint used by the Admin Console.

1. Create a Google Spreadsheet for audit records.
2. Open **Extensions → Apps Script**.
3. Copy the contents of `apps-script/AuditLog.gs` into the script project.
4. In **Project Settings → Script properties**, add:

```text
AUDIT_SPREADSHEET_ID       The audit spreadsheet ID
FIRESTORE_PROJECT_ID       Your Firebase project ID
FIREBASE_WEB_API_KEY       Firebase Web App apiKey, beginning with AIza
FIREBASE_SERVICE_ACCOUNT_JSON  Service-account JSON used by the Admin API
```

5. Deploy → **New deployment** → **Web app**.
6. Execute as the spreadsheet owner.
7. Allow access for the intended website users.
8. Copy the deployed `/exec` URL into `VITE_AUDIT_LOG_API_URL` in `.env.local`.
9. Run `redactExistingAuditLog()` once if the spreadsheet contains old unrestricted audit values.

Keep the service-account JSON only in Apps Script Script Properties. Never commit it to the repository.

## 7. Deploy The Feedback Service

`apps-script/Feedback.gs` writes feedback to a spreadsheet after verifying the Firebase ID token.

1. Create a separate spreadsheet for website feedback.
2. Open **Extensions → Apps Script**.
3. Copy `apps-script/Feedback.gs` into the project.
4. Deploy it as a Web App executing as the spreadsheet owner.
5. Copy its `/exec` URL into `VITE_FEEDBACK_API_URL` in `.env.local`.
6. The script creates the `Feedback` sheet and headers automatically on first submission.

Keep Feedback and AuditLog in separate spreadsheets unless you intentionally update both scripts and their bindings.

## 8. Enable Firestore Usage Monitoring

The Admin Console includes a Firestore usage monitor. It reads the last 14 days of Firestore operation metrics through the deployed AuditLog Apps Script service; the service account is never sent to the browser.

1. In Google Cloud Console, select the Firebase project and enable **Cloud Monitoring API**.
2. Ensure the Apps Script service account has **Monitoring Viewer** access to the project. Do not grant Owner or Editor access.
3. In Apps Script **Project Settings → Script properties**, configure:

```text
FIRESTORE_PROJECT_ID             san-roque-es-dashboard
FIREBASE_SERVICE_ACCOUNT_JSON    The replacement service-account JSON
```

`FIRESTORE_PROJECT_ID` must be the Firebase project ID `san-roque-es-dashboard`. Do not use the numeric project number `54497527570` or the Firebase messaging sender ID.

4. Redeploy the AuditLog Apps Script Web App after saving the properties.
5. Sign in as an active **School Admin**, open **Admin Console**, and select **Refresh Firestore usage**.
6. Confirm that the panel shows daily reads, writes, deletes, quota percentages, and a refreshed timestamp.

Cloud Monitoring data is delayed and is not guaranteed to be instantaneous. The Firebase usage console remains the source of truth for billing and quota details.

If the monitor reports `SERVICE_DISABLED` or asks you to visit `billing/enable`, open the link from the error and enable or link billing for the Google Cloud project `san-roque-es-dashboard`. Then enable **Cloud Monitoring API**, wait a few minutes, redeploy the Apps Script Web App, and refresh the Admin Console. This monitoring API requires a billing-enabled Google Cloud project even when Firestore itself is using the no-cost quota.

## 9. Add School Years And Sections

After the first admin signs in:

1. Open **Admin Console**.
2. Add a school year such as `2026-2027`.
3. The Firestore integration copies the current year's section and adviser structure when creating a new year.
4. Review or edit sections and teacher assignments in the school-structure area.

The website stores school years in `schoolYears` and section/adviser records in `sections`.

## 10. Add Learner Data

Learners are entered through the Masterlist or program pages. Each record belongs to a selected school year. The app stores active learners under:

```text
Learners/{schoolYear}/records/{learnerId}
```

Dropouts and transferred-out learners are moved to their separate year-specific archive collections. Do not manually place learner documents in Google Sheets; the website reads and writes them through Firestore.

If existing data must be migrated, export it to a safe private copy and write a one-time migration script against the current Firestore document structure. Test with a small sample before importing the complete dataset.

## 11. Build And Deploy The Website

Create a production build:

```bash
npm run build
```

The output is written to `dist/`.

### Firebase Hosting

1. Install the Firebase CLI if needed.
2. Sign in with `firebase login`.
3. Select the correct project with `firebase use your-project-id`.
4. Deploy hosting:

```bash
firebase deploy --only hosting
```

`firebase.json` already points Hosting at `dist/` and rewrites application routes to `index.html`.

### Vercel

1. Open the Vercel project → **Settings → Environment Variables**.
2. Add every variable from `.env.example`, using the same names and values as `.env.local`.
3. Select the environments that need each value, then redeploy. Vercel injects `VITE_*` values at build time, so changing one requires a new deployment.
4. Do not paste service-account JSON, private keys, passwords, or admin tokens into any `VITE_*` variable. Vite intentionally exposes every `VITE_*` value to browsers.

### Other Hosts

Deploy `dist/` to a host that supports SPA fallback. The repository includes `vercel.json` and `public/_redirects` for common providers. Ensure requests to `/pages/*.html` fall back to `index.html`.

## 12. Verify The Installation

Check these workflows after deployment:

1. Sign in as the first School Admin.
2. Open the dashboard and confirm aggregate statistics load.
3. Add and edit a learner.
4. Confirm the learner appears in the selected school year.
5. Add a second user and verify the profile and sign-in account are both present.
6. Test single and bulk user deletion with a test account.
7. Add a school year and confirm sections/advisers are copied.
8. Submit feedback and confirm a row appears in the Feedback sheet.
9. Create an audit event and confirm it appears in the AuditLog sheet.
10. Test the deployed site on a fresh browser session and on mobile width.

## 13. Security Checklist

- Publish and review `firestore.rules` before production use.
- Use a strong temporary password and reset it after the first admin signs in.
- Never commit service-account JSON, private keys, passwords, or tokens.
- Restrict Apps Script deployments to the intended audience.
- Keep Firestore backups private because they contain sensitive learner information.
- Use the Firebase Console to remove a user manually only when the normal Admin Console flow is unavailable.
- When changing roles or status, confirm the matching Firebase Auth account and `users/{uid}` document use the same UID.

## 14. Keeping Secrets Server-Side

Anything prefixed with `VITE_` is public. A user can retrieve it from the built JavaScript, browser developer tools, or network requests. This includes the Firebase web `apiKey`, project identifiers, and any Apps Script URL. Do not put a credential that grants administrative access in a `VITE_*` variable.

Keep true secrets in a server-only runtime:

- Apps Script: store `FIREBASE_SERVICE_ACCOUNT_JSON`, `FIREBASE_WEB_API_KEY`, and other private values in **Project Settings → Script properties**. Read them with `PropertiesService` and never return them in a web response.
- Vercel: store private values under **Settings → Environment Variables** without a `VITE_` prefix, for example `FIREBASE_SERVICE_ACCOUNT_JSON`. Read them only inside a Vercel Function under `api/`; call that function from the browser instead of calling an admin API directly.
- Never import server-only environment variables into React code, place them in `public/`, log them, or include them in JSON responses. Restrict the server endpoint with Firebase ID-token verification, authorization checks, validation, and rate limiting.

## 15. Teacher Learner Permissions

Active users whose role is `Teacher` can read, add, edit, and remove learner
records. Learner CRUD authorization is based only on the user's role and active
status in `users/{uid}`. It does not depend on a derived assignment-key field,
so legacy teacher accounts work without a migration or repair action.

The app still limits the learner form and normal learner lists to the teacher's
assigned grade-sections for usability. That client-side scope is not the
security boundary; Firestore authorizes the learner CRUD operations by the
stable role/status check.

After deploying this change:

1. Publish `firestore.rules` in Firebase Console.
2. Build and deploy the updated app.
3. Ensure affected teacher profiles have `role: "Teacher"` and
   `status: "Active"`, then sign out and back in.

### How a teacher's add/edit access actually scopes (for reference)

This part was already correct and needs no changes — included here so the
whole access model lives in one place:

- A teacher with **exactly one** grade-section assignment sees no
  grade/section picker in Add/Edit Learner; the learner is silently
  registered to that one assignment.
- A teacher with **two or more** assignments sees an "Assigned section"
  dropdown limited to only their own coverage; picking one locks the
  grade/section fields to match it.
- This applies uniformly across every page that opens the learner modal
  (Masterlist and every program page), because they all share the same
  `teacherLearnerScope()` / `applyTeacherLearnerScope()` helpers in
  `src/lib/learner-list.ts` — adding a new program page automatically gets
  the same scoping with no extra wiring.
- The client-side scoping is a UX convenience only. The real boundary is
   `firestore.rules`; only active users with the `Teacher` role can use learner
   CRUD operations.

