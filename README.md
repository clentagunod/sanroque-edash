# San Roque ES Dashboard

San Roque Elementary School's realtime enrollment and school-management dashboard. The website helps authorized school staff manage learners, school years, sections, programs, reports, and school operations from one workspace.

## What It Does

- Authenticated staff dashboard with role-based access.
- Learner masterlist with add, edit, search, filtering, and removal.
- Program views for 4Ps, IP, SNED, ARAL, and Muslim learners.
- School-year and section management, including teacher/adviser assignments.
- Enrollment summaries and dashboard statistics.
- Reading profiles, math profiles, grades profiles, nutritional status, dropout, and transfer reports.
- EOSY reporting, data exports, utilities, feedback, and audit logging.
- Visitor mode for limited dashboard and enrollment-summary access.
- Live Firestore updates for learners, users, sections, school years, and public dashboard statistics.

## Technology

- React 18, TypeScript, Vite, and React Router.
- Firebase Authentication for sign-in.
- Cloud Firestore for application data and live listeners.
- Google Apps Script for the standalone Feedback and AuditLog services.
- Google Sheets as the storage behind those two Apps Script services only.
- Firebase Hosting, Vercel, Netlify/Cloudflare Pages, or another SPA-capable host.

## Application Structure

```text
src/
  App.tsx                  Route definitions
  main.tsx                 React entry point and Firestore API setup
  pages/                   React page wrappers and raw page markup
  lib/                     Auth, Firestore, reports, forms, exports, and utilities
  styles/                  Shared tokens, shell styles, responsive styles, and page styles
public/assets/             School logo, school image, and other static assets
apps-script/
  AuditLog.gs              Authenticated audit-log and admin Auth service
  Feedback.gs              Authenticated feedback service
firestore.rules             Firestore access-control rules
firebase.json               Firebase Hosting configuration
SETUP_GUIDE.md              Installation, Firebase, Apps Script, and deployment guide
```

## How The Website Works

The app uses a thin React shell around page modules that still use DOM-based page markup. Each route mounts its page HTML, then runs the matching initializer in `src/lib`. This keeps the existing workflows stable while allowing the project to use Vite, TypeScript, code splitting, and shared React routing.

Firebase Authentication identifies the signed-in user. The matching `users/{uid}` Firestore document supplies the user's name, role, and status. Firestore Security Rules enforce access on the database itself; UI checks only control what the user sees.

Main application records are organized by school year:

```text
users/{uid}
Learners/{schoolYear}/records/{learnerId}
Dropouts/{schoolYear}/records/{learnerId}
TransferredOut/{schoolYear}/records/{learnerId}
schoolYears/{schoolYear}
sections/{sectionId}
settings/{settingId}
publicStats/summary
```

The public statistics document contains aggregate information only. Visitor mode does not read private learner records.

## Roles

- **School Admin**: full access, including users, school structure, settings, and all records.
- **Registrar**: staff access to learner and operational records.
- **Teacher**: staff access allowed by the current application rules.
- **Visitor**: read-only access to the public dashboard and enrollment summary.

The authoritative permissions are in [firestore.rules](firestore.rules). Review and publish those rules whenever access behavior changes.

## Development

```bash
npm install
npm run dev
```

The Vite development server normally runs at `http://localhost:5173`.

Useful commands:

```bash
npm test                 # Run the Vitest suite
npm run build            # Typecheck and create dist/
npm run preview          # Preview the production build locally
```

## Maintenance Notes

- Update Firebase and Apps Script configuration in `src/lib/app-config.ts` as described in [SETUP_GUIDE.md](SETUP_GUIDE.md).
- Deploy `firestore.rules` after changing security behavior.
- Deploy `apps-script/AuditLog.gs` and `apps-script/Feedback.gs` separately from the React site.
- Do not commit Firebase service-account JSON, private keys, passwords, or other secrets.
- Keep the Firestore database as the source of truth for application records. Do not add new learner-data writes to Google Sheets without documenting the reason and migration path.
- The app uses Firebase's compat SDK loaded by `index.html`; keep the initialization order in `src/main.tsx` and `src/lib/firebase.ts` intact when changing the data layer.

## Deployment

Build the site and deploy the generated `dist/` directory using the provider of your choice. Firebase Hosting is already configured through [firebase.json](firebase.json), including the rewrite that sends application routes to `index.html`.

See [SETUP_GUIDE.md](SETUP_GUIDE.md) for the complete first-time setup and deployment process.
