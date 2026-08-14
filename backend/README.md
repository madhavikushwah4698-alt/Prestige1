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
```

Protected endpoints need:

```text
Authorization: Bearer <token>
```

## Storage

Data is saved in MongoDB collection:

```text
prestige_access_portal.app_state
```

On first startup, the backend seeds MongoDB from `backend/data/db.json` if the MongoDB state document does not exist yet. After that, all writes go to MongoDB.
"# Prestige" 
