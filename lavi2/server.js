const express = require('express');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { DatabaseSync } = require('node:sqlite');

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '256kb' }));
app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Referrer-Policy', 'no-referrer');
  if (req.path === '/' || req.path.endsWith('.html')) {
    res.set('Cache-Control', 'no-store');
  }
  next();
});
app.use(express.static(path.join(__dirname, 'public'), { etag: false, maxAge: 0 }));

const PORT = Number(process.env.PORT || 3100);
const DEMO_MODE = process.env.LAVI_DEMO_MODE === 'true';
const SECRET = process.env.LAVI_JWT_SECRET;
if (!SECRET || SECRET.length < 32) {
  console.error('LAVI_JWT_SECRET must be set to at least 32 characters.');
  process.exit(1);
}
if (process.env.NODE_ENV === 'production' && !DEMO_MODE) {
  console.error('This sandbox build is not approved for production. Keep LAVI_DEMO_MODE=true.');
  process.exit(1);
}

const dataDir = path.resolve(process.env.LAVI_DATA_DIR || path.join(__dirname, 'data'));
fs.mkdirSync(dataDir, { recursive: true });
const db = new DatabaseSync(path.join(dataDir, 'lavi2-sandbox.sqlite'));
db.exec(`
  PRAGMA foreign_keys = ON;
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    email TEXT,
    phone TEXT,
    contact_verified INTEGER NOT NULL DEFAULT 0,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('teacher','student','parent','admin')),
    display_name TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE IF NOT EXISTS classes (
    id TEXT PRIMARY KEY,
    owner_user_id INTEGER NOT NULL REFERENCES users(id),
    name TEXT NOT NULL,
    school_name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(owner_user_id, name)
  );
  CREATE TABLE IF NOT EXISTS students (
    id TEXT PRIMARY KEY,
    class_id TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    student_code TEXT NOT NULL,
    display_name TEXT NOT NULL,
    demo_level TEXT NOT NULL DEFAULT 'Chưa đánh giá',
    UNIQUE(class_id, student_code)
  );
  CREATE TABLE IF NOT EXISTS audit_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    actor_user_id INTEGER REFERENCES users(id),
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  INSERT OR IGNORE INTO schema_migrations(version) VALUES (1);
`);

// Additive migration for existing sandbox databases.
const userColumns = new Set(db.prepare('PRAGMA table_info(users)').all().map(c => c.name));
if (!userColumns.has('email')) db.exec('ALTER TABLE users ADD COLUMN email TEXT');
if (!userColumns.has('phone')) db.exec('ALTER TABLE users ADD COLUMN phone TEXT');
if (!userColumns.has('contact_verified')) db.exec('ALTER TABLE users ADD COLUMN contact_verified INTEGER NOT NULL DEFAULT 0');
db.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_unique ON users(email) WHERE email IS NOT NULL;
  CREATE UNIQUE INDEX IF NOT EXISTS idx_users_phone_unique ON users(phone) WHERE phone IS NOT NULL;
`);
db.prepare('INSERT OR IGNORE INTO schema_migrations(version) VALUES (2)').run();

function seedDemoData() {
  if (!DEMO_MODE) return;
  const n = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  if (Number(n) > 0) return;
  const addUser = db.prepare('INSERT INTO users(username,password_hash,role,display_name) VALUES(?,?,?,?)');
  const demoPasswordHash = bcrypt.hashSync('Demo1234!', 10);
  const teacherA = Number(addUser.run('teacher1', demoPasswordHash, 'teacher', 'Giáo viên thử nghiệm 1').lastInsertRowid);
  const teacherB = Number(addUser.run('teacher2', demoPasswordHash, 'teacher', 'Giáo viên thử nghiệm 2').lastInsertRowid);
  const addClass = db.prepare('INSERT INTO classes(id,owner_user_id,name,school_name) VALUES(?,?,?,?)');
  addClass.run('demo-class-a', teacherA, 'Lớp Mẫu A', 'Trường Thử nghiệm');
  addClass.run('demo-class-b', teacherB, 'Lớp Mẫu B', 'Trường Thử nghiệm');
  const addStudent = db.prepare('INSERT INTO students(id,class_id,student_code,display_name,demo_level) VALUES(?,?,?,?,?)');
  [
    ['demo-a-01','demo-class-a','A01','Học sinh giả lập An','Khá'],
    ['demo-a-02','demo-class-a','A02','Học sinh giả lập Bình','Tốt'],
    ['demo-a-03','demo-class-a','A03','Học sinh giả lập Chi','Trung bình'],
    ['demo-b-01','demo-class-b','B01','Học sinh giả lập Dũng','Khá'],
    ['demo-b-02','demo-class-b','B02','Học sinh giả lập Hà','Tốt']
  ].forEach(s => addStudent.run(...s));
}
seedDemoData();

function normalizeContact(raw) {
  const value = String(raw || '').trim();
  if (value.includes('@')) {
    const email = value.toLowerCase();
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
    return { kind: 'email', value: email };
  }
  const compact = value.replace(/[\s().-]/g, '');
  let phone = compact;
  if (/^0\d{9}$/.test(phone)) phone = '+84' + phone.slice(1);
  if (/^84\d{9}$/.test(phone)) phone = '+' + phone;
  if (!/^\+[1-9]\d{7,14}$/.test(phone)) return null;
  return { kind: 'phone', value: phone };
}

const requestBuckets = new Map();
function rateLimit(key, limit, windowMs) {
  const now = Date.now();
  const current = requestBuckets.get(key);
  if (!current || now - current.start >= windowMs) {
    requestBuckets.set(key, { start: now, count: 1 });
    return true;
  }
  current.count += 1;
  return current.count <= limit;
}
function clientKey(req) {
  return req.socket.remoteAddress || 'unknown';
}

function audit(actorId, action, entityType, entityId = null) {
  db.prepare('INSERT INTO audit_events(actor_user_id,action,entity_type,entity_id) VALUES(?,?,?,?)')
    .run(actorId || null, action, entityType, entityId);
}
function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) return res.status(401).json({ error: 'Vui lòng đăng nhập.' });
  try {
    req.user = jwt.verify(header.slice(7), SECRET);
    const user = db.prepare('SELECT id,username,role,display_name,active FROM users WHERE id=?').get(req.user.id);
    if (!user || !user.active) return res.status(401).json({ error: 'Tài khoản không hoạt động.' });
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ error: 'Phiên đăng nhập không hợp lệ.' });
  }
}
function requireTeacher(req, res, next) {
  if (req.user.role !== 'teacher' && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Chức năng chỉ dành cho giáo viên.' });
  }
  next();
}

app.get('/api/health', (_req, res) => res.json({
  ok: true,
  app: 'LAVI 2.0 Sandbox',
  demoMode: DEMO_MODE,
  syntheticDataOnly: true,
  database: 'sqlite',
  schemaVersion: 1
}));

app.post('/api/register', (req, res) => {
  if (!rateLimit('register:' + clientKey(req), 5, 15 * 60 * 1000)) {
    return res.status(429).json({ error: 'Bạn đăng ký quá nhiều lần. Vui lòng thử lại sau 15 phút.' });
  }
  const displayName = String(req.body?.displayName || '').trim().replace(/\s+/g, ' ');
  const contact = normalizeContact(req.body?.contact);
  const password = String(req.body?.password || '');
  if (displayName.length < 2 || displayName.length > 100) {
    return res.status(400).json({ error: 'Họ tên cần từ 2 đến 100 ký tự.' });
  }
  if (!contact) return res.status(400).json({ error: 'Vui lòng nhập email hợp lệ hoặc số điện thoại có mã quốc gia.' });
  if (password.length < 8 || password.length > 200) {
    return res.status(400).json({ error: 'Mật khẩu cần ít nhất 8 ký tự.' });
  }
  const existing = db.prepare('SELECT id FROM users WHERE lower(username)=? OR email=? OR phone=?')
    .get(contact.value, contact.value, contact.value);
  if (existing) return res.status(409).json({ error: 'Email hoặc số điện thoại này đã được đăng ký.' });
  try {
    const passwordHash = bcrypt.hashSync(password, 12);
    const result = db.prepare('INSERT INTO users(username,email,phone,contact_verified,password_hash,role,display_name) VALUES(?,?,?,?,?,?,?)')
      .run(contact.value, contact.kind === 'email' ? contact.value : null, contact.kind === 'phone' ? contact.value : null, 0, passwordHash, 'teacher', displayName);
    const id = Number(result.lastInsertRowid);
    audit(id, 'register', 'user', String(id));
    const token = jwt.sign({ id }, SECRET, { expiresIn: '2h', issuer: 'lavi2-sandbox', audience: 'lavi2-client' });
    res.status(201).json({
      token,
      user: { id, username: contact.value, role: 'teacher', displayName, contact: contact.value, contactVerified: false },
      notice: 'Đã tạo tài khoản thử nghiệm. Email/số điện thoại chưa được xác minh bằng OTP.'
    });
  } catch (err) {
    if (err && err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ error: 'Email hoặc số điện thoại này đã được đăng ký.' });
    }
    throw err;
  }
});

app.post('/api/login', (req, res) => {
  if (!rateLimit('login:' + clientKey(req), 10, 5 * 60 * 1000)) {
    return res.status(429).json({ error: 'Bạn đăng nhập quá nhiều lần. Vui lòng thử lại sau 5 phút.' });
  }
  const rawContact = String(req.body?.contact || req.body?.username || '').trim();
  const normalized = normalizeContact(rawContact);
  const identifier = normalized ? normalized.value : rawContact.toLowerCase();
  const password = String(req.body?.password || '');
  if (!identifier || !password || identifier.length > 254 || password.length > 200) {
    return res.status(400).json({ error: 'Vui lòng nhập email/số điện thoại và mật khẩu hợp lệ.' });
  }
  const user = db.prepare('SELECT * FROM users WHERE lower(username)=? OR email=? OR phone=?')
    .get(identifier, identifier, identifier);
  if (!user || !user.active || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Sai email/số điện thoại hoặc mật khẩu.' });
  }
  audit(user.id, 'login', 'user', String(user.id));
  const token = jwt.sign({ id: user.id }, SECRET, { expiresIn: '2h', issuer: 'lavi2-sandbox', audience: 'lavi2-client' });
  res.json({
    token,
    user: {
      id: user.id, username: user.username, role: user.role, displayName: user.display_name,
      contact: user.email || user.phone || user.username,
      contactVerified: Boolean(user.contact_verified)
    }
  });
});

app.get('/api/me', authenticate, (req, res) => {
  res.json({ user: { id: req.user.id, username: req.user.username, role: req.user.role, displayName: req.user.display_name } });
});

app.post('/api/classes', authenticate, requireTeacher, (req, res) => {
  const name = String(req.body?.name || '').trim().replace(/\s+/g, ' ');
  const schoolName = String(req.body?.schoolName || '').trim().replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > 80) {
    return res.status(400).json({ error: 'Tên lớp cần từ 2 đến 80 ký tự.' });
  }
  if (schoolName.length < 2 || schoolName.length > 120) {
    return res.status(400).json({ error: 'Tên trường cần từ 2 đến 120 ký tự.' });
  }
  const id = randomUUID();
  try {
    db.prepare('INSERT INTO classes(id,owner_user_id,name,school_name) VALUES(?,?,?,?)')
      .run(id, req.user.id, name, schoolName);
    audit(req.user.id, 'create', 'class', id);
    res.status(201).json({ class: { id, name, schoolName, studentCount: 0 } });
  } catch (err) {
    if (err && err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ error: 'Thầy cô đã có lớp cùng tên trong tài khoản này.' });
    }
    throw err;
  }
});

app.get('/api/classes', authenticate, requireTeacher, (req, res) => {
  const rows = db.prepare(`
    SELECT c.id,c.name,c.school_name AS schoolName,
      (SELECT COUNT(*) FROM students s WHERE s.class_id=c.id) AS studentCount
    FROM classes c
    WHERE c.owner_user_id = ?
    ORDER BY c.name
  `).all(req.user.id);
  res.json({ classes: rows });
});

app.get('/api/classes/:classId/students', authenticate, requireTeacher, (req, res) => {
  const klass = db.prepare('SELECT id,name FROM classes WHERE id=? AND owner_user_id=?')
    .get(String(req.params.classId), req.user.id);
  if (!klass) return res.status(404).json({ error: 'Không tìm thấy lớp hoặc bạn không có quyền truy cập.' });
  const students = db.prepare(`
    SELECT id,student_code AS code,display_name AS displayName,demo_level AS level
    FROM students WHERE class_id=? ORDER BY student_code
  `).all(klass.id);
  res.json({ class: klass, students });
});

app.use('/api', (_req, res) => res.status(404).json({ error: 'API không tồn tại trong bản thử nghiệm.' }));
app.use((err, _req, res, _next) => {
  console.error('LAVI2 request error:', err.message);
  res.status(500).json({ error: 'Đã xảy ra lỗi máy chủ.' });
});

if (require.main === module) {
  app.listen(PORT, () => console.log(`LAVI 2.0 sandbox listening on ${PORT}; demoMode=${DEMO_MODE}`));
}
module.exports = { app, db };