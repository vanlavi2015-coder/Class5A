const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs/promises');

test('teacher data is isolated and survives a server restart', async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lavi-multi-teacher-'));
  const port = 32000 + (process.pid % 1000);
  const base = 'http://127.0.0.1:' + port;
  const serverFile = path.resolve(__dirname, '..', 'server.js');
  let child;

  async function startServer() {
    child = spawn(process.execPath, [serverFile], {
      env: {
        ...process.env,
        PORT: String(port),
        LAVI_DATA_DIR: dataDir,
        LAVI_JWT_SECRET: 'test-only-secret-for-lavi-multi-teacher',
        LAVI_TEACHER_PASSWORD: 'Lavi@2026',
        LAVI_BACKUP_TOKEN: '',
        LAVI_BACKUP_KEY: ''
      },
      stdio: 'ignore'
    });
    for (let i = 0; i < 100; i++) {
      try {
        const r = await fetch(base + '/api/health');
        if (r.ok) return;
      } catch {}
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('LAVI server did not start');
  }

  async function stopServer() {
    if (!child || child.exitCode !== null) return;
    child.kill('SIGTERM');
    await Promise.race([
      new Promise(resolve => child.once('exit', resolve)),
      new Promise(resolve => setTimeout(resolve, 3000))
    ]);
    child = null;
  }

  async function api(url, token, method = 'GET', body) {
    const headers = {};
    if (token) headers.Authorization = 'Bearer ' + token;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const response = await fetch(base + url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    let data = {};
    try { data = await response.json(); } catch {}
    return { status: response.status, data };
  }

  async function login(username, password) {
    for (let i = 0; i < 30; i++) {
      const result = await api('/api/login', null, 'POST', { username, password });
      if (result.status === 200) return result.data;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('Could not log in as ' + username);
  }

  t.after(async () => {
    await stopServer();
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  await startServer();
  const teacher1 = await login('teacher', 'Lavi@2026');
  let result = await api('/api/state', teacher1.token);
  assert.equal(result.status, 200);
  assert.equal(result.data.students.length, 32);

  const assignment1 = {
    id: 'tenant-test-teacher1-assignment',
    title: 'Bài kiểm tra riêng của giáo viên 1',
    status: 'Đang giao',
    createdAt: new Date().toISOString(),
    sets: [{ group: 'Tất cả', questions: [{ text: 'Câu hỏi thử', answer: 'A', options: ['A', 'B'] }] }]
  };
  result = await api('/api/state', teacher1.token, 'PUT', {
    state: { assignments: [assignment1], submissions: {} }
  });
  assert.equal(result.status, 200);

  result = await api('/api/teacher/create-account', teacher1.token, 'POST', {
    username: 'teacher2', className: 'Lớp 5B', password: 'Teacher2Pass!'
  });
  assert.equal(result.status, 201, JSON.stringify(result.data));

  const teacher2 = await login('teacher2', 'Teacher2Pass!');
  result = await api('/api/state', teacher2.token);
  assert.equal(result.status, 200);
  assert.equal(result.data.students.length, 0);
  assert.equal(result.data.state.assignments.length, 0);
  assert.equal(teacher2.user.className, 'Lớp 5B');

  result = await api('/api/leaderboard?assignmentId=' + assignment1.id, teacher2.token);
  assert.equal(result.status, 404);

  result = await api('/api/teacher/students', teacher2.token, 'POST', {
    name: 'Học sinh thử nghiệm lớp 5B',
    code: '01',
    username: 'hs5b01',
    password: 'Student123',
    group: 'Khá'
  });
  assert.equal(result.status, 201, JSON.stringify(result.data));
  const studentId = result.data.student.id;

  result = await api('/api/state', teacher1.token);
  assert.equal(result.data.students.length, 32);
  assert.equal(result.data.students.some(s => s.id === studentId), false);

  result = await api('/api/teacher/award', teacher2.token, 'POST', {
    studentId: 1, stars: 1, reason: 'cross-tenant test'
  });
  assert.equal(result.status, 404);

  const student = await login('hs5b01', 'Student123');
  result = await api('/api/state', student.token);
  assert.equal(result.data.students.length, 1);
  assert.equal(result.data.students[0].id, studentId);
  assert.equal(result.data.state.assignments.length, 0);

  const assignment2 = {
    id: 'tenant-test-teacher2-assignment',
    title: 'Bài kiểm tra riêng của giáo viên 2',
    status: 'Đang giao',
    createdAt: new Date().toISOString(),
    sets: [{ group: 'Tất cả', questions: [{ text: 'Câu hỏi thử', answer: 'B', options: ['A', 'B'] }] }]
  };
  result = await api('/api/state', teacher2.token, 'PUT', {
    state: { assignments: [assignment2], submissions: {} }
  });
  assert.equal(result.status, 200);

  result = await api('/api/state', teacher1.token);
  assert.equal(result.data.state.assignments.some(a => a.id === assignment2.id), false);

  await stopServer();
  await startServer();

  const teacher2AfterRestart = await login('teacher2', 'Teacher2Pass!');
  result = await api('/api/state', teacher2AfterRestart.token);
  assert.equal(result.data.students.length, 1);
  assert.equal(result.data.state.assignments.some(a => a.id === assignment2.id), true);

  const teacher1AfterRestart = await login('teacher', 'Lavi@2026');
  result = await api('/api/state', teacher1AfterRestart.token);
  assert.equal(result.data.students.length, 32);
  assert.equal(result.data.state.assignments.some(a => a.id === assignment1.id), true);
  assert.equal(result.data.state.assignments.some(a => a.id === assignment2.id), false);
});
