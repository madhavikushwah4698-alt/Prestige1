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

The dashboard's **Generate from Workload** action uses submitted faculty subject selections and the weekly lecture/lab counts from **Manage Form**. It generates only assignments whose faculty-subject pair has been assigned to the currently selected section in **Manage Workload**, randomizes eligible days and slots between subjects, and schedules each faculty member for a subject at most once per day.

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
