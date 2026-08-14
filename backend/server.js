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
const APP_ORIGIN = process.env.APP_ORIGIN || 'http://localhost:4000';
const GMAIL_USER = String(process.env.GMAIL_USER || '').trim();
const GMAIL_APP_PASSWORD = String(process.env.GMAIL_APP_PASSWORD || '').replace(/\s+/g, '');
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017';
const MONGODB_DB = process.env.MONGODB_DB || 'prestige_access_portal';
const MONGODB_STATE_COLLECTION = process.env.MONGODB_STATE_COLLECTION || 'app_state';
const STATE_DOCUMENT_ID = 'prestige-state';
const COLLECTION_NAMES = ['admins', 'faculty', 'invites', 'timetables'];

const jsonHeaders = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
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
    meta: {
      nextAdminId: 1,
      nextFacultyId: 1,
      nextInviteId: 1,
      nextTimetableId: 1
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
    await collections[name].deleteMany({});
    const records = (db[name] || []).map(item => ({ ...item, _id: item.id }));
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

function stripMongoId(document) {
  const { _id, ...rest } = document;
  return rest;
}

function buildMetaFromData(db) {
  const nextIdFor = records => Math.max(0, ...records.map(item => Number(item.id) || 0)) + 1;
  return {
    nextAdminId: nextIdFor(db.admins || []),
    nextFacultyId: nextIdFor(db.faculty || []),
    nextInviteId: nextIdFor(db.invites || []),
    nextTimetableId: nextIdFor(db.timetables || [])
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

function routeKey(method, pathname) {
  return `${method} ${pathname}`;
}

function buildInviteLink(req, inviteCode) {
  const origin = APP_ORIGIN || `http://${req.headers.host || `localhost:${PORT}`}`;
  return `${origin.replace(/\/+$/, '')}/?inviteCode=${encodeURIComponent(inviteCode)}`;
}

function encodeMailHeader(value) {
  return String(value || '').replace(/[\r\n]+/g, ' ').trim();
}

function escapeMailText(value) {
  return String(value || '').replace(/\r?\n/g, '\r\n');
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

async function sendGmailInvite(email, inviteLink) {
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

    const subject = 'Faculty registration invite';
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
    return { sent: false, error: error.message || 'Unable to send Gmail invite' };
  } finally {
    socket.end();
  }
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
    if (serveStatic(req, res, pathname)) return;
    return notFound(res);
  } catch (error) {
    return send(res, 500, { error: error.message || 'Internal server error' });
  }
}

async function start() {
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

