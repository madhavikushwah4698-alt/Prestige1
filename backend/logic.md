# Backend and Timetable Logic

This guide explains how the backend works and how the timetable's **Generate from Workload** action uses it.

## Important distinction

The Node.js backend is in `backend/server.js`. It authenticates requests and reads/writes MongoDB data, but it does **not** calculate generated timetable slots. The timetable generator and legacy batch-assignment compatibility logic are in the browser code, `modules/app.js`. The browser fetches approved workload assignments from the backend, generates slots locally, and saves the result back through the timetable API.

The backend is exposed as a Vercel function by `api/index.js`; when run locally, `backend/server.js` also serves the frontend files.

## Application architecture and overall flow

This project follows a **monolithic application architecture** (more specifically, a small, three-tier monolithic web application), not a microservices architecture. Its frontend, API/business logic, and data access are separated into layers and files, but they are developed and deployed as one application; the backend API is not split into independently deployed domain services. MongoDB and Gmail SMTP are external dependencies/integrations, not microservices implemented by this project.

The application has a browser-based frontend, a Node.js HTTP API, and MongoDB persistence:

```text
Browser
  claude_clone.html + modules/styles.css + modules/app.js
            |
            | HTTP/JSON requests to /api/*
            v
Node.js API
  api/index.js (Vercel entry point)
  backend/server.js (API handlers and local static-file server)
            |
            | MongoDB Node.js driver
            v
MongoDB
  admins, faculty, timetables, workloadForms, appSettings, etc.
```

- **Presentation layer:** `claude_clone.html` supplies the page, `modules/styles.css` supplies its styles, and `modules/app.js` handles browser interactions, API calls, rendering, and timetable generation. The browser keeps the working timetable state while the page is open.
- **API/application layer:** `backend/server.js` handles HTTP requests, validates and authorizes operations, applies business rules, and reads or writes application data. The frontend sends JSON requests to the same origin's `/api/*` routes.
- **Persistence layer:** MongoDB stores application records. The backend initializes the database and counters on startup and imports `backend/data/db.json` (or legacy state) only when application collections are empty.
- **Email integration:** The backend can send invite and workload-form emails through Gmail SMTP when configured. Email delivery is an integration, not the primary data store.

### Request and user-action flow

1. A user opens the portal in a browser. In a local run, `backend/server.js` serves the frontend files; on Vercel, the `/` rewrite serves `claude_clone.html` and `/api/*` requests are routed to `api/index.js`.
2. The browser loads the page's styles and JavaScript. The frontend calls API endpoints to load data and, when needed, authenticate the user.
3. The API parses the request, checks its route, validates the input, and enforces the applicable role or token rules.
4. For data-backed operations, the backend reads or updates MongoDB and returns a JSON response. The frontend uses the response to update the visible page.
5. For edits, the frontend sends the changed data to the appropriate API endpoint. Timetable dashboard saves are queued/debounced, and the backend merges timetable records by ID before persisting changes.
6. For **Generate from Workload**, the browser retrieves submitted workload forms, builds section requirements, and calculates timetable placements locally. It then saves the updated dashboard timetable through the API. The backend stores the result; it does not run the timetable-placement algorithm.

## Programming language and data-structure primer

The backend and browser logic are written in **JavaScript** and run on **Node.js** (backend) or in the browser (UI). The backend uses the official MongoDB Node.js driver. There is no separate Python, Java, or SQL backend in this project.

| Term | Meaning in this project |
|---|---|
| Variable (`const`, `let`) | A named value. `const` means the variable is not reassigned; `let` is used when the value changes. Objects held by a `const` can still have their properties changed. |
| Object (`{ ... }`) | A record with named fields, similar to a JSON object or one MongoDB document. Example: `{ name: "Algorithms", lectureCount: 3 }`. |
| Array (`[ ... ]`) | An ordered list of values, often records. Example: `forms` is an array of workload-form objects. |
| `.filter()` | Returns a new array containing only entries that pass a condition. It does not change the original array. |
| `.map()` | Makes a new array by transforming each entry, for example turning a subject record into a scheduling requirement. |
| `.forEach()` | Runs an action for each entry, often to group data or update the timetable. It does not create a result array. |
| `Set` | A collection of unique values, used to remove duplicate selected IDs or track days already scheduled. |
| `Map` | A key/value collection, used by the generator for teacher/subject/day tracking. |
| `async` / `await` | JavaScript syntax for waiting for asynchronous work, such as a database query or HTTP request, without blocking the server thread. |
| JSON | The text format used for browser/API messages and commonly used to represent document data. |

### Example: what a workload record looks like

This simplified JavaScript object illustrates the shape of one stored workload form. Actual records also include IDs, timestamps, email status, and other metadata:

```js
const form = {
  facultyId: 12,
  facultyName: "Asha Sharma",
  course: "B.Tech",
  semester: "semester1",
  status: "submitted",
  selectedSubjectIds: ["cs101"],
  selectedSubjects: [
    {
      id: "cs101",
      name: "Data Structures",
      code: "CS101",
      lectureCount: 3,
      labEnabled: true,
      labCount: 1,
      assignedSections: ["sectionA"]
    }
  ]
};
```

In this example, the form was submitted, the faculty member selected `cs101`, and the admin assigned that subject to Section A. Its lecture requirement is three sessions per week and its lab requirement is one session per week.

### Example: `filter` then `map` in plain terms

The generator first filters the workload forms to the chosen course/semester and submitted status. It then maps selected subjects and assigned sections into requirements. This shortened example shows the same idea (it omits some input validation and lab-only branching from the real function):

```js
const currentCourse = "B.Tech";
const currentSemester = "semester1";

const submittedForms = forms.filter(form =>
  form.status === "submitted" &&
  form.course === currentCourse &&
  form.semester === currentSemester
);

const sectionARequirements = submittedForms.flatMap(form =>
  form.selectedSubjects
    .filter(subject =>
      form.selectedSubjectIds.includes(subject.id) &&
      subject.assignedSections.includes("sectionA")
    )
    .map(subject => ({
      subjectName: subject.name,
      subjectCode: subject.code,
      teacher: form.facultyName,
      classType: "Lecture",
      lecturesPerWeek: Number(subject.lectureCount)
    }))
);
```

`filter` narrows the list; `flatMap` turns each form's selected subjects into one combined requirement list; `map` reshapes each subject into the fields the slot-placement function needs. The actual `buildDashboardWorkloadRequirementsBySection()` also creates separate lab requirements and groups requirements by section.

## Request and startup flow

1. `server.js` reads `backend/.env` if present. Values already defined in the process environment take precedence.
2. `resolveMongoConfig()` selects MongoDB settings. Local development defaults to `mongodb://127.0.0.1:27017`; a production runtime must provide `MONGODB_URI`.
3. `start()` connects to MongoDB, initializes data/counters/admin, and starts the HTTP server.
4. For each request, `handleRequest()` connects (or reuses the connection), dispatches by `/api/...` path, and returns JSON. `OPTIONS` requests get a CORS preflight response.
5. On first initialization, `connectDb()` imports `backend/data/db.json` when the application collections are empty. It can instead import the legacy `app_state` document when present.
6. API writes update MongoDB. Timetable changes made in the browser are saved with a short debounce; a successful API response updates the UI's save status.

## MongoDB collections

| Collection | Purpose |
|---|---|
| `admins` | Admin accounts; passwords are stored as PBKDF2 hashes. |
| `faculty` | Faculty registration/profile data and approval status. |
| `invites` | Admin-created faculty invite codes and their status. |
| `timetables` | Timetable records. The dashboard uses the `dashboard-state` record for its course/section grid and slot details. |
| `timeSettings` | Working days, periods, period times, lunch, and lab duration by course and semester. |
| `subjects` | Subject catalog entries, including category, course, semester, and lab flag. |
| `history` | Archived timetable snapshots; the API keeps the newest 20 records. |
| `teacherViews` | Faculty timetable views saved for admins. |
| `workloadForms` | Forwarded faculty forms, submitted subject choices, and section assignments. |
| `appSettings` | One global settings document: lab catalog/timetable, individual-lab toggles, Manage Form counts/selections, and teacher roster. |
| `meta` | Atomic counters used to allocate numeric record IDs. |

Most collections use diff-based writes: unchanged documents are not rewritten, changed/new documents are upserted, and explicit removals are deleted. The timetable `PUT` route first merges updates by `id`, so a partial dashboard save does not replace other timetable records or erase fields omitted from the update. Workload submissions and section assignments update their specific `workloadForms` document directly.

Mongo `_id` values are hidden from API responses. Time-setting, subject, history, and teacher-view records use deterministic identifiers when no numeric ID exists. Dotted keys in app settings are stored as `{ key, value }` entries rather than MongoDB object paths.

## Authentication and access rules

- Login accepts `admin` or `faculty` role and normalizes email by trimming and lowercasing it.
- `hashPassword()` uses PBKDF2-SHA256 with a random salt. `verifyPassword()` checks the stored hash using a timing-safe comparison.
- `signToken()` makes a signed token from the user ID and role. `verifyToken()` validates its HMAC signature; `requireAuth()` reads the `Bearer` token and optionally enforces a role.
- Faculty must have `status: "approved"` to log in. Admin-only operations reject faculty tokens.
- Public faculty registration-status lookup uses a random status token whose SHA-256 hash is stored; the raw token is returned at registration.
- Workload forms can be opened through a random token link. Admin form listings do not include that token.

## Backend function reference

### Startup, storage, and shared helpers

| Function | What it does |
|---|---|
| `resolveMongoConfig` | Resolves Mongo URI, database, legacy-state collection, and app origin; fails if production has no Mongo URI. |
| `loadSeedDb` | Loads `backend/data/db.json`, or returns an empty database-shaped object with initial counters. |
| `connectDb` | Creates/reuses the Mongo client, initializes collection handles, seeds/imports initial state when needed, then ensures counters and the demo admin. |
| `readDb` | Reads all application collections and counters into an in-memory object, strips Mongo IDs, and records a baseline snapshot for diff writes. |
| `snapshotCollection` | Maps each record's Mongo document ID to its serialized value for later change detection. |
| `buildCollectionDiff` | Produces upsert operations for changed/new records and IDs explicitly removed from the in-memory collection. |
| `mergeRecordsById` | Applies partial incoming records by ID while retaining fields/records not included in the update. |
| `writeDb` | Saves collection diffs (except the singleton `appSettings` document) and advances counters without moving them backward. |
| `nextDatabaseId` | Atomically increments a named counter and returns the previous counter value as the new ID. |
| `hasDocumentData` | Checks whether application collections or counters already contain data. |
| `ensureDemoAdmin` | Creates or refreshes the configured demo admin account. Credentials can be overridden with environment variables. |
| `ensureMetaCounters` | Raises each counter to at least one greater than the highest existing numeric ID. |
| `stripMongoId` | Removes MongoDB's `_id` property from a document. |
| `mongoDocumentIdFor` | Chooses the document key from a record ID or stable composite keys for settings/catalog/history/view records. |
| `buildMetaFromData` | Calculates next numeric IDs from the records already loaded. |
| `send` / `notFound` | Send a JSON response with the common CORS headers, or the standard 404 response. |
| `contentTypeFor` / `serveStatic` | Map common file extensions and safely serve frontend files from the repository root in local-server mode. |
| `parseBody` | Reads and parses a JSON request body, rejecting invalid JSON and bodies larger than 1 MB. |
| `todayLabel` | Produces the display date used for registration and invite events. |
| `normalizeEmail` / `isEmail` / `requireFields` | Normalize and validate email, and report missing required form fields. |
| `publicAdmin` / `publicFaculty` | Select profile fields safe to return to the client (not password hashes or private status-token hashes). |
| `routeKey` | Combines HTTP method and path for exact route matching. |

### Sanitizers and public data

| Function | What it does |
|---|---|
| `sanitizeTimeSetting` | Normalizes a course/semester time-setting record and derives its stable ID. |
| `sanitizeSubject` | Validates a subject name, normalizes category/elective type, and derives a stable catalog ID. |
| `sanitizeHistoryEntry` | Requires course, semester, and section, then normalizes snapshot metadata and schedule objects. |
| `sanitizeTeacherView` | Normalizes teacher identity and creates a stable ID from faculty ID or normalized name. |
| `sanitizeAppSettings` | Filters and normalizes the lab catalog, teacher roster, lecture-count map, subject-selection map, and lab timetable map. |
| `publicAppSettings` | Converts sanitized key/value setting arrays into the map-shaped response expected by the UI. |
| `sanitizeWorkloadSubjects` | Restricts workload subject fields and bounds lecture/lab weekly counts to 0–12. Empty names are discarded. |
| `workloadSubjectCounts` | Formats the weekly lecture/lab counts for form email text. |
| `publicWorkloadForm` | Selects the workload fields exposed to a faculty member using a token link. |

### Passwords, tokens, links, and email

| Function | What it does |
|---|---|
| `hashPassword` / `verifyPassword` | Create and verify salted PBKDF2-SHA256 password hashes. |
| `signToken` / `verifyToken` / `requireAuth` | Sign, validate, and authorize bearer tokens. |
| `buildInviteLink` / `buildWorkloadFormLink` | Make portal links using the configured app origin. |
| `encodeMailHeader` | Removes line breaks from email header values. |
| `escapeMailText` / `escapeMailHtml` | Prepare plain-text line endings and escape HTML text. |
| `smtpRead` / `smtpCommand` | Read SMTP replies and require the expected status codes. |
| `sendGmailMessage` | Sends multipart text/HTML mail through Gmail SMTP over TLS; returns an explicit sent/error result. |
| `sendGmailInvite` | Builds the faculty-registration invite email and delegates delivery to `sendGmailMessage`. |
| `buildWorkloadFormEmail` | Builds the faculty workload-selection email and its secure form link. |

### HTTP route handlers

| Handler | Routes and behavior |
|---|---|
| `handleAuth` | `POST /api/auth/login` verifies credentials and returns a token/profile; `GET /api/auth/me` validates the token and reloads the current profile. |
| `handleFaculty` | Admins list, approve, reject, and delete faculty. Public sign-up validates fields/email/invite, creates a pending faculty record, and returns a status token. `POST /api/faculty/status` checks registration status using the hashed token. |
| `handleInvites` | Admins list/create/delete invites. Creation validates uniqueness, makes a random code, attempts email delivery, and records whether the email was sent. A public lookup returns only a pending invite. |
| `handleAdmins` | Admins list and create admin accounts; creation validates required fields and unique email. |
| `handleTimetables` | Logged-in users can read timetables. Admins can create, patch, or merge-save timetable records. The dashboard uses the merge-save route to persist its state. |
| `handleTimeSettings` | Logged-in users read settings; admins can add/update one or more sanitized settings by course and semester. |
| `handleSubjects` | Logged-in users read subjects; admins replace the submitted sanitized catalog, deduplicated by stable subject ID. |
| `handleHistory` | Logged-in users read history; admins save sanitized snapshots, sorted newest-first and limited to 20. |
| `handleTeacherViews` | Admins read and upsert the saved timetable view for a faculty member/normalized teacher. |
| `handleWorkloadForms` | Routes admin workload-form listing/creation, faculty-authenticated form listing/submission, token-based form viewing/submission, and admin section assignments. |
| `handleAppSettings` | Admin-only read/write of the singleton settings record; writes validate object shape and sanitize fields. |
| `handleRequest` | Applies CORS preflight, connects to Mongo, routes API calls, serves local static files, and returns a JSON 500 for thrown errors. |
| `start` | Connects to Mongo and starts the local HTTP server. |

### Workload-form functions

| Function | What it does |
|---|---|
| `submitWorkloadForm` | Rejects missing/already-submitted forms, validates selected subject IDs against the forwarded list, requires at least one choice, and atomically marks the form submitted. |
| `createWorkloadForm` | Requires an approved faculty member, sanitizes and validates subject IDs, allocates a form ID, stores the pending form, emails the faculty, then records mail delivery status. |
| `listFacultyWorkloadForms` | Returns only forms owned by the authenticated faculty account, newest first. |
| `submitFacultyWorkloadForm` | Resolves a form by ID and authenticated faculty ID, then uses the shared submit flow. |
| `handleTokenWorkloadForm` | Uses the private token to show a form or submit it without a faculty login. |
| `listAdminWorkloadForms` | Returns admin workload data newest first while removing the private form token. |
| `assignWorkloadSubjectSections` | Admin-only; stores up to two unique section assignments (`sectionA`, `sectionB`, `sectionC`) on a selected subject in its specific form document. |

## Generate from Workload: end-to-end logic

1. **Prepare the requested workload.** In Manage Form, admins choose approved faculty, subjects, and weekly lecture/lab counts. `POST /api/workload-forms` creates one form per selected faculty member. The backend stores the requested counts with each forwarded subject.
2. **Faculty selects subjects.** A faculty member opens the emailed token link or signs in, chooses one or more listed subject IDs, and submits. The backend checks that every submitted ID belongs to that form and changes its status from `pending` to `submitted`.
3. **Admin assigns sections.** Manage Workload lets an admin assign each faculty-selected subject to up to two sections. Those section IDs are saved with the selected subject in MongoDB.
4. **Generator fetches the source records.** `generateDashboardTimetable()` calls `GET /api/workload-forms`. The route is admin-only and returns forms without their private tokens.
5. **Requirements are filtered and grouped.** `buildDashboardWorkloadRequirementsBySection()` uses only forms that are `submitted` and match the currently selected course and semester. It also checks the selected subject IDs, then turns each assigned subject/section into a weekly requirement:
   - a regular subject contributes its `lectureCount`;
   - a regular subject with labs enabled contributes its separate `labCount` as a lab requirement;
   - a lab-only subject contributes `labCount`, falling back to `lectureCount`;
   - weekly counts are converted to non-negative whole numbers;
   - only the known section IDs A/B/C are included.
6. **Apply the individual-lab setting at generation time.** `buildDashboardWorkloadRequirementsBySection()` resolves the Manage Lab toggle for each subject using its identity and course/semester scope. A toggle-on lab is marked `individualLab` and remains independent; a toggle-off lab is eligible to pair with a different lab subject for P1/P2. Workload records remain unchanged.
7. **Generate each section in turn.** The UI temporarily selects each section with requirements and calls `autoGenerateDashboardTimetable()`. The current section is restored after the loop. The UI displays how many timetable cells were filled and any unmet weekly requirements.
8. **Save the timetable.** Generation changes the browser's in-memory schedule and slot details. The dashboard's save queue sends the `dashboard-state` record to `PUT /api/timetables`; the backend merges it by ID and persists only changed documents.

If there are no submitted subject assignments with sections, generation stops and asks the admin to use Manage Workload first. Existing timetable entries are preserved except legacy P1/P2-paired lab slots that match the current lab requirements; those stale slots are cleared so labs can be regenerated according to their current toggle state.

### Worked example: from form to timetable requirement

Suppose Asha's submitted form contains the example above. For B.Tech / Semester 1, the generator:

1. Keeps the form because its status, course, and semester match the current dashboard.
2. Checks that `cs101` is in `selectedSubjectIds`; this prevents an unselected forwarded subject from being scheduled.
3. Reads `assignedSections` and adds the subject to Section A's requirements.
4. Creates a lecture requirement for 3 per week and a lab requirement for 1 per week.
5. Tries to place those requirements into available Section A cells. Each lecture occupies one cell; each lab occupies two consecutive cells.
6. Reports a shortfall if conflicts or occupied cells prevent the weekly count from being reached.

The browser timetable is also represented with JavaScript objects and arrays. Conceptually, a generated slot is stored like this:

```js
const slotData = {
  subject: "Data Structures (CS101)",
  subjectName: "Data Structures",
  subjectCode: "CS101",
  teacher: "Asha Sharma",
  classType: "Lecture"
};
```

The dashboard indexes slot details by a composite string key such as `semester1|sectionA|Monday|0`. It separately keeps a day/period grid for display. Individual labs have one assignment and no batch labels; toggle-off paired labs keep separate P1 and P2 assignments in one slot. Previously saved same-subject shared assignments remain readable for compatibility, but the Manage Lab toggle no longer creates them. These dashboard structures are bundled into the `dashboard-state` timetable record and sent as JSON to the backend for persistence.

## Slot placement rules

`autoGenerateDashboardTimetable()` works with the selected course, semester, and section:

- It reads working days, period count, and period times from the course settings.
- It builds teacher occupancy from existing slot assignments across timetable courses. Teacher names are normalized by trimming, lowercasing, and collapsing spaces.
- It tracks matching sessions by course, semester, section, and day. Generation first tries to schedule each subject no more than once per day; if its weekly count is still short, it retries with a maximum of two sessions for that subject on a day.
- Empty-slot checks reject occupied cells and lunch; a lab requires two consecutive empty periods.
- Cross-section checks reject a teacher already occupied at that same period. Lab placement additionally checks for conflicting use of a lab subject/room reservation in the lab timetable.
- Candidate days and periods are shuffled, then regular requirements are considered in descending weekly-count order. Because the candidate order is randomized, generated timetables may differ between runs.
- Existing matching assignments count toward each requirement, so rerunning generation can fill remaining empty slots rather than intentionally duplicating already-counted sessions.
- A weekly count that cannot fit is returned as a conflict/shortfall, not treated as a successful full schedule.

The generator does not select or reserve a physical room for newly generated lab assignments; the generated slot room field is blank. The admin can enter rooms in the slot editor, which validates room conflicts.

## Individual lab setting

The Manage Lab **Individual lab (no P1/P2)** toggle is persisted in `appSettings.sharedLabSubjects`, keyed by course, semester, and subject identity. Although the existing storage/API field retains its historical `sharedLabSubjects` name, an enabled toggle means this subject is scheduled individually, without P1/P2 pairing or labels. When disabled, it is paired with a different lab subject for P1 and P2. The setting is not stored on a lab-catalog row, so unrelated courses and semesters do not inherit it. The same subject setting applies independently to each section where that subject is assigned.

- A toggle-on lab remains one subject/session, is counted once toward its weekly requirement, and occupies two consecutive timetable periods.
- The subject is not paired with a second lab and has no P1/P2 batch assignments. Its timetable entry is displayed once.
- Toggle-off lab workload sessions are paired with different subjects for P1 and P2 within the same section/course/semester. Each subject retains its own teacher and room, is counted once per paired session, and shares the same two-period time window.
- A lab requirement without a different toggle-off subject, with no distinct teacher, or with both subjects mapped to the same lab resource is reported as unmatched instead of being scheduled unsafely.
- The original workload forms are not modified, and settings are resolved separately by subject, course, and semester.
- Lab placement continues to honor empty-slot, teacher, mapped-lab, and room conflict checks.
- Before regeneration, legacy P1/P2-paired lab slots matching current requirements are cleared so obsolete batch assignments are not retained.

### Manual lab editing

`saveDashboardSlot()` applies corresponding validation for manually entered lab slots:

- With the Individual lab toggle ON, the editor accepts one lab subject, one faculty member, and one physical lab room.
- When the selected subject's Individual lab toggle is ON, the editor stores one lab assignment with no batch labels. When OFF, it requires different lab subjects, teachers, and rooms for P1 and P2.
- A lab uses the selected period and the immediately following period; the following period must exist and be free.
- Teacher, lab, and room conflicts are checked across courses, semesters, and sections before the slot is written.
- Both cells store the relevant subject, teacher, room, class type, and other slot details. Toggle-off P1/P2 pairs use `batchAssignments` to preserve each batch's distinct assignment.

## Other important behavior

- **Timetable history:** the browser archives a section snapshot before clearing it. The history API stores schedule and slot details and limits the history collection to the newest 20 entries.
- **Lab timetable/settings:** `appSettings` holds the lab catalog, lab timetable reservations, Manage Form counts/selections, and manually imported teacher roster. Generated workload lab assignments appear in the mapped lab's timetable when their subject name/code matches the lab allocation; a trailing `Lab` in the saved allocation label is treated as an equivalent subject name. The API sanitizes these fields and returns keyed maps to the browser.
- **Lab pairing:** The Manage Lab toggle persists per subject/course/semester through `PUT /api/app-settings/shared-lab-subjects`. Enabling it does not change `workloadForms`; enabled subjects schedule individually, while disabled subjects pair with a different lab subject for P1/P2. Teacher and mapped-lab conflict checks apply to both assignments.
- **Faculty workload view:** faculty can list only their own forwarded forms; admin Manage Workload reads all forms and updates selected-subject section assignments.
- **Email delivery:** missing Gmail configuration or SMTP errors are returned as delivery status. The form/invite is still saved, so an admin can see and address an email that was not sent.

## Main API routes

| Method and path | Access | Purpose |
|---|---|---|
| `GET /api/health` | Public | Backend health response. |
| `POST /api/auth/login`, `GET /api/auth/me` | Public / logged-in | Login and current-user lookup. |
| `GET /api/faculty` | Admin | List faculty. |
| `POST /api/faculty/signup`, `POST /api/faculty/status` | Public | Register and check registration status. |
| `PATCH /api/faculty/:id/approve`, `PATCH /api/faculty/:id/reject`, `DELETE /api/faculty/:id` | Admin | Manage faculty access and records. |
| `GET/POST /api/invites`, `DELETE /api/invites/:id` | Admin | Manage faculty invitations. `GET /api/invites/lookup/:code` is public. |
| `GET/POST /api/admins` | Admin | List/create admins. |
| `GET/POST /api/timetables`, `PUT /api/timetables`, `PATCH /api/timetables/:id` | Logged-in read; admin write | Read and persist timetable records. |
| `GET/POST /api/time-settings` | Logged-in read; admin write | Read and save course/semester time settings. |
| `GET/PUT /api/subjects` | Logged-in read; admin write | Read and replace the subject catalog. |
| `GET/PUT /api/history` | Logged-in read; admin write | Read and save archived timetable history. |
| `GET/POST /api/teacher-views` | Admin | Read and save faculty timetable views. |
| `GET/POST /api/workload-forms` | Admin | List forms and forward subjects to approved faculty. |
| `GET /api/workload-forms/faculty`, `POST /api/workload-forms/:id/faculty-submit` | Faculty | List and submit the current faculty member's forms. |
| `GET /api/workload-forms/:token`, `POST /api/workload-forms/:token/submit` | Form token | Open and submit an emailed form. |
| `PATCH /api/workload-forms/:id/subjects/:subjectId/sections` | Admin | Assign selected subject to sections. |
| `GET/PUT /api/app-settings` | Admin | Read and save the singleton settings document while preserving shared-lab toggle settings. |
| `PUT /api/app-settings/shared-lab-subjects` | Admin | Save shared-lab toggles independently from other app settings. |

## Tests related to these flows

From the `backend` directory, the repository's focused checks can be run with:

```text
node data-persistence.test.js
node mongo-config.test.js
node ../modules/timetable-generation.test.js
```

They cover diff/merge persistence behavior, Mongo configuration requirements, and teacher/subject/day duplicate scoping used by timetable generation.
