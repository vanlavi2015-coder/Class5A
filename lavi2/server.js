const express = require('express');
const path = require('node:path');
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

app.post('/api/login', (req, res) => {
  const username = String(req.body?.username || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  if (!username || !password || username.length > 80 || password.length > 200) {
    return res.status(400).json({ error: 'Vui lòng nhập tài khoản và mật khẩu hợp lệ.' });
  }
  const user = db.prepare('SELECT * FROM users WHERE lower(username)=? AND active=1').get(username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Sai tài khoản hoặc mật khẩu.' });
  }
  audit(user.id, 'login', 'user', String(user.id));
  const token = jwt.sign({ id: user.id }, SECRET, { expiresIn: '2h', issuer: 'lavi2-sandbox', audience: 'lavi2-client' });
  res.json({ token, user: { id: user.id, username: user.username, role: user.role, displayName: user.display_name } });
});

app.get('/api/me', authenticate, (req, res) => {
  res.json({ user: { id: req.user.id, username: req.user.username, role: req.user.role, displayName: req.user.display_name } });
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