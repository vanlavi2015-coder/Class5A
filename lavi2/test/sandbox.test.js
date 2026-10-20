const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const root = path.join(__dirname, '..');

test('sandbox safety contract contains only synthetic records and server-side tenant filters', () => {
  const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  assert.match(server, /syntheticDataOnly: true/);
  assert.match(server, /LAVI_DEMO_MODE/);
  assert.match(server, /owner_user_id = \?/);
  assert.doesNotMatch(server, /Hoàng Tuệ An|Tô Nguyễn Tâm An/);
  const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
  assert.match(html, /Chỉ sử dụng dữ liệu giả lập/);
  assert.match(html, /teacher1/);
  assert.match(html, /teacher2/);
});

test('teacher1 and teacher2 cannot see or open each other’s classes', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lavi2-test-'));
  const port = 32000 + Math.floor(Math.random() * 10000);
  const base = 'http://127.0.0.1:' + port;
  const child = spawn(process.execPath, [path.join(root, 'server.js')], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(port),
      NODE_ENV: 'test',
      LAVI_DEMO_MODE: 'true',
      LAVI_JWT_SECRET: 'test-secret-only-not-for-deployment-123456789',
      LAVI_DATA_DIR: dataDir
    },
    stdio: ['ignore', 'ignore', 'pipe']
  });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk.toString(); });

  async function waitReady() {
    for (let i = 0; i < 60; i++) {
      if (child.exitCode !== null) throw new Error('Test server exited: ' + stderr);
      try {
        const r = await fetch(base + '/api/health');
        if (r.ok) return;
      } catch {}
      await new Promise(resolve => setTimeout(resolve, 150));
    }
    throw new Error('Test server did not start: ' + stderr);
  }
  async function login(username) {
    const r = await fetch(base + '/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password: 'Demo1234!' })
    });
    assert.equal(r.status, 200);
    return (await r.json()).token;
  }

  try {
    await waitReady();
    const health = await (await fetch(base + '/api/health')).json();
    assert.equal(health.syntheticDataOnly, true);

    const tokenA = await login('teacher1');
    const tokenB = await login('teacher2');
    const classesA = await (await fetch(base + '/api/classes', { headers: { Authorization: 'Bearer ' + tokenA } })).json();
    const classesB = await (await fetch(base + '/api/classes', { headers: { Authorization: 'Bearer ' + tokenB } })).json();

    assert.deepEqual(classesA.classes.map(c => c.id), ['demo-class-a']);
    assert.deepEqual(classesB.classes.map(c => c.id), ['demo-class-b']);

    const crossAccess = await fetch(base + '/api/classes/demo-class-b/students', {
      headers: { Authorization: 'Bearer ' + tokenA }
    });
    assert.equal(crossAccess.status, 404);

    const ownAccess = await fetch(base + '/api/classes/demo-class-a/students', {
      headers: { Authorization: 'Bearer ' + tokenA }
    });
    assert.equal(ownAccess.status, 200);
    const roster = await ownAccess.json();
    assert.equal(roster.students.length, 3);
    assert.ok(roster.students.every(s => s.displayName.includes('giả lập')));
  } finally {
    child.kill('SIGTERM');
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
