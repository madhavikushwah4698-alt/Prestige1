# Prestige Access Backend

Node.js API backend for the Prestige Institute Access Portal. App data is stored in MongoDB.

## Run

```bash
cd backend
npm install
npm start
```

Update `backend/.env`:

```text
GMAIL_USER=yourgmail@gmail.com
GMAIL_APP_PASSWORD=your_google_app_password
APP_ORIGIN=http://localhost:4000
MONGODB_URI=mongodb://127.0.0.1:27017
MONGODB_DB=prestige_access_portal
```

Use a Google app password for `GMAIL_APP_PASSWORD`, not the normal Gmail login password.

Server URL:

```text
http://localhost:4000
```

## Faculty Workload Forms

In the admin portal, open **Manage Form**, choose an approved faculty member, select the subjects to include, and click **Forward**. The faculty member receives an email link to select the subjects they can teach. Submitted selections appear under **Manage Workload**.

Email delivery requires `GMAIL_USER` and `GMAIL_APP_PASSWORD`. Set `APP_ORIGIN` to the deployed portal URL so the emailed form link is reachable by faculty.

The dashboard's **Generate from Workload** action uses submitted faculty subject selections and the weekly lecture/lab counts from **Manage Form**. It generates assignments for every section selected for each faculty-subject pair in **Manage Workload**, using only empty slots and respecting teacher availability, lab pairing, and the once-per-day-per-subject limit within each section. The same faculty member may teach the same subject to multiple sections on the same day when separate slots are available. It reports section-specific shortfalls when existing timetable entries or scheduling constraints prevent the requested weekly counts from being met.

Manage Form counts, subject choices, and lab timetable settings are saved in MongoDB's singleton `appSettings` document and loaded when an admin signs in. Dotted subject/course keys are stored as key-value entries so MongoDB does not interpret them as nested field paths. Forwarded forms, each faculty member's submitted subject IDs, and section assignments are stored in `workloadForms`; Manage Workload fetches those records from MongoDB. Workload updates target the affected form, so an unrelated app-data save cannot replace the workload collection.

Collection writes apply only changed, added, or explicitly removed records; unrelated records are not deleted and rewritten during a save. Database-backed IDs use atomic MongoDB counters, and workload submissions and section assignments update their specific form document. This keeps independent sections' updates from overwriting one another and makes refreshed views load the saved database state.

The timetable bulk-save endpoint merges records by ID, preserving other courses/sections and fields not included in a partial update.

Default admin login:

```text
email: admin@prestige.edu
password: Admin@123
role: admin
```

## Main Endpoints

```text
GET    /api/health
POST   /api/auth/login
GET    /api/auth/me
GET    /api/faculty
POST   /api/faculty/signup
PATCH  /api/faculty/:id/approve
PATCH  /api/faculty/:id/reject
DELETE /api/faculty/:id
GET    /api/invites
POST   /api/invites
DELETE /api/invites/:id
GET    /api/admins
POST   /api/admins
GET    /api/timetables
POST   /api/timetables
PATCH  /api/timetables/:id
GET    /api/app-settings
PUT    /api/app-settings
GET    /api/workload-forms
POST   /api/workload-forms
GET    /api/workload-forms/faculty
POST   /api/workload-forms/:id/faculty-submit
POST   /api/workload-forms/:token/submit
PATCH  /api/workload-forms/:id/subjects/:subjectId/sections
```

Protected endpoints need:

```text
Authorization: Bearer <token>
```

## Storage

Application data is stored in MongoDB collections, including `faculty` (registrations, profile details, and approval status), `timetables`, `timeSettings`, `subjects`, `history`, `teacherViews` (viewed faculty timetables), `workloadForms`, and the singleton `appSettings` record. View Faculty roster entries added/imported outside faculty registration, Manage Lab data, and Manage Form counts/checkbox choices are saved in `appSettings`. Existing browser-saved Manage Lab and Manage Form values are migrated to MongoDB the first time an admin signs in after this update.

```text
prestige_access_portal.<collection>
```

On first startup, the backend seeds MongoDB from `backend/data/db.json` (or imports a legacy `app_state` document) when the application collections are empty. Subsequent application changes are written to MongoDB.
"# Prestige" 
