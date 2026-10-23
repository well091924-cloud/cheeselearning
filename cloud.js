/* Supabase sync and account screens; plain browser JS for static GitHub Pages. */
const cloudConfigured = !!(window.CHEESE_CONFIG?.supabaseUrl && window.CHEESE_CONFIG?.supabaseAnonKey);
if(cloudConfigured) cloudClient = window.supabase.createClient(window.CHEESE_CONFIG.supabaseUrl,window.CHEESE_CONFIG.supabaseAnonKey);
let lastSnapshot=null;
const notice = (msg) => { $('auth-notice').textContent=msg; };
const safe = value => String(value??'').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function switchPage(page){
  pauseClock('Tạm dừng — chuyển màn hình');
  $('app-area').hidden=page!=='typing';$('menu-page').hidden=page!=='menu';$('dashboard-page').hidden=page!=='dashboard';
  document.querySelectorAll('.nav-btn').forEach(b=>b.classList.toggle('selected',b.dataset.page===page));
  if(page==='menu') renderMenu();if(page==='dashboard')renderDashboard();
}
function toggleDetails(){const p=$('details-panel');p.hidden=!p.hidden;$('details-toggle').textContent=p.hidden?'⌃':'⌄';$('details-toggle').setAttribute('aria-expanded',String(!p.hidden));}
function openAccount(){ $('account-modal').style.display='flex'; $('account-status').textContent=cloudUser?'Đang đăng nhập: '+cloudUser.email:(cloudConfigured?'Chế độ Khách':'Chế độ Khách — chưa cấu hình Supabase trong config.js'); }
function closeAccount(){$('account-modal').style.display='none';}
async function login(){
  if(!cloudClient)return notice('Cần cấu hình Supabase trước.');
  const {data,error}=await cloudClient.auth.signInWithPassword({email:$('auth-email').value.trim(),password:$('auth-password').value});
  if(error)return notice(error.message);
  notice('Đăng nhập thành công.');closeAccount();await handleAuth(data.user);
}
async function register(){
  if(!cloudClient)return notice('Cần cấu hình Supabase trước.');
  const {data,error}=await cloudClient.auth.signUp({email:$('auth-email').value.trim(),password:$('auth-password').value});
  notice(error?error.message:(data.session?'Đăng ký và đăng nhập thành công.':'Đã đăng ký. Kiểm tra email xác minh trước khi đăng nhập.'));
  if(data.session){closeAccount();await handleAuth(data.user);}
}
async function logout(){if(cloudClient){await cloudClient.auth.signOut();}cloudUser=null;courseId=null;sessionId=null;cloudRevision=0;testData=[];currentIndex=0;sessionCompleted=false;resetCurrentWord();$('question-text').textContent='Nhập Excel để bắt đầu...';$('display-area').replaceChildren();$('extra-info').textContent='';$('completion-panel').style.display='none';$('account-button').textContent='👤 Khách / Đăng nhập';closeAccount();switchPage('typing');restoreProgress();}
async function handleAuth(user){
  if(!user)return;
  pauseClock('Chuyển sang chế độ Cá nhân');
  cloudUser=user;courseId=null;sessionId=null;cloudRevision=0;
  testData=[];currentIndex=0;sessionCompleted=false;resetCurrentWord();$('display-area').replaceChildren();
  $('question-text').textContent='Mở Your Cheese Menu hoặc nhập Excel để bắt đầu.';
  $('account-button').textContent='👤 '+(user.email||'Cá nhân');
  setStatus('Cá nhân — đồng bộ đám mây');
  switchPage('menu');
}
async function initializeApp(){
  if(!cloudClient){restoreProgress();return;}
  const {data:{session}}=await cloudClient.auth.getSession();
  if(session?.user) await handleAuth(session.user);else restoreProgress();
  cloudClient.auth.onAuthStateChange((ev,session)=>{
    if(ev==='SIGNED_OUT' && cloudUser){cloudUser=null;$('account-button').textContent='👤 Khách / Đăng nhập';}
  });
}
async function createCloudCourseAndSession(){
  if(!cloudUser)return;
  try{
    suspendCloudSync=true;
    const {data:course,error:ce}=await cloudClient.from('courses').insert({user_id:cloudUser.id,name:courseName,settings:{ttsLang,showQuestion,showExtra,colExtra}}).select('id').single();
    if(ce)throw ce;
    courseId=course.id;
    const chunks=[];for(let i=0;i<testData.length;i+=200) chunks.push(testData.slice(i,i+200).map((w,j)=>({user_id:cloudUser.id,course_id:courseId,ordinal:i+j,question:w.Q,answer:w.A,extra:w.Extra||''})));
    for(const chunk of chunks){const {error}=await cloudClient.from('words').insert(chunk);if(error)throw error;}
    const {data:session,error:se}=await cloudClient.from('sessions').insert({user_id:cloudUser.id,course_id:courseId,state:{},status:'in_progress'}).select('id,revision').single();
    if(se)throw se;
    sessionId=session.id;cloudRevision=Number(session.revision);
    suspendCloudSync=false;saveProgress(false);setStatus('Đã tạo bài học trên tài khoản');
  }catch(err){suspendCloudSync=false;setStatus('Lỗi lưu đám mây',true);alert('Không thể tạo bài học trên Supabase: '+err.message+'; không coi tiến độ là đã đồng bộ.');}
}
function captureSnapshot(){
  return {version:2,testData,currentIndex,ttsLang,courseName,sessionCompleted,colExtra,showQuestion,showExtra,courseId,sessionId,
    currentInput:hiddenInput.value,activeMsCurrent:elapsedActiveMs(),errorCountCurrent,correctionCountCurrent,
    wrongPositionsCurrent:[...wrongPositionsCurrent],savedAt:new Date().toISOString()};
}
function queueCloudSave(snapshot){
  if(!sessionId||!cloudUser)return;
  lastSnapshot=snapshot;
  if(saveTimer)clearTimeout(saveTimer);
  saveTimer=setTimeout(()=>{saveTimer=null;flushCloudSave();},350);
}
async function flushCloudSave(){
  if(syncBusy||!lastSnapshot||!sessionId)return;
  syncBusy=true;
  const snap=lastSnapshot;lastSnapshot=null;
  try{
    const results=snap.testData.flatMap((w,i)=>w.Status==='Completed'?[{
      ordinal:i,first_try:w.FirstTryCorrect==='Yes',error_count:w.ErrorCount,
      correction_count:w.CorrectionCount,response_time:w.ActiveTimeSeconds,
      score:w.Score,level:w.Level.charAt(0),completed_at:w.CompletedAt||null
    }]:[]);
    const {data,error}=await cloudClient.rpc('save_cheese_session',{
      p_session_id:sessionId,p_revision:cloudRevision,p_state:snap,
      p_status:snap.sessionCompleted?'completed':'in_progress',p_results:results
    });
    if(error)throw error;
    cloudRevision=Number(data);
    setStatus('Đã đồng bộ phiên');
  }catch(err){
    lastSnapshot=snap;
    setStatus('Chưa đồng bộ — '+err.message,true);
    if(String(err.message).includes('STALE_SESSION')){lastSnapshot=null;alert('Xung đột đồng bộ: phiên này đã thay đổi trên thiết bị khác. Tạm dừng, hãy mở lại phiên từ Cheese Menu. Không ghi đè dữ liệu của thiết bị kia.');pauseClock('Xung đột dữ liệu');}
  }finally{syncBusy=false;if(lastSnapshot && !saveTimer)saveTimer=setTimeout(()=>{saveTimer=null;flushCloudSave();},1500);}
}
async function cloudCourses(){
  if(!cloudUser)return [];
  const {data,error}=await cloudClient.from('courses').select('id,name,created_at,words(id),sessions(id,created_at,status,state)').order('created_at',{ascending:false});
  if(error)throw error;
  return data||[];
}
function sessionMetrics(s){
  const words=s.state?.testData||[];const done=words.filter(w=>w.Status==='Completed');
  const levels={A:0,B:0,C:0,D:0};done.forEach(w=>{const l=w.Level?.charAt(0);if(levels[l]!==undefined)levels[l]++;});
  return {done,total:words.length,levels,avg:done.length?done.reduce((t,w)=>t+w.Score,0)/done.length:0,
    active:done.length?done.reduce((t,w)=>t+Number(w.ActiveTimeSeconds||0),0)/done.length:0,first:done.filter(w=>w.FirstTryCorrect==='Yes').length};
}
function progressBar(levels){const total=Object.values(levels).reduce((a,b)=>a+b,0);return `<div class="bar" aria-label="A ${levels.A}; B ${levels.B}; C ${levels.C}; D ${levels.D}">${Object.entries(levels).map(([k,v])=>`<span class="lvl-${k}" style="width:${total?100*v/total:0}%"></span>`).join('')}</div>`;}
async function renderMenu(){
  const box=$('course-list');$('course-detail').hidden=true;
  if(!cloudUser){box.innerHTML=`<p>Khách: chỉ một bài được lưu trong trình duyệt. ${testData.length?safe(courseName)+' — '+currentIndex+'/'+testData.length+' từ':'Chưa có bài học.'}</p>`;return;}
  box.textContent='Đang tải danh sách...';
  try{
    const courses=await cloudCourses();box.replaceChildren();
    if(!courses.length){box.textContent='Chưa có bài học. Hãy vào Typing để nhập Excel.';return;}
    for(const course of courses){
      const sessions=[...course.sessions].sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));const latest=sessions[0];const m=latest?sessionMetrics(latest):null;
      const row=document.createElement('div');row.className='lesson-row';
      row.innerHTML=`<div><strong>${safe(course.name)}</strong><div class="secondary compact">${course.words.length} từ · ${sessions.length} phiên · ${m?m.done.length+'/'+m.total+' đã làm':'Chưa học'}</div></div>${m?progressBar(m.levels):''}`;
      const btn=document.createElement('button');btn.className='icon-btn';btn.textContent='Xem chi tiết';btn.onclick=()=>showCourse(course);row.append(btn);box.append(row);
    }
  }catch(err){box.textContent='Lỗi tải Cheese Menu: '+err.message;}
}
async function showCourse(course){
  const box=$('course-detail');box.hidden=false;box.replaceChildren();
  const heading=document.createElement('h3');heading.textContent=course.name;box.append(heading);
  const sessions=[...course.sessions].sort((a,b)=>new Date(a.created_at)-new Date(b.created_at));
  const last=sessions[sessions.length-1];
  if(last){const m=sessionMetrics(last);const p=document.createElement('p');p.textContent=`Phiên mới nhất: điểm trung bình ${m.avg.toFixed(1)} · ${m.done.length}/${m.total} từ · trung bình ${m.active.toFixed(1)} giây/từ · A ${m.levels.A}, B ${m.levels.B}, C ${m.levels.C}, D ${m.levels.D}`;box.append(p);}
  const list=document.createElement('div');list.className='stack';box.append(list);
  for(const s of sessions){const m=sessionMetrics(s);const row=document.createElement('div');row.className='lesson-row';row.innerHTML=`<span>${new Date(s.created_at).toLocaleString('vi-VN')}<br><small>${m.done.length}/${m.total} · Điểm ${m.avg.toFixed(1)} · ${safe(s.status)}</small></span>${progressBar(m.levels)}`;
    const b=document.createElement('button');b.className='icon-btn';b.textContent='Mở phiên';b.onclick=()=>openCloudSession(course,s);row.append(b);list.append(row);}
  const newButton=document.createElement('button');newButton.className='icon-btn';newButton.textContent='Học lại (phiên mới)';newButton.onclick=()=>newCloudSession(course);box.append(newButton);
}
async function newCloudSession(course){
  if(!confirm('Tạo phiên học mới từ đầu? Lịch sử cũ vẫn được giữ.'))return;
  const {data:words,error:we}=await cloudClient.from('words').select('*').eq('course_id',course.id).order('ordinal');if(we)return alert(we.message);
  const {data:s,error:se}=await cloudClient.from('sessions').insert({course_id:course.id,user_id:cloudUser.id,state:{}}).select('id,revision').single();if(se)return alert(se.message);
  courseId=course.id;sessionId=s.id;cloudRevision=Number(s.revision);courseName=course.name;
  const cfg=course.settings||{};ttsLang=cfg.ttsLang||'en-US';showQuestion=cfg.showQuestion!==false;showExtra=cfg.showExtra!==false;colExtra=cfg.colExtra??-1;
  testData=words.map(w=>({Q:w.question,A:w.answer,Extra:w.extra,Status:'Unanswered',Score:null,Level:'Unanswered',FirstTryCorrect:null,ErrorCount:0,CorrectionCount:0,ActiveTimeSeconds:null,CompletedAt:''}));
  currentIndex=0;sessionCompleted=false;switchPage('typing');loadQuestion();saveProgress(false);
}
function restoreSnapshot(snap){
  suspendCloudSync=true;
  testData=snap.testData;currentIndex=Math.min(snap.currentIndex||0,testData.length);
  courseName=snap.courseName||'Vocabulary';ttsLang=snap.ttsLang||'en-US';showQuestion=snap.showQuestion!==false;showExtra=snap.showExtra!==false;
  colExtra=snap.colExtra??-1;sessionCompleted=!!snap.sessionCompleted;active=false;waitingForResumeKey=true;
  if(sessionCompleted){finishSession();}else{
    loadQuestion();activeMsCurrent=Number(snap.activeMsCurrent)||0;
    errorCountCurrent=Number(snap.errorCountCurrent)||0;correctionCountCurrent=Number(snap.correctionCountCurrent)||0;
    wrongPositionsCurrent=new Set(snap.wrongPositionsCurrent||[]);hiddenInput.value=snap.currentInput||'';lastTypedText=hiddenInput.value;
    updateDisplay(lastTypedText);updateLiveMetrics();setStatus('Khôi phục từ Supabase — nhấn phím để tiếp tục',true);
  }
  suspendCloudSync=false;
}
async function openCloudSession(course,s){
  if(!s.state?.testData?.length){return newCloudSession(course);}
  courseId=course.id;sessionId=s.id;
  const {data:fresh,error}=await cloudClient.from('sessions').select('state,revision').eq('id',s.id).single();if(error)return alert(error.message);
  cloudRevision=Number(fresh.revision);switchPage('typing');restoreSnapshot(fresh.state);
}
async function renderDashboard(){
  const box=$('dashboard-body');if(!cloudUser){box.textContent='Đăng nhập để xem Dashboard của tài khoản.';return;}
  try{
    const courses=await cloudCourses();const sessions=courses.flatMap(c=>c.sessions);const m=sessions.map(sessionMetrics);const done=m.reduce((a,v)=>a+v.done.length,0);
    const avg=done?m.reduce((a,v)=>a+v.avg*v.done.length,0)/done:0;
    box.innerHTML=`<div class="summary-grid"><div class="summary-card">Bài học<strong>${courses.length}</strong></div><div class="summary-card">Phiên học<strong>${sessions.length}</strong></div><div class="summary-card">Từ đã làm<strong>${done}</strong></div><div class="summary-card">Điểm trung bình<strong>${avg.toFixed(1)}</strong></div></div>`;
  }catch(err){box.textContent='Lỗi tải Dashboard: '+err.message;}
}
