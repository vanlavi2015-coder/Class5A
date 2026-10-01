const express=require('express');
const path=require('path');
const fs=require('fs');
const bcrypt=require('bcryptjs');
const jwt=require('jsonwebtoken');
const crypto=require('crypto');
const {DatabaseSync}=require('node:sqlite');

const app=express();
app.use(express.json({limit:'4mb'}));
// Luôn lấy bản LAVI mới nhất để tránh trình duyệt giữ giao diện chấm bài cũ.
app.use((req,res,next)=>{if(req.path==='/'||req.path==='/index.html')res.set('Cache-Control','no-store, no-cache, must-revalidate, proxy-revalidate');next();});
app.use(express.static(path.join(__dirname,'public'),{etag:false,maxAge:0}));
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
CREATE TABLE IF NOT EXISTS students(id INTEGER PRIMARY KEY, code TEXT UNIQUE NOT NULL, name TEXT NOT NULL, group_name TEXT NOT NULL, source_level TEXT, avatar TEXT DEFAULT '🎓');
CREATE TABLE IF NOT EXISTS assignments(id TEXT PRIMARY KEY, payload TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS submissions(k TEXT PRIMARY KEY, assignment_id TEXT NOT NULL, student_id INTEGER NOT NULL, payload TEXT NOT NULL, submitted_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS stars(student_id INTEGER PRIMARY KEY, total INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS awards(id TEXT PRIMARY KEY, student_id INTEGER NOT NULL, stars INTEGER NOT NULL, reason TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS notifications(id TEXT PRIMARY KEY, student_id INTEGER NOT NULL, message TEXT NOT NULL, read INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS schedules(id TEXT PRIMARY KEY, payload TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS game_results(student_id INTEGER NOT NULL, game_type TEXT NOT NULL, score INTEGER NOT NULL DEFAULT 0, correct INTEGER NOT NULL DEFAULT 0, total INTEGER NOT NULL DEFAULT 10, stars INTEGER NOT NULL DEFAULT 0, time_seconds INTEGER NOT NULL DEFAULT 0, played_at TEXT NOT NULL, PRIMARY KEY(student_id,game_type));
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

function students(){return db.prepare('SELECT id,code,name,group_name AS "group",source_level AS sourceLevel,COALESCE(avatar,\'🎓\') AS avatar FROM students ORDER BY id').all();}
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

app.get('/api/health',(req,res)=>res.json({ok:true,app:'LAVI 5A Online v3',students:students().length,db:'sqlite'}));
app.post('/api/login',(req,res)=>{const {username,password}=req.body||{};const u=db.prepare('SELECT * FROM users WHERE username=?').get(String(username||''));if(!u||!bcrypt.compareSync(String(password||''),u.password_hash))return res.status(401).json({error:'Sai tài khoản hoặc mật khẩu'});const user={username:u.username,role:u.role,studentId:u.student_id||null};res.json({token:tokenFor(user),user,students:students()});});
app.get('/api/state',auth,(req,res)=>res.json({state:req.user.role==='teacher'?stateForTeacher():stateForStudent(req.user.studentId),students:req.user.role==='teacher'?students():students().filter(s=>s.id===req.user.studentId),user:req.user}));
app.get('/api/students',auth,(req,res)=>{if(!teacher(req,res))return;res.json({students:students()});});
app.post('/api/game/result',auth,(req,res)=>{
  if(req.user.role!=='student')return res.status(403).json({error:'Chỉ học sinh được lưu kết quả trò chơi'});
  const type=String(req.body?.gameType||'').trim();
  if(!['math','choice','knowledge'].includes(type))return res.status(400).json({error:'Loại trò chơi không hợp lệ'});
  const score=Math.max(0,Math.min(100,Number(req.body?.score)||0));
  const correct=Math.max(0,Number(req.body?.correct)||0);
  const total=Math.max(1,Number(req.body?.total)||10);
  const stars=Math.max(0,Math.min(5,Number(req.body?.stars)||0));
  const timeSeconds=Math.max(0,Number(req.body?.timeSeconds)||0);
  const old=db.prepare('SELECT score FROM game_results WHERE student_id=? AND game_type=?').get(req.user.studentId,type);
  if(!old || score>=Number(old.score||0)){
    db.prepare('INSERT INTO game_results(student_id,game_type,score,correct,total,stars,time_seconds,played_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(student_id,game_type) DO UPDATE SET score=excluded.score,correct=excluded.correct,total=excluded.total,stars=excluded.stars,time_seconds=excluded.time_seconds,played_at=excluded.played_at').run(req.user.studentId,type,score,correct,total,stars,timeSeconds,now());
  }
  res.json({ok:true});
});
app.get('/api/overall-leaderboard',auth,(req,res)=>{
  const ss=students();
  const assignmentRows=db.prepare('SELECT student_id, SUM(CASE WHEN json_extract(payload,\'$.score\') IS NOT NULL THEN CAST(json_extract(payload,\'$.score\') AS REAL) ELSE 0 END) AS points, COUNT(CASE WHEN json_extract(payload,\'$.score\') IS NOT NULL THEN 1 END) AS completed FROM submissions GROUP BY student_id').all();
  const games=db.prepare('SELECT student_id, game_type, score, stars, correct, total, time_seconds FROM game_results').all();
  const amap=new Map(assignmentRows.map(x=>[Number(x.student_id),{points:Number(x.points)||0,completed:Number(x.completed)||0}]));
  const gmap=new Map();
  for(const g of games){const id=Number(g.student_id);if(!gmap.has(id))gmap.set(id,{points:0,stars:0,games:0,details:[]});const z=gmap.get(id);z.points+=Number(g.score)||0;z.stars+=Number(g.stars)||0;z.games++;z.details.push({type:g.game_type,score:Number(g.score)||0,stars:Number(g.stars)||0,correct:Number(g.correct)||0,total:Number(g.total)||0,timeSeconds:Number(g.time_seconds)||0});}
  const list=ss.map(s=>{const a=amap.get(s.id)||{points:0,completed:0};const g=gmap.get(s.id)||{points:0,stars:0,games:0,details:[]};return {studentId:s.id,name:s.name,group:s.group,assignmentPoints:a.points,completedAssignments:a.completed,gamePoints:g.points,gameStars:g.stars,playedGames:g.games,totalPoints:a.points+g.points,details:g.details};});
  list.sort((a,b)=>b.totalPoints-a.totalPoints||b.assignmentPoints-a.assignmentPoints||b.gamePoints-a.gamePoints||a.studentId-b.studentId);
  list.forEach((x,i)=>x.rank=i+1);
  const me=list.find(x=>x.studentId===req.user.studentId);
  res.json({ok:true,leaderboard:list,userRank:me?.rank||null});
});
app.get('/api/leaderboard',auth,(req,res)=>{
  const assignmentId=String(req.query.assignmentId||'');
  if(!assignmentId)return res.status(400).json({error:'Thiếu assignmentId'});
  const rows=db.prepare('SELECT s.id,s.name,s.group_name AS "group",sub.payload FROM students s LEFT JOIN submissions sub ON sub.student_id=s.id AND sub.assignment_id=? ORDER BY s.id').all(assignmentId);
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
app.put('/api/state',auth,(req,res)=>{if(!teacher(req,res))return;const s=req.body?.state;if(!s)return res.status(400).json({error:'Thiếu state'});try{db.exec('BEGIN');for(const a of s.assignments||[]){db.prepare('INSERT INTO assignments(id,payload,status,created_at) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,status=excluded.status').run(String(a.id),JSON.stringify(a),a.status||'Đang giao',a.createdAt||now());}for(const [k,v] of Object.entries(s.submissions||{})){db.prepare('INSERT INTO submissions(k,assignment_id,student_id,payload,submitted_at) VALUES(?,?,?,?,?) ON CONFLICT(k) DO UPDATE SET payload=excluded.payload').run(k,String(v.assignmentId||k.split('_')[0]),Number(v.studentId||k.split('_')[1]),JSON.stringify(v),v.time||now());}db.exec('COMMIT');res.json({ok:true,updatedAt:now()});}catch(e){try{db.exec('ROLLBACK')}catch{}res.status(500).json({error:e.message});}});
app.post('/api/password',auth,(req,res)=>{const {currentPassword,newPassword}=req.body||{};const u=db.prepare('SELECT * FROM users WHERE username=?').get(req.user.username);if(!u||!bcrypt.compareSync(String(currentPassword||''),u.password_hash))return res.status(400).json({error:'Mật khẩu hiện tại không đúng'});if(String(newPassword||'').length<6)return res.status(400).json({error:'Mật khẩu mới tối thiểu 6 ký tự'});db.prepare('UPDATE users SET password_hash=? WHERE username=?').run(bcrypt.hashSync(String(newPassword),10),req.user.username);res.json({ok:true});});
app.post('/api/teacher/group',auth,(req,res)=>{if(!teacher(req,res))return;const {studentId,group}=req.body||{};if(!['Tốt','Khá','Trung bình','Yếu'].includes(group))return res.status(400).json({error:'Nhóm không hợp lệ'});const s=db.prepare('SELECT * FROM students WHERE id=?').get(Number(studentId));if(!s)return res.status(404).json({error:'Không tìm thấy học sinh'});db.prepare('UPDATE students SET group_name=? WHERE id=?').run(group,s.id);res.json({ok:true,student:students().find(x=>x.id===s.id)});});
app.post('/api/teacher/grade',auth,(req,res)=>{if(!teacher(req,res))return;const {assignmentId,studentId,score,praise,stars,questionGrades}=req.body||{};const key=String(assignmentId)+'_'+Number(studentId);const r=db.prepare('SELECT payload FROM submissions WHERE k=?').get(key);if(!r)return res.status(404).json({error:'Chưa có bài nộp'});const source=JSON.parse(r.payload);const rawScore=Number(score),rawStars=Number(stars);const finalScore=Number.isFinite(rawScore)?Math.max(0,Math.min(100,rawScore)):Number(source.score)||0;const ns=Number.isFinite(rawStars)?Math.max(0,Math.min(5,rawStars)):Math.min(5,Number(source.stars)||0);const finalPraise=String(praise??'').trim()||praiseByStars(ns);const finalQuestionGrades=(questionGrades&&typeof questionGrades==='object')?questionGrades:(source.questionGrades||{});const all=db.prepare('SELECT k,student_id,payload FROM submissions WHERE assignment_id=?').all(String(assignmentId));const answerKey=v=>{const a=v&&typeof v.answers==='object'?v.answers:{};return Object.keys(a).sort((x,y)=>Number(x)-Number(y)).map(k=>String(k)+':'+normAnswer(a[k])).join('|');};const sourceKey=answerKey(source);const matches=all.filter(row=>answerKey(JSON.parse(row.payload))===sourceKey);let updated=source;let affected=0;try{db.exec('BEGIN');for(const row of matches){const oldRow=JSON.parse(row.payload);const oldStars=Number(oldRow.stars)||0;const delta=ns-oldStars;const next={...oldRow,score:finalScore,stars:ns,praise:finalPraise,questionGrades:finalQuestionGrades,gradedBy:'teacher',gradedAt:now()};db.prepare('UPDATE submissions SET payload=?,submitted_at=? WHERE k=?').run(JSON.stringify(next),now(),row.k);db.prepare('INSERT INTO stars(student_id,total) VALUES(?,?) ON CONFLICT(student_id) DO UPDATE SET total=MAX(0,total+excluded.total)').run(Number(row.student_id),delta);if(delta!==0)db.prepare('INSERT INTO awards(id,student_id,stars,reason,created_at) VALUES(?,?,?,?,?)').run(crypto.randomUUID(),Number(row.student_id),delta,'Cô giáo chấm/điều chỉnh bài theo bài mẫu',now());if(row.k===key)updated=next;affected++;}db.exec('COMMIT');}catch(e){try{db.exec('ROLLBACK')}catch{}return res.status(500).json({error:'Không lưu được kết quả: '+e.message});}res.json({ok:true,submission:updated,affected,propagated:Math.max(0,affected-1),message:affected>1?('Đã áp dụng cùng cách chấm cho '+affected+' học sinh có bài làm giống nhau.'):''});});
app.post('/api/teacher/answer',auth,(req,res)=>{if(!teacher(req,res))return;const {assignmentId,group,questionIndex,answer,acceptedAnswers}=req.body||{};const idx=Number(questionIndex);if(!assignmentId||!Number.isInteger(idx)||idx<0)return res.status(400).json({error:'Dữ liệu câu hỏi không hợp lệ'});const row=db.prepare('SELECT payload FROM assignments WHERE id=?').get(String(assignmentId));if(!row)return res.status(404).json({error:'Không tìm thấy bài'});const a=JSON.parse(row.payload);const set=(a.sets||[]).find(x=>x.group===String(group))||(a.sets||[]).find(x=>x.group==='Tất cả')||(a.sets||[]).find(x=>x.group==='Cả 4 nhóm');if(!set?.questions?.[idx])return res.status(404).json({error:'Không tìm thấy câu hỏi'});const q=set.questions[idx];const clean=String(answer??'').trim();if(!clean)return res.status(400).json({error:'Đáp án không được để trống'});q.answer=clean;const extras=Array.isArray(acceptedAnswers)?acceptedAnswers.map(x=>String(x).trim()).filter(Boolean):String(acceptedAnswers??'').split(';').map(x=>x.trim()).filter(Boolean);q.acceptedAnswers=[...new Set([clean,...extras])];db.prepare('UPDATE assignments SET payload=? WHERE id=?').run(JSON.stringify(a),String(assignmentId));const submissions=db.prepare('SELECT k,student_id,payload FROM submissions WHERE assignment_id=?').all(String(assignmentId));let changed=0;for(const r of submissions){const p=JSON.parse(r.payload);const student=students().find(s=>s.id===Number(r.student_id));const target=(a.sets||[]).find(x=>x.group==='Tất cả')||(a.sets||[]).find(x=>x.group==='Cả 4 nhóm'||x.group===student?.group)||(a.sets||[])[0];if(!target?.questions?.length)continue;let correct=0,autoTotal=0,manualTotal=0;const aa=p.answers||{};for(let i=0;i<target.questions.length;i++){const tq=target.questions[i];if(tq.manual||/cô chấm|tự luận|essay/i.test(String(tq.type||''))){manualTotal++;continue;}autoTotal++;const acc=Array.isArray(tq.acceptedAnswers)&&tq.acceptedAnswers.length?tq.acceptedAnswers:[tq.answer];if(acc.some(v=>answersEqual(aa[i],v))&&String(aa[i]??'').trim()!=='')correct++;}const autoScore=autoTotal?Math.round(correct/autoTotal*100):null;const next={...p,correct,total:target.questions.length,autoTotal,manualTotal,wrong:autoTotal-correct,correctPercent:autoScore,wrongPercent:autoScore==null?null:100-autoScore};if(!p.gradedBy)next.score=autoScore;db.prepare('UPDATE submissions SET payload=? WHERE k=?').run(JSON.stringify(next),r.k);changed++;}res.json({ok:true,assignment:a,updatedSubmissions:changed});});app.post('/api/teacher/notify',auth,(req,res)=>{if(!teacher(req,res))return;const {studentIds,message}=req.body||{};if(!String(message||'').trim())return res.status(400).json({error:'Thiếu nội dung'});const ids=Array.isArray(studentIds)&&studentIds.length?studentIds.map(Number):students().map(s=>s.id);const ins=db.prepare('INSERT INTO notifications(id,student_id,message,read,created_at) VALUES(?,?,?,?,?)');for(const id of ids)ins.run(crypto.randomUUID(),id,String(message),0,now());res.json({ok:true,count:ids.length});});
app.post('/api/student/avatar',auth,(req,res)=>{
  if(req.user.role!=='student')return res.status(403).json({error:'Chỉ học sinh được đổi ảnh đại diện'});
  const allowed=['🎓','🧑‍🎓','👩‍🎓','👨‍🎓','🦊','🐼','🐯','🐰','🐨','🐸','🐵','🦄','🐱','🐶','🐻','🐼','🐨','🦁','🐯','🐷','🐙','🦋','🌈','⭐','🚀','⚽','🎨','🎵','📚','🤖'];
  const avatar=String(req.body?.avatar||'').trim();
  const image=String(req.body?.image||'').trim();
  if(image){
    if(!/^data:image\/(png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=]+$/.test(image))return res.status(400).json({error:'Ảnh không đúng định dạng'});
    if(image.length>1400000)return res.status(400).json({error:'Ảnh quá lớn. Hãy chọn ảnh nhỏ hơn 1 MB'});
    db.prepare('UPDATE students SET avatar=? WHERE id=?').run(image,req.user.studentId);
    return res.json({ok:true,avatar:image});
  }
  if(!allowed.includes(avatar))return res.status(400).json({error:'Ảnh đại diện không hợp lệ'});
  db.prepare('UPDATE students SET avatar=? WHERE id=?').run(avatar,req.user.studentId);
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
app.post('/api/submit',auth,(req,res)=>{if(req.user.role!=='student')return res.status(403).json({error:'Chỉ tài khoản học sinh được nộp bài'});const {assignmentId,answers}=req.body||{};if(!assignmentId)return res.status(400).json({error:'Thiếu assignmentId'});const arow=db.prepare('SELECT payload,status FROM assignments WHERE id=?').get(String(assignmentId));if(!arow||arow.status!=='Đang giao')return res.status(404).json({error:'Bài không còn được giao'});const a=JSON.parse(arow.payload);const sid=req.user.studentId;const ss=students().find(x=>x.id===sid);const set=(a.sets||[]).find(x=>x.group==='Tất cả')||(a.sets||[]).find(x=>x.group==='Cả 4 nhóm'||x.group===ss?.group)||(a.sets||[])[0];if(!set?.questions?.length)return res.status(400).json({error:'Bài chưa có câu hỏi'});const qs=set.questions;const aa=answers||{};let correct=0,autoTotal=0,manualTotal=0;for(let i=0;i<qs.length;i++){
 if(qs[i].manual||/cô chấm|tự luận|tự\s*luận|essay/i.test(String(qs[i].type||''))){manualTotal++;continue;}
 autoTotal++;
 const accepted=Array.isArray(qs[i].acceptedAnswers)&&qs[i].acceptedAnswers.length?qs[i].acceptedAnswers:[qs[i].answer];
 if(accepted.some(expected=>answersEqual(aa[i],expected))&&String(aa[i]??'').trim()!=='')correct++;
}const total=qs.length;const wrong=autoTotal-correct;const correctPercent=autoTotal?Math.round(correct/autoTotal*100):null;const wrongPercent=autoTotal?100-correctPercent:null;const score=autoTotal?correctPercent:null;const oldR=db.prepare('SELECT payload FROM submissions WHERE k=?').get(String(assignmentId)+'_'+sid);const old=oldR?JSON.parse(oldR.payload):{};const newStars=Math.max(0,Math.min(5,Number(req.body?.stars)||0));const delta=(manualTotal?0:newStars)-(Number(old.stars)||0);const payload={...old,assignmentId:String(assignmentId),studentId:sid,score,correct,total,autoTotal,manualTotal,wrong,correctPercent,wrongPercent,stars:manualTotal?0:newStars,praise:String(req.body?.praise||''),answers:aa,time:now()};db.prepare('INSERT INTO submissions(k,assignment_id,student_id,payload,submitted_at) VALUES(?,?,?,?,?) ON CONFLICT(k) DO UPDATE SET payload=excluded.payload,submitted_at=excluded.submitted_at').run(String(assignmentId)+'_'+sid,String(assignmentId),sid,JSON.stringify(payload),now());db.prepare('INSERT INTO stars(student_id,total) VALUES(?,?) ON CONFLICT(student_id) DO UPDATE SET total=MAX(0,total+excluded.total)').run(sid,delta);if(delta!==0)db.prepare('INSERT INTO awards(id,student_id,stars,reason,created_at) VALUES(?,?,?,?,?)').run(crypto.randomUUID(),sid,delta,'Hoàn thành bài',now());res.json({ok:true,submission:payload,starsTotal:db.prepare('SELECT total FROM stars WHERE student_id=?').get(sid)?.total||0});});
app.post('/api/teacher/award',auth,(req,res)=>{if(!teacher(req,res))return;const {studentId,stars,reason}=req.body||{};const n=Math.max(-10,Math.min(10,Number(stars)||0));if(!Number(studentId)||!n)return res.status(400).json({error:'Số sao không hợp lệ'});db.prepare('INSERT INTO stars(student_id,total) VALUES(?,?) ON CONFLICT(student_id) DO UPDATE SET total=MAX(0,total+excluded.total)').run(Number(studentId),n);db.prepare('INSERT INTO awards(id,student_id,stars,reason,created_at) VALUES(?,?,?,?,?)').run(crypto.randomUUID(),Number(studentId),n,String(reason||'Cô giáo tặng sao'),now());res.json({ok:true});});
app.get('/api/teacher/overview',auth,(req,res)=>{if(!teacher(req,res))return;const ss=students();const submitted=db.prepare('SELECT COUNT(*) n FROM submissions').get().n;const assignmentCount=db.prepare('SELECT COUNT(*) n FROM assignments').get().n;const stars=db.prepare('SELECT COALESCE(SUM(total),0) n FROM stars').get().n;res.json({students:ss.length,assignments:Number(assignmentCount),submissions:Number(submitted),stars:Number(stars)});});
app.get('/api/teacher/export',auth,(req,res)=>{if(!teacher(req,res))return;res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Content-Disposition','attachment; filename="lavi5a-backup.json"');res.end(JSON.stringify({version:3,exportedAt:now(),students:students(),state:stateForTeacher()},null,2));});
app.post('/api/teacher/restore',auth,(req,res)=>{if(!teacher(req,res))return;const data=req.body;if(!data?.state)return res.status(400).json({error:'File sao lưu không hợp lệ'});res.json({ok:true,note:'Hãy dùng PUT /api/state để phục hồi dữ liệu tương thích.'});});
app.get('*',(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
app.listen(PORT,()=>console.log(`LAVI 5A Online v3 running on http://localhost:${PORT}`));