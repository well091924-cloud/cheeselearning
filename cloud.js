/* Supabase sync and account screens; plain browser JS for static GitHub Pages. */
const cloudConfigured = !!(window.CHEESE_CONFIG?.supabaseUrl && window.CHEESE_CONFIG?.supabaseAnonKey);
if(cloudConfigured) cloudClient = window.supabase.createClient(window.CHEESE_CONFIG.supabaseUrl,window.CHEESE_CONFIG.supabaseAnonKey);
let lastSnapshot=null;
const notice = (msg) => { $('auth-notice').textContent=msg; };
const safe = value => String(value??'').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function toggleSidebar(force){const el=$('sidebar');const open=typeof force==='boolean'?force:!el.classList.contains('open');el.classList.toggle('open',open);el.setAttribute('aria-hidden',String(!open));$('sidebar-backdrop').hidden=!open;}
function switchPage(page){pauseClock('Tạm dừng');toggleSidebar(false);$('app-area').hidden=page!=='typing';$('menu-page').hidden=page!=='menu';$('dashboard-page').hidden=page!=='dashboard';$('app-area').classList.remove('stats-open');$('details-panel').hidden=true;if(page==='menu')renderMenu();if(page==='dashboard')renderDashboard();}
function toggleDetails(){const panel=$('details-panel');const open=panel.hidden;panel.hidden=!open;$('app-area').classList.toggle('stats-open',open);$('details-toggle').setAttribute('aria-expanded',String(open));if(open)pauseClock('Xem thống kê');else hiddenInput.focus({preventScroll:true});}
function syncAccountUI(){const logged=!!cloudUser;$('account-button').textContent=logged?(cloudUser.email||'Cá nhân'):'Khách';$('auth-action').textContent=logged?'⇥':'↪';$('auth-action').title=logged?'Đăng xuất':'Đăng nhập';$('auth-action').setAttribute('aria-label',$('auth-action').title);$('auth-action').onclick=logged?logout:openAccount;}
async function changePassword(){if(!cloudUser){openAccount();return;}const password=prompt('Mật khẩu mới (tối thiểu 8 ký tự):');if(password===null)return;if(password.length<8)return alert('Mật khẩu quá ngắn.');const {error}=await cloudClient.auth.updateUser({password});alert(error?error.message:'Đã đổi mật khẩu.');}
function openAccount(){ $('account-modal').style.display='flex'; $('account-status').textContent=cloudUser?'Đang đăng nhập: '+cloudUser.email:(cloudConfigured?'Chế độ Khách':'Chế độ Khách — chưa cấu hình Supabase trong config.js'); }
function closeAccount(){$('account-modal').style.display='none';}
async function login(){
  if(!cloudClient)return notice('Cần cấu hình Supabase trước.');
  const {data,error}=await cloudClient.auth.signInWithPassword({email:$('auth-email').value.trim(),password:$('auth-password').value});
  if(error)return notice(error.message);
  notice('Đăng nhập thành công.');closeAccount();await handleAuth(data.user);
}
async function logout(){if(cloudClient){await cloudClient.auth.signOut();}cloudUser=null;courseId=null;sessionId=null;cloudRevision=0;testData=[];currentIndex=0;sessionCompleted=false;resetCurrentWord();$('question-text').textContent='Nhập Excel để bắt đầu...';$('display-area').replaceChildren();$('extra-info').textContent='';$('completion-panel').style.display='none';syncAccountUI();closeAccount();switchPage('typing');restoreProgress();}
async function handleAuth(user){
  if(!user)return;
  pauseClock('Chuyển sang chế độ Cá nhân');
  cloudUser=user;courseId=null;sessionId=null;cloudRevision=0;
  testData=[];currentIndex=0;sessionCompleted=false;resetCurrentWord();$('display-area').replaceChildren();
  $('question-text').textContent='Mở Your Cheese Menu hoặc nhập Excel để bắt đầu.';
  syncAccountUI();
  setStatus('Cá nhân — đồng bộ đám mây');
  switchPage('menu');
}
async function initializeApp(){
  if(!cloudClient){restoreProgress();syncAccountUI();return;}
  const {data:{session}}=await cloudClient.auth.getSession();
  if(session?.user) await handleAuth(session.user);else restoreProgress();syncAccountUI();
  cloudClient.auth.onAuthStateChange((ev,session)=>{
    if(ev==='SIGNED_OUT' && cloudUser){cloudUser=null;syncAccountUI();}
  });
}
async function createCloudCourseAndSession(){
  if(!cloudUser)return;
  try{
    suspendCloudSync=true;
    const {data:course,error:ce}=await cloudClient.from('courses').insert({user_id:cloudUser.id,name:courseName,settings:{ttsLang,ttsVoiceURI,showQuestion,showExtra,colExtra,fontScale}}).select('id').single();
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
  return {version:2,testData,currentIndex,ttsLang,ttsVoiceURI,fontScale,activeColumns,courseName,sessionCompleted,colExtra,showQuestion,showExtra,courseId,sessionId,
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
  const {data,error}=await cloudClient.from('courses').select('id,name,settings,created_at,words(id),sessions(id,created_at,status,state)').order('created_at',{ascending:false});
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
  const box=$('course-list');box.textContent='';
  if(!cloudUser){const row=document.createElement('div');row.className='lesson-row';row.innerHTML=`<strong>${safe(courseName||'Chưa có bài học')}</strong><div>${testData.length} từ · ${currentIndex}/${testData.length}</div>`;row.onclick=()=>switchPage('typing');box.append(row);return;}
  try{const courses=await cloudCourses();if(!courses.length){box.textContent='Chưa có bài học';return;}
    for(const course of courses){const latest=[...course.sessions].sort((a,b)=>new Date(b.created_at)-new Date(a.created_at))[0];const m=latest?sessionMetrics(latest):null;const row=document.createElement('div');row.className='lesson-row';row.tabIndex=0;row.setAttribute('role','button');row.innerHTML=`<strong>${safe(course.name)}</strong><span>${course.words.length} từ · ${course.sessions.length} phiên</span>${m?progressBar(m.levels):''}`;row.onclick=()=>showCourse(course);row.onkeydown=e=>{if(e.key==='Enter')showCourse(course)};box.append(row);}
  }catch(err){box.textContent='Lỗi tải bài học: '+err.message;}
}
let selectedCourse=null, editedRows=null, editChanged=false;
function closeCourseModal(){$('course-modal').style.display='none';}
async function showCourse(course){
 selectedCourse=course;$('detail-course-title').textContent=course.name;
 const body=$('course-modal-body');body.replaceChildren();const sessions=[...course.sessions].sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));const latest=sessions[0],m=latest?sessionMetrics(latest):null;
 const left=document.createElement('div');const metrics=[['Điểm trung bình',m?m.avg.toFixed(1):'—'],['Tổng số từ',course.words.length],['Đã hoàn thành',m?m.done.length:'0'],['Thời gian hoạt động TB (s)',m?m.active.toFixed(1):'—'],...['A','B','C','D'].map(k=>['Nhóm '+k,m?m.levels[k]:0])];left.innerHTML=metrics.map(([a,b])=>`<div class="metric-pair"><span>${safe(a)}</span><strong>${safe(b)}</strong></div>`).join('');
 const right=document.createElement('div');right.innerHTML='<h3>Lịch sử phiên</h3>';sessions.forEach(sess=>{const sm=sessionMetrics(sess);const r=document.createElement('div');r.className='history-row';r.innerHTML=`<div class="history-title">${new Date(sess.created_at).toLocaleString('vi-VN')} · ${sm.done.length}/${sm.total} · ${sm.avg.toFixed(1)} điểm</div>${progressBar(sm.levels)}`;right.append(r)});if(!sessions.length)right.textContent='Chưa có phiên học';
 const layout=document.createElement('div');layout.className='course-modal-layout';layout.append(left,right);body.append(layout);const buttons=document.createElement('div');buttons.className='actions modal-actions';
 const unfinished=sessions.find(x=>x.status==='in_progress' && x.state?.testData?.length);
 if(unfinished){const b=document.createElement('button');b.className='icon-btn';b.textContent='Tiếp tục học';b.onclick=()=>{closeCourseModal();openCloudSession(course,unfinished)};buttons.append(b);}
 const start=document.createElement('button');start.className='icon-btn';start.textContent='Bắt đầu phiên học mới';start.onclick=()=>openShuffle(course);buttons.append(start);
 const edit=document.createElement('button');edit.className='icon-btn';edit.textContent='Chỉnh sửa bài học';edit.onclick=()=>openCourseEdit(course);buttons.append(edit);body.append(buttons);$('course-modal').style.display='flex';
}
function shuffleList(list){const a=[...list];for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;}
function openShuffle(course){selectedCourse=course;$('shuffle-modal').style.display='flex';}
function closeShuffle(){$('shuffle-modal').style.display='none';}
async function confirmNewSession(){const mode=document.querySelector('input[name="shuffle"]:checked').value;const c=selectedCourse;const latest=[...c.sessions].sort((a,b)=>new Date(b.created_at)-new Date(a.created_at))[0];let allowed=null;
 if(mode==='review'){if(!latest?.state?.testData?.length)return alert('Chưa có phiên gần nhất để chọn nhóm ôn tập.');const selected=[...document.querySelectorAll('#review-levels input:checked')].map(x=>x.value);if(!selected.length)return alert('Chọn ít nhất một nhóm.');allowed=latest.state.testData.filter(w=>selected.includes((w.Level||'').charAt(0)) && w.Status==='Completed').map(w=>[w.Q,w.A,w.Extra||'']);if(!allowed.length)return alert('Phiên gần nhất không có từ thuộc nhóm đã chọn.');}
 closeShuffle();closeCourseModal();await newCloudSession(c,mode,allowed);
}
async function newCloudSession(course,mode='original',allowed=null){
 if(!cloudUser)return alert('Cần đăng nhập.');const {data:words,error:we}=await cloudClient.from('words').select('*').eq('course_id',course.id).order('ordinal');if(we)return alert(we.message);
 let chosen=allowed?words.filter(w=>allowed.some(t=>t[0]===w.question&&t[1]===w.answer&&t[2]===w.extra)):words;
 if(!chosen.length)return alert('Không có từ phù hợp.');if(mode!=='original')chosen=shuffleList(chosen);
 const {data:s,error:se}=await cloudClient.from('sessions').insert({course_id:course.id,user_id:cloudUser.id,state:{}}).select('id,revision').single();if(se)return alert(se.message);
 courseId=course.id;sessionId=s.id;cloudRevision=Number(s.revision);courseName=course.name;const cfg=course.settings||{};ttsLang=cfg.ttsLang||'en-US';ttsVoiceURI=cfg.ttsVoiceURI||'';fontScale=Number(cfg.fontScale)||100;showQuestion=cfg.showQuestion!==false;showExtra=cfg.showExtra!==false;colExtra=cfg.colExtra??-1;applyTypingScale(fontScale);
 activeColumns={q:null,a:null,extra:colExtra};
 testData=chosen.map(w=>({Q:w.question,A:w.answer,Extra:w.extra,Status:'Unanswered',Score:null,Level:'Unanswered',FirstTryCorrect:null,ErrorCount:0,CorrectionCount:0,ActiveTimeSeconds:null,CompletedAt:''}));
 currentIndex=0;sessionCompleted=false;switchPage('typing');loadQuestion();saveProgress(false);
}
function openCourseEdit(course){selectedCourse=course;editedRows=null;editChanged=false;$('edit-course-name').value=course.name;$('edit-file').value='';$('edit-preview').textContent='';$('confirm-edit').disabled=true;$('edit-modal').style.display='flex';}
function closeEditModal(){$('edit-modal').style.display='none';}
async function previewCourseEdit(){
 const c=selectedCourse;const file=$('edit-file').files[0];editedRows=null;editChanged=false;$('confirm-edit').disabled=true;
 if(!file){$('edit-preview').textContent='Chọn file Excel mới để đối chiếu.';return;}
 try{const book=XLSX.read(await file.arrayBuffer(),{type:'array'});const rows=XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]],{header:1,defval:''});const headers=rows.shift()||[];
 if(headers.length<2)throw Error('Excel cần ít nhất hai cột: câu hỏi, trả lời.');editedRows=rows.filter(r=>String(r[0]||'').trim()&&String(r[1]||'').trim()).map(r=>({question:String(r[0]).trim(),answer:String(r[1]).trim(),extra:String(r[2]||'').trim()}));
 if(!editedRows.length)throw Error('Không tìm thấy từ hợp lệ.');
 const {data:old,error}=await cloudClient.from('words').select('*').eq('course_id',c.id).order('ordinal');if(error)throw error;
 const key=w=>JSON.stringify([w.question,w.answer,w.extra||'']);const count=(arr)=>{const m=new Map();arr.forEach(w=>m.set(key(w),(m.get(key(w))||0)+1));return m;};const prev=count(old),next=count(editedRows);let added=0,removed=0;for(const [k,n] of next)added+=Math.max(0,n-(prev.get(k)||0));for(const [k,n] of prev)removed+=Math.max(0,n-(next.get(k)||0));
 editChanged=added>0||removed>0||editedRows.some((w,i)=>key(w)!==key(old[i]||{}));$('edit-preview').innerHTML=`<p>${old.length} → ${editedRows.length} từ</p><p>Thêm: ${added} · Bỏ/thay đổi: ${removed}</p><p>${removed?'Danh sách hiện hành được thay thế; lịch sử phiên vẫn giữ snapshot cũ.':'Dữ liệu hiện hành sẽ được cập nhật.'}</p><p>Xem trước:</p><div class="stack">${editedRows.filter((w,i)=>key(w)!==key(old[i]||{})).slice(0,12).map(w=>`<div>${safe(w.question)} → ${safe(w.answer)} ${w.extra?safe('· '+w.extra):''}</div>`).join('')||'Không thay đổi nội dung'}</div>`;
 $('confirm-edit').disabled=false;
 }catch(e){$('edit-preview').textContent=e.message;}
}
async function commitCourseEdit(){
 if(!editedRows||!selectedCourse||!cloudUser)return;const c=selectedCourse;const name=$('edit-course-name').value.trim();if(!name)return alert('Tên bài học không được để trống.');
 if(!confirm('Xác nhận thay thế danh sách từ hiện hành? Các phiên đang học dở cần hoàn tất hoặc mở lại bằng snapshot cũ; lịch sử không bị xóa.'))return;
 $('confirm-edit').disabled=true;
 try{const payload=editedRows.map((w,i)=>({user_id:cloudUser.id,course_id:c.id,ordinal:i,...w}));
 // Atomic database function: prevents temporary empty vocab and revision races.
 const {error}=await cloudClient.rpc('replace_cheese_words',{p_course_id:c.id,p_name:name,p_words:payload.map(({ordinal,question,answer,extra})=>({ordinal,question,answer,extra}))});if(error)throw error;
 closeEditModal();closeCourseModal();await renderMenu();alert('Đã lưu phiên bản hiện hành. Lịch sử phiên cũ được giữ.');
 }catch(e){$('confirm-edit').disabled=false;alert('Không thể cập nhật: '+e.message);}
}
function restoreSnapshot(snap){
  suspendCloudSync=true;
  testData=snap.testData;currentIndex=Math.min(snap.currentIndex||0,testData.length);
  courseName=snap.courseName||'Vocabulary';ttsLang=snap.ttsLang||'en-US';ttsVoiceURI=snap.ttsVoiceURI||'';fontScale=Number(snap.fontScale)||100;activeColumns=snap.activeColumns||activeColumns;applyTypingScale(fontScale);showQuestion=snap.showQuestion!==false;showExtra=snap.showExtra!==false;
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
