const express = require('express');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const fs = require('node:fs');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const XLSX = require('xlsx');
const mammoth = require('mammoth');
const { DatabaseSync } = require('node:sqlite');

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '15mb' }));
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
  CREATE TABLE IF NOT EXISTS question_banks (
    id TEXT PRIMARY KEY,
    owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    subject TEXT NOT NULL DEFAULT '',
    grade TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS questions (
    id TEXT PRIMARY KEY,
    bank_id TEXT NOT NULL REFERENCES question_banks(id) ON DELETE CASCADE,
    question_type TEXT NOT NULL,
    prompt TEXT NOT NULL,
    options_json TEXT NOT NULL DEFAULT '[]',
    answer_json TEXT NOT NULL DEFAULT 'null',
    explanation TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS test_sets (
    id TEXT PRIMARY KEY,
    owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    subject TEXT NOT NULL DEFAULT '',
    grade TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS test_set_questions (
    test_set_id TEXT NOT NULL REFERENCES test_sets(id) ON DELETE CASCADE,
    question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
    position INTEGER NOT NULL DEFAULT 0,
    points REAL NOT NULL DEFAULT 1,
    PRIMARY KEY(test_set_id, question_id)
  );
  CREATE TABLE IF NOT EXISTS assignments (
    id TEXT PRIMARY KEY,
    owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    class_id TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    test_set_id TEXT REFERENCES test_sets(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    due_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS scores (
    id TEXT PRIMARY KEY,
    assignment_id TEXT NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
    student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    score REAL NOT NULL DEFAULT 0,
    max_score REAL NOT NULL DEFAULT 0,
    detail_json TEXT NOT NULL DEFAULT '{}',
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(assignment_id, student_id)
  );
  CREATE TABLE IF NOT EXISTS point_transactions (
    id TEXT PRIMARY KEY,
    owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    class_id TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    points INTEGER NOT NULL,
    reason TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS backup_imports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    fingerprint TEXT NOT NULL,
    imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(owner_user_id, fingerprint)
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

app.get('/api/question-template.xlsx', (_req, res) => {
  const sheet = XLSX.utils.aoa_to_sheet([
    ['ID','Câu hỏi','Đáp án A','Đáp án B','Đáp án C','Đáp án D','Đáp án đúng'],
    ['1','Ví dụ: 3 m² 5 dm² bằng bao nhiêu dm²?','35 dm²','305 dm²','3005 dm²','350 dm²','B']
  ]);
  sheet['!cols'] = [{wch:8},{wch:55},{wch:28},{wch:28},{wch:28},{wch:28},{wch:16}];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Câu hỏi');
  const buffer = XLSX.write(workbook, {type:'buffer',bookType:'xlsx'});
  res.set('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.set('Content-Disposition','attachment; filename="mau-cau-hoi-LAVI2.xlsx"');
  res.send(buffer);
});

app.get('/api/health', (_req, res) => res.json({
  ok: true,
  app: 'LAVI 2.0 Sandbox',
  demoMode: DEMO_MODE,
  syntheticDataOnly: true,
  database: 'sqlite',
  schemaVersion: 3
}));

function ownedClassIds(userId) {
  return db.prepare('SELECT id FROM classes WHERE owner_user_id=?').all(userId).map(row => row.id);
}

app.get('/api/backup', authenticate, requireTeacher, (req, res) => {
  const classIds = ownedClassIds(req.user.id);
  const banks = db.prepare('SELECT * FROM question_banks WHERE owner_user_id=?').all(req.user.id);
  const tests = db.prepare('SELECT * FROM test_sets WHERE owner_user_id=?').all(req.user.id);
  const bankIds = banks.map(row => row.id);
  const testIds = tests.map(row => row.id);
  const inRows = (table, column, ids) => {
    if (!ids.length) return [];
    const marks = ids.map(() => '?').join(',');
    return db.prepare('SELECT * FROM ' + table + ' WHERE ' + column + ' IN (' + marks + ')').all(...ids);
  };
  const students = inRows('students', 'class_id', classIds);
  const studentIds = students.map(row => row.id);
  const questions = inRows('questions', 'bank_id', bankIds);
  const questionIds = questions.map(row => row.id);
  const testQuestionRows = inRows('test_set_questions', 'test_set_id', testIds);
  const assignments = db.prepare('SELECT * FROM assignments WHERE owner_user_id=?').all(req.user.id);
  const assignmentIds = assignments.map(row => row.id);
  const backup = {
    format: 'LAVI2_BACKUP', version: 1, exportedAt: new Date().toISOString(),
    account: { username: req.user.username, displayName: req.user.display_name },
    data: {
      classes: inRows('classes', 'id', classIds),
      students,
      question_banks: banks,
      questions,
      test_sets: tests,
      test_set_questions: testQuestionRows,
      assignments,
      scores: inRows('scores', 'assignment_id', assignmentIds),
      point_transactions: inRows('point_transactions', 'class_id', classIds),
      audit_events: db.prepare('SELECT action,entity_type,entity_id,created_at FROM audit_events WHERE actor_user_id=? ORDER BY id').all(req.user.id)
    }
  };
  audit(req.user.id, 'export_backup', 'backup');
  res.set('Content-Type', 'application/json; charset=utf-8');
  res.set('Content-Disposition', 'attachment; filename="lavi2-backup-' + new Date().toISOString().slice(0,10) + '.json"');
  res.json(backup);
});

app.post('/api/backup/restore', authenticate, requireTeacher, (req, res) => {
  const backup = req.body;
  if (!backup || backup.format !== 'LAVI2_BACKUP' || backup.version !== 1 || !backup.data || typeof backup.data !== 'object') {
    return res.status(400).json({ error: 'Tệp sao lưu không đúng định dạng LAVI 2.0.' });
  }
  const allowed = ['classes','students','question_banks','questions','test_sets','test_set_questions','assignments','scores','point_transactions','audit_events'];
  // Prevent accidental repeated restoration of the exact same backup file.
  const fingerprint = createHash('sha256').update(JSON.stringify(backup)).digest('hex');
  const alreadyImported = db.prepare('SELECT 1 FROM backup_imports WHERE owner_user_id=? AND fingerprint=?').get(req.user.id, fingerprint);
  if (alreadyImported) return res.status(409).json({ error: 'Tệp sao lưu này đã được khôi phục trước đó. Không nhập lặp lại.' });
  for (const key of allowed) {
    if (!Array.isArray(backup.data[key])) return res.status(400).json({ error: 'Tệp sao lưu thiếu dữ liệu hợp lệ: ' + key });
    if (backup.data[key].length > 50000) return res.status(413).json({ error: 'Tệp sao lưu quá lớn.' });
  }
  // Restore is intentionally additive and remaps all ownership to the currently signed-in teacher.
  // It never deletes existing data or restores credentials/other users.
  const classMap = new Map(), bankMap = new Map(), questionMap = new Map(), testMap = new Map(), assignmentMap = new Map(), studentMap = new Map();
  const remapId = old => randomUUID();
  const tx = db.prepare('SELECT 1');
  try {
    db.exec('BEGIN IMMEDIATE');
    for (const row of backup.data.classes) {
      const id = remapId(row.id); classMap.set(row.id, id);
      db.prepare('INSERT INTO classes(id,owner_user_id,name,school_name) VALUES(?,?,?,?)')
        .run(id, req.user.id, String(row.name || 'Lớp khôi phục').slice(0,80) + ' (khôi phục)', String(row.school_name || 'Trường').slice(0,120));
    }
    for (const row of backup.data.students) {
      if (!classMap.has(row.class_id)) continue;
      const id = remapId(row.id); studentMap.set(row.id, id);
      db.prepare('INSERT INTO students(id,class_id,student_code,display_name,demo_level) VALUES(?,?,?,?,?)')
        .run(id, classMap.get(row.class_id), String(row.student_code || id.slice(0,8)).slice(0,50), String(row.display_name || 'Học sinh').slice(0,100), String(row.demo_level || 'Chưa đánh giá').slice(0,50));
    }
    for (const row of backup.data.question_banks) {
      const id = remapId(row.id); bankMap.set(row.id, id);
      db.prepare('INSERT INTO question_banks(id,owner_user_id,name,subject,grade) VALUES(?,?,?,?,?)')
        .run(id, req.user.id, String(row.name || 'Ngân hàng khôi phục').slice(0,120) + ' (khôi phục)', String(row.subject || '').slice(0,80), String(row.grade || '').slice(0,40));
    }
    for (const row of backup.data.questions) {
      if (!bankMap.has(row.bank_id)) continue;
      const id = remapId(row.id); questionMap.set(row.id, id);
      db.prepare('INSERT INTO questions(id,bank_id,question_type,prompt,options_json,answer_json,explanation) VALUES(?,?,?,?,?,?,?)')
        .run(id, bankMap.get(row.bank_id), String(row.question_type || 'short').slice(0,40), String(row.prompt || '').slice(0,5000), String(row.options_json || '[]').slice(0,20000), String(row.answer_json || 'null').slice(0,10000), String(row.explanation || '').slice(0,3000));
    }
    for (const row of backup.data.test_sets) {
      const id = remapId(row.id); testMap.set(row.id, id);
      db.prepare('INSERT INTO test_sets(id,owner_user_id,name,subject,grade) VALUES(?,?,?,?,?)')
        .run(id, req.user.id, String(row.name || 'Bộ đề khôi phục').slice(0,120) + ' (khôi phục)', String(row.subject || '').slice(0,80), String(row.grade || '').slice(0,40));
    }
    for (const row of backup.data.test_set_questions) {
      if (!testMap.has(row.test_set_id) || !questionMap.has(row.question_id)) continue;
      db.prepare('INSERT OR IGNORE INTO test_set_questions(test_set_id,question_id,position,points) VALUES(?,?,?,?)')
        .run(testMap.get(row.test_set_id), questionMap.get(row.question_id), Number(row.position) || 0, Math.max(0, Math.min(100, Number(row.points) || 1)));
    }
    for (const row of backup.data.assignments) {
      if (!classMap.has(row.class_id)) continue;
      const id = remapId(row.id); assignmentMap.set(row.id, id);
      db.prepare('INSERT INTO assignments(id,owner_user_id,class_id,test_set_id,title,due_at) VALUES(?,?,?,?,?,?)')
        .run(id, req.user.id, classMap.get(row.class_id), testMap.get(row.test_set_id) || null, String(row.title || 'Bài tập khôi phục').slice(0,160) + ' (khôi phục)', row.due_at || null);
    }
    for (const row of backup.data.scores) {
      if (!assignmentMap.has(row.assignment_id) || !studentMap.has(row.student_id)) continue;
      db.prepare('INSERT OR IGNORE INTO scores(id,assignment_id,student_id,score,max_score,detail_json) VALUES(?,?,?,?,?,?)')
        .run(remapId(row.id), assignmentMap.get(row.assignment_id), studentMap.get(row.student_id), Number(row.score) || 0, Number(row.max_score) || 0, String(row.detail_json || '{}').slice(0,20000));
    }
    for (const row of backup.data.point_transactions) {
      if (!classMap.has(row.class_id) || !studentMap.has(row.student_id)) continue;
      db.prepare('INSERT INTO point_transactions(id,owner_user_id,class_id,student_id,points,reason,created_at) VALUES(?,?,?,?,?,?,?)')
        .run(remapId(row.id), req.user.id, classMap.get(row.class_id), studentMap.get(row.student_id), Number(row.points) || 0, String(row.reason || '').slice(0,500), row.created_at || new Date().toISOString());
    }
    for (const row of backup.data.audit_events) {
      db.prepare('INSERT INTO audit_events(actor_user_id,action,entity_type,entity_id,created_at) VALUES(?,?,?,?,?)')
        .run(req.user.id, String(row.action || 'restored').slice(0,80), String(row.entity_type || 'record').slice(0,80), row.entity_id ? String(row.entity_id).slice(0,100) : null, row.created_at || new Date().toISOString());
    }
    db.prepare('INSERT INTO backup_imports(owner_user_id,fingerprint) VALUES(?,?)').run(req.user.id, fingerprint);
    audit(req.user.id, 'restore_backup', 'backup');
    db.exec('COMMIT');
    res.json({ ok: true, message: 'Đã khôi phục dữ liệu bổ sung. Dữ liệu hiện có không bị xóa.', restored: Object.fromEntries(allowed.map(key => [key, backup.data[key].length])) });
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch {}
    console.error('LAVI2 restore error:', err.message);
    res.status(400).json({ error: 'Không thể khôi phục tệp. Hãy kiểm tra tệp sao lưu và thử lại.' });
  }
});

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
  const duplicate = db.prepare('SELECT id FROM classes WHERE owner_user_id=? AND name=?').get(req.user.id, name);
  if (duplicate) return res.status(409).json({ error: 'Thầy cô đã có lớp cùng tên trong tài khoản này.' });
  const id = randomUUID();
  try {
    db.prepare('INSERT INTO classes(id,owner_user_id,name,school_name) VALUES(?,?,?,?)')
      .run(id, req.user.id, name, schoolName);
    audit(req.user.id, 'create', 'class', id);
    res.status(201).json({ class: { id, name, schoolName, studentCount: 0 } });
  } catch (err) {
    if (err && (err.code === 'SQLITE_CONSTRAINT_UNIQUE' || /UNIQUE constraint failed: classes\.owner_user_id, classes\.name/i.test(String(err.message || '')))) {
      return res.status(409).json({ error: 'Thầy cô đã có lớp cùng tên trong tài khoản này.' });
    }
    throw err;
  }
});

app.get('/api/question-banks', authenticate, requireTeacher, (req, res) => {
  const banks = db.prepare(`
    SELECT b.id,b.name,b.subject,b.grade,b.created_at AS createdAt,
      (SELECT COUNT(*) FROM questions q WHERE q.bank_id=b.id) AS questionCount
    FROM question_banks b WHERE b.owner_user_id=? ORDER BY b.created_at DESC
  `).all(req.user.id);
  res.json({ questionBanks: banks });
});

app.post('/api/question-banks', authenticate, requireTeacher, (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (name.length < 2 || name.length > 120) return res.status(400).json({ error: 'Tên ngân hàng cần từ 2 đến 120 ký tự.' });
  const id = randomUUID();
  db.prepare('INSERT INTO question_banks(id,owner_user_id,name,subject,grade) VALUES(?,?,?,?,?)')
    .run(id, req.user.id, name, String(req.body?.subject || '').slice(0,80), String(req.body?.grade || '').slice(0,40));
  audit(req.user.id, 'create', 'question_bank', id);
  res.status(201).json({ questionBank: { id, name } });
});


function normalizeHeader(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/đ/g, 'd').replace(/[^a-z0-9]/g, '');
}
function firstValue(row, aliases) {
  for (const [key, value] of Object.entries(row)) {
    if (aliases.includes(normalizeHeader(key)) && value !== undefined && value !== null && String(value).trim() !== '') return String(value).trim();
  }
  return '';
}
function parseQuestionRows(rows) {
  const parsed = [];
  for (const row of rows) {
    const prompt = firstValue(row, ['cauhoi','question','noidungcauhoi','prompt','content']);
    if (!prompt) continue;
    const a = firstValue(row, ['dapana','phuonga','a']);
    const b = firstValue(row, ['dapanb','phuongb','b']);
    const c = firstValue(row, ['dapanc','phuongc','c']);
    const d = firstValue(row, ['dapand','phuongd','d']);
    const options = [a,b,c,d].filter(Boolean);
    const answerRaw = firstValue(row, ['dapandung','dapan','correctanswer','answer','key']);
    const explanation = firstValue(row, ['giaithich','explanation','loigiai']);
    if (!answerRaw) continue;
    // The official template stores A/B/C/D. Convert that key to the zero-based option index
    // used by the question editor and scoring API; preserve free-text answers unchanged.
    const answerLetter = answerRaw.trim().toUpperCase();
    const answer = options.length >= 2 && /^[ABCD]$/.test(answerLetter)
      ? ['A','B','C','D'].indexOf(answerLetter)
      : answerRaw;
    if (options.length >= 2 && typeof answer === 'number' && answer >= options.length) continue;
    parsed.push({ prompt: prompt.slice(0,5000), type: options.length >= 2 ? 'abcd' : 'short', options, answer, explanation: explanation.slice(0,3000) });
  }
  return parsed;
}
async function extractUploadedFile(fileName, base64) {
  if (typeof base64 !== 'string' || base64.length > 14 * 1024 * 1024) throw new Error('Tệp thiếu dữ liệu hoặc vượt giới hạn 10 MB.');
  const buffer = Buffer.from(base64, 'base64');
  const ext = path.extname(String(fileName || '')).toLowerCase();
  if (['.xlsx','.xls'].includes(ext)) {
    const workbook = XLSX.read(buffer, { type:'buffer' });
    const rows = [];
    for (const sheetName of workbook.SheetNames) rows.push(...XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval:'', raw:false }));
    return { rows, text: rows.map(row => Object.entries(row).map(([k,v]) => String(k)+': '+String(v)).join(' | ')).join('\n').slice(0,50000) };
  }
  if (ext === '.csv') {
    const workbook = XLSX.read(buffer.toString('utf8'), { type:'string' });
    const rows = [];
    for (const sheetName of workbook.SheetNames) rows.push(...XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval:'', raw:false }));
    return { rows, text: rows.map(row => Object.entries(row).map(([k,v]) => String(k)+': '+String(v)).join(' | ')).join('\n').slice(0,50000) };
  }
  if (ext === '.docx') {
    const result = await mammoth.extractRawText({ buffer });
    return { rows: [], text: String(result.value || '').slice(0,50000) };
  }
  if (['.txt','.md'].includes(ext)) return { rows: [], text: buffer.toString('utf8').slice(0,50000) };
  throw new Error('Định dạng chưa hỗ trợ. Dùng .xlsx, .xls, .csv, .docx, .txt hoặc .md.');
}

app.post('/api/documents/extract', authenticate, requireTeacher, async (req, res) => {
  try {
    const extracted = await extractUploadedFile(req.body?.fileName, req.body?.dataBase64);
    if (!extracted.text || extracted.text.trim().length < 20) return res.status(400).json({ error:'Không đọc được nội dung văn bản trong tệp.' });
    res.json({ text: extracted.text, rows: extracted.rows.length, fileName: String(req.body.fileName || '') });
  } catch (err) {
    res.status(400).json({ error:err.message || 'Không đọc được tài liệu.' });
  }
});

app.post('/api/question-banks/:bankId/import', authenticate, requireTeacher, async (req, res) => {
  const bank = db.prepare('SELECT id FROM question_banks WHERE id=? AND owner_user_id=?').get(String(req.params.bankId), req.user.id);
  if (!bank) return res.status(404).json({ error:'Không tìm thấy ngân hàng câu hỏi.' });
  try {
    const extracted = await extractUploadedFile(req.body?.fileName, req.body?.dataBase64);
    if (!extracted.rows.length) return res.status(400).json({ error:'Tệp đã đọc được nhưng chưa có bảng câu hỏi. Với Word, hãy dùng chức năng AI tạo câu hỏi từ tài liệu.' });
    const questions = parseQuestionRows(extracted.rows);
    if (!questions.length) return res.status(400).json({ error:'Không nhận diện được câu hỏi có đáp án. Hãy dùng mẫu Excel: ID, Câu hỏi, Đáp án A, Đáp án B, Đáp án C, Đáp án D, Đáp án đúng.' });
    const insert = db.prepare('INSERT INTO questions(id,bank_id,question_type,prompt,options_json,answer_json,explanation) VALUES(?,?,?,?,?,?,?)');
    db.exec('BEGIN IMMEDIATE');
    for (const q of questions) insert.run(randomUUID(), bank.id, q.type, q.prompt, JSON.stringify(q.options), JSON.stringify(q.answer), q.explanation);
    db.exec('COMMIT');
    audit(req.user.id,'import_questions','question_bank',bank.id);
    return res.json({ ok:true, imported:questions.length, message:'Đã nhập '+questions.length+' câu hỏi. Cô hãy kiểm tra lại đáp án trước khi sử dụng.' });
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch {}
    return res.status(400).json({ error:err.message || 'Không thể đọc tệp.' });
  }
});

app.post('/api/question-banks/:bankId/ai-generate', authenticate, requireTeacher, async (req, res) => {
  const bank = db.prepare('SELECT id FROM question_banks WHERE id=? AND owner_user_id=?').get(String(req.params.bankId), req.user.id);
  if (!bank) return res.status(404).json({ error:'Không tìm thấy ngân hàng câu hỏi.' });
  const text = String(req.body?.sourceText || '').trim();
  const count = Math.max(1, Math.min(30, Number(req.body?.count) || 10));
  if (text.length < 100) return res.status(400).json({ error:'Tài liệu cần ít nhất 100 ký tự để tạo câu hỏi bám sát nội dung.' });
  if (!process.env.OPENAI_API_KEY) return res.status(503).json({ error:'Chưa cấu hình OPENAI_API_KEY trên Render. Tính năng AI chưa thể chạy; cô vẫn có thể nhập câu hỏi từ Excel.' });
  try {
    const response = await fetch(process.env.OPENAI_API_URL || 'https://api.openai.com/v1/chat/completions', {
      method:'POST',
      headers:{'Authorization':'Bearer '+process.env.OPENAI_API_KEY,'Content-Type':'application/json'},
      body:JSON.stringify({
        model:process.env.OPENAI_MODEL || 'gpt-4o-mini',
        temperature:0.2,
        response_format:{type:'json_object'},
        messages:[
          {role:'system',content:'Bạn là trợ lý biên soạn câu hỏi giáo dục tiểu học bằng tiếng Việt. Chỉ dùng thông tin có trong tài liệu nguồn; không bịa kiến thức ngoài. Trả JSON object có key questions, là mảng câu hỏi trắc nghiệm. Mỗi phần tử có prompt, options là mảng đúng 4 chuỗi phương án, answer là A/B/C/D, explanation. Câu hỏi rõ ràng, một đáp án đúng, tránh mơ hồ và không lặp. Đây là bản nháp để giáo viên duyệt.'},
          {role:'user',content:'Tạo '+count+' câu hỏi trắc nghiệm theo tài liệu dưới đây. Không thêm nội dung ngoài nguồn. Nếu tài liệu không đủ căn cứ cho đủ số lượng, tạo ít câu hơn thay vì suy đoán.\n\nTÀI LIỆU:\n'+text.slice(0,30000)}
        ]
      })
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error?.message || 'Dịch vụ AI trả về lỗi.');
    const content = payload.choices?.[0]?.message?.content || '{}';
    const parsed = JSON.parse(content);
    const questions = Array.isArray(parsed.questions) ? parsed.questions.slice(0,count).filter(q => typeof q.prompt==='string' && Array.isArray(q.options) && q.options.length===4 && ['A','B','C','D'].includes(String(q.answer).toUpperCase())) : [];
    if (!questions.length) throw new Error('AI không trả về câu hỏi đúng cấu trúc. Hãy thử tài liệu rõ hơn.');
    res.json({ questions:questions.map(q=>({prompt:q.prompt.slice(0,5000),type:'abcd',options:q.options.map(String),answer:String(q.answer).toUpperCase(),explanation:String(q.explanation||'').slice(0,3000)})), requiresTeacherReview:true });
  } catch (err) {
    res.status(502).json({ error:err.message || 'Không tạo được câu hỏi từ tài liệu.' });
  }
});

app.get('/api/question-banks/:bankId/questions', authenticate, requireTeacher, (req, res) => {
  const bank = db.prepare('SELECT id FROM question_banks WHERE id=? AND owner_user_id=?').get(String(req.params.bankId), req.user.id);
  if (!bank) return res.status(404).json({ error: 'Không tìm thấy ngân hàng câu hỏi.' });
  const questions = db.prepare('SELECT id,bank_id AS bankId,question_type AS type,prompt,options_json AS optionsJson,answer_json AS answerJson,explanation,created_at AS createdAt FROM questions WHERE bank_id=? ORDER BY created_at DESC').all(bank.id);
  res.json({ questions: questions.map(q => ({ ...q, options: JSON.parse(q.optionsJson || '[]'), answer: JSON.parse(q.answerJson || 'null') })) });
});

app.post('/api/question-banks/:bankId/questions', authenticate, requireTeacher, (req, res) => {
  const bank = db.prepare('SELECT id FROM question_banks WHERE id=? AND owner_user_id=?').get(String(req.params.bankId), req.user.id);
  if (!bank) return res.status(404).json({ error: 'Không tìm thấy ngân hàng câu hỏi.' });
  const prompt = String(req.body?.prompt || '').trim();
  const type = String(req.body?.type || 'short');
  if (prompt.length < 3 || prompt.length > 5000) return res.status(400).json({ error: 'Nội dung câu hỏi cần từ 3 đến 5000 ký tự.' });
  if (!['abcd','multiple','true_false','short','fill_blank','matching','ordering'].includes(type)) return res.status(400).json({ error: 'Loại câu hỏi không được hỗ trợ.' });
  const options = Array.isArray(req.body?.options) ? req.body.options.slice(0,20) : [];
  const id = randomUUID();
  db.prepare('INSERT INTO questions(id,bank_id,question_type,prompt,options_json,answer_json,explanation) VALUES(?,?,?,?,?,?,?)')
    .run(id, bank.id, type, prompt, JSON.stringify(options), JSON.stringify(req.body?.answer ?? null), String(req.body?.explanation || '').slice(0,3000));
  audit(req.user.id, 'create', 'question', id);
  res.status(201).json({ question: { id, bankId: bank.id, type, prompt } });
});

app.get('/api/test-sets', authenticate, requireTeacher, (req, res) => {
  const sets = db.prepare(`
    SELECT t.id,t.name,t.subject,t.grade,t.created_at AS createdAt,
      (SELECT COUNT(*) FROM test_set_questions tq WHERE tq.test_set_id=t.id) AS questionCount
    FROM test_sets t WHERE t.owner_user_id=? ORDER BY t.created_at DESC
  `).all(req.user.id);
  res.json({ testSets: sets });
});

app.post('/api/test-sets', authenticate, requireTeacher, (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (name.length < 2 || name.length > 120) return res.status(400).json({ error: 'Tên bộ đề cần từ 2 đến 120 ký tự.' });
  const id = randomUUID();
  db.prepare('INSERT INTO test_sets(id,owner_user_id,name,subject,grade) VALUES(?,?,?,?,?)')
    .run(id, req.user.id, name, String(req.body?.subject || '').slice(0,80), String(req.body?.grade || '').slice(0,40));
  audit(req.user.id, 'create', 'test_set', id);
  res.status(201).json({ testSet: { id, name } });
});

app.post('/api/test-sets/:testSetId/questions', authenticate, requireTeacher, (req, res) => {
  const testSet = db.prepare('SELECT id FROM test_sets WHERE id=? AND owner_user_id=?').get(String(req.params.testSetId), req.user.id);
  if (!testSet) return res.status(404).json({ error: 'Không tìm thấy bộ đề.' });
  const questionId = String(req.body?.questionId || '');
  const question = db.prepare(`
    SELECT q.id FROM questions q JOIN question_banks b ON b.id=q.bank_id
    WHERE q.id=? AND b.owner_user_id=?
  `).get(questionId, req.user.id);
  if (!question) return res.status(404).json({ error: 'Không tìm thấy câu hỏi thuộc tài khoản của thầy cô.' });
  db.prepare('INSERT OR IGNORE INTO test_set_questions(test_set_id,question_id,position,points) VALUES(?,?,?,?)')
    .run(testSet.id, question.id, Math.max(0, Math.min(10000, Number(req.body?.position) || 0)), Math.max(0, Math.min(100, Number(req.body?.points) || 1)));
  res.status(201).json({ ok: true });
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

app.post('/api/classes/:classId/students', authenticate, requireTeacher, (req, res) => {
  const klass = db.prepare('SELECT id FROM classes WHERE id=? AND owner_user_id=?')
    .get(String(req.params.classId), req.user.id);
  if (!klass) return res.status(404).json({ error: 'Không tìm thấy lớp hoặc bạn không có quyền truy cập.' });
  const code = String(req.body?.code || '').trim().replace(/\\s+/g, '').slice(0,40);
  const displayName = String(req.body?.displayName || '').trim().replace(/\\s+/g, ' ');
  if (code.length < 1) return res.status(400).json({ error: 'Vui lòng nhập mã học sinh.' });
  if (displayName.length < 2 || displayName.length > 120) return res.status(400).json({ error: 'Tên học sinh cần từ 2 đến 120 ký tự.' });
  const duplicate = db.prepare('SELECT id FROM students WHERE class_id=? AND student_code=?').get(klass.id, code);
  if (duplicate) return res.status(409).json({ error: 'Mã học sinh đã tồn tại trong lớp này.' });
  const id = randomUUID();
  try {
    db.prepare('INSERT INTO students(id,class_id,student_code,display_name,demo_level) VALUES(?,?,?,?,?)')
      .run(id, klass.id, code, displayName, 'Chưa đánh giá');
    audit(req.user.id, 'create', 'student', id);
    res.status(201).json({ student: { id, code, displayName, level: 'Chưa đánh giá' } });
  } catch (err) {
    if (err && err.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(409).json({ error: 'Mã học sinh đã tồn tại trong lớp này.' });
    throw err;
  }
});

app.delete('/api/classes/:classId/students/:studentId', authenticate, requireTeacher, (req, res) => {
  const student = db.prepare(`
    SELECT s.id FROM students s JOIN classes c ON c.id=s.class_id
    WHERE s.id=? AND c.id=? AND c.owner_user_id=?
  `).get(String(req.params.studentId), String(req.params.classId), req.user.id);
  if (!student) return res.status(404).json({ error: 'Không tìm thấy học sinh trong lớp thuộc tài khoản của thầy cô.' });
  db.prepare('DELETE FROM students WHERE id=?').run(student.id);
  audit(req.user.id, 'delete', 'student', student.id);
  res.json({ ok: true });
});

app.get('/api/assignments', authenticate, requireTeacher, (req, res) => {
  const assignments = db.prepare(`
    SELECT a.id,a.class_id AS classId,c.name AS className,a.test_set_id AS testSetId,
      t.name AS testSetName,a.title,a.due_at AS dueAt,a.created_at AS createdAt,
      (SELECT COUNT(*) FROM scores sc WHERE sc.assignment_id=a.id) AS gradedCount
    FROM assignments a
    JOIN classes c ON c.id=a.class_id AND c.owner_user_id=a.owner_user_id
    LEFT JOIN test_sets t ON t.id=a.test_set_id
    WHERE a.owner_user_id=?
    ORDER BY a.created_at DESC
  `).all(req.user.id);
  res.json({ assignments });
});

app.post('/api/assignments', authenticate, requireTeacher, (req, res) => {
  const classId = String(req.body?.classId || '');
  const title = String(req.body?.title || '').trim().replace(/\\s+/g, ' ');
  const testSetId = String(req.body?.testSetId || '').trim() || null;
  const dueAt = String(req.body?.dueAt || '').trim() || null;
  if (title.length < 2 || title.length > 160) return res.status(400).json({ error: 'Tên bài giao cần từ 2 đến 160 ký tự.' });
  const klass = db.prepare('SELECT id,name FROM classes WHERE id=? AND owner_user_id=?').get(classId, req.user.id);
  if (!klass) return res.status(404).json({ error: 'Không tìm thấy lớp thuộc tài khoản của thầy cô.' });
  let testSet = null;
  if (testSetId) {
    testSet = db.prepare('SELECT id,name FROM test_sets WHERE id=? AND owner_user_id=?').get(testSetId, req.user.id);
    if (!testSet) return res.status(404).json({ error: 'Không tìm thấy bộ đề thuộc tài khoản của thầy cô.' });
  }
  if (dueAt && Number.isNaN(Date.parse(dueAt))) return res.status(400).json({ error: 'Hạn nộp chưa đúng định dạng ngày giờ.' });
  const id = randomUUID();
  db.prepare('INSERT INTO assignments(id,owner_user_id,class_id,test_set_id,title,due_at) VALUES(?,?,?,?,?,?)')
    .run(id, req.user.id, klass.id, testSet?.id || null, title, dueAt);
  audit(req.user.id, 'create', 'assignment', id);
  res.status(201).json({ assignment: { id, classId: klass.id, className: klass.name, testSetId: testSet?.id || null, testSetName: testSet?.name || null, title, dueAt } });
});


function canonicalAnswer(value) {
  if (Array.isArray(value)) return JSON.stringify(value.map(v => String(v).trim().toLowerCase()).sort());
  if (value && typeof value === 'object') return JSON.stringify(value);
  return String(value ?? '').trim().toLowerCase().replace(/^đáp án\\s*/i, '');
}
function gradeAnswer(question, submitted) {
  const expected = JSON.parse(question.answer_json || 'null');
  const type = question.question_type;
  // Objective grading only when a reliable answer key exists; open responses are teacher-graded.
  if (['short','fill_blank'].includes(type)) {
    if (expected === null || expected === '') return { autoGraded: false, correct: null, points: 0 };
    const normalize = v => String(v ?? '').trim().toLocaleLowerCase('vi').replace(/\\s+/g, ' ');
    const accepted = Array.isArray(expected) ? expected : [expected];
    const correct = accepted.some(v => normalize(v) === normalize(submitted));
    return { autoGraded: true, correct, points: correct ? 1 : 0 };
  }
  if (expected === null || expected === undefined) return { autoGraded: false, correct: null, points: 0 };
  const correct = canonicalAnswer(expected) === canonicalAnswer(submitted);
  return { autoGraded: true, correct, points: correct ? 1 : 0 };
}

app.get('/api/assignments/:assignmentId/submissions', authenticate, requireTeacher, (req, res) => {
  const assignment = db.prepare('SELECT id,class_id AS classId,title,test_set_id AS testSetId FROM assignments WHERE id=? AND owner_user_id=?')
    .get(String(req.params.assignmentId), req.user.id);
  if (!assignment) return res.status(404).json({ error: 'Không tìm thấy bài giao thuộc tài khoản của thầy cô.' });
  const students = db.prepare('SELECT id,student_code AS code,display_name AS displayName FROM students WHERE class_id=? ORDER BY student_code').all(assignment.classId);
  const scores = db.prepare('SELECT student_id AS studentId,score,max_score AS maxScore,detail_json AS detailJson,updated_at AS updatedAt FROM scores WHERE assignment_id=?').all(assignment.id);
  const scoreByStudent = new Map(scores.map(s => [s.studentId, s]));
  res.json({ assignment, submissions: students.map(s => {
    const score = scoreByStudent.get(s.id);
    return { studentId: s.id, code: s.code, displayName: s.displayName, submitted: Boolean(score), score: score ? score.score : null, maxScore: score ? score.maxScore : null, details: score ? JSON.parse(score.detailJson || '{}') : null, updatedAt: score?.updatedAt || null };
  })});
});

app.post('/api/assignments/:assignmentId/submissions/:studentId', authenticate, requireTeacher, (req, res) => {
  const assignment = db.prepare('SELECT id,class_id AS classId,test_set_id AS testSetId FROM assignments WHERE id=? AND owner_user_id=?')
    .get(String(req.params.assignmentId), req.user.id);
  if (!assignment) return res.status(404).json({ error: 'Không tìm thấy bài giao thuộc tài khoản của thầy cô.' });
  const student = db.prepare('SELECT id FROM students WHERE id=? AND class_id=?').get(String(req.params.studentId), assignment.classId);
  if (!student) return res.status(404).json({ error: 'Học sinh không thuộc lớp được giao bài.' });
  const answers = req.body?.answers;
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) return res.status(400).json({ error: 'Cần gửi câu trả lời dưới dạng đối tượng.' });
  if (!assignment.testSetId) return res.status(400).json({ error: 'Bài giao chưa gắn bộ đề nên chưa thể chấm tự động.' });
  const questions = db.prepare(`
    SELECT q.id,q.question_type,q.answer_json,tq.points
    FROM test_set_questions tq JOIN questions q ON q.id=tq.question_id
    JOIN test_sets ts ON ts.id=tq.test_set_id AND ts.owner_user_id=?
    JOIN question_banks b ON b.id=q.bank_id AND b.owner_user_id=?
    WHERE tq.test_set_id=? ORDER BY tq.position,q.created_at
  `).all(req.user.id, req.user.id, assignment.testSetId);
  if (!questions.length) return res.status(400).json({ error: 'Bộ đề chưa có câu hỏi hợp lệ.' });
  const details = {};
  let score = 0, maxScore = 0, needsReview = false;
  for (const q of questions) {
    const points = Math.max(0, Number(q.points) || 0);
    maxScore += points;
    const result = gradeAnswer(q, Object.prototype.hasOwnProperty.call(answers, q.id) ? answers[q.id] : null);
    const earned = result.autoGraded && result.correct ? points : 0;
    score += earned;
    if (!result.autoGraded) needsReview = true;
    details[q.id] = { autoGraded: result.autoGraded, correct: result.correct, earned, maxPoints: points, submitted: Object.prototype.hasOwnProperty.call(answers, q.id) };
  }
  const id = randomUUID();
  db.prepare(`INSERT INTO scores(id,assignment_id,student_id,score,max_score,detail_json,updated_at)
    VALUES(?,?,?,?,?,?,CURRENT_TIMESTAMP)
    ON CONFLICT(assignment_id,student_id) DO UPDATE SET score=excluded.score,max_score=excluded.max_score,detail_json=excluded.detail_json,updated_at=CURRENT_TIMESTAMP`)
    .run(id, assignment.id, student.id, score, maxScore, JSON.stringify(details));
  audit(req.user.id, 'grade_submission', 'assignment', assignment.id);
  res.json({ ok: true, score, maxScore, percent: maxScore ? Math.round(score / maxScore * 1000) / 10 : 0, needsTeacherReview: needsReview, details });
});

app.post('/api/assignments/:assignmentId/submissions/:studentId/manual-grade', authenticate, requireTeacher, (req, res) => {
  const assignment = db.prepare('SELECT id,class_id AS classId,test_set_id AS testSetId FROM assignments WHERE id=? AND owner_user_id=?')
    .get(String(req.params.assignmentId), req.user.id);
  if (!assignment) return res.status(404).json({ error: 'Không tìm thấy bài giao thuộc tài khoản của thầy cô.' });
  const student = db.prepare('SELECT id FROM students WHERE id=? AND class_id=?').get(String(req.params.studentId), assignment.classId);
  if (!student) return res.status(404).json({ error: 'Học sinh không thuộc lớp được giao bài.' });
  if (!assignment.testSetId) return res.status(400).json({ error: 'Bài giao chưa gắn bộ đề.' });
  const existing = db.prepare('SELECT id,detail_json AS detailJson FROM scores WHERE assignment_id=? AND student_id=?').get(assignment.id, student.id);
  if (!existing) return res.status(404).json({ error: 'Chưa có kết quả để chấm. Hãy lưu bài làm trước.' });
  const incoming = req.body?.details;
  if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) return res.status(400).json({ error: 'Cần gửi điểm từng câu dưới dạng đối tượng details.' });
  const rows = db.prepare('SELECT q.id,tq.points FROM test_set_questions tq JOIN questions q ON q.id=tq.question_id WHERE tq.test_set_id=?').all(assignment.testSetId);
  const maxById = new Map(rows.map(row => [row.id, Math.max(0, Number(row.points) || 0)]));
  const details = JSON.parse(existing.detailJson || '{}');
  for (const [questionId, value] of Object.entries(incoming)) {
    if (!maxById.has(questionId)) return res.status(400).json({ error: 'Có câu hỏi không thuộc bộ đề được giao.' });
    if (!value || typeof value !== 'object') return res.status(400).json({ error: 'Dữ liệu chấm từng câu không hợp lệ.' });
    const earned = Number(value.earned);
    if (!Number.isFinite(earned) || earned < 0 || earned > maxById.get(questionId)) {
      return res.status(400).json({ error: 'Điểm câu hỏi phải nằm trong khoảng 0 đến ' + maxById.get(questionId) + '.' });
    }
    details[questionId] = {
      ...(details[questionId] || {}),
      earned,
      maxPoints: maxById.get(questionId),
      autoGraded: false,
      correct: earned === maxById.get(questionId),
      teacherReviewed: true,
      teacherNote: String(value.note || '').slice(0,500)
    };
  }
  let score = 0, maxScore = 0, needsReview = false;
  for (const row of rows) {
    const item = details[row.id] || {};
    const maxPoints = Math.max(0, Number(row.points) || 0);
    maxScore += maxPoints;
    score += Math.max(0, Math.min(maxPoints, Number(item.earned) || 0));
    if (item.autoGraded === false && !item.teacherReviewed) needsReview = true;
  }
  db.prepare('UPDATE scores SET score=?,max_score=?,detail_json=?,updated_at=CURRENT_TIMESTAMP WHERE id=?')
    .run(score, maxScore, JSON.stringify(details), existing.id);
  audit(req.user.id, 'manual_grade_submission', 'assignment', assignment.id);
  res.json({ ok: true, score, maxScore, percent: maxScore ? Math.round(score / maxScore * 1000) / 10 : 0, needsTeacherReview: needsReview, details });
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