const express=require('express');
const path=require('path');
const fs=require('fs');
const bcrypt=require('bcryptjs');
const jwt=require('jsonwebtoken');
const crypto=require('crypto');
const https=require('https');
const {DatabaseSync}=require('node:sqlite');

const app=express();
app.use(express.json({limit:'4mb'}));
// Luôn lấy bản LAVI mới nhất để tránh trình duyệt giữ giao diện chấm bài cũ.
app.use((req,res,next)=>{if(req.path==='/'||req.path==='/index.html')res.set('Cache-Control','no-store, no-cache, must-revalidate, proxy-revalidate');next();});
app.use(express.static(path.join(__dirname,'public'),{etag:false,maxAge:0}));
const PORT=process.env.PORT||3000;
const SECRET=process.env.LAVI_JWT_SECRET;
if(!SECRET){ console.error('Thiếu LAVI_JWT_SECRET. Hãy đặt biến môi trường trước khi chạy.'); process.exit(1); }
const DEFAULT_DATA_DIR=fs.existsSync('/var/data')?'/var/data':path.join(__dirname,'data');
const DATA_DIR=process.env.LAVI_DATA_DIR||DEFAULT_DATA_DIR;
fs.mkdirSync(DATA_DIR,{recursive:true});
console.log(`LAVI_DATA_DIR=${DATA_DIR}`);
const DB_PATH=path.join(DATA_DIR,'lavi5a.sqlite');
const db=new DatabaseSync(DB_PATH);

db.exec(`
PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS users(username TEXT PRIMARY KEY, role TEXT NOT NULL, student_id INTEGER, password_hash TEXT NOT NULL, owner_username TEXT NOT NULL DEFAULT 'teacher', class_name TEXT NOT NULL DEFAULT 'Lớp 5A');
CREATE TABLE IF NOT EXISTS students(id INTEGER PRIMARY KEY, code TEXT UNIQUE NOT NULL, name TEXT NOT NULL, group_name TEXT NOT NULL, source_level TEXT, avatar TEXT DEFAULT '🎓', owner_username TEXT NOT NULL DEFAULT 'teacher');
CREATE TABLE IF NOT EXISTS assignments(id TEXT PRIMARY KEY, payload TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, owner_username TEXT NOT NULL DEFAULT 'teacher');
CREATE TABLE IF NOT EXISTS submissions(k TEXT PRIMARY KEY, assignment_id TEXT NOT NULL, student_id INTEGER NOT NULL, payload TEXT NOT NULL, submitted_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS stars(student_id INTEGER PRIMARY KEY, total INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS awards(id TEXT PRIMARY KEY, student_id INTEGER NOT NULL, stars INTEGER NOT NULL, reason TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS notifications(id TEXT PRIMARY KEY, student_id INTEGER NOT NULL, message TEXT NOT NULL, read INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS schedules(id TEXT PRIMARY KEY, payload TEXT NOT NULL, created_at TEXT NOT NULL, owner_username TEXT NOT NULL DEFAULT 'teacher');
CREATE TABLE IF NOT EXISTS game_results(student_id INTEGER NOT NULL, game_type TEXT NOT NULL, score INTEGER NOT NULL DEFAULT 0, correct INTEGER NOT NULL DEFAULT 0, total INTEGER NOT NULL DEFAULT 10, stars INTEGER NOT NULL DEFAULT 0, time_seconds INTEGER NOT NULL DEFAULT 0, played_at TEXT NOT NULL, PRIMARY KEY(student_id,game_type));
CREATE TABLE IF NOT EXISTS game_attempts(id INTEGER PRIMARY KEY AUTOINCREMENT, student_id INTEGER NOT NULL, game_type TEXT NOT NULL, score INTEGER NOT NULL DEFAULT 0, correct INTEGER NOT NULL DEFAULT 0, total INTEGER NOT NULL DEFAULT 10, stars INTEGER NOT NULL DEFAULT 0, time_seconds INTEGER NOT NULL DEFAULT 0, played_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY, v TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS score_history(id INTEGER PRIMARY KEY AUTOINCREMENT, student_id INTEGER NOT NULL, month TEXT NOT NULL, source TEXT NOT NULL, assignment_id TEXT, score REAL, stars INTEGER DEFAULT 0, payload TEXT, recorded_at TEXT NOT NULL);
`);

// Migration an toàn: dữ liệu cũ của lớp 5A vẫn thuộc tài khoản teacher.
function ensureColumn(table,column,definition){const columns=db.prepare('PRAGMA table_info('+table+')').all().map(x=>x.name);if(!columns.includes(column))db.exec('ALTER TABLE '+table+' ADD COLUMN '+column+' '+definition);}
ensureColumn('users','owner_username',"TEXT NOT NULL DEFAULT 'teacher'");
ensureColumn('users','class_name',"TEXT NOT NULL DEFAULT 'Lớp 5A'");
ensureColumn('students','owner_username',"TEXT NOT NULL DEFAULT 'teacher'");
ensureColumn('assignments','owner_username',"TEXT NOT NULL DEFAULT 'teacher'");
ensureColumn('schedules','owner_username',"TEXT NOT NULL DEFAULT 'teacher'");

const STUDENTS=[
['01','Hoàng Tuệ An','Khá'],['02','Tô Nguyễn Tâm An','Khá'],['03','Lê Ngọc Anh','Khá'],['04','Lê Thu Ánh','Yếu'],['05','Hứa Gia Bảo','Khá'],['06','Lục Nguyễn Trí Bằng','Trung bình'],['07','La Hoàng Châu','Trung bình'],['08','Trần Khánh Chi','Khá'],['09','Nông Trọng Duy','Tốt'],['10','Đoàn Hải Dương','Tốt'],['11','Hoàng Thùy Dương','Tốt'],['12','Vi Đức Đạt','Trung bình'],['13','Hoàng Trọng Đức','Trung bình'],['14','Bế Nông Hương Giang','Yếu'],['15','Đàm Gia Hân','Tốt'],['16','Hoàng Gia Huy','Khá'],['17','Hoàng Minh Khôi','Khá'],['18','Ngô Hoàng Minh','Yếu'],['19','Hoàng Gia Nhi','Yếu'],['20','Nguyễn Khánh Nhi','Khá'],['21','Nông Thảo Nhi','Khá'],['22','Bùi Long Quỳnh Như','Khá'],['23','Lâm Hoàng Phúc','Trung bình'],['24','Nông Hữu Quốc','Tốt'],['25','Hứa Tuệ Tâm','Khá'],['26','Trần Cao Thành','Tốt'],['27','Hoàng Mai Trang','Khá'],['28','Nông Hà Vy','Khá'],['29','Nông Tường Vy','Tốt'],['30','Trần Ngọc Hà','Tốt'],['31','Trần Ngọc Hải','Trung bình'],['32','Hoàng Minh Khôi (C)','Tốt']
];
function now(){return new Date().toISOString();}

const BACKUP_TOKEN=process.env.LAVI_BACKUP_TOKEN||'';
const BACKUP_REPO=process.env.LAVI_BACKUP_REPO||'vanlavi2015-coder/Class5A';
const BACKUP_PATH=process.env.LAVI_BACKUP_PATH||'backup/lavi5a.enc.json';
const BACKUP_BRANCH=process.env.LAVI_BACKUP_BRANCH||'Lavi-Data';
const BACKUP_KEY=String(process.env.LAVI_BACKUP_KEY||'');
let backupQueue=Promise.resolve();
function githubRequest(url,options={}){
 return new Promise((resolve,reject)=>{
  const u=new URL(url);
  const req=https.request(u,{method:options.method||'GET',headers:options.headers||{}},res=>{
   let body=''; res.setEncoding('utf8');
   res.on('data',chunk=>body+=chunk);
   res.on('end',()=>resolve({ok:res.statusCode>=200&&res.statusCode<300,status:res.statusCode,text:async()=>body,json:async()=>JSON.parse(body)}));
  });
  req.on('error',reject);
  if(options.body)req.write(options.body);
  req.end();
 });
}
function backupEnabled(){return !!(BACKUP_TOKEN&&BACKUP_REPO&&BACKUP_KEY);}
function encryptionKey(){return crypto.createHash('sha256').update(BACKUP_KEY).digest();}
function backupObject(){const assignmentRows=db.prepare('SELECT payload,owner_username FROM assignments ORDER BY created_at DESC').all();const scheduleRows=db.prepare('SELECT payload,owner_username FROM schedules ORDER BY created_at DESC').all();return {version:5,exportedAt:now(),students:db.prepare('SELECT id,code,name,group_name,source_level,avatar,owner_username FROM students ORDER BY id').all().map(x=>({id:x.id,code:x.code,name:x.name,group:x.group_name,sourceLevel:x.source_level,avatar:x.avatar,ownerUsername:x.owner_username})),users:db.prepare('SELECT username,role,student_id,password_hash,owner_username,class_name FROM users').all(),state:{...stateForTeacher(),assignments:assignmentRows.map(x=>({...JSON.parse(x.payload),ownerUsername:x.owner_username})),schedules:scheduleRows.map(x=>({...JSON.parse(x.payload),ownerUsername:x.owner_username}))},scoreHistory:db.prepare('SELECT * FROM score_history ORDER BY id').all()};}
function encryptBackup(obj){const iv=crypto.randomBytes(12);const cipher=crypto.createCipheriv('aes-256-gcm',encryptionKey(),iv);const raw=Buffer.from(JSON.stringify(obj),'utf8');const enc=Buffer.concat([cipher.update(raw),cipher.final()]);return JSON.stringify({version:1,algorithm:'aes-256-gcm',iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),data:enc.toString('base64')});}
function decryptBackup(text){const x=JSON.parse(text);const decipher=crypto.createDecipheriv('aes-256-gcm',encryptionKey(),Buffer.from(x.iv,'base64'));decipher.setAuthTag(Buffer.from(x.tag,'base64'));return JSON.parse(Buffer.concat([decipher.update(Buffer.from(x.data,'base64')),decipher.final()]).toString('utf8'));}
async function githubBackup(){
 if(!backupEnabled())return {enabled:false};
 const api='https://api.github.com/repos/'+BACKUP_REPO+'/contents/'+BACKUP_PATH;
 const headers={'Accept':'application/vnd.github+json','Authorization':'Bearer '+BACKUP_TOKEN,'X-GitHub-Api-Version':'2026-03-10','User-Agent':'LAVI-5A'};
 let sha=null; const get=await githubRequest(api+'?ref='+encodeURIComponent(BACKUP_BRANCH),{headers});
 if(get.ok){const old=await get.json();sha=old.sha||null;}else if(get.status!==404)throw new Error('GitHub backup GET '+get.status);
 const content=Buffer.from(encryptBackup(backupObject()),'utf8').toString('base64');
 const body={message:'LAVI 5A: sao luu du lieu diem',content,branch:BACKUP_BRANCH}; if(sha)body.sha=sha;
 const put=await githubRequest(api,{method:'PUT',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify(body)});
 if(!put.ok)throw new Error('GitHub backup PUT '+put.status+' '+(await put.text()).slice(0,300));
 return {enabled:true,ok:true};
}
function queueBackup(){if(!backupEnabled())return backupQueue;backupQueue=backupQueue.then(()=>githubBackup()).catch(e=>{console.error('LAVI BACKUP ERROR:',e.message);});return backupQueue;}
async function restoreBackupIfEmpty(){
 if(!backupEnabled())return false;
 const n=Number(db.prepare('SELECT COUNT(*) n FROM students').get().n||0); if(n>0)return false;
 const api='https://api.github.com/repos/'+BACKUP_REPO+'/contents/'+BACKUP_PATH+'?ref='+encodeURIComponent(BACKUP_BRANCH);
 const r=await githubRequest(api,{headers:{'Accept':'application/vnd.github+json','Authorization':'Bearer '+BACKUP_TOKEN,'X-GitHub-Api-Version':'2026-03-10','User-Agent':'LAVI-5A'}});
 if(!r.ok){if(r.status===404)return false;throw new Error('Không đọc được backup GitHub: '+r.status);}
 const x=await r.json(); const text=Buffer.from(String(x.content||'').replace(/\\s/g,''),'base64').toString('utf8'); const data=decryptBackup(text);
 if(!data?.students?.length)return false;
 const ins=db.prepare('INSERT OR REPLACE INTO students(id,code,name,group_name,source_level,avatar,owner_username) VALUES(?,?,?,?,?,?,?)');
 for(const s of data.students)ins.run(Number(s.id),String(s.code),String(s.name),String(s.group||''),String(s.sourceLevel||s.group||''),String(s.avatar||'🎓'),String(s.ownerUsername||'teacher'));
 if(Array.isArray(data.users)){const userIns=db.prepare('INSERT OR REPLACE INTO users(username,role,student_id,password_hash,owner_username,class_name) VALUES(?,?,?,?,?,?)');for(const u of data.users)userIns.run(String(u.username),String(u.role),u.student_id==null?null:Number(u.student_id),String(u.password_hash),String(u.owner_username||u.username),String(u.class_name||'Lớp 5A'));}
 for(const raw of data.state?.assignments||[]){const a={...raw},owner=String(a.ownerUsername||'teacher');delete a.ownerUsername;db.prepare('INSERT OR REPLACE INTO assignments(id,payload,status,created_at,owner_username) VALUES(?,?,?,?,?)').run(String(a.id),JSON.stringify(a),a.status||'Đang giao',a.createdAt||now(),owner);}
 for(const [k,v] of Object.entries(data.state?.submissions||{})){const sid=Number(v.studentId||k.split('_')[1]);db.prepare('INSERT OR REPLACE INTO submissions(k,assignment_id,student_id,payload,submitted_at) VALUES(?,?,?,?,?)').run(k,String(v.assignmentId||k.split('_')[0]),sid,JSON.stringify(v),v.time||now());}
 for(const [sid,total] of Object.entries(data.state?.stars||{}))db.prepare('INSERT OR REPLACE INTO stars(student_id,total) VALUES(?,?)').run(Number(sid),Number(total)||0);
 for(const raw of data.state?.schedules||[]){const x={...raw},owner=String(x.ownerUsername||'teacher');delete x.ownerUsername;db.prepare('INSERT OR REPLACE INTO schedules(id,payload,created_at,owner_username) VALUES(?,?,?,?)').run(String(x.id||crypto.randomUUID()),JSON.stringify(x),x.createdAt||now(),owner);}
 for(const h of data.scoreHistory||[])db.prepare('INSERT OR REPLACE INTO score_history(id,student_id,month,source,assignment_id,score,stars,payload,recorded_at) VALUES(?,?,?,?,?,?,?,?,?)').run(Number(h.id),Number(h.student_id),String(h.month),String(h.source),h.assignment_id==null?null:String(h.assignment_id),h.score==null?null:Number(h.score),Number(h.stars)||0,h.payload==null?null:String(h.payload),String(h.recorded_at||now()));
 return true;
}

function seed(){
  const count=db.prepare('SELECT COUNT(*) n FROM students').get().n;
  if(Number(count)===0){
    const ins=db.prepare('INSERT INTO students(id,code,name,group_name,source_level,owner_username) VALUES(?,?,?,?,?,?)');
    for(let i=0;i<STUDENTS.length;i++)ins.run(i+1,STUDENTS[i][0],STUDENTS[i][1],STUDENTS[i][2],STUDENTS[i][2],'teacher');
  }
  const tc=db.prepare('SELECT COUNT(*) n FROM users WHERE username=?').get('teacher').n;
  if(Number(tc)===0){
    const pass=process.env.LAVI_TEACHER_PASSWORD||'Lavi@2026';
    db.prepare('INSERT INTO users(username,role,student_id,password_hash,owner_username) VALUES(?,?,?,?,?)').run('teacher','teacher',null,bcrypt.hashSync(pass,10),'teacher');
    const ins=db.prepare('INSERT INTO users(username,role,student_id,password_hash,owner_username) VALUES(?,?,?,?,?)');
    for(let i=0;i<STUDENTS.length;i++)ins.run('hs'+STUDENTS[i][0],'student',i+1,bcrypt.hashSync('1234',10),'teacher');
  }
}
awaitableStartup();

async function awaitableStartup(){try{const restored=await restoreBackupIfEmpty();if(restored)console.log('LAVI: đã khôi phục dữ liệu từ backup GitHub mã hóa.');}catch(e){console.error('LAVI RESTORE ERROR:',e.message);}seed();}

function students(ownerUsername=null){
 const sql=`SELECT id,code,name,group_name AS "group",source_level AS sourceLevel,COALESCE(avatar,'🎓') AS avatar FROM students${ownerUsername?' WHERE owner_username=?':''} ORDER BY id`;
 return ownerUsername?db.prepare(sql).all(String(ownerUsername)):db.prepare(sql).all();
}
function ownerForUser(user){return user?.role==='student'?String(user.ownerUsername||'teacher'):String(user?.username||'teacher');}
function recordScoreHistory(studentId,source,assignmentId,score,stars,payload){
 const month=new Date().toISOString().slice(0,7);
 db.prepare('INSERT INTO score_history(student_id,month,source,assignment_id,score,stars,payload,recorded_at) VALUES(?,?,?,?,?,?,?,?)').run(Number(studentId),month,String(source),assignmentId==null?null:String(assignmentId),score==null?null:Number(score),Number(stars)||0,payload?JSON.stringify(payload):null,now());
}
function monthScores(studentId,month){
  const rows=db.prepare("SELECT * FROM score_history WHERE student_id=? AND month=? AND source<>? ORDER BY id").all(Number(studentId),String(month),'award');
  // Một bài có thể được ghi khi học sinh nộp và ghi lại lần nữa khi cô chấm.
  // Chỉ lấy bản ghi mới nhất của cùng một assignment để không tính đôi.
  const latestByAssignment=new Map();
  const games=[];
  for(const r of rows){
    if(r.source==='game'){ games.push(r); continue; }
    const key=r.assignment_id==null?('record:'+r.id):('assignment:'+String(r.assignment_id));
    latestByAssignment.set(key,r);
  }
  const records=[...latestByAssignment.values(),...games].sort((a,b)=>Number(a.id)-Number(b.id));
  const scores=records.map(r=>Number(r.score)).filter(Number.isFinite);
  const average=scores.length?scores.reduce((a,b)=>a+b,0)/scores.length:0;
  const classification=scores.length?(average>=90?'Tốt':average>=80?'Khá':average>=65?'Trung bình':'Yếu'):'Chưa có dữ liệu';
  return {studentId:Number(studentId),month:String(month),records,total:scores.reduce((a,b)=>a+b,0),average,classification};
}
function stateForTeacher(ownerUsername=null){
 const scoped=!!ownerUsername,owner=String(ownerUsername||'');
 const assignments=(scoped?db.prepare('SELECT payload FROM assignments WHERE owner_username=? ORDER BY created_at DESC').all(owner):db.prepare('SELECT payload FROM assignments ORDER BY created_at DESC').all()).map(x=>JSON.parse(x.payload));
 const subRows=scoped?db.prepare('SELECT sub.k,sub.payload FROM submissions sub JOIN students s ON s.id=sub.student_id WHERE s.owner_username=?').all(owner):db.prepare('SELECT k,payload FROM submissions').all();const submissions={};for(const r of subRows)submissions[r.k]=JSON.parse(r.payload);
 const starRows=scoped?db.prepare('SELECT st.student_id,st.total FROM stars st JOIN students s ON s.id=st.student_id WHERE s.owner_username=?').all(owner):db.prepare('SELECT student_id,total FROM stars').all();const stars={};for(const r of starRows)stars[r.student_id]=r.total;
 const awards=scoped?db.prepare('SELECT a.id,a.student_id AS studentId,a.stars,a.reason,a.created_at AS time FROM awards a JOIN students s ON s.id=a.student_id WHERE s.owner_username=? ORDER BY a.created_at DESC LIMIT 300').all(owner):db.prepare('SELECT id,student_id AS studentId,stars,reason,created_at AS time FROM awards ORDER BY created_at DESC LIMIT 300').all();
 const notifications=(scoped?db.prepare('SELECT n.id,n.student_id AS studentId,n.message,n.read,n.created_at AS time FROM notifications n JOIN students s ON s.id=n.student_id WHERE s.owner_username=? ORDER BY n.created_at DESC LIMIT 500').all(owner):db.prepare('SELECT id,student_id AS studentId,message,read,created_at AS time FROM notifications ORDER BY created_at DESC LIMIT 500').all()).map(n=>({...n,read:!!n.read}));
 const schedules=(scoped?db.prepare('SELECT payload FROM schedules WHERE owner_username=? ORDER BY created_at DESC').all(owner):db.prepare('SELECT payload FROM schedules ORDER BY created_at DESC').all()).map(x=>JSON.parse(x.payload));return {assignments,submissions,stars,awards,notifications,schedules};
}
function stateForStudent(sid,ownerUsername='teacher'){
  const ss=students(ownerUsername).find(s=>s.id===sid);
  const all=db.prepare('SELECT payload FROM assignments WHERE status=? AND owner_username=? ORDER BY created_at DESC').all('Đang giao',String(ownerUsername)).map(x=>JSON.parse(x.payload));
  const assignments=all.filter(a=>Array.isArray(a.sets)&&a.sets.some(set=>set.group==='Tất cả'||set.group==='Cả 4 nhóm'||set.group===ss.group));
  const submissions={}; for(const r of db.prepare('SELECT k,payload FROM submissions WHERE student_id=?').all(sid)) submissions[r.k]=JSON.parse(r.payload);
  const star=db.prepare('SELECT total FROM stars WHERE student_id=?').get(sid);
  const awards=db.prepare('SELECT id,student_id AS studentId,stars,reason,created_at AS time FROM awards WHERE student_id=? ORDER BY created_at DESC LIMIT 100').all(sid);
  const notifications=db.prepare('SELECT id,student_id AS studentId,message,read,created_at AS time FROM notifications WHERE student_id=? ORDER BY created_at DESC LIMIT 100').all(sid).map(n=>({...n,read:!!n.read}));
  return {assignments,submissions,stars:{[sid]:star?.total||0},awards,notifications,schedules:[]};
}
function tokenFor(u){return jwt.sign(u,SECRET,{expiresIn:'30d'});}
function auth(req,res,next){try{const h=req.headers.authorization||'';if(!h.startsWith('Bearer '))return res.status(401).json({error:'Chưa đăng nhập'});req.user=jwt.verify(h.slice(7),SECRET);next();}catch(e){return res.status(401).json({error:'Phiên đăng nhập không hợp lệ'});}}
function teacher(req,res){if(req.user.role!=='teacher'){res.status(403).json({error:'Chỉ giáo viên được thực hiện thao tác này'});return false;}return true;}

app.get('/api/health',(req,res)=>res.json({ok:true,app:'LAVI 5A Online v3',students:students().length,db:'sqlite',persistentData:DATA_DIR,backup:backupEnabled()}));
app.post('/api/login',(req,res)=>{const rawUser=String(req.body?.username||'').trim();const username=rawUser.toLowerCase();const password=String(req.body?.password??'');const u=db.prepare('SELECT * FROM users WHERE lower(username)=?').get(username);if(!u)return res.status(401).json({error:'Sai tài khoản hoặc mật khẩu'});if(!bcrypt.compareSync(password,u.password_hash))return res.status(401).json({error:'Sai tài khoản hoặc mật khẩu'});const ownerUsername=u.role==='student'?String(u.owner_username||'teacher'):String(u.username);const ownerRow=u.role==='student'?db.prepare("SELECT class_name FROM users WHERE username=? AND role='teacher'").get(ownerUsername):u;const user={username:u.username,role:u.role,studentId:u.student_id||null,ownerUsername,className:String(ownerRow?.class_name||'Lớp')};res.json({token:tokenFor(user),user,students:students(user.ownerUsername)});});
app.get('/api/state',auth,(req,res)=>{const owner=ownerForUser(req.user),roster=students(owner);res.json({state:req.user.role==='teacher'?stateForTeacher(owner):stateForStudent(req.user.studentId,owner),students:req.user.role==='teacher'?roster:roster.filter(s=>s.id===req.user.studentId),user:req.user});});
app.get('/api/students',auth,(req,res)=>{if(!teacher(req,res))return;res.json({students:students(ownerForUser(req.user))});});
app.post('/api/teacher/create-account',auth,async(req,res)=>{
 if(!teacher(req,res))return;
 if(req.user.username!==(process.env.LAVI_ADMIN_USERNAME||'teacher'))return res.status(403).json({error:'Chỉ tài khoản quản trị teacher được tạo tài khoản giáo viên mới'});
 const username=String(req.body?.username||'').trim().toLowerCase(),password=String(req.body?.password||''),className=String(req.body?.className||'').trim();
 if(!/^[a-z0-9][a-z0-9._-]{2,31}$/.test(username))return res.status(400).json({error:'Tên đăng nhập 3–32 ký tự, dùng chữ thường, số, dấu chấm, gạch dưới hoặc gạch ngang'});
 if(password.length<8)return res.status(400).json({error:'Mật khẩu giáo viên phải có ít nhất 8 ký tự'});
 if(!className||className.length>80)return res.status(400).json({error:'Hãy nhập tên lớp (tối đa 80 ký tự)'});
 if(db.prepare('SELECT 1 FROM users WHERE lower(username)=?').get(username))return res.status(409).json({error:'Tên đăng nhập đã tồn tại'});
 db.prepare('INSERT INTO users(username,role,student_id,password_hash,owner_username,class_name) VALUES(?,?,?,?,?,?)').run(username,'teacher',null,bcrypt.hashSync(password,10),username,className);
 await queueBackup();res.status(201).json({ok:true,teacher:{username,className},message:'Đã tạo tài khoản giáo viên riêng; danh sách lớp bắt đầu trống.'});
});
app.post('/api/teacher/students',auth,async(req,res)=>{
 if(!teacher(req,res))return;
 const owner=ownerForUser(req.user),name=String(req.body?.name||'').trim(),rawCode=String(req.body?.code||'').trim().toUpperCase(),username=String(req.body?.username||'').trim().toLowerCase(),password=String(req.body?.password||''),group=String(req.body?.group||'Trung bình');
 if(name.length<2||name.length>100)return res.status(400).json({error:'Họ tên học sinh phải từ 2 đến 100 ký tự'});
 if(!/^[A-Z0-9_-]{1,20}$/.test(rawCode))return res.status(400).json({error:'Mã học sinh chỉ gồm chữ, số, gạch ngang hoặc gạch dưới'});
 if(!/^[a-z0-9][a-z0-9._-]{2,31}$/.test(username))return res.status(400).json({error:'Tên đăng nhập học sinh phải từ 3 đến 32 ký tự'});
 if(password.length<6)return res.status(400).json({error:'Mật khẩu học sinh tối thiểu 6 ký tự'});
 if(!['Tốt','Khá','Trung bình','Yếu'].includes(group))return res.status(400).json({error:'Nhóm học tập không hợp lệ'});
 const code=owner.toUpperCase()+'-'+rawCode;
 if(db.prepare('SELECT 1 FROM students WHERE code=?').get(code))return res.status(409).json({error:'Mã học sinh đã tồn tại trong hệ thống'});
 if(db.prepare('SELECT 1 FROM users WHERE lower(username)=?').get(username))return res.status(409).json({error:'Tên đăng nhập đã tồn tại'});
 let studentId;
 try{db.exec('BEGIN');const info=db.prepare('INSERT INTO students(code,name,group_name,source_level,owner_username) VALUES(?,?,?,?,?)').run(code,name,group,group,owner);studentId=Number(info.lastInsertRowid);db.prepare('INSERT INTO users(username,role,student_id,password_hash,owner_username,class_name) VALUES(?,?,?,?,?,?)').run(username,'student',studentId,bcrypt.hashSync(password,10),owner,'');db.exec('COMMIT');}
 catch(e){try{db.exec('ROLLBACK')}catch{}return res.status(500).json({error:'Không tạo được học sinh: '+e.message});}
 await queueBackup();res.status(201).json({ok:true,student:students(owner).find(x=>x.id===studentId),login:{username,password}});
});
app.get('/api/game/status',auth,(req,res)=>{
  if(req.user.role!=='student')return res.status(403).json({error:'Chỉ học sinh được xem lượt chơi'});
  const type=String(req.query?.gameType||'').trim();
  if(!['math','choice','knowledge'].includes(type))return res.status(400).json({error:'Loại trò chơi không hợp lệ'});
  const row=db.prepare('SELECT COUNT(*) n FROM game_attempts WHERE student_id=? AND game_type=?').get(req.user.studentId,type);
  const best=db.prepare('SELECT score FROM game_results WHERE student_id=? AND game_type=?').get(req.user.studentId,type);
  const attempts=Number(row?.n||0);
  res.json({ok:true,attempts,maxAttempts:3,remaining:Math.max(0,3-attempts),bestScore:Number(best?.score||0)});
});
app.post('/api/game/result',auth,async(req,res)=>{
  if(req.user.role!=='student')return res.status(403).json({error:'Chỉ học sinh được lưu kết quả trò chơi'});
  const type=String(req.body?.gameType||'').trim();
  if(!['math','choice','knowledge'].includes(type))return res.status(400).json({error:'Loại trò chơi không hợp lệ'});
  const score=Math.max(0,Math.min(100,Number(req.body?.score)||0));
  const correct=Math.max(0,Number(req.body?.correct)||0);
  const total=Math.max(1,Number(req.body?.total)||10);
  const stars=Math.max(0,Math.min(5,Number(req.body?.stars)||0));
  const timeSeconds=Math.max(0,Number(req.body?.timeSeconds)||0);
  const attempts=Number(db.prepare('SELECT COUNT(*) n FROM game_attempts WHERE student_id=? AND game_type=?').get(req.user.studentId,type)?.n||0);
  if(attempts>=3)return res.status(429).json({error:'Em đã sử dụng đủ 3 lượt cho trò chơi này.',attempts,maxAttempts:3,remaining:0});
  db.prepare('INSERT INTO game_attempts(student_id,game_type,score,correct,total,stars,time_seconds,played_at) VALUES(?,?,?,?,?,?,?,?)').run(req.user.studentId,type,score,correct,total,stars,timeSeconds,now());
  const old=db.prepare('SELECT score FROM game_results WHERE student_id=? AND game_type=?').get(req.user.studentId,type);
  if(!old || score>=Number(old.score||0)){
    db.prepare('INSERT INTO game_results(student_id,game_type,score,correct,total,stars,time_seconds,played_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(student_id,game_type) DO UPDATE SET score=excluded.score,correct=excluded.correct,total=excluded.total,stars=excluded.stars,time_seconds=excluded.time_seconds,played_at=excluded.played_at').run(req.user.studentId,type,score,correct,total,stars,timeSeconds,now());
  }
  const used=attempts+1;
  recordScoreHistory(req.user.studentId,'game',type,score,stars,{correct,total,timeSeconds}); await queueBackup(); res.json({ok:true,attempts:used,maxAttempts:3,remaining:Math.max(0,3-used)});
});
app.get('/api/overall-leaderboard',auth,(req,res)=>{
  const ss=students(ownerForUser(req.user));
  const assignmentRows=db.prepare('SELECT student_id, SUM(CASE WHEN json_extract(payload,\'$.score\') IS NOT NULL THEN CAST(json_extract(payload,\'$.score\') AS REAL) ELSE 0 END) AS points, COUNT(CASE WHEN json_extract(payload,\'$.score\') IS NOT NULL THEN 1 END) AS completed FROM submissions GROUP BY student_id').all();
  const games=db.prepare('SELECT student_id, game_type, score, stars, correct, total, time_seconds FROM game_results').all();
  const amap=new Map(assignmentRows.map(x=>[Number(x.student_id),{points:Number(x.points)||0,completed:Number(x.completed)||0}]));
  // Điểm trò chơi = cộng ĐIỂM CAO NHẤT của cả 3 trò:
  // ⚡ Tính nhanh + 🎯 Săn đáp án + 🧠 Thử tài kiến thức.
  // Mỗi trò có tối đa 3 lượt; game_results chỉ giữ kết quả cao nhất của từng trò.
  const GAME_TYPES=['math','choice','knowledge'];
  const gmap=new Map();
  for(const g of games){
    const id=Number(g.student_id);
    if(!gmap.has(id))gmap.set(id,{points:0,stars:0,games:0,details:[],byType:{}});
    const z=gmap.get(id);
    const score=Number(g.score)||0, stars=Number(g.stars)||0, type=String(g.game_type||'');
    z.points+=score;
    z.stars+=stars;
    z.games++;
    z.byType[type]={score,stars,correct:Number(g.correct)||0,total:Number(g.total)||0,timeSeconds:Number(g.time_seconds)||0};
    z.details.push({type,score,stars,correct:Number(g.correct)||0,total:Number(g.total)||0,timeSeconds:Number(g.time_seconds)||0});
  }
  const list=ss.map(s=>{
    const a=amap.get(s.id)||{points:0,completed:0};
    const g=gmap.get(s.id)||{points:0,stars:0,games:0,details:[],byType:{}};
    const gameMath=Number(g.byType.math?.score||0);
    const gameChoice=Number(g.byType.choice?.score||0);
    const gameKnowledge=Number(g.byType.knowledge?.score||0);
    const gamePoints=gameMath+gameChoice+gameKnowledge;
    return {
      studentId:s.id,name:s.name,group:s.group,
      assignmentPoints:a.points,completedAssignments:a.completed,
      gamePoints,gameStars:g.stars,playedGames:g.games,
      gameMath,gameChoice,gameKnowledge,
      totalPoints:a.points+gamePoints,details:g.details
    };
  });
  list.sort((a,b)=>b.totalPoints-a.totalPoints||b.assignmentPoints-a.assignmentPoints||b.gamePoints-a.gamePoints||a.studentId-b.studentId);
  list.forEach((x,i)=>x.rank=i+1);
  const me=list.find(x=>x.studentId===req.user.studentId);
  res.json({ok:true,leaderboard:list,userRank:me?.rank||null});
});
app.get('/api/leaderboard',auth,(req,res)=>{
  const assignmentId=String(req.query.assignmentId||''),owner=ownerForUser(req.user);
  if(!assignmentId)return res.status(400).json({error:'Thiếu assignmentId'});
  if(!db.prepare('SELECT id FROM assignments WHERE id=? AND owner_username=?').get(assignmentId,owner))return res.status(404).json({error:'Không tìm thấy bài trong lớp của tài khoản này'});
  const rows=db.prepare('SELECT s.id,s.name,s.group_name AS "group",sub.payload FROM students s LEFT JOIN submissions sub ON sub.student_id=s.id AND sub.assignment_id=? WHERE s.owner_username=? ORDER BY s.id').all(assignmentId,owner);
  const list=rows.map(r=>{
    const p=r.payload?JSON.parse(r.payload):null;
    return {studentId:r.id,name:r.name,group:r.group,submitted:!!p,score:p?.score??null,stars:p?.stars??0,time:p?.time??null,correct:p?.correct??0,total:p?.total??0};
  });
  const submitted=list.filter(x=>x.submitted);
  submitted.sort((a,b)=>{
    const sa=Number(a.score??-1), sb=Number(b.score??-1);
    if(sb!==sa)return sb-sa;
    const ta=a.time?new Date(a.time).getTime():Number.MAX_SAFE_INTEGER;
    const tb=b.time?new Date(b.time).getTime():Number.MAX_SAFE_INTEGER;
    if(ta!==tb)return ta-tb;
    return Number(b.stars||0)-Number(a.stars||0);
  });
  const rankById=new Map(submitted.map((x,i)=>[x.studentId,i+1]));
  list.forEach(x=>x.rank=rankById.get(x.studentId)||null);
  const userRank=req.user.role==='student'?rankById.get(req.user.studentId)||null:null;
  res.json({ok:true,assignmentId,leaderboard:list,submittedCount:submitted.length,totalStudents:list.length,userRank});
});
app.put('/api/state',auth,async(req,res)=>{
 if(!teacher(req,res))return;const owner=ownerForUser(req.user),s=req.body?.state;if(!s)return res.status(400).json({error:'Thiếu state'});
 try{db.exec('BEGIN');
  for(const a of s.assignments||[]){if(!a?.id)throw new Error('Bài tập thiếu mã định danh');const old=db.prepare('SELECT owner_username FROM assignments WHERE id=?').get(String(a.id));if(old&&old.owner_username!==owner)throw new Error('Không có quyền sửa bài của giáo viên khác');db.prepare('INSERT INTO assignments(id,payload,status,created_at,owner_username) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,status=excluded.status WHERE assignments.owner_username=excluded.owner_username').run(String(a.id),JSON.stringify(a),a.status||'Đang giao',a.createdAt||now(),owner);}
  for(const [k,v] of Object.entries(s.submissions||{})){const studentId=Number(v.studentId||String(k).split('_').pop()),assignmentId=String(v.assignmentId||String(k).split('_')[0]);if(!db.prepare('SELECT id FROM students WHERE id=? AND owner_username=?').get(studentId,owner)||!db.prepare('SELECT id FROM assignments WHERE id=? AND owner_username=?').get(assignmentId,owner))throw new Error('Bài nộp không thuộc lớp của tài khoản này');db.prepare('INSERT INTO submissions(k,assignment_id,student_id,payload,submitted_at) VALUES(?,?,?,?,?) ON CONFLICT(k) DO UPDATE SET payload=excluded.payload,submitted_at=excluded.submitted_at').run(String(k),assignmentId,studentId,JSON.stringify(v),v.time||now());}
  db.exec('COMMIT');await queueBackup();res.json({ok:true,updatedAt:now()});
 }catch(e){try{db.exec('ROLLBACK')}catch{}res.status(400).json({error:e.message});}
});
app.post('/api/password',auth,async(req,res)=>{const {currentPassword,newPassword}=req.body||{};const u=db.prepare('SELECT * FROM users WHERE username=?').get(req.user.username);if(!u||!bcrypt.compareSync(String(currentPassword||''),u.password_hash))return res.status(400).json({error:'Mật khẩu hiện tại không đúng'});if(String(newPassword||'').length<6)return res.status(400).json({error:'Mật khẩu mới tối thiểu 6 ký tự'});db.prepare('UPDATE users SET password_hash=? WHERE username=?').run(bcrypt.hashSync(String(newPassword),10),req.user.username);await queueBackup();res.json({ok:true});});
app.post('/api/teacher/group',auth,(req,res)=>{if(!teacher(req,res))return;const {studentId,group}=req.body||{},owner=ownerForUser(req.user);if(!['Tốt','Khá','Trung bình','Yếu'].includes(group))return res.status(400).json({error:'Nhóm không hợp lệ'});const s=db.prepare('SELECT * FROM students WHERE id=? AND owner_username=?').get(Number(studentId),owner);if(!s)return res.status(404).json({error:'Không tìm thấy học sinh trong lớp của cô'});db.prepare('UPDATE students SET group_name=? WHERE id=? AND owner_username=?').run(group,s.id,owner);res.json({ok:true,student:students(owner).find(x=>x.id===s.id)});});
app.post('/api/teacher/grade',auth,async(req,res)=>{if(!teacher(req,res))return;const {assignmentId,studentId,score,praise,stars,questionGrades}=req.body||{},owner=ownerForUser(req.user);if(!db.prepare('SELECT id FROM assignments WHERE id=? AND owner_username=?').get(String(assignmentId),owner)||!db.prepare('SELECT id FROM students WHERE id=? AND owner_username=?').get(Number(studentId),owner))return res.status(404).json({error:'Bài hoặc học sinh không thuộc lớp của cô'});const key=String(assignmentId)+'_'+Number(studentId);const r=db.prepare('SELECT payload FROM submissions WHERE k=?').get(key);if(!r)return res.status(404).json({error:'Chưa có bài nộp'});const source=JSON.parse(r.payload);const rawScore=Number(score),rawStars=Number(stars);const finalScore=Number.isFinite(rawScore)?Math.max(0,Math.min(100,rawScore)):Number(source.score)||0;const ns=Number.isFinite(rawStars)?Math.max(0,Math.min(5,rawStars)):Math.min(5,Number(source.stars)||0);const finalPraise=String(praise??'').trim()||praiseByStars(ns);const finalQuestionGrades=(questionGrades&&typeof questionGrades==='object')?questionGrades:(source.questionGrades||{});const all=db.prepare('SELECT k,student_id,payload FROM submissions WHERE assignment_id=? AND student_id IN (SELECT id FROM students WHERE owner_username=?)').all(String(assignmentId),owner);const answerKey=v=>{const a=v&&typeof v.answers==='object'?v.answers:{};return Object.keys(a).sort((x,y)=>Number(x)-Number(y)).map(k=>String(k)+':'+normAnswer(a[k])).join('|');};const sourceKey=answerKey(source);const matches=all.filter(row=>answerKey(JSON.parse(row.payload))===sourceKey);let updated=source;let affected=0;try{db.exec('BEGIN');for(const row of matches){const oldRow=JSON.parse(row.payload);const oldStars=Number(oldRow.stars)||0;const delta=ns-oldStars;const next={...oldRow,score:finalScore,stars:ns,praise:finalPraise,questionGrades:finalQuestionGrades,gradedBy:'teacher',gradedAt:now()};db.prepare('UPDATE submissions SET payload=?,submitted_at=? WHERE k=?').run(JSON.stringify(next),now(),row.k);db.prepare('INSERT INTO stars(student_id,total) VALUES(?,?) ON CONFLICT(student_id) DO UPDATE SET total=MAX(0,total+excluded.total)').run(Number(row.student_id),delta);if(delta!==0)db.prepare('INSERT INTO awards(id,student_id,stars,reason,created_at) VALUES(?,?,?,?,?)').run(crypto.randomUUID(),Number(row.student_id),delta,'Cô giáo chấm/điều chỉnh bài theo bài mẫu',now());if(row.k===key)updated=next;affected++;}db.exec('COMMIT');}catch(e){try{db.exec('ROLLBACK')}catch{}return res.status(500).json({error:'Không lưu được kết quả: '+e.message});}for(const row of matches){const p=JSON.parse(row.payload);recordScoreHistory(Number(row.student_id),'teacher_grade',assignmentId,p.score,p.stars,p);} await queueBackup(); res.json({ok:true,submission:updated,affected,propagated:Math.max(0,affected-1),message:affected>1?('Đã áp dụng cùng cách chấm cho '+affected+' học sinh có bài làm giống nhau.'):''});});
app.post('/api/teacher/answer',auth,(req,res)=>{if(!teacher(req,res))return;const {assignmentId,group,questionIndex,answer,acceptedAnswers}=req.body||{},owner=ownerForUser(req.user);const idx=Number(questionIndex);if(!assignmentId||!Number.isInteger(idx)||idx<0)return res.status(400).json({error:'Dữ liệu câu hỏi không hợp lệ'});const row=db.prepare('SELECT payload FROM assignments WHERE id=? AND owner_username=?').get(String(assignmentId),owner);if(!row)return res.status(404).json({error:'Không tìm thấy bài trong lớp của cô'});const a=JSON.parse(row.payload);const set=(a.sets||[]).find(x=>x.group===String(group))||(a.sets||[]).find(x=>x.group==='Tất cả')||(a.sets||[]).find(x=>x.group==='Cả 4 nhóm');if(!set?.questions?.[idx])return res.status(404).json({error:'Không tìm thấy câu hỏi'});const q=set.questions[idx];const clean=String(answer??'').trim();if(!clean)return res.status(400).json({error:'Đáp án không được để trống'});q.answer=clean;const extras=Array.isArray(acceptedAnswers)?acceptedAnswers.map(x=>String(x).trim()).filter(Boolean):String(acceptedAnswers??'').split(';').map(x=>x.trim()).filter(Boolean);q.acceptedAnswers=[...new Set([clean,...extras])];db.prepare('UPDATE assignments SET payload=? WHERE id=?').run(JSON.stringify(a),String(assignmentId));const submissions=db.prepare('SELECT k,student_id,payload FROM submissions WHERE assignment_id=? AND student_id IN (SELECT id FROM students WHERE owner_username=?)').all(String(assignmentId),owner);let changed=0;for(const r of submissions){const p=JSON.parse(r.payload);const student=students(owner).find(s=>s.id===Number(r.student_id));const target=(a.sets||[]).find(x=>x.group==='Tất cả')||(a.sets||[]).find(x=>x.group==='Cả 4 nhóm'||x.group===student?.group)||(a.sets||[])[0];if(!target?.questions?.length)continue;let correct=0,autoTotal=0,manualTotal=0;const aa=p.answers||{};for(let i=0;i<target.questions.length;i++){const tq=target.questions[i];if(tq.manual||/cô chấm|tự luận|essay/i.test(String(tq.type||''))){manualTotal++;continue;}autoTotal++;const acc=Array.isArray(tq.acceptedAnswers)&&tq.acceptedAnswers.length?tq.acceptedAnswers:[tq.answer];if(acc.some(v=>answersEqual(aa[i],v))&&String(aa[i]??'').trim()!=='')correct++;}const autoScore=autoTotal?correct*30:null;const next={...p,correct,total:target.questions.length,autoTotal,manualTotal,wrong:autoTotal-correct,correctPercent:autoScore,wrongPercent:autoScore==null?null:100-autoScore};if(!p.gradedBy)next.score=autoScore;db.prepare('UPDATE submissions SET payload=? WHERE k=?').run(JSON.stringify(next),r.k);changed++;}res.json({ok:true,assignment:a,updatedSubmissions:changed});});app.post('/api/teacher/notify',auth,(req,res)=>{if(!teacher(req,res))return;const {studentIds,message}=req.body||{},owner=ownerForUser(req.user),allowed=new Set(students(owner).map(s=>s.id));if(!String(message||'').trim())return res.status(400).json({error:'Thiếu nội dung'});const requested=Array.isArray(studentIds)&&studentIds.length?studentIds.map(Number):[...allowed],ids=requested.filter(id=>allowed.has(id));if(!ids.length)return res.status(400).json({error:'Không có học sinh hợp lệ trong lớp của cô'});const ins=db.prepare('INSERT INTO notifications(id,student_id,message,read,created_at) VALUES(?,?,?,?,?)');for(const id of ids)ins.run(crypto.randomUUID(),id,String(message),0,now());res.json({ok:true,count:ids.length});});
app.post('/api/student/avatar',auth,(req,res)=>{
  if(req.user.role!=='student')return res.status(403).json({error:'Chỉ học sinh được đổi ảnh đại diện'});
  const allowed=['🎓','🧑‍🎓','👩‍🎓','👨‍🎓','🦊','🐼','🐯','🐰','🐨','🐸','🐵','🦄','🐱','🐶','🐻','🐼','🐨','🦁','🐯','🐷','🐙','🦋','🌈','⭐','🚀','⚽','🎨','🎵','📚','🤖'];
  const avatar=String(req.body?.avatar||'').trim();
  const image=String(req.body?.image||'').trim();
  if(image){
    if(!/^data:image\/(png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=]+$/.test(image))return res.status(400).json({error:'Ảnh không đúng định dạng'});
    if(image.length>1400000)return res.status(400).json({error:'Ảnh quá lớn. Hãy chọn ảnh nhỏ hơn 1 MB'});
    db.prepare('UPDATE students SET avatar=? WHERE id=? AND owner_username=?').run(image,req.user.studentId,ownerForUser(req.user));
    return res.json({ok:true,avatar:image});
  }
  if(!allowed.includes(avatar))return res.status(400).json({error:'Ảnh đại diện không hợp lệ'});
  db.prepare('UPDATE students SET avatar=? WHERE id=? AND owner_username=?').run(avatar,req.user.studentId,ownerForUser(req.user));
  res.json({ok:true,avatar});
});
app.post('/api/student/read-notifications',auth,(req,res)=>{if(req.user.role!=='student')return res.status(403).json({error:'Không có quyền'});const ids=Array.isArray(req.body?.ids)?req.body.ids:[];if(!ids.length)return res.json({ok:true});db.prepare(`UPDATE notifications SET read=1 WHERE student_id=? AND id IN (${ids.map(()=>'?').join(',')})`).run(req.user.studentId,...ids);res.json({ok:true});});
function praiseByStars(stars){
 const n=Math.max(0,Math.min(5,Number(stars)||0));
 if(n>=5)return "🏆 Xuất sắc! Em hoàn thành bài rất tuyệt vời!";
 if(n===4)return "🌟 Rất tốt! Em đã hoàn thành bài rất tốt!";
 if(n===3)return "👏 Tốt lắm! Em đã nắm được phần lớn kiến thức.";
 if(n===2)return "💪 Em đã cố gắng. Hãy luyện thêm để tiến bộ hơn nhé!";
 if(n===1)return "🌱 Em đã có cố gắng. Cô tin em sẽ tiến bộ từng ngày!";
 return "❤️ Em hãy xem lại bài và cố gắng thêm nhé. Cô tin em sẽ làm tốt hơn!";
}
function normAnswer(v){
 return String(v??'').toLowerCase().normalize('NFD')
  .replace(/[\u0300-\u036f]/g,'')
  .replace(/,/g,'.')
  .replace(/²/g,'2').replace(/³/g,'3')
  .replace(/cm2/g,'cm²').replace(/m2/g,'m²').replace(/cm3/g,'cm³').replace(/m3/g,'m³')
  .replace(/\s+/g,' ').trim()
  .replace(/\s*(cm²|m²|cm³|m³|kg|g|km|m|cm|mm|l|ml|%)(?=\s|$)/g,'$1')
  .replace(/[^a-z0-9\s./%²³-]/g,'').trim();
}
function answersEqual(a,b){
 const x=normAnswer(a), y=normAnswer(b);
 if(x===y)return true;
 function numeric(v){
  const s=String(v).trim().replace(/,/g,'.');
  const unit=(s.match(/(cm²|m²|cm³|m³|kg|g|km|m|cm|mm|l|ml|%)$/i)||[])[1]||"";
  const core=s.slice(0,s.length-unit.length).trim();
  const f=core.match(/^(-?\d+)\s*\/\s*(\d+)$/);
  if(f && Number(f[2])!==0)return {v:Number(f[1])/Number(f[2]),unit};
  if(/^-?\d+(?:\.\d+)?$/.test(core))return {v:Number(core),unit};
  return null;
 }
 const nx=numeric(x), ny=numeric(y);
 return !!nx && !!ny && nx.unit===ny.unit && Math.abs(nx.v-ny.v)<1e-9;
}
app.post('/api/submit',auth,async(req,res)=>{if(req.user.role!=='student')return res.status(403).json({error:'Chỉ tài khoản học sinh được nộp bài'});const {assignmentId,answers}=req.body||{};if(!assignmentId)return res.status(400).json({error:'Thiếu assignmentId'});const owner=ownerForUser(req.user);const arow=db.prepare('SELECT payload,status FROM assignments WHERE id=? AND owner_username=?').get(String(assignmentId),owner);if(!arow||arow.status!=='Đang giao')return res.status(404).json({error:'Bài không còn được giao trong lớp của em'});const a=JSON.parse(arow.payload);const sid=req.user.studentId;const ss=students(owner).find(x=>x.id===sid);if(!ss)return res.status(403).json({error:'Tài khoản học sinh không thuộc lớp này'});const set=(a.sets||[]).find(x=>x.group==='Tất cả')||(a.sets||[]).find(x=>x.group==='Cả 4 nhóm'||x.group===ss?.group)||(a.sets||[])[0];if(!set?.questions?.length)return res.status(400).json({error:'Bài chưa có câu hỏi'});const qs=set.questions;const aa=answers||{};let correct=0,autoTotal=0,manualTotal=0;for(let i=0;i<qs.length;i++){
 if(qs[i].manual||/cô chấm|tự luận|tự\s*luận|essay/i.test(String(qs[i].type||''))){manualTotal++;continue;}
 autoTotal++;
 const accepted=Array.isArray(qs[i].acceptedAnswers)&&qs[i].acceptedAnswers.length?qs[i].acceptedAnswers:[qs[i].answer];
 if(accepted.some(expected=>answersEqual(aa[i],expected))&&String(aa[i]??'').trim()!=='')correct++;
}const total=qs.length;const wrong=autoTotal-correct;const correctPercent=autoTotal?Math.round(correct/autoTotal*100):null;const wrongPercent=autoTotal?100-correctPercent:null;const currentScore=autoTotal?correct*30:null;const oldR=db.prepare('SELECT payload FROM submissions WHERE k=?').get(String(assignmentId)+'_'+sid);const old=oldR?JSON.parse(oldR.payload):{};const attempts=Number(old.attempts||0);if(attempts>=3)return res.status(429).json({error:'Em đã làm bài này đủ 3 lần (lần đầu + 2 lần làm lại).',attempts,maxAttempts:3});const score=Math.max(Number(old.bestScore)||0,currentScore);const newStars=Math.max(0,Math.min(5,Number(req.body?.stars)||0));const delta=(manualTotal?0:newStars)-(Number(old.stars)||0);const payload={...old,assignmentId:String(assignmentId),studentId:sid,score,bestScore:score,lastScore:currentScore,correct,total,autoTotal,manualTotal,wrong,correctPercent,wrongPercent,attempts:attempts+1,maxAttempts:3,stars:manualTotal?0:newStars,praise:String(req.body?.praise||''),answers:aa,time:now()};db.prepare('INSERT INTO submissions(k,assignment_id,student_id,payload,submitted_at) VALUES(?,?,?,?,?) ON CONFLICT(k) DO UPDATE SET payload=excluded.payload,submitted_at=excluded.submitted_at').run(String(assignmentId)+'_'+sid,String(assignmentId),sid,JSON.stringify(payload),now());db.prepare('INSERT INTO stars(student_id,total) VALUES(?,?) ON CONFLICT(student_id) DO UPDATE SET total=MAX(0,total+excluded.total)').run(sid,delta);if(delta!==0)db.prepare('INSERT INTO awards(id,student_id,stars,reason,created_at) VALUES(?,?,?,?,?)').run(crypto.randomUUID(),sid,delta,'Hoàn thành bài',now());recordScoreHistory(sid,'assignment',assignmentId,score,newStars,payload); await queueBackup(); res.json({ok:true,submission:payload,starsTotal:db.prepare('SELECT total FROM stars WHERE student_id=?').get(sid)?.total||0});});
app.post('/api/teacher/award',auth,async(req,res)=>{if(!teacher(req,res))return;const {studentId,stars,reason}=req.body||{},owner=ownerForUser(req.user);if(!db.prepare('SELECT id FROM students WHERE id=? AND owner_username=?').get(Number(studentId),owner))return res.status(404).json({error:'Không tìm thấy học sinh trong lớp của cô'});const n=Math.max(-10,Math.min(10,Number(stars)||0));if(!Number(studentId)||!n)return res.status(400).json({error:'Số sao không hợp lệ'});db.prepare('INSERT INTO stars(student_id,total) VALUES(?,?) ON CONFLICT(student_id) DO UPDATE SET total=MAX(0,total+excluded.total)').run(Number(studentId),n);db.prepare('INSERT INTO awards(id,student_id,stars,reason,created_at) VALUES(?,?,?,?,?)').run(crypto.randomUUID(),Number(studentId),n,String(reason||'Cô giáo tặng sao'),now());recordScoreHistory(Number(studentId),'award',null,n,n,{reason:String(reason||'Cô giáo tặng sao')}); await queueBackup(); res.json({ok:true});});
app.get('/api/teacher/monthly-scores',auth,(req,res)=>{if(!teacher(req,res))return;const month=String(req.query.month||new Date().toISOString().slice(0,7)),owner=ownerForUser(req.user);res.json({ok:true,month,students:students(owner).map(s=>monthScores(s.id,month))});});
app.get('/api/teacher/overview',auth,(req,res)=>{if(!teacher(req,res))return;const owner=ownerForUser(req.user),ss=students(owner);const submitted=db.prepare('SELECT COUNT(*) n FROM submissions WHERE student_id IN (SELECT id FROM students WHERE owner_username=?)').get(owner).n;const assignmentCount=db.prepare('SELECT COUNT(*) n FROM assignments WHERE owner_username=?').get(owner).n;const stars=db.prepare('SELECT COALESCE(SUM(total),0) n FROM stars WHERE student_id IN (SELECT id FROM students WHERE owner_username=?)').get(owner).n;res.json({students:ss.length,assignments:Number(assignmentCount),submissions:Number(submitted),stars:Number(stars)});});
app.get('/api/teacher/export',auth,(req,res)=>{if(!teacher(req,res))return;const owner=ownerForUser(req.user);res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Content-Disposition','attachment; filename="lavi-backup.json"');res.end(JSON.stringify({version:4,exportedAt:now(),students:students(owner),state:stateForTeacher(owner)},null,2));});
app.post('/api/teacher/restore',auth,(req,res)=>{if(!teacher(req,res))return;const data=req.body;if(!data?.state)return res.status(400).json({error:'File sao lưu không hợp lệ'});res.json({ok:true,note:'Hãy dùng PUT /api/state để phục hồi dữ liệu tương thích.'});});
app.get('*',(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
app.listen(PORT,()=>console.log(`LAVI 5A Online v3 running on http://localhost:${PORT}`));
