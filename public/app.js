'use strict';
const $ = (s, root=document) => root.querySelector(s);
let csrf = '';
let dashboard = null;
let toastTimer;
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function api(url, options={}) {
  const headers = { ...(options.body ? {'Content-Type':'application/json'} : {}), ...(options.headers || {}) };
  if (options.method && options.method !== 'GET') headers['X-CSRF-Token'] = csrf;
  const response = await fetch(url, { credentials:'same-origin', ...options, headers });
  const data = await response.json().catch(()=>({error:'Unexpected server response.'}));
  if (!response.ok) throw new Error(data.error || 'Request failed.');
  return data;
}
function message(form, text, success=false) { const el = $('.form-message',form); if(el){el.textContent=text;el.classList.toggle('success',success);} }
function toast(text) { const el=$('#toast');el.textContent=text;el.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('show'),2600); }
function showAuth(mode='login') { $('#authView').classList.remove('hidden');$('#appView').classList.add('hidden');document.querySelectorAll('.tab').forEach(b=>b.classList.toggle('active',b.dataset.auth===mode));$('#loginForm').classList.toggle('hidden',mode!=='login');$('#registerForm').classList.toggle('hidden',mode!=='register'); }
function showApp() { $('#authView').classList.add('hidden');$('#appView').classList.remove('hidden'); }
function render(data) {
  dashboard=data;const u=data.user;
  $('#topUsername').textContent=u.username;$('#avatarInitial').textContent=u.username.slice(0,1).toUpperCase();$('#topRank').textContent=u.rank;$('#levelValue').textContent=u.level;$('#rankValue').textContent=`${u.rank} RANK`;$('#xpValue').textContent=u.xp.toLocaleString();$('#streakValue').innerHTML=`${u.streak} <em>days</em>`;$('#successValue').innerHTML=`${data.stats.completionRate}<em>%</em>`;$('#questCountText').textContent=`${data.stats.completedQuests} of ${data.stats.totalQuests} quests completed`;
  const pct=u.xpIntoLevel;$('#levelProgress').style.width=`${pct}%`;$('#xpProgressText').textContent=`${u.xpIntoLevel} / 100 XP · ${u.xpToNextLevel} XP to next level`;
  $('#todayLabel').textContent=new Intl.DateTimeFormat(undefined,{weekday:'long',month:'short',day:'numeric'}).format(new Date()).toUpperCase();
  $('#yearNow').textContent=new Date().getFullYear();
  const quests=data.quests.filter(q=>q.day===new Date().toISOString().slice(0,10) || !q.daily);
  $('#questList').innerHTML=quests.length?quests.map(q=>`<article class="quest-item ${q.completed?'completed':''}"><button class="quest-check" data-complete="${q.id}" aria-label="${q.completed?'Completed':'Complete quest'}" ${q.completed?'disabled':''}>${q.completed?'✓':''}</button><div class="quest-info"><strong>${escapeHtml(q.title)}</strong><p>${escapeHtml(q.description||'A step forward is still progress.')}</p></div><span class="xp-pill">+${q.xpReward} XP</span>${!q.completed&&!q.daily?`<button class="delete-quest" data-delete="${q.id}" aria-label="Delete quest">×</button>`:''}</article>`).join(''):'<div class="empty-state">No quests yet. Add one small action to get started.</div>';
  const unlocked=data.achievements;const known=[['First steps','Completed your first quest.','↗'],['Quest finisher','Completed 10 quests.','✳'],['Seven-day focus','Maintained a seven-day streak.','◇']];
  const items=[...unlocked.map(a=>({...a,icon:'✦',locked:false})),...known.filter(k=>!unlocked.some(a=>a.title===k[0])).map(k=>({title:k[0],description:k[1],icon:k[2],locked:true}))];
  $('#achievementCount').textContent=`${unlocked.length} UNLOCKED`;$('#achievementList').innerHTML=items.map(a=>`<div class="achievement ${a.locked?'locked':''}"><div class="achievement-icon">${a.icon}</div><div><strong>${escapeHtml(a.title)}</strong><small>${escapeHtml(a.description)}</small></div></div>`).join('');
  $('#quoteText').textContent=data.quote?.quote||'Progress is built one deliberate action at a time.';$('#quoteAuthor').textContent=`— ${data.quote?.author||'UNO LEVELING'}`;
  $('#sponsorList').innerHTML=data.sponsors.length?data.sponsors.map(s=>`<article class="sponsor">${s.imageUrl?`<img src="${escapeHtml(s.imageUrl)}" alt="">`:'<div class="sponsor-img"></div>'}<div><strong>${escapeHtml(s.name)}</strong><p>${escapeHtml(s.description||'Community partner')}</p>${s.websiteUrl?`<a href="${escapeHtml(s.websiteUrl)}" target="_blank" rel="noopener noreferrer">Visit website ↗</a>`:''}</div></article>`).join(''):'<p class="muted small-copy">No partners to display yet.</p>';
}
async function refresh() { const data=await api('/api/dashboard');render(data); }
async function init() {
  try { csrf=(await api('/api/csrf')).csrf;const me=await api('/api/me');if(me.user){showApp();await refresh();}else showAuth(); }
  catch(e){showAuth();toast(e.message);}
}
document.querySelectorAll('.tab').forEach(b=>b.addEventListener('click',()=>showAuth(b.dataset.auth)));
$('#loginForm').addEventListener('submit',async e=>{e.preventDefault();const form=e.currentTarget;message(form,'');const data=Object.fromEntries(new FormData(form));try{await api('/api/login',{method:'POST',body:JSON.stringify(data)});showApp();await refresh();}catch(err){message(form,err.message);}});
$('#registerForm').addEventListener('submit',async e=>{e.preventDefault();const form=e.currentTarget;message(form,'');const data=Object.fromEntries(new FormData(form));try{await api('/api/register',{method:'POST',body:JSON.stringify(data)});showApp();await refresh();}catch(err){message(form,err.message);}});
$('#logoutBtn').addEventListener('click',async()=>{try{await api('/api/logout',{method:'POST',body:'{}'});showAuth();showAuth('login');toast('You have signed out.');}catch(e){toast(e.message);}});
$('#addQuestBtn').addEventListener('click',()=>$('#questDialog').showModal());
document.querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click',()=>$('#'+b.dataset.close).close()));
$('#questForm').addEventListener('submit',async e=>{e.preventDefault();const form=e.currentTarget;const data=Object.fromEntries(new FormData(form));try{await api('/api/quests',{method:'POST',body:JSON.stringify(data)});form.reset();$('#questDialog').close();await refresh();toast('Quest added. Keep moving.');}catch(err){message(form,err.message);}});
$('#questList').addEventListener('click',async e=>{const complete=e.target.closest('[data-complete]');const del=e.target.closest('[data-delete]');try{if(complete){await api(`/api/quests/${complete.dataset.complete}/complete`,{method:'POST',body:'{}'});await refresh();toast('Quest completed. XP earned!');}if(del){await api(`/api/quests/${del.dataset.delete}`,{method:'DELETE'});await refresh();toast('Quest removed.');}}catch(err){toast(err.message);}});
init();
