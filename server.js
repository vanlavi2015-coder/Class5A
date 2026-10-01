const express=require('express');
const path=require('path');
const fs=require('fs');
const bcrypt=require('bcryptjs');
const jwt=require('jsonwebtoken');
const crypto=require('crypto');
const {DatabaseSync}=require('node:sqlite');

const app=express();
app.use(express.json({limit:'4mb'}));
app.use(express.static(path.join(__dirname,'public')));
const PORT=process.env.PORT||3000;
const SECRET=process.env.LAVI_JWT_SECRET;
if(!SECRET){ console.error('Thiếu LAVI_JWT_SECRET. Hãy đặt biến môi trường trước khi chạy.'); process.exit(1); }
const DATA_DIR=process.env.LAVI_DATA_DIR||path.join(__dirname,'data');
fs.mkdirSync(DATA_DIR,{recursive:true});
const DB_PATH=path.join(DATA_DIR,'lavi5a.sqlite');
const db=new DatabaseSync(DB_PATH);

db.exec(`
PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS users(username TEXT PRIMARY KEY, role TEXT NOT NULL, student_id INTEGER, password_hash TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS students(id INTEGER PRIMARY KEY, code TEXT UNIQUE NOT NULL, name TEXT NOT NULL, group_name TEXT NOT NULL, source_level TEXT);
CREATE TABLE IF NOT EXISTS assignments(id TEXT PRIMARY KEY, payload TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS submissions(k TEXT PRIMARY KEY, assignment_id TEXT NOT NULL, student_id INTEGER NOT NULL, payload TEXT NOT NULL, submitted_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS stars(student_id INTEGER PRIMARY KEY, total INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS awards(id TEXT PRIMARY KEY, student_id INTEGER NOT NULL, stars INTEGER NOT NULL, reason TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS notifications(id TEXT PRIMARY KEY, student_id INTEGER NOT NULL, message TEXT NOT NULL, read INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS schedules(id TEXT PRIMARY KEY, payload TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY, v TEXT NOT NULL);
`);

const STUDENTS=[
['01','Hoàng Tuệ An','Khá'],['02','Tô Nguyễn Tâm An','Khá'],['03','Lê Ngọc Anh','Khá'],['04','Lê Thu Ánh','Yếu'],['05','Hứa Gia Bảo','Khá'],['06','Lục Nguyễn Trí Bằng','Trung bình'],['07','La Hoàng Châu','Trung bình'],['08','Trần Khánh Chi','Khá'],['09','Nông Trọng Duy','Tốt'],['10','Đoàn Hải Dương','Tốt'],['11','Hoàng Thùy Dương','Tốt'],['12','Vi Đức Đạt','Trung bình'],['13','Hoàng Trọng Đức','Trung bình'],['14','Bế Nông Hương Giang','Yếu'],['15','Đàm Gia Hân','Tốt'],['16','Hoàng Gia Huy','Khá'],['17','Hoàng Minh Khôi','Khá'],['18','Ngô Hoàng Minh','Yếu'],['19','Hoàng Gia Nhi','Yếu'],['20','Nguyễn Khánh Nhi','Khá'],['21','Nông Thảo Nhi','Khá'],['22','Bùi Long Quỳnh Như','Khá'],['23','Lâm Hoàng Phúc','Trung bình'],['24','Nông Hữu Quốc','Tốt'],['25','Hứa Tuệ Tâm','Khá'],['26','Trần Cao Thành','Tốt'],['27','Hoàng Mai Trang','Khá'],['28','Nông Hà Vy','Khá'],['29','Nông Tường Vy','Tốt'],['30','Trần Ngọc Hà','Tốt'],['31','Trần Ngọc Hải','Trung bình'],['32','Hoàng Minh Khôi (C)','Tốt']
];
function now(){return new Date().toISOString();}
function seed(){
  const count=db.prepare('SELECT COUNT(*) n FROM students').get().n;
  if(Number(count)===0){
    const ins=db.prepare('INSERT INTO students(id,code,name,group_name,source_level) VALUES(?,?,?,?,?)');
    for(let i=0;i<STUDENTS.length;i++)ins.run(i+1,STUDENTS[i][0],STUDENTS[i][1],STUDENTS[i][2],STUDENTS[i][2]);
  }
  const tc=db.prepare('SELECT COUNT(*) n FROM users WHERE username=?').get('teacher').n;
  if(Number(tc)===0){
    const pass=process.env.LAVI_TEACHER_PASSWORD||'Lavi@2026';
    db.prepare('INSERT INTO users(username,role,student_id,password_hash) VALUES(?,?,?,?)').run('teacher','teacher',null,bcrypt.hashSync(pass,10));
    const ins=db.prepare('INSERT INTO users(username,role,student_id,password_hash) VALUES(?,?,?,?)');
    for(let i=0;i<STUDENTS.length;i++)ins.run('hs'+STUDENTS[i][0],'student',i+1,bcrypt.hashSync('1234',10));
  }
}
seed();

function students(){return db.prepare('SELECT id,code,name,group_name AS "group",source_level AS sourceLevel FROM students ORDER BY id').all();}
function stateForTeacher(){
  const assignments=db.prepare('SELECT payload FROM assignments ORDER BY created_at DESC').all().map(x=>JSON.parse(x.payload));
  const submissions={}; for(const r of db.prepare('SELECT k,payload FROM submissions').all()) submissions[r.k]=JSON.parse(r.payload);
  const stars={}; for(const r of db.prepare('SELECT student_id,total FROM stars').all()) stars[r.student_id]=r.total;
  const awards=db.prepare('SELECT id,student_id AS studentId,stars,reason,created_at AS time FROM awards ORDER BY created_at DESC LIMIT 300').all();
  const notifications=db.prepare('SELECT id,student_id AS studentId,message,read,created_at AS time FROM notifications ORDER BY created_at DESC LIMIT 500').all().map(n=>({...n,read:!!n.read}));
  const schedules=db.prepare('SELECT payload FROM schedules ORDER BY created_at DESC').all().map(x=>JSON.parse(x.payload));
  return {assignments,submissions,stars,awards,notifications,schedules};
}
function stateForStudent(sid){
  const ss=students().find(s=>s.id===sid);
  const all=db.prepare('SELECT payload FROM assignments WHERE status=? ORDER BY created_at DESC').all('Đang giao').map(x=>JSON.parse(x.payload));
  const assignments=all.filter(a=>Array.isArray(a.sets)&&a.sets.some(set=>set.group==='Cả 4 nhóm'||set.group===ss.group));
  const submissions={}; for(const r of db.prepare('SELECT k,payload FROM submissions WHERE student_id=?').all(sid)) submissions[r.k]=JSON.parse(r.payload);
  const star=db.prepare('SELECT total FROM stars WHERE student_id=?').get(sid);
  const awards=db.prepare('SELECT id,student_id AS studentId,stars,reason,created_at AS time FROM awards WHERE student_id=? ORDER BY created_at DESC LIMIT 100').all(sid);
  const notifications=db.prepare('SELECT id,student_id AS studentId,message,read,created_at AS time FROM notifications WHERE student_id=? ORDER BY created_at DESC LIMIT 100').all(sid).map(n=>({...n,read:!!n.read}));
  return {assignments,submissions,stars:{[sid]:star?.total||0},awards,notifications,schedules:[]};
}
function tokenFor(u){return jwt.sign(u,SECRET,{expiresIn:'30d'});}
function auth(req,res,next){try{const h=req.headers.authorization||'';if(!h.startsWith('Bearer '))return res.status(401).json({error:'Chưa đăng nhập'});req.user=jwt.verify(h.slice(7),SECRET);next();}catch(e){return res.status(401).json({error:'Phiên đăng nhập không hợp lệ'});}}
function teacher(req,res){if(req.user.role!=='teacher'){res.status(403).json({error:'Chỉ giáo viên được thực hiện thao tác này'});return false;}return true;}

app.get('/api/health',(req,res)=>res.json({ok:true,app:'LAVI 5A Online v3',students:students().length,db:'sqlite'}));
app.post('/api/login',(req,res)=>{const {username,password}=req.body||{};const u=db.prepare('SELECT * FROM users WHERE username=?').get(String(username||''));if(!u||!bcrypt.compareSync(String(password||''),u.password_hash))return res.status(401).json({error:'Sai tài khoản hoặc mật khẩu'});const user={username:u.username,role:u.role,studentId:u.student_id||null};res.json({token:tokenFor(user),user,students:students()});});
app.get('/api/state',auth,(req,res)=>res.json({state:req.user.role==='teacher'?stateForTeacher():stateForStudent(req.user.studentId),students:req.user.role==='teacher'?students():students().filter(s=>s.id===req.user.studentId),user:req.user}));
app.get('/api/students',auth,(req,res)=>{if(!teacher(req,res))return;res.json({students:students()});});
app.put('/api/state',auth,(req,res)=>{if(!teacher(req,res))return;const s=req.body?.state;if(!s)return res.status(400).json({error:'Thiếu state'});try{db.exec('BEGIN');for(const a of s.assignments||[]){db.prepare('INSERT INTO assignments(id,payload,status,created_at) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,status=excluded.status').run(String(a.id),JSON.stringify(a),a.status||'Đang giao',a.createdAt||now());}for(const [k,v] of Object.entries(s.submissions||{})){db.prepare('INSERT INTO submissions(k,assignment_id,student_id,payload,submitted_at) VALUES(?,?,?,?,?) ON CONFLICT(k) DO UPDATE SET payload=excluded.payload').run(k,String(v.assignmentId||k.split('_')[0]),Number(v.studentId||k.split('_')[1]),JSON.stringify(v),v.time||now());}db.exec('COMMIT');res.json({ok:true,updatedAt:now()});}catch(e){try{db.exec('ROLLBACK')}catch{}res.status(500).json({error:e.message});}});
app.post('/api/password',auth,(req,res)=>{const {currentPassword,newPassword}=req.body||{};const u=db.prepare('SELECT * FROM users WHERE username=?').get(req.user.username);if(!u||!bcrypt.compareSync(String(currentPassword||''),u.password_hash))return res.status(400).json({error:'Mật khẩu hiện tại không đúng'});if(String(newPassword||'').length<6)return res.status(400).json({error:'Mật khẩu mới tối thiểu 6 ký tự'});db.prepare('UPDATE users SET password_hash=? WHERE username=?').run(bcrypt.hashSync(String(newPassword),10),req.user.username);res.json({ok:true});});
app.post('/api/teacher/group',auth,(req,res)=>{if(!teacher(req,res))return;const {studentId,group}=req.body||{};if(!['Tốt','Khá','Trung bình','Yếu'].includes(group))return res.status(400).json({error:'Nhóm không hợp lệ'});const s=db.prepare('SELECT * FROM students WHERE id=?').get(Number(studentId));if(!s)return res.status(404).json({error:'Không tìm thấy học sinh'});db.prepare('UPDATE students SET group_name=? WHERE id=?').run(group,s.id);res.json({ok:true,student:students().find(x=>x.id===s.id)});});
app.post('/api/teacher/grade',auth,(req,res)=>{if(!teacher(req,res))return;const {assignmentId,studentId,score,praise,stars}=req.body||{};const key=String(assignmentId)+'_'+Number(studentId);const r=db.prepare('SELECT payload FROM submissions WHERE k=?').get(key);if(!r)return res.status(404).json({error:'Chưa có bài nộp'});const old=JSON.parse(r.payload);const ns=Math.max(0,Math.min(10,Number(stars)||0));const delta=ns-(Number(old.stars)||0);const updated={...old,score:Math.max(0,Math.min(100,Number(score)||0)),stars:ns,praise:String(praise||old.praise||''),gradedBy:'teacher',gradedAt:now()};db.prepare('UPDATE submissions SET payload=?,submitted_at=? WHERE k=?').run(JSON.stringify(updated),now(),key);db.prepare('INSERT INTO stars(student_id,total) VALUES(?,?) ON CONFLICT(student_id) DO UPDATE SET total=MAX(0,total+excluded.total)').run(Number(studentId),delta);if(delta!==0)db.prepare('INSERT INTO awards(id,student_id,stars,reason,created_at) VALUES(?,?,?,?,?)').run(crypto.randomUUID(),Number(studentId),delta,'Cô giáo chấm/điều chỉnh bài',now());res.json({ok:true,submission:updated});});
app.post('/api/teacher/notify',auth,(req,res)=>{if(!teacher(req,res))return;const {studentIds,message}=req.body||{};if(!String(message||'').trim())return res.status(400).json({error:'Thiếu nội dung'});const ids=Array.isArray(studentIds)&&studentIds.length?studentIds.map(Number):students().map(s=>s.id);const ins=db.prepare('INSERT INTO notifications(id,student_id,message,read,created_at) VALUES(?,?,?,?,?)');for(const id of ids)ins.run(crypto.randomUUID(),id,String(message),0,now());res.json({ok:true,count:ids.length});});
app.post('/api/student/read-notifications',auth,(req,res)=>{if(req.user.role!=='student')return res.status(403).json({error:'Không có quyền'});const ids=Array.isArray(req.body?.ids)?req.body.ids:[];if(!ids.length)return res.json({ok:true});db.prepare(`UPDATE notifications SET read=1 WHERE student_id=? AND id IN (${ids.map(()=>'?').join(',')})`).run(req.user.studentId,...ids);res.json({ok:true});});
function normAnswer(v){return String(v??'').toLowerCase().normalize('NFD').replace(/[\\u0300-\\u036f]/g,'').replace(/[^a-z0-9\\s./-]/g,'').replace(/\\s+/g,' ').trim();}
app.post('/api/submit',auth,(req,res)=>{if(req.user.role!=='student')return res.status(403).json({error:'Chỉ tài khoản học sinh được nộp bài'});const {assignmentId,answers}=req.body||{};if(!assignmentId)return res.status(400).json({error:'Thiếu assignmentId'});const arow=db.prepare('SELECT payload,status FROM assignments WHERE id=?').get(String(assignmentId));if(!arow||arow.status!=='Đang giao')return res.status(404).json({error:'Bài không còn được giao'});const a=JSON.parse(arow.payload);const sid=req.user.studentId;const ss=students().find(x=>x.id===sid);const set=(a.sets||[]).find(x=>x.group==='Cả 4 nhóm'||x.group===ss?.group)||(a.sets||[])[0];if(!set?.questions?.length)return res.status(400).json({error:'Bài chưa có câu hỏi'});const qs=set.questions;const aa=answers||{};let correct=0;for(let i=0;i<qs.length;i++){if(normAnswer(aa[i])===normAnswer(qs[i].answer)&&String(aa[i]??'').trim()!=='')correct++;}const total=qs.length;const wrong=total-correct;const correctPercent=Math.round(correct/total*100);const wrongPercent=100-correctPercent;const score=correctPercent;const oldR=db.prepare('SELECT payload FROM submissions WHERE k=?').get(String(assignmentId)+'_'+sid);const old=oldR?JSON.parse(oldR.payload):{};const newStars=Math.max(0,Math.min(10,Number(req.body?.stars)||0));const delta=newStars-(Number(old.stars)||0);const payload={...old,assignmentId:String(assignmentId),studentId:sid,score,correct,total,wrong,correctPercent,wrongPercent,stars:newStars,praise:String(req.body?.praise||''),answers:aa,time:now()};db.prepare('INSERT INTO submissions(k,assignment_id,student_id,payload,submitted_at) VALUES(?,?,?,?,?) ON CONFLICT(k) DO UPDATE SET payload=excluded.payload,submitted_at=excluded.submitted_at').run(String(assignmentId)+'_'+sid,String(assignmentId),sid,JSON.stringify(payload),now());db.prepare('INSERT INTO stars(student_id,total) VALUES(?,?) ON CONFLICT(student_id) DO UPDATE SET total=MAX(0,total+excluded.total)').run(sid,delta);if(delta!==0)db.prepare('INSERT INTO awards(id,student_id,stars,reason,created_at) VALUES(?,?,?,?,?)').run(crypto.randomUUID(),sid,delta,'Hoàn thành bài',now());res.json({ok:true,submission:payload});});
app.post('/api/teacher/award',auth,(req,res)=>{if(!teacher(req,res))return;const {studentId,stars,reason}=req.body||{};const n=Math.max(-10,Math.min(10,Number(stars)||0));if(!Number(studentId)||!n)return res.status(400).json({error:'Số sao không hợp lệ'});db.prepare('INSERT INTO stars(student_id,total) VALUES(?,?) ON CONFLICT(student_id) DO UPDATE SET total=MAX(0,total+excluded.total)').run(Number(studentId),n);db.prepare('INSERT INTO awards(id,student_id,stars,reason,created_at) VALUES(?,?,?,?,?)').run(crypto.randomUUID(),Number(studentId),n,String(reason||'Cô giáo tặng sao'),now());res.json({ok:true});});
app.get('/api/teacher/overview',auth,(req,res)=>{if(!teacher(req,res))return;const ss=students();const submitted=db.prepare('SELECT COUNT(*) n FROM submissions').get().n;const assignmentCount=db.prepare('SELECT COUNT(*) n FROM assignments').get().n;const stars=db.prepare('SELECT COALESCE(SUM(total),0) n FROM stars').get().n;res.json({students:ss.length,assignments:Number(assignmentCount),submissions:Number(submitted),stars:Number(stars)});});
app.get('/api/teacher/export',auth,(req,res)=>{if(!teacher(req,res))return;res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Content-Disposition','attachment; filename="lavi5a-backup.json"');res.end(JSON.stringify({version:3,exportedAt:now(),students:students(),state:stateForTeacher()},null,2));});
app.post('/api/teacher/restore',auth,(req,res)=>{if(!teacher(req,res))return;const data=req.body;if(!data?.state)return res.status(400).json({error:'File sao lưu không hợp lệ'});res.json({ok:true,note:'Hãy dùng PUT /api/state để phục hồi dữ liệu tương thích.'});});
app.get('*',(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
app.listen(PORT,()=>console.log(`LAVI 5A Online v3 running on http://localhost:${PORT}`));
