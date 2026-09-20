# Firestore Schema Bootstrap

This file documents the automated Firestore schema creation flow for this project.

The project expects the following base structure in Firestore:

```text
users/
  {uid}

schoolYears/
  {schoolYear}

Sections/
  {schoolYear}/
    grades/
      {gradeKey}/
        sections/
          {sectionKey}/
            teachers/
              {teacherUid}

advisory/
  {schoolYear}/
    users/
      {teacherUid}/
        assignments/
          {gradeLevel-section}

Learners/
  {schoolYear}/
    records/
      {learnerId}

Dropouts/
  {schoolYear}/
    records/
      {learnerId}

TransferredOut/
  {schoolYear}/
    records/
      {learnerId}

settings/
  currentSchoolYear

publicStats/
  summary
```

## 1. Prerequisites

1. Install Node.js 18 or newer.
2. Run `npm install` in the project root.
3. Enable Firebase Authentication and Firestore for the project.
4. Download a Firebase service-account JSON and keep it outside the repo if possible.
5. Make sure the service account has Cloud Firestore access (`roles/datastore.user`).

## 2. Create the Firestore schema only

This creates the empty structure without adding learner or teacher records:

### PowerShell

```powershell
npm run firestore:bootstrap -- --project "san-roque-es-dashboard" --school-year 2026-2027 --structure-only --service-account ./service-account.json
```

### Command explanation

- `--project` = Firebase project ID
- `--school-year` = the current school year
- `--structure-only` = create the schema only; no learner/teacher data is inserted
- `--service-account` = path to the service-account JSON file

This script creates the collection roots and base metadata required by the app.

## 3. Create the schema and add an admin profile

If you want to create the admin Firestore profile at the same time:

```powershell
npm run firestore:bootstrap -- --project "san-roque-es-dashboard" --school-year 2026-2027 --structure-only --service-account ./service-account.json --admin-uid admin_001 --admin-email example.admin@sanroquees.edu.ph --admin-name "School Admin"
```

This creates:

```text
users/admin_001
schoolYears/2026-2027
settings/currentSchoolYear
publicStats/summary
Sections/2026-2027
advisory/2026-2027
Learners/2026-2027
Dropouts/2026-2027
TransferredOut/2026-2027
```

## 4. Admin user rule

The project still requires a real Firebase Authentication user. The Firestore profile alone is not enough.

Create the actual auth user in Firebase Console:

- Authentication → Users → Add user
- Email: `example.admin@sanroquees.edu.ph`
- Password: your chosen password
- UID: `admin_001`

Then ensure the Firestore document matches that same UID:

```text
users/admin_001
```

with data like:

```json
{
  "uid": "admin_001",
  "name": "School Admin",
  "email": "example.admin@sanroquees.edu.ph",
  "role": "School Admin",
  "status": "Active",
  "teacherAssignments": [],
  "teacherAssignment": null
}
```

## 5. Teacher advisory filtering structure

The app uses this advisory index for teacher assignment filtering:

```text
advisory/{schoolYear}/users/{teacherUid}/assignments/{gradeLevel-section}
```

Example:

```text
advisory/2026-2027/users/teacher_001/assignments/grade-1-a
advisory/2026-2027/users/teacher_001/assignments/grade-5-b
```

The associated profile field remains:

```text
users/{uid}.teacherAssignments
```

Example:

```json
[
  { "schoolYear": "2026-2027", "gradeLevel": "Grade 1", "section": "A" },
  { "schoolYear": "2026-2027", "gradeLevel": "Grade 5", "section": "B" }
]
```

## 6. Important: no placeholder user in production

The bootstrap script uses a temporary placeholder only to force the `users` collection to exist in Firestore, because Firestore cannot keep an empty collection root.

Do not treat that placeholder as a real app user.

For production, remove the placeholder and keep only real authenticated users and matching Firestore profile docs.

## 7. Reset / rebuild

If you want a completely clean schema rebuild, delete the Firestore database in Firebase Console first, then rerun the bootstrap command above.

## 8. One-liner summary

```powershell
npm run firestore:bootstrap -- --project "san-roque-es-dashboard" --school-year 2026-2027 --structure-only --service-account ./service-account.json
```

This is the automatic Firestore schema creation command for this website.
