const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const tls = require('tls');
const { MongoClient } = require('mongodb');

const ENV_PATH = path.join(__dirname, '.env');
if (fs.existsSync(ENV_PATH)) {
  const envText = fs.readFileSync(ENV_PATH, 'utf8');
  envText.split(/\r?\n/).forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex === -1) return;
    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim().replace(/^['"]|['"]$/g, '');
    if (key && process.env[key] === undefined) process.env[key] = value;
  });
}

const PORT = Number(process.env.PORT || 4000);
const TOKEN_SECRET = process.env.TOKEN_SECRET || 'change-this-secret-before-production';
const SEED_DB_PATH = path.join(__dirname, 'data', 'db.json');
const FRONTEND_ROOT = path.resolve(__dirname, '..');
const isProductionRuntime = Boolean(process.env.NODE_ENV === 'production' || process.env.VERCEL || process.env.RENDER || process.env.NETLIFY || process.env.RAILWAY_ENVIRONMENT_NAME);

function resolveMongoConfig(env = process.env) {
  const providedMongoUri = String(env.MONGODB_URI || '').trim();
  const mongoUri = providedMongoUri || (!isProductionRuntime ? 'mongodb://127.0.0.1:27017' : null);

  if (!mongoUri) {
    throw new Error('MONGODB_URI is required in production deployments. Set it to your MongoDB Atlas or MongoDB connection string.');
  }

  return {
    APP_ORIGIN: env.APP_ORIGIN || (env.VERCEL_URL ? `https://${env.VERCEL_URL}` : 'http://localhost:4000'),
    MONGODB_URI: mongoUri,
    MONGODB_DB: env.MONGODB_DB || 'prestige_access_portal',
    MONGODB_STATE_COLLECTION: env.MONGODB_STATE_COLLECTION || 'app_state'
  };
}

const { APP_ORIGIN, MONGODB_URI, MONGODB_DB, MONGODB_STATE_COLLECTION } = resolveMongoConfig(process.env);
const GMAIL_USER = String(process.env.GMAIL_USER || '').trim();
const GMAIL_APP_PASSWORD = String(process.env.GMAIL_APP_PASSWORD || '').replace(/\s+/g, '');
const DEMO_ADMIN_EMAIL = normalizeEmail(process.env.DEMO_ADMIN_EMAIL || 'admin@prestige.edu');
const DEMO_ADMIN_PASSWORD = process.env.DEMO_ADMIN_PASSWORD || 'Admin@123';
const DEMO_ADMIN_NAME = process.env.DEMO_ADMIN_NAME || 'Registrar Admin';
const STATE_DOCUMENT_ID = 'prestige-state';
const COLLECTION_NAMES = ['admins', 'faculty', 'invites', 'timetables', 'timeSettings', 'subjects', 'history', 'teacherViews', 'workloadForms', 'appSettings'];

const jsonHeaders = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization'
};

let mongoClient;
let mongoDb;
let collections;
let metaCollection;
let dbConnectionPromise;

function loadSeedDb() {
  if (fs.existsSync(SEED_DB_PATH)) {
    return JSON.parse(fs.readFileSync(SEED_DB_PATH, 'utf8'));
  }
  return {
    admins: [],
    faculty: [],
    invites: [],
    timetables: [],
    timeSettings: [],
    subjects: [],
    history: [],
    teacherViews: [],
    workloadForms: [],
    appSettings: [],
    meta: {
      nextAdminId: 1,
      nextFacultyId: 1,
      nextInviteId: 1,
      nextTimetableId: 1,
      nextWorkloadFormId: 1
    }
  };
}

async function connectDb() {
  if (mongoDb) return;
  if (dbConnectionPromise) return dbConnectionPromise;

  dbConnectionPromise = (async () => {
    mongoClient = new MongoClient(MONGODB_URI);
    await mongoClient.connect();
    mongoDb = mongoClient.db(MONGODB_DB);
    collections = Object.fromEntries(COLLECTION_NAMES.map(name => [name, mongoDb.collection(name)]));
    metaCollection = mongoDb.collection('meta');

    const hasCollectionData = await hasDocumentData();
    if (!hasCollectionData) {
      const legacyState = await mongoDb.collection(MONGODB_STATE_COLLECTION).findOne({ _id: STATE_DOCUMENT_ID });
      await writeDb(legacyState?.state || loadSeedDb());
    }

    await ensureDemoAdmin();
  })();

  try {
    return await dbConnectionPromise;
  } catch (error) {
    dbConnectionPromise = undefined;
    throw error;
  }
}

async function readDb() {
  const db = {};
  for (const name of COLLECTION_NAMES) {
    db[name] = (await collections[name].find({}, { projection: { _id: 0 } }).sort({ id: 1 }).toArray())
      .map(stripMongoId);
  }

  const metaDocument = await metaCollection.findOne({ _id: 'counters' }, { projection: { _id: 0 } });
  db.meta = metaDocument || buildMetaFromData(db);
  return db;
}

async function writeDb(db) {
  for (const name of COLLECTION_NAMES) {
    if (name === 'appSettings') continue;
    await collections[name].deleteMany({});
    const records = (db[name] || []).map(item => ({ ...item, _id: mongoDocumentIdFor(name, item) }));
    if (records.length) await collections[name].insertMany(records);
  }

  await metaCollection.replaceOne(
    { _id: 'counters' },
    { _id: 'counters', ...db.meta, updatedAt: new Date() },
    { upsert: true }
  );
}

async function hasDocumentData() {
  for (const name of COLLECTION_NAMES) {
    if (await collections[name].findOne({})) return true;
  }
  return Boolean(await metaCollection.findOne({ _id: 'counters' }));
}

async function ensureDemoAdmin() {
  if (!DEMO_ADMIN_EMAIL || !DEMO_ADMIN_PASSWORD) return;

  await ensureMetaCounters();

  const existingAdmin = await collections.admins.findOne({ email: DEMO_ADMIN_EMAIL });
  if (existingAdmin) {
    const passwordMatches = verifyPassword(DEMO_ADMIN_PASSWORD, existingAdmin.passwordHash);
    if (!passwordMatches || existingAdmin.name !== DEMO_ADMIN_NAME) {
      await collections.admins.updateOne(
        { _id: existingAdmin._id },
        {
          $set: {
            name: DEMO_ADMIN_NAME,
            email: DEMO_ADMIN_EMAIL,
            passwordHash: passwordMatches ? existingAdmin.passwordHash : hashPassword(DEMO_ADMIN_PASSWORD),
            updatedAt: new Date().toISOString()
          }
        }
      );
    }
    return;
  }

  const metaDocument = await metaCollection.findOne({ _id: 'counters' }, { projection: { _id: 0 } });
  const highestAdmin = await collections.admins.find({ id: { $type: 'number' } }).sort({ id: -1 }).limit(1).next();
  const nextAdminId = Math.max(Number(metaDocument?.nextAdminId) || 1, Number(highestAdmin?.id || 0) + 1);

  await collections.admins.insertOne({
    _id: nextAdminId,
    id: nextAdminId,
    name: DEMO_ADMIN_NAME,
    email: DEMO_ADMIN_EMAIL,
    passwordHash: hashPassword(DEMO_ADMIN_PASSWORD),
    createdAt: new Date().toISOString()
  });

  await metaCollection.updateOne(
    { _id: 'counters' },
    { $max: { nextAdminId: nextAdminId + 1 } },
    { upsert: true }
  );
}

async function ensureMetaCounters() {
  const db = await readDb();
  await metaCollection.updateOne(
    { _id: 'counters' },
    {
      $set: {
        nextAdminId: Math.max(Number(db.meta?.nextAdminId) || 1, buildMetaFromData(db).nextAdminId),
        nextFacultyId: Math.max(Number(db.meta?.nextFacultyId) || 1, buildMetaFromData(db).nextFacultyId),
        nextInviteId: Math.max(Number(db.meta?.nextInviteId) || 1, buildMetaFromData(db).nextInviteId),
        nextTimetableId: Math.max(Number(db.meta?.nextTimetableId) || 1, buildMetaFromData(db).nextTimetableId),
        nextWorkloadFormId: Math.max(Number(db.meta?.nextWorkloadFormId) || 1, buildMetaFromData(db).nextWorkloadFormId)
      }
    },
    { upsert: true }
  );
}

function stripMongoId(document) {
  const { _id, ...rest } = document;
  return rest;
}

function mongoDocumentIdFor(collectionName, item) {
  if (item.id) return item.id;
  if (collectionName === 'timeSettings') return `${item.course}|${item.semester}`;
  if (collectionName === 'subjects') {
    return [
      item.course || '',
      item.semester || '',
      item.category || 'main',
      item.electiveType || 'program',
      item.isLab ? 'lab' : 'subject',
      item.name || '',
      item.code || ''
    ].join('|').toLowerCase();
  }
  if (collectionName === 'history') return item.id || crypto.randomUUID();
  if (collectionName === 'teacherViews') return item.id || (item.facultyId ? `faculty-${item.facultyId}` : `teacher-${item.normalizedTeacherName || crypto.randomUUID()}`);
  return crypto.randomUUID();
}

function buildMetaFromData(db) {
  const nextIdFor = records => Math.max(0, ...records.map(item => Number(item.id) || 0)) + 1;
  return {
    nextAdminId: nextIdFor(db.admins || []),
    nextFacultyId: nextIdFor(db.faculty || []),
    nextInviteId: nextIdFor(db.invites || []),
    nextTimetableId: nextIdFor(db.timetables || []),
    nextWorkloadFormId: nextIdFor(db.workloadForms || [])
  };
}

function send(res, status, payload) {
  res.writeHead(status, jsonHeaders);
  res.end(JSON.stringify(payload));
}

function notFound(res) {
  send(res, 404, { error: 'Route not found' });
}

function contentTypeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml; charset=utf-8'
  }[ext] || 'application/octet-stream';
}

function serveStatic(req, res, pathname) {
  if (!['GET', 'HEAD'].includes(req.method)) return false;
  const routePath = pathname === '/' ? '/claude_clone.html' : pathname;
  const decodedPath = decodeURIComponent(routePath).replace(/^\/+/, '');
  const filePath = path.resolve(FRONTEND_ROOT, decodedPath);
  if (!filePath.startsWith(FRONTEND_ROOT + path.sep)) return false;
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return false;

  res.writeHead(200, { 'Content-Type': contentTypeFor(filePath) });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(filePath).pipe(res);
  return true;
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1_000_000) {
        req.destroy();
        reject(new Error('Request body too large'));
      }
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function todayLabel() {
  return new Date().toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  });
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function publicAdmin(admin) {
  return {
    id: admin.id,
    name: admin.name,
    email: admin.email,
    createdAt: admin.createdAt
  };
}

function publicFaculty(faculty) {
  return {
    id: faculty.id,
    name: faculty.name,
    dept: faculty.dept,
    empid: faculty.empid,
    email: faculty.email,
    status: faculty.status,
    appliedOn: faculty.appliedOn,
    approvedOn: faculty.approvedOn,
    invitedBy: Boolean(faculty.invitedBy),
    createdAt: faculty.createdAt
  };
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const iterations = 120000;
  const hash = crypto.pbkdf2Sync(String(password), salt, iterations, 32, 'sha256').toString('hex');
  return `pbkdf2_sha256$${iterations}$${salt}$${hash}`;
}

function verifyPassword(password, stored) {
  const [scheme, iterationsText, salt, hash] = String(stored || '').split('$');
  if (scheme !== 'pbkdf2_sha256' || !iterationsText || !salt || !hash) return false;
  const testHash = crypto.pbkdf2Sync(String(password), salt, Number(iterationsText), 32, 'sha256').toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(testHash, 'hex'));
}

function signToken(payload) {
  const body = Buffer.from(JSON.stringify({ ...payload, iat: Date.now() })).toString('base64url');
  const signature = crypto.createHmac('sha256', TOKEN_SECRET).update(body).digest('base64url');
  return `${body}.${signature}`;
}

function verifyToken(token) {
  if (!token || !token.includes('.')) return null;
  const [body, signature] = token.split('.');
  const expected = crypto.createHmac('sha256', TOKEN_SECRET).update(body).digest('base64url');
  if (signature.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  try {
    return JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

function requireAuth(req, role) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const user = verifyToken(token);
  if (!user) return null;
  if (role && user.role !== role) return null;
  return user;
}

function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || ''));
}

function requireFields(body, fields) {
  return fields.filter(field => !String(body[field] || '').trim());
}

function sanitizeTimeSetting(raw) {
  const course = String(raw.course || '').trim();
  const semester = String(raw.semester || '').trim();
  if (!course || !semester) return null;

  const setting = raw.settings && typeof raw.settings === 'object' ? raw.settings : raw;
  return {
    id: `${course}|${semester}`,
    course,
    semester,
    start: String(setting.start || '').trim(),
    end: String(setting.end || '').trim(),
    startDate: String(setting.startDate || '').trim(),
    endDate: String(setting.endDate || '').trim(),
    duration: Number(setting.duration) || 0,
    labDuration: Number(setting.labDuration) || 0,
    lunchStart: String(setting.lunchStart || '').trim(),
    lunchEnd: String(setting.lunchEnd || '').trim(),
    workingDays: Array.isArray(setting.workingDays) ? setting.workingDays.map(day => String(day).trim()).filter(Boolean) : [],
    periodTimes: Array.isArray(setting.periodTimes) ? setting.periodTimes.map(time => String(time).trim()).filter(Boolean) : [],
    periodCount: Number(setting.periodCount) || (Array.isArray(setting.periodTimes) ? setting.periodTimes.length : 0)
  };
}

function sanitizeSubject(raw) {
  const name = String(raw.name || '').trim();
  if (!name) return null;
  const course = String(raw.course || 'B.Tech').trim() || 'B.Tech';
  const semester = String(raw.semester || 'semester1').trim() || 'semester1';
  const validCategories = ['main', 'elective', 'placement'];
  const categoryInput = String(raw.category || 'main').trim().toLowerCase();
  const category = validCategories.includes(categoryInput) ? categoryInput : 'main';
  const electiveType = category === 'elective' && String(raw.electiveType || '').trim() === 'open' ? 'open' : 'program';

  return {
    id: [
      course,
      semester,
      category,
      electiveType,
      raw.isLab ? 'lab' : 'subject',
      name,
      String(raw.code || '').trim()
    ].join('|').toLowerCase(),
    name,
    code: String(raw.code || '').trim(),
    category,
    electiveType,
    isLab: Boolean(raw.isLab),
    course,
    semester
  };
}

function sanitizeHistoryEntry(raw) {
  const id = String(raw.id || '').trim() || `dashboard-history-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  const course = String(raw.course || '').trim();
  const semester = String(raw.semester || '').trim();
  const section = String(raw.section || '').trim();
  if (!course || !semester || !section) return null;

  return {
    id,
    course,
    semester,
    section,
    timestamp: raw.timestamp ? String(raw.timestamp) : new Date().toISOString(),
    entryCount: Number(raw.entryCount) || 0,
    schedule: raw.schedule && typeof raw.schedule === 'object' ? raw.schedule : {},
    slotData: raw.slotData && typeof raw.slotData === 'object' ? raw.slotData : {}
  };
}

function sanitizeTeacherView(raw) {
  const teacherName = String(raw.teacherName || '').trim();
  const normalizedTeacherName = String(raw.normalizedTeacherName || teacherName).trim().toLowerCase().replace(/\s+/g, ' ');
  if (!teacherName) return null;

  const facultyId = raw.facultyId === null || raw.facultyId === undefined || raw.facultyId === ''
    ? null
    : Number(raw.facultyId);
  const id = facultyId ? `faculty-${facultyId}` : `teacher-${normalizedTeacherName}`;

  return {
    id,
    facultyId: facultyId || null,
    teacherName,
    normalizedTeacherName,
    email: String(raw.email || '').trim(),
    dept: String(raw.dept || '').trim(),
    empid: String(raw.empid || '').trim(),
    viewedAt: raw.viewedAt ? String(raw.viewedAt) : new Date().toISOString(),
    courseTables: Array.isArray(raw.courseTables) ? raw.courseTables : []
  };
}

function sanitizeAppSettings(raw) {
  const isRecord = value => value && typeof value === 'object' && !Array.isArray(value);
  const labCatalog = Array.isArray(raw.labCatalog)
    ? raw.labCatalog.filter(lab => isRecord(lab) && String(lab.id || '').trim() && String(lab.name || '').trim()).map(lab => ({
      id: String(lab.id).trim(),
      name: String(lab.name).trim(),
      subjects: Array.isArray(lab.subjects) ? lab.subjects.filter(isRecord).map(subject => ({
        key: String(subject.key || '').trim(),
        label: String(subject.label || '').trim(),
        course: String(subject.course || 'B.Tech').trim(),
        semester: String(subject.semester || 'semester1').trim()
      })).filter(subject => subject.label) : [],
      createdAt: String(lab.createdAt || '')
    }))
    : [];
  const lectureCounts = isRecord(raw.manageFormLectureCounts) ? Object.fromEntries(
    Object.entries(raw.manageFormLectureCounts).filter(([key, value]) => (
      !key.startsWith('$') && !key.includes('.') &&
      (typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value)))
    ))
  ) : {};
  const subjectSelections = isRecord(raw.manageFormSubjectSelections) ? Object.fromEntries(
    Object.entries(raw.manageFormSubjectSelections).filter(([key, value]) => (
      !key.startsWith('$') && !key.includes('.') && typeof value === 'boolean'
    ))
  ) : {};
  const labTimetable = isRecord(raw.labTimetable)
    ? Object.fromEntries(Object.entries(raw.labTimetable).filter(([key]) => !key.startsWith('$') && !key.includes('.')))
    : {};

  return {
    id: 'global',
    labCatalog,
    labTimetable,
    manageFormLectureCounts: lectureCounts,
    manageFormSubjectSelections: subjectSelections,
    teacherRoster: Array.isArray(raw.teacherRoster)
      ? [...new Set(raw.teacherRoster.map(name => String(name || '').trim()).filter(Boolean))]
      : []
  };
}

function routeKey(method, pathname) {
  return `${method} ${pathname}`;
}

function buildInviteLink(req, inviteCode) {
  const host = req.headers.host || `localhost:${PORT}`;
  const origin = new URL(APP_ORIGIN || `http://${host}`).origin;
  return `${origin}/?inviteCode=${encodeURIComponent(inviteCode)}`;
}

function buildWorkloadFormLink(req, token) {
  const host = req.headers.host || `localhost:${PORT}`;
  const origin = new URL(APP_ORIGIN || `http://${host}`).origin;
  return `${origin}/?workloadForm=${encodeURIComponent(token)}`;
}

function encodeMailHeader(value) {
  return String(value || '').replace(/[\r\n]+/g, ' ').trim();
}

function escapeMailText(value) {
  return String(value || '').replace(/\r?\n/g, '\r\n');
}

function escapeMailHtml(value) {
  return String(value || '').replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);
}

function smtpRead(socket) {
  return new Promise((resolve, reject) => {
    let data = '';
    const cleanup = () => {
      socket.off('data', onData);
      socket.off('error', onError);
    };
    const onError = error => {
      cleanup();
      reject(error);
    };
    const onData = chunk => {
      data += chunk.toString('utf8');
      const lines = data.split(/\r?\n/).filter(Boolean);
      if (lines.length && /^\d{3} /.test(lines[lines.length - 1])) {
        cleanup();
        resolve(data);
      }
    };
    socket.on('data', onData);
    socket.on('error', onError);
  });
}

async function smtpCommand(socket, command, expectedCodes) {
  if (command) socket.write(`${command}\r\n`);
  const response = await smtpRead(socket);
  const code = Number(response.slice(0, 3));
  if (!expectedCodes.includes(code)) {
    throw new Error(`Gmail SMTP failed: ${response.trim()}`);
  }
  return response;
}

async function sendGmailMessage(email, subject, text, html) {
  if (!GMAIL_USER || !GMAIL_APP_PASSWORD) {
    return { sent: false, error: 'Gmail is not configured. Set GMAIL_USER and GMAIL_APP_PASSWORD.' };
  }

  const socket = tls.connect({
    host: 'smtp.gmail.com',
    port: 465,
    servername: 'smtp.gmail.com',
    timeout: 20000
  });

  try {
    await new Promise((resolve, reject) => {
      socket.once('secureConnect', resolve);
      socket.once('error', reject);
      socket.once('timeout', () => reject(new Error('Gmail SMTP connection timed out')));
    });

    await smtpCommand(socket, null, [220]);
    await smtpCommand(socket, `EHLO ${encodeMailHeader(GMAIL_USER.split('@')[1] || 'localhost')}`, [250]);
    await smtpCommand(socket, 'AUTH LOGIN', [334]);
    await smtpCommand(socket, Buffer.from(GMAIL_USER).toString('base64'), [334]);
    await smtpCommand(socket, Buffer.from(GMAIL_APP_PASSWORD).toString('base64'), [235]);
    await smtpCommand(socket, `MAIL FROM:<${GMAIL_USER}>`, [250]);
    await smtpCommand(socket, `RCPT TO:<${email}>`, [250, 251]);
    await smtpCommand(socket, 'DATA', [354]);

    const boundary = `prestige-${crypto.randomBytes(8).toString('hex')}`;
    const message = [
      `From: ${encodeMailHeader(GMAIL_USER)}`,
      `To: ${encodeMailHeader(email)}`,
      `Subject: ${encodeMailHeader(subject)}`,
      'MIME-Version: 1.0',
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      '',
      `--${boundary}`,
      'Content-Type: text/plain; charset=UTF-8',
      '',
      escapeMailText(text),
      `--${boundary}`,
      'Content-Type: text/html; charset=UTF-8',
      '',
      html,
      `--${boundary}--`,
      '.'
    ].join('\r\n');

    await smtpCommand(socket, message, [250]);
    await smtpCommand(socket, 'QUIT', [221]);
    return { sent: true };
  } catch (error) {
    return { sent: false, error: error.message || 'Unable to send Gmail message' };
  } finally {
    socket.end();
  }
}

async function sendGmailInvite(email, inviteLink) {
  const text = [
    'Hello,',
    '',
    'You have been invited to register as faculty on the Prestige Institute portal.',
    '',
    `Open this link to complete your registration: ${inviteLink}`,
    '',
    'After registration, the admin office can approve your faculty access.',
    '',
    'Prestige Institute'
  ].join('\n');
  const html = `<!doctype html>
<html>
<body style="font-family:Arial,sans-serif;line-height:1.5;color:#111827;">
  <p>Hello,</p>
  <p>You have been invited to register as faculty on the Prestige Institute portal.</p>
  <p><a href="${inviteLink}" style="display:inline-block;background:#2563eb;color:#ffffff;padding:10px 14px;text-decoration:none;border-radius:6px;">Register as faculty</a></p>
  <p>Or open this link:<br><a href="${inviteLink}">${inviteLink}</a></p>
  <p>After registration, the admin office can approve your faculty access.</p>
  <p>Prestige Institute</p>
</body>
</html>`;
  return sendGmailMessage(email, 'Faculty registration invite', text, html);
}

async function handleAuth(req, res, pathname) {
  const db = await readDb();
  const body = await parseBody(req);

  if (routeKey(req.method, pathname) === 'POST /api/auth/login') {
    const email = normalizeEmail(body.email);
    const password = body.password;
    const role = body.role === 'admin' ? 'admin' : 'faculty';
    const collection = role === 'admin' ? db.admins : db.faculty;
    const user = collection.find(item => normalizeEmail(item.email) === email);

    if (!user || !verifyPassword(password, user.passwordHash)) {
      return send(res, 401, { error: 'Invalid email or password' });
    }

    if (role === 'faculty' && user.status !== 'approved') {
      return send(res, 403, {
        error: 'Faculty account is not approved yet',
        faculty: publicFaculty(user)
      });
    }

    const token = signToken({ id: user.id, role });
    return send(res, 200, {
      token,
      role,
      user: role === 'admin' ? publicAdmin(user) : publicFaculty(user)
    });
  }

  if (routeKey(req.method, pathname) === 'GET /api/auth/me') {
    const auth = requireAuth(req);
    if (!auth) return send(res, 401, { error: 'Unauthorized' });
    const collection = auth.role === 'admin' ? db.admins : db.faculty;
    const user = collection.find(item => item.id === auth.id);
    if (!user) return send(res, 401, { error: 'User no longer exists' });
    return send(res, 200, {
      role: auth.role,
      user: auth.role === 'admin' ? publicAdmin(user) : publicFaculty(user)
    });
  }

  return notFound(res);
}

async function handleFaculty(req, res, pathname) {
  const db = await readDb();

  if (routeKey(req.method, pathname) === 'GET /api/faculty') {
    if (!requireAuth(req, 'admin')) return send(res, 401, { error: 'Admin login required' });
    return send(res, 200, { faculty: db.faculty.map(publicFaculty) });
  }

  if (routeKey(req.method, pathname) === 'POST /api/faculty/signup') {
    const body = await parseBody(req);
    const missing = requireFields(body, ['name', 'dept', 'empid', 'email', 'password']);
    if (missing.length) return send(res, 400, { error: `Missing fields: ${missing.join(', ')}` });

    const email = normalizeEmail(body.email);
    if (!isEmail(email)) return send(res, 400, { error: 'Invalid email address' });
    if (db.admins.some(item => normalizeEmail(item.email) === email) || db.faculty.some(item => normalizeEmail(item.email) === email)) {
      return send(res, 409, { error: 'Email is already registered' });
    }

    let invitedBy = false;
    if (body.inviteCode) {
      const invite = db.invites.find(item => item.inviteCode === String(body.inviteCode).trim());
      if (!invite || invite.status !== 'pending' || normalizeEmail(invite.email) !== email) {
        return send(res, 400, { error: 'Invalid or expired invite code' });
      }
      invite.status = 'accepted';
      invite.acceptedOn = todayLabel();
      invitedBy = true;
    }

    const faculty = {
      id: db.meta.nextFacultyId++,
      name: String(body.name).trim(),
      dept: String(body.dept).trim(),
      empid: String(body.empid).trim(),
      email,
      passwordHash: hashPassword(body.password),
      status: 'pending',
      appliedOn: todayLabel(),
      invitedBy,
      createdAt: new Date().toISOString()
    };

    db.faculty.push(faculty);
    await writeDb(db);
    return send(res, 201, { faculty: publicFaculty(faculty) });
  }

  const approveMatch = pathname.match(/^\/api\/faculty\/(\d+)\/approve$/);
  if (req.method === 'PATCH' && approveMatch) {
    if (!requireAuth(req, 'admin')) return send(res, 401, { error: 'Admin login required' });
    const faculty = db.faculty.find(item => item.id === Number(approveMatch[1]));
    if (!faculty) return send(res, 404, { error: 'Faculty not found' });
    faculty.status = 'approved';
    faculty.approvedOn = todayLabel();
    await writeDb(db);
    return send(res, 200, { faculty: publicFaculty(faculty) });
  }

  const rejectMatch = pathname.match(/^\/api\/faculty\/(\d+)\/reject$/);
  if (req.method === 'PATCH' && rejectMatch) {
    if (!requireAuth(req, 'admin')) return send(res, 401, { error: 'Admin login required' });
    const faculty = db.faculty.find(item => item.id === Number(rejectMatch[1]));
    if (!faculty) return send(res, 404, { error: 'Faculty not found' });
    faculty.status = 'rejected';
    await writeDb(db);
    return send(res, 200, { faculty: publicFaculty(faculty) });
  }

  const deleteMatch = pathname.match(/^\/api\/faculty\/(\d+)$/);
  if (req.method === 'DELETE' && deleteMatch) {
    if (!requireAuth(req, 'admin')) return send(res, 401, { error: 'Admin login required' });
    const before = db.faculty.length;
    db.faculty = db.faculty.filter(item => item.id !== Number(deleteMatch[1]));
    if (db.faculty.length === before) return send(res, 404, { error: 'Faculty not found' });
    await writeDb(db);
    return send(res, 200, { ok: true });
  }

  return notFound(res);
}

async function handleInvites(req, res, pathname) {
  const db = await readDb();

  const publicLookupMatch = pathname.match(/^\/api\/invites\/lookup\/([^/]+)$/);
  if (req.method === 'GET' && publicLookupMatch) {
    const inviteCode = decodeURIComponent(publicLookupMatch[1]);
    const invite = db.invites.find(item => item.inviteCode === inviteCode && item.status === 'pending');
    if (!invite) return send(res, 404, { error: 'Invite not found or already used' });
    return send(res, 200, {
      invite: {
        email: invite.email,
        inviteCode: invite.inviteCode,
        status: invite.status
      }
    });
  }

  if (!requireAuth(req, 'admin')) return send(res, 401, { error: 'Admin login required' });

  if (routeKey(req.method, pathname) === 'GET /api/invites') {
    return send(res, 200, { invites: db.invites });
  }

  if (routeKey(req.method, pathname) === 'POST /api/invites') {
    const body = await parseBody(req);
    const email = normalizeEmail(body.email);
    if (!isEmail(email)) return send(res, 400, { error: 'Invalid email address' });
    if (db.faculty.some(item => normalizeEmail(item.email) === email)) {
      return send(res, 409, { error: 'Faculty already registered' });
    }
    if (db.invites.some(item => normalizeEmail(item.email) === email && item.status === 'pending')) {
      return send(res, 409, { error: 'Pending invite already exists' });
    }

    const invite = {
      id: db.meta.nextInviteId++,
      email,
      inviteCode: crypto.randomBytes(16).toString('hex'),
      status: 'pending',
      createdOn: todayLabel(),
      createdAt: new Date().toISOString()
    };
    invite.inviteLink = buildInviteLink(req, invite.inviteCode);
    const mailResult = await sendGmailInvite(email, invite.inviteLink);
    invite.emailSent = mailResult.sent;
    invite.emailError = mailResult.sent ? '' : mailResult.error;
    db.invites.push(invite);
    await writeDb(db);
    return send(res, 201, { invite, emailSent: mailResult.sent, emailError: mailResult.error || '' });
  }

  const deleteMatch = pathname.match(/^\/api\/invites\/(\d+)$/);
  if (req.method === 'DELETE' && deleteMatch) {
    const before = db.invites.length;
    db.invites = db.invites.filter(item => item.id !== Number(deleteMatch[1]));
    if (db.invites.length === before) return send(res, 404, { error: 'Invite not found' });
    await writeDb(db);
    return send(res, 200, { ok: true });
  }

  return notFound(res);
}

async function handleAdmins(req, res, pathname) {
  const db = await readDb();
  if (!requireAuth(req, 'admin')) return send(res, 401, { error: 'Admin login required' });

  if (routeKey(req.method, pathname) === 'GET /api/admins') {
    return send(res, 200, { admins: db.admins.map(publicAdmin) });
  }

  if (routeKey(req.method, pathname) === 'POST /api/admins') {
    const body = await parseBody(req);
    const missing = requireFields(body, ['name', 'email', 'password']);
    if (missing.length) return send(res, 400, { error: `Missing fields: ${missing.join(', ')}` });
    const email = normalizeEmail(body.email);
    if (!isEmail(email)) return send(res, 400, { error: 'Invalid email address' });
    if (db.admins.some(item => normalizeEmail(item.email) === email) || db.faculty.some(item => normalizeEmail(item.email) === email)) {
      return send(res, 409, { error: 'Email is already registered' });
    }

    const admin = {
      id: db.meta.nextAdminId++,
      name: String(body.name).trim(),
      email,
      passwordHash: hashPassword(body.password),
      createdAt: new Date().toISOString()
    };
    db.admins.push(admin);
    await writeDb(db);
    return send(res, 201, { admin: publicAdmin(admin) });
  }

  return notFound(res);
}

async function handleTimetables(req, res, pathname) {
  const db = await readDb();
  const auth = requireAuth(req);
  if (!auth) return send(res, 401, { error: 'Login required' });

  if (routeKey(req.method, pathname) === 'GET /api/timetables') {
    return send(res, 200, { timetables: db.timetables });
  }

  if (routeKey(req.method, pathname) === 'PUT /api/timetables') {
    if (auth.role !== 'admin') return send(res, 403, { error: 'Admin login required' });
    const body = await parseBody(req);
    db.timetables = Array.isArray(body.timetables) ? body.timetables.map(item => ({
      ...item,
      updatedAt: new Date().toISOString()
    })) : [];
    await writeDb(db);
    return send(res, 200, { timetables: db.timetables });
  }

  if (routeKey(req.method, pathname) === 'POST /api/timetables') {
    if (auth.role !== 'admin') return send(res, 403, { error: 'Admin login required' });
    const body = await parseBody(req);
    const timetable = {
      id: db.meta.nextTimetableId++,
      course: String(body.course || '').trim(),
      semester: String(body.semester || '').trim(),
      section: String(body.section || '').trim(),
      slots: Array.isArray(body.slots) ? body.slots : [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    db.timetables.push(timetable);
    await writeDb(db);
    return send(res, 201, { timetable });
  }

  const updateMatch = pathname.match(/^\/api\/timetables\/(\d+)$/);
  if (req.method === 'PATCH' && updateMatch) {
    if (auth.role !== 'admin') return send(res, 403, { error: 'Admin login required' });
    const body = await parseBody(req);
    const timetable = db.timetables.find(item => item.id === Number(updateMatch[1]));
    if (!timetable) return send(res, 404, { error: 'Timetable not found' });
    Object.assign(timetable, {
      course: body.course ?? timetable.course,
      semester: body.semester ?? timetable.semester,
      section: body.section ?? timetable.section,
      slots: Array.isArray(body.slots) ? body.slots : timetable.slots,
      updatedAt: new Date().toISOString()
    });
    await writeDb(db);
    return send(res, 200, { timetable });
  }

  return notFound(res);
}

async function handleTimeSettings(req, res, pathname) {
  const db = await readDb();
  const auth = requireAuth(req);
  if (!auth) return send(res, 401, { error: 'Login required' });

  if (routeKey(req.method, pathname) === 'GET /api/time-settings') {
    return send(res, 200, { settings: db.timeSettings || [] });
  }

  if (routeKey(req.method, pathname) === 'POST /api/time-settings') {
    if (auth.role !== 'admin') return send(res, 403, { error: 'Admin login required' });
    const body = await parseBody(req);
    const incoming = Array.isArray(body.settings) ? body.settings : [body];
    const sanitized = incoming.map(sanitizeTimeSetting).filter(Boolean);
    if (!sanitized.length) return send(res, 400, { error: 'No valid time settings provided' });

    db.timeSettings = db.timeSettings || [];
    const now = new Date().toISOString();
    sanitized.forEach((setting) => {
      const existingIndex = db.timeSettings.findIndex(item => item.id === setting.id);
      const savedSetting = {
        ...setting,
        updatedAt: now
      };
      if (existingIndex >= 0) {
        db.timeSettings[existingIndex] = {
          ...db.timeSettings[existingIndex],
          ...savedSetting
        };
      } else {
        db.timeSettings.push({
          ...savedSetting,
          createdAt: now
        });
      }
    });

    await writeDb(db);
    return send(res, 200, { settings: sanitized });
  }

  return notFound(res);
}

async function handleSubjects(req, res, pathname) {
  const db = await readDb();
  const auth = requireAuth(req);
  if (!auth) return send(res, 401, { error: 'Login required' });

  if (routeKey(req.method, pathname) === 'GET /api/subjects') {
    return send(res, 200, { subjects: db.subjects || [] });
  }

  if (routeKey(req.method, pathname) === 'PUT /api/subjects') {
    if (auth.role !== 'admin') return send(res, 403, { error: 'Admin login required' });
    const body = await parseBody(req);
    const incoming = Array.isArray(body.subjects) ? body.subjects : [];
    const seen = new Set();
    const subjects = incoming.map(sanitizeSubject).filter((subject) => {
      if (!subject || seen.has(subject.id)) return false;
      seen.add(subject.id);
      return true;
    });

    db.subjects = subjects.map(subject => ({
      ...subject,
      updatedAt: new Date().toISOString()
    }));
    await writeDb(db);
    return send(res, 200, { subjects: db.subjects });
  }

  return notFound(res);
}

async function handleHistory(req, res, pathname) {
  const db = await readDb();
  const auth = requireAuth(req);
  if (!auth) return send(res, 401, { error: 'Login required' });

  if (routeKey(req.method, pathname) === 'GET /api/history') {
    return send(res, 200, { history: db.history || [] });
  }

  if (routeKey(req.method, pathname) === 'PUT /api/history') {
    if (auth.role !== 'admin') return send(res, 403, { error: 'Admin login required' });
    const body = await parseBody(req);
    const incoming = Array.isArray(body.history) ? body.history : [];
    const seen = new Set();
    const history = incoming.map(sanitizeHistoryEntry).filter((entry) => {
      if (!entry || seen.has(entry.id)) return false;
      seen.add(entry.id);
      return true;
    });

    db.history = history
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, 20)
      .map(entry => ({
        ...entry,
        updatedAt: new Date().toISOString()
      }));
    await writeDb(db);
    return send(res, 200, { history: db.history });
  }

  return notFound(res);
}

async function handleTeacherViews(req, res, pathname) {
  const db = await readDb();
  const auth = requireAuth(req);
  if (!auth) return send(res, 401, { error: 'Login required' });

  if (routeKey(req.method, pathname) === 'GET /api/teacher-views') {
    if (auth.role !== 'admin') return send(res, 403, { error: 'Admin login required' });
    return send(res, 200, { teacherViews: db.teacherViews || [] });
  }

  if (routeKey(req.method, pathname) === 'POST /api/teacher-views') {
    if (auth.role !== 'admin') return send(res, 403, { error: 'Admin login required' });
    const body = await parseBody(req);
    const teacherView = sanitizeTeacherView(body);
    if (!teacherView) return send(res, 400, { error: 'No valid teacher view data provided' });

    db.teacherViews = db.teacherViews || [];
    const existingIndex = db.teacherViews.findIndex(item => item.id === teacherView.id);
    const savedView = {
      ...teacherView,
      updatedAt: new Date().toISOString()
    };
    if (existingIndex >= 0) {
      db.teacherViews[existingIndex] = {
        ...db.teacherViews[existingIndex],
        ...savedView
      };
    } else {
      db.teacherViews.push({
        ...savedView,
        createdAt: new Date().toISOString()
      });
    }

    await writeDb(db);
    return send(res, 200, { teacherView: savedView });
  }

  return notFound(res);
}

function sanitizeWorkloadSubjects(rawSubjects, defaults = {}) {
  if (!Array.isArray(rawSubjects)) return [];
  const boundedCount = value => {
    const count = Number(value);
    return Number.isFinite(count) ? Math.max(0, Math.min(12, count)) : 0;
  };
  return rawSubjects.map((subject, index) => ({
    id: String(subject.id || `subject-${index + 1}`).slice(0, 240),
    name: String(subject.name || '').trim().slice(0, 160),
    code: String(subject.code || '').trim().slice(0, 80),
    course: String(subject.course || defaults.course || '').trim().slice(0, 80),
    semester: String(subject.semester || defaults.semester || '').trim().slice(0, 40),
    category: String(subject.category || defaults.category || 'main').trim().slice(0, 40),
    isLab: Boolean(subject.isLab),
    labEnabled: Boolean(subject.labEnabled),
    lectureCount: boundedCount(subject.lectureCount),
    labCount: boundedCount(subject.labCount)
  })).filter(subject => subject.name);
}

function workloadSubjectCounts(subject) {
  return [
    subject.lectureCount ? `${subject.lectureCount} lectures/week` : '',
    subject.labEnabled || subject.isLab ? `${subject.labCount || subject.lectureCount} labs/week` : ''
  ].filter(Boolean).join(', ');
}

function buildWorkloadFormEmail(form, formLink) {
  const subjectLines = form.subjects.map(subject => {
    const label = subject.name + (subject.code ? ` (${subject.code})` : '');
    const counts = workloadSubjectCounts(subject);
    return '- ' + label + (counts ? `: ${counts}` : '');
  });
  const text = [
    `Hello ${form.facultyName},`,
    '',
    `Please select the subjects you are able to teach for ${form.course}, ${form.semester}.`,
    ...subjectLines,
    '',
    `Open the form: ${formLink}`,
    '',
    'Prestige Institute'
  ].join('\n');
  const subjectRows = form.subjects.map(subject => {
    const label = subject.name + (subject.code ? ` (${subject.code})` : '');
    const counts = workloadSubjectCounts(subject);
    const countText = counts ? ': ' + escapeMailHtml(counts) : '';
    return '<li>' + escapeMailHtml(label) + countText + '</li>';
  }).join('');
  const html = `<!doctype html>
<html><body style="font-family:Arial,sans-serif;line-height:1.5;color:#111827;">
  <p>Hello ${escapeMailHtml(form.facultyName)},</p>
  <p>Please select the subjects you are able to teach for ${escapeMailHtml(form.course)}, ${escapeMailHtml(form.semester)}.</p>
  <ul>${subjectRows}</ul>
  <p><a href="${escapeMailHtml(formLink)}">Open and submit the faculty workload form</a></p>
  <p>Prestige Institute</p>
</body></html>`;
  return { text, html };
}

function publicWorkloadForm(form) {
  return {
    facultyName: form.facultyName,
    course: form.course,
    semester: form.semester,
    category: form.category,
    subjects: form.subjects,
    status: form.status,
    selectedSubjectIds: form.selectedSubjectIds || [],
    submittedAt: form.submittedAt || ''
  };
}

async function submitWorkloadForm(req, res, db, form) {
  if (!form) return send(res, 404, { error: 'Workload form not found or expired' });
  if (form.status === 'submitted') return send(res, 409, { error: 'This workload form has already been submitted' });
  const body = await parseBody(req);
  const subjectIds = Array.isArray(body.subjectIds) ? [...new Set(body.subjectIds.map(String))] : [];
  const selectedSubjects = form.subjects.filter(subject => subjectIds.includes(subject.id));
  if (!selectedSubjects.length) return send(res, 400, { error: 'Select at least one subject before submitting' });
  if (selectedSubjects.length !== subjectIds.length) return send(res, 400, { error: 'The selection contains an invalid subject' });

  form.selectedSubjectIds = selectedSubjects.map(subject => subject.id);
  form.selectedSubjects = selectedSubjects;
  form.status = 'submitted';
  form.submittedAt = new Date().toISOString();
  await writeDb(db);
  return send(res, 200, { ok: true, submittedAt: form.submittedAt });
}

async function createWorkloadForm(req, res, db) {
  const body = await parseBody(req);
  const faculty = db.faculty.find(item => item.id === Number(body.facultyId) && item.status === 'approved');
  if (!faculty) return send(res, 404, { error: 'Approved faculty member not found' });
  const formDefaults = {
    course: String(body.course || '').trim(),
    semester: String(body.semester || '').trim(),
    category: String(body.category || 'main').trim()
  };
  const subjects = sanitizeWorkloadSubjects(body.subjects, formDefaults);
  if (!subjects.length) return send(res, 400, { error: 'Select at least one subject to forward' });
  if (new Set(subjects.map(subject => subject.id)).size !== subjects.length) {
    return send(res, 400, { error: 'Subject IDs must be unique' });
  }

  const form = {
    id: db.meta.nextWorkloadFormId++,
    facultyId: faculty.id,
    facultyName: faculty.name,
    facultyEmail: faculty.email,
    ...formDefaults,
    subjects,
    selectedSubjectIds: [],
    selectedSubjects: [],
    status: 'pending',
    token: crypto.randomBytes(32).toString('hex'),
    createdAt: new Date().toISOString(),
    submittedAt: ''
  };
  const formLink = buildWorkloadFormLink(req, form.token);
  const email = buildWorkloadFormEmail(form, formLink);
  const mailResult = await sendGmailMessage(faculty.email, 'Faculty workload subject selection', email.text, email.html);
  form.emailSent = mailResult.sent;
  form.emailError = mailResult.sent ? '' : mailResult.error;
  db.workloadForms.push(form);
  await writeDb(db);
  const publicForm = { ...form };
  delete publicForm.token;
  return send(res, 201, { form: publicForm, emailSent: mailResult.sent, emailError: mailResult.error || '' });
}

async function listFacultyWorkloadForms(req, res, db) {
  const auth = requireAuth(req, 'faculty');
  if (!auth) return send(res, 401, { error: 'Faculty login required' });
  const forms = db.workloadForms
    .filter(item => item.facultyId === auth.id)
    .slice()
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
    .map(item => ({
      id: item.id,
      course: item.course,
      semester: item.semester,
      category: item.category,
      subjects: item.subjects,
      selectedSubjectIds: item.selectedSubjectIds || [],
      status: item.status,
      createdAt: item.createdAt,
      submittedAt: item.submittedAt || ''
    }));
  return send(res, 200, { forms });
}

async function submitFacultyWorkloadForm(req, res, db, formId) {
  const auth = requireAuth(req, 'faculty');
  if (!auth) return send(res, 401, { error: 'Faculty login required' });
  const form = db.workloadForms.find(item => item.id === Number(formId) && item.facultyId === auth.id);
  return submitWorkloadForm(req, res, db, form);
}

async function handleTokenWorkloadForm(req, res, db, tokenMatch) {
  const form = db.workloadForms.find(item => item.token === tokenMatch[1]);
  if (req.method === 'POST') return submitWorkloadForm(req, res, db, form);
  return form
    ? send(res, 200, { form: publicWorkloadForm(form) })
    : send(res, 404, { error: 'Workload form not found or expired' });
}

function listAdminWorkloadForms(res, db) {
  const forms = db.workloadForms
    .slice()
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
    .map(form => {
      const publicForm = { ...form };
      delete publicForm.token;
      return publicForm;
    });
  return send(res, 200, { forms });
}

async function assignWorkloadSubjectSections(req, res, db, match) {
  if (!requireAuth(req, 'admin')) return send(res, 401, { error: 'Admin login required' });
  const form = db.workloadForms.find(item => item.id === Number(match[1]));
  if (!form) return send(res, 404, { error: 'Workload form not found' });
  const subjectId = decodeURIComponent(match[2]);
  const selectedSubject = (form.selectedSubjects || []).find(item => item.id === subjectId);
  if (!selectedSubject) return send(res, 404, { error: 'Faculty has not selected this subject' });

  const body = await parseBody(req);
  const validSections = new Set(['sectionA', 'sectionB', 'sectionC']);
  const sections = Array.isArray(body.sections) ? [...new Set(body.sections.map(String))] : [];
  if (sections.length > 2) {
    return send(res, 400, { error: 'A faculty member can be assigned to a maximum of two sections for this subject' });
  }
  if (sections.some(section => !validSections.has(section))) {
    return send(res, 400, { error: 'Invalid section selection' });
  }
  selectedSubject.assignedSections = sections;
  await writeDb(db);
  return send(res, 200, { ok: true, assignedSections: sections });
}

async function handleWorkloadForms(req, res, pathname) {
  const db = await readDb();
  if (routeKey(req.method, pathname) === 'GET /api/workload-forms/faculty') {
    return listFacultyWorkloadForms(req, res, db);
  }

  const facultySubmitMatch = pathname.match(/^\/api\/workload-forms\/(\d+)\/faculty-submit$/);
  if (req.method === 'POST' && facultySubmitMatch) {
    return submitFacultyWorkloadForm(req, res, db, facultySubmitMatch[1]);
  }

  const sectionAssignmentMatch = pathname.match(/^\/api\/workload-forms\/(\d+)\/subjects\/([^/]+)\/sections$/);
  if (req.method === 'PATCH' && sectionAssignmentMatch) {
    return assignWorkloadSubjectSections(req, res, db, sectionAssignmentMatch);
  }

  const tokenMatch = pathname.match(/^\/api\/workload-forms\/([a-f0-9]{64})(?:\/(submit))?$/i);
  if (tokenMatch) return handleTokenWorkloadForm(req, res, db, tokenMatch);
  if (!requireAuth(req, 'admin')) return send(res, 401, { error: 'Admin login required' });
  if (routeKey(req.method, pathname) === 'GET /api/workload-forms') return listAdminWorkloadForms(res, db);
  if (routeKey(req.method, pathname) === 'POST /api/workload-forms') return createWorkloadForm(req, res, db);
  return notFound(res);
}

async function handleAppSettings(req, res, pathname) {
  const auth = requireAuth(req);
  if (!auth) return send(res, 401, { error: 'Login required' });

  if (routeKey(req.method, pathname) === 'GET /api/app-settings') {
    if (auth.role !== 'admin') return send(res, 403, { error: 'Admin login required' });
    const settings = await collections.appSettings.findOne({ _id: 'global' }, { projection: { _id: 0 } });
    return send(res, 200, { settings: settings ? stripMongoId(settings) : null });
  }

  if (routeKey(req.method, pathname) === 'PUT /api/app-settings') {
    if (auth.role !== 'admin') return send(res, 403, { error: 'Admin login required' });
    const body = await parseBody(req);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return send(res, 400, { error: 'App settings must be a JSON object' });
    }
    if (body.settings !== undefined && (!body.settings || typeof body.settings !== 'object' || Array.isArray(body.settings))) {
      return send(res, 400, { error: 'Settings must be a JSON object' });
    }
    const rawSettings = body.settings || body;
    const existing = await collections.appSettings.findOne({ _id: 'global' });
    const settings = {
      ...sanitizeAppSettings(rawSettings),
      createdAt: existing?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    await collections.appSettings.replaceOne(
      { _id: 'global' },
      { _id: 'global', ...settings },
      { upsert: true }
    );
    return send(res, 200, { settings });
  }

  return notFound(res);
}

async function handleRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  if (req.method === 'OPTIONS') {
    res.writeHead(204, jsonHeaders);
    return res.end();
  }

  try {
    await connectDb();

    if (routeKey(req.method, pathname) === 'GET /api/health') {
      return send(res, 200, { ok: true, service: 'prestige-access-backend' });
    }
    if (pathname.startsWith('/api/auth')) return handleAuth(req, res, pathname);
    if (pathname.startsWith('/api/faculty')) return handleFaculty(req, res, pathname);
    if (pathname.startsWith('/api/invites')) return handleInvites(req, res, pathname);
    if (pathname.startsWith('/api/admins')) return handleAdmins(req, res, pathname);
    if (pathname.startsWith('/api/timetables')) return handleTimetables(req, res, pathname);
    if (pathname.startsWith('/api/time-settings')) return handleTimeSettings(req, res, pathname);
    if (pathname.startsWith('/api/subjects')) return handleSubjects(req, res, pathname);
    if (pathname.startsWith('/api/history')) return handleHistory(req, res, pathname);
    if (pathname.startsWith('/api/teacher-views')) return handleTeacherViews(req, res, pathname);
    if (pathname.startsWith('/api/app-settings')) return handleAppSettings(req, res, pathname);
    if (pathname.startsWith('/api/workload-forms')) return handleWorkloadForms(req, res, pathname);
    if (serveStatic(req, res, pathname)) return;
    return notFound(res);
  } catch (error) {
    return send(res, 500, { error: error.message || 'Internal server error' });
  }
}

async function start() {
  await connectDb();

  const server = http.createServer(handleRequest);

  server.listen(PORT, () => {
    console.log(`Prestige backend running on http://localhost:${PORT}`);
    console.log(`MongoDB connected: ${MONGODB_DB} (${COLLECTION_NAMES.join(', ')}, meta)`);
  });
}

if (require.main === module) {
  start().catch(error => {
    console.error('Failed to start Prestige backend:', error);
    process.exit(1);
  });
}

module.exports = handleRequest;
module.exports.resolveMongoConfig = resolveMongoConfig;
