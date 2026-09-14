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

## 8. Add School Years And Sections

After the first admin signs in:

1. Open **Admin Console**.
2. Add a school year such as `2026-2027`.
3. The Firestore integration copies the current year's section and adviser structure when creating a new year.
4. Review or edit sections and teacher assignments in the school-structure area.

The website stores school years in `schoolYears` and section/adviser records in `sections`.

## 9. Add Learner Data

Learners are entered through the Masterlist or program pages. Each record belongs to a selected school year. The app stores active learners under:

```text
Learners/{schoolYear}/records/{learnerId}
```

Dropouts and transferred-out learners are moved to their separate year-specific archive collections. Do not manually place learner documents in Google Sheets; the website reads and writes them through Firestore.

If existing data must be migrated, export it to a safe private copy and write a one-time migration script against the current Firestore document structure. Test with a small sample before importing the complete dataset.

## 10. Build And Deploy The Website

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

## 11. Verify The Installation

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

## 12. Security Checklist

- Publish and review `firestore.rules` before production use.
- Use a strong temporary password and reset it after the first admin signs in.
- Never commit service-account JSON, private keys, passwords, or tokens.
- Restrict Apps Script deployments to the intended audience.
- Keep Firestore backups private because they contain sensitive learner information.
- Use the Firebase Console to remove a user manually only when the normal Admin Console flow is unavailable.
- When changing roles or status, confirm the matching Firebase Auth account and `users/{uid}` document use the same UID.

## 13. Keeping Secrets Server-Side

Anything prefixed with `VITE_` is public. A user can retrieve it from the built JavaScript, browser developer tools, or network requests. This includes the Firebase web `apiKey`, project identifiers, and any Apps Script URL. Do not put a credential that grants administrative access in a `VITE_*` variable.

Keep true secrets in a server-only runtime:

- Apps Script: store `FIREBASE_SERVICE_ACCOUNT_JSON`, `FIREBASE_WEB_API_KEY`, and other private values in **Project Settings → Script properties**. Read them with `PropertiesService` and never return them in a web response.
- Vercel: store private values under **Settings → Environment Variables** without a `VITE_` prefix, for example `FIREBASE_SERVICE_ACCOUNT_JSON`. Read them only inside a Vercel Function under `api/`; call that function from the browser instead of calling an admin API directly.
- Never import server-only environment variables into React code, place them in `public/`, log them, or include them in JSON responses. Restrict the server endpoint with Firebase ID-token verification, authorization checks, validation, and rate limiting.

Changing a value from a hardcoded string to `.env.local` protects the Git repository, but it does not hide a value that the browser needs. To make a secret unretrievable by users, the operation using it must happen on Apps Script or a Vercel server function, with only the result returned to the browser. Rotate any credential that has already been committed publicly, and review Git history because deleting the latest copy does not remove old commits.
