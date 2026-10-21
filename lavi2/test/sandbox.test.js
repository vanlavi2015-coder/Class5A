const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const root = path.join(__dirname, '..');

test('sandbox UI and API support teacher registration with email or phone', () => {
  const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
  assert.match(server, /app\.post\('\/api\/register'/);
  assert.match(server, /normalizeContact/);
  assert.match(server, /contact_verified/);
  assert.match(server, /owner_user_id = \?/);
  assert.match(html, /Đăng ký/);
  assert.match(html, /Gmail hoặc số điện thoại/);
  assert.match(html, /Chưa xác minh email\/số điện thoại bằng OTP/);
  assert.match(html, /class="lavi-sidebar"/);
  assert.match(html, /data-view="classesView"/);
  assert.match(html, /data-view="questionsView"/);
  assert.match(html, /data-view="testsView"/);
  assert.match(html, /data-view="backupView"/);
  for (const moduleName of ['Bài đang giao', 'Bài nộp & chấm điểm', 'Danh sách học sinh', 'Sao thưởng & khen thưởng', 'Trò chơi kiến thức', 'Trò chơi & xếp hạng', 'Lịch lớp học', 'Thống kê học tập', 'Xếp loại tháng', 'Trợ lý VnEdu', 'Tài khoản giáo viên']) {
    assert.ok(html.includes(moduleName), 'Missing legacy navigation module: ' + moduleName);
  }
  assert.match(html, /id="futureView"/);
  assert.match(html, /Chưa kết nối chức năng/);
  assert.match(html, /data-go-view="classesView"/);
  assert.match(html, /async function renderSubmissions\(\)/);
  assert.match(html, /Bài nộp & chấm điểm/);
  assert.match(html, /Chọn bài đã giao để xem kết quả đã lưu/);
  assert.match(html, /Làm mới kết quả/);
  assert.match(html, /Tải mẫu Excel câu hỏi LAVI/);
  assert.match(html, /Cột “Đáp án đúng” ghi A, B, C hoặc D/);
  assert.match(server, /manual-grade/);
  assert.match(server, /answerLetter/);
  assert.match(html, /mobileMenuBtn/);
  assert.match(html, /@media\(max-width:650px\)/);
  assert.doesNotMatch(server, /Hoàng Tuệ An|Tô Nguyễn Tâm An/);
});

test('demo teachers remain isolated and registration/login works for email and phone', async () => {
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
  async function post(url, body, token) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = 'Bearer ' + token;
    return fetch(base + url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    });
  }
  async function login(username) {
    const r = await post('/api/login', { username, password: 'Demo1234!' });
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

    const teacherCRegister = await post('/api/register', {
      displayName: 'Giáo viên Demo Lớp',
      contact: 'teacher.class@gmail.com',
      password: 'StrongDemo123!'
    });
    assert.equal(teacherCRegister.status, 201);
    const teacherCToken = (await teacherCRegister.json()).token;
    const createClass = await fetch(base + '/api/classes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + teacherCToken },
      body: JSON.stringify({ name: 'Lớp thử nghiệm C', schoolName: 'Trường giả lập C' })
    });
    assert.equal(createClass.status, 201);
    const createdClass = (await createClass.json()).class;
    assert.equal(createdClass.studentCount, 0);
    const ownNewClass = await (await fetch(base + '/api/classes', {
      headers: { Authorization: 'Bearer ' + teacherCToken }
    })).json();
    assert.deepEqual(ownNewClass.classes.map(c => c.id), [createdClass.id]);
    const teacherACannotSeeNewClass = await fetch(base + '/api/classes/' + createdClass.id + '/students', {
      headers: { Authorization: 'Bearer ' + tokenA }
    });
    assert.equal(teacherACannotSeeNewClass.status, 404);
    const duplicateClass = await fetch(base + '/api/classes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + teacherCToken },
      body: JSON.stringify({ name: 'Lớp thử nghiệm C', schoolName: 'Trường giả lập C' })
    });
    assert.equal(duplicateClass.status, 409);

    const bankResponse = await post('/api/question-banks', {
      name: 'Ngân hàng Toán demo', subject: 'Toán', grade: '5'
    }, teacherCToken);
    assert.equal(bankResponse.status, 201);
    const bank = (await bankResponse.json()).questionBank;
    const questionResponse = await post('/api/question-banks/' + bank.id + '/questions', {
      type: 'abcd', prompt: 'Diện tích hình chữ nhật được tính thế nào?',
      options: ['Dài × rộng', 'Dài + rộng'], answer: 0, explanation: 'Lấy chiều dài nhân chiều rộng.'
    }, teacherCToken);
    assert.equal(questionResponse.status, 201);
    const question = (await questionResponse.json()).question;
    const testSetResponse = await post('/api/test-sets', { name: 'Đề Toán demo', subject: 'Toán', grade: '5' }, teacherCToken);
    assert.equal(testSetResponse.status, 201);
    const testSet = (await testSetResponse.json()).testSet;
    assert.equal((await post('/api/test-sets/' + testSet.id + '/questions', { questionId: question.id, points: 2 }, teacherCToken)).status, 201);

    const studentCreate = await post('/api/classes/' + createdClass.id + '/students', {
      code: 'C01', displayName: 'Học sinh thử nghiệm C'
    }, teacherCToken);
    assert.equal(studentCreate.status, 201);
    const student = (await studentCreate.json()).student;
    assert.equal(student.code, 'C01');
    assert.equal(student.level, 'Chưa đánh giá');
    const duplicateStudent = await post('/api/classes/' + createdClass.id + '/students', {
      code: 'C01', displayName: 'Học sinh trùng mã'
    }, teacherCToken);
    assert.equal(duplicateStudent.status, 409);
    const rosterAfterCreate = await (await fetch(base + '/api/classes/' + createdClass.id + '/students', {
      headers: { Authorization: 'Bearer ' + teacherCToken }
    })).json();
    assert.equal(rosterAfterCreate.students.length, 1);
    const otherTeacherRoster = await fetch(base + '/api/classes/' + createdClass.id + '/students', {
      headers: { Authorization: 'Bearer ' + tokenA }
    });
    assert.equal(otherTeacherRoster.status, 404);

    const assignmentResponse = await post('/api/assignments', {
      title: 'Bài ôn tập thử nghiệm', classId: createdClass.id, testSetId: testSet.id,
      dueAt: '2026-10-25T10:00:00.000Z'
    }, teacherCToken);
    assert.equal(assignmentResponse.status, 201);
    const assignment = (await assignmentResponse.json()).assignment;
    assert.equal(assignment.classId, createdClass.id);
    assert.equal(assignment.testSetId, testSet.id);
    const assignmentList = await (await fetch(base + '/api/assignments', {
      headers: { Authorization: 'Bearer ' + teacherCToken }
    })).json();
    assert.equal(assignmentList.assignments.length, 1);
    assert.equal(assignmentList.assignments[0].title, 'Bài ôn tập thử nghiệm');
    const otherTeacherAssignments = await (await fetch(base + '/api/assignments', {
      headers: { Authorization: 'Bearer ' + tokenA }
    })).json();
    assert.equal(otherTeacherAssignments.assignments.length, 0);
    const invalidAssignment = await post('/api/assignments', {
      title: 'Bài không hợp lệ', classId: 'demo-class-b'
    }, teacherCToken);
    assert.equal(invalidAssignment.status, 404);


    const submissionResponse = await post('/api/assignments/' + assignment.id + '/submissions/' + student.id, {
      answers: { [question.id]: 0 }
    }, teacherCToken);
    assert.equal(submissionResponse.status, 200);
    const graded = await submissionResponse.json();
    assert.equal(graded.score, 2);
    assert.equal(graded.maxScore, 2);
    assert.equal(graded.percent, 100);
    assert.equal(graded.needsTeacherReview, false);
    const manualGradeResponse = await post('/api/assignments/' + assignment.id + '/submissions/' + student.id + '/manual-grade', {
      details: { [question.id]: { earned: 1.5, note: 'Chấm thử nghiệm' } }
    }, teacherCToken);
    assert.equal(manualGradeResponse.status, 200);
    const manuallyGraded = await manualGradeResponse.json();
    assert.equal(manuallyGraded.score, 1.5);
    assert.equal(manuallyGraded.maxScore, 2);
    assert.equal(manuallyGraded.details[question.id].teacherReviewed, true);
    const invalidManualGrade = await post('/api/assignments/' + assignment.id + '/submissions/' + student.id + '/manual-grade', {
      details: { [question.id]: { earned: 3, note: 'Điểm vượt mức' } }
    }, teacherCToken);
    assert.equal(invalidManualGrade.status, 400);
    const submissionList = await fetch(base + '/api/assignments/' + assignment.id + '/submissions', {
      headers: { Authorization: 'Bearer ' + teacherCToken }
    });
    assert.equal(submissionList.status, 200);
    const submissionData = await submissionList.json();
    assert.equal(submissionData.submissions.length, 1);
    assert.equal(submissionData.submissions[0].submitted, true);
    assert.equal(submissionData.submissions[0].score, 1.5);
    const foreignSubmission = await fetch(base + '/api/assignments/' + assignment.id + '/submissions/demo-a-01', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + teacherCToken },
      body: JSON.stringify({ answers: { [question.id]: 0 } })
    });
    assert.equal(foreignSubmission.status, 404);
    const otherTeacherCannotReadSubmission = await fetch(base + '/api/assignments/' + assignment.id + '/submissions', {
      headers: { Authorization: 'Bearer ' + tokenA }
    });
    assert.equal(otherTeacherCannotReadSubmission.status, 404);

    const backupResponse = await fetch(base + '/api/backup', {
      headers: { Authorization: 'Bearer ' + teacherCToken }
    });
    assert.equal(backupResponse.status, 200);
    const backup = await backupResponse.json();
    assert.equal(backup.format, 'LAVI2_BACKUP');
    assert.equal(backup.data.question_banks.length, 1);
    assert.equal(backup.data.questions.length, 1);
    assert.equal(backup.data.test_sets.length, 1);
    assert.equal(backup.data.test_set_questions.length, 1);
    assert.ok(Array.isArray(backup.data.audit_events));
    const restoreResponse = await fetch(base + '/api/backup/restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + teacherCToken },
      body: JSON.stringify(backup)
    });
    assert.equal(restoreResponse.status, 200);
    const restored = await restoreResponse.json();
    assert.equal(restored.ok, true);
    assert.equal(restored.restored.questions, 1);
    const duplicateRestoreResponse = await fetch(base + '/api/backup/restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + teacherCToken },
      body: JSON.stringify(backup)
    });
    assert.equal(duplicateRestoreResponse.status, 409);
    assert.match((await duplicateRestoreResponse.json()).error, /đã được khôi phục trước đó/i);
    const banksAfterRestore = await (await fetch(base + '/api/question-banks', {
      headers: { Authorization: 'Bearer ' + teacherCToken }
    })).json();
    assert.equal(banksAfterRestore.questionBanks.length, 2);

    const emailRegister = await post('/api/register', {
      displayName: 'Giáo viên Demo Email',
      contact: 'Teacher.Demo@Gmail.com',
      password: 'StrongDemo123!'
    });
    assert.equal(emailRegister.status, 201);
    const emailData = await emailRegister.json();
    assert.equal(emailData.user.contact, 'teacher.demo@gmail.com');
    assert.equal(emailData.user.contactVerified, false);

    const emailLogin = await post('/api/login', {
      contact: 'teacher.demo@gmail.com',
      password: 'StrongDemo123!'
    });
    assert.equal(emailLogin.status, 200);

    const duplicateEmail = await post('/api/register', {
      displayName: 'Giáo viên khác',
      contact: 'teacher.demo@gmail.com',
      password: 'AnotherDemo123!'
    });
    assert.equal(duplicateEmail.status, 409);

    const phoneRegister = await post('/api/register', {
      displayName: 'Giáo viên Demo Phone',
      contact: '0912345678',
      password: 'StrongDemo123!'
    });
    assert.equal(phoneRegister.status, 201);
    const phoneData = await phoneRegister.json();
    assert.equal(phoneData.user.contact, '+84912345678');

    const phoneLogin = await post('/api/login', {
      contact: '0912 345 678',
      password: 'StrongDemo123!'
    });
    assert.equal(phoneLogin.status, 200);
    assert.equal((await post('/api/register', {
      displayName: 'Giáo viên Demo Phone Trùng',
      contact: '+84912345678',
      password: 'AnotherDemo123!'
    })).status, 409);
  } finally {
    child.kill('SIGTERM');
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
