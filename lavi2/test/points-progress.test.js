const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');

test('point ledger exposes class totals and individual transaction history', () => {
  assert.match(server, /app\.get\('\/api\/classes\/:classId\/points'/);
  assert.match(server, /app\.get\('\/api\/classes\/:classId\/students\/:studentId\/points'/);
  assert.match(server, /app\.post\('\/api\/classes\/:classId\/students\/:studentId\/points'/);
  assert.match(server, /INSERT INTO point_transactions/);
  assert.match(server, /SUM\(pt\.points\)/);
  assert.match(server, /ORDER BY created_at DESC,id DESC LIMIT 500/);
});

test('point ledger validates values and scopes all mutations to the teacher-owned class', () => {
  assert.match(server, /points < -1000 \|\| points > 1000/);
  assert.match(server, /reason\.length < 2 \|\| reason\.length > 300/);
  assert.match(server, /c\.owner_user_id=\?/);
  assert.match(server, /audit\(req\.user\.id, 'record_points', 'student'/);
});

test('progress summary is computed from saved scores and reward ledger', () => {
  assert.match(server, /app\.get\('\/api\/classes\/:classId\/progress'/);
  assert.match(server, /COUNT\(sc\.id\) AS completedAssignments/);
  assert.match(server, /SUM\(sc\.score\)/);
  assert.match(server, /SUM\(sc\.max_score\)/);
  assert.match(server, /AS rewardPoints/);
  assert.match(server, /feedback: s\.percent === null/);
  assert.match(server, /requiresTeacherReview|teacherReviewed/);
});

test('production guard remains enabled until readiness gates are met', () => {
  assert.match(server, /NODE_ENV === 'production' && !DEMO_MODE/);
  assert.match(server, /This sandbox build is not approved for production/);
});
