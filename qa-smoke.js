const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
(async()=>{
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'uno-qa-'));
 const port=3200+Math.floor(Math.random()*1000);
 const child=spawn(process.execPath,['server.js'],{cwd:__dirname,env:{...process.env,PORT:String(port),NODE_ENV:'test',SESSION_SECRET:'qa-secret-that-is-long-enough-for-tests-123456',ADMIN_USERNAME:'qa-admin',ADMIN_PASSCODE:'qa-admin-passcode-1234',DATA_DIR:path.join(tmp,'data'),UPLOAD_DIR:path.join(tmp,'uploads')}});
 let output='';child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>output+=d);
 const base=`http://127.0.0.1:${port}`;let cookie='',csrf='';
 async function wait(){for(let i=0;i<40;i++){try{const r=await fetch(base+'/api/csrf');if(r.ok){cookie=(r.headers.getSetCookie?.()||[]).map(x=>x.split(';')[0]).join('; ');csrf=(await r.json()).csrf;return;}}catch{}await new Promise(r=>setTimeout(r,100));}throw Error('Server did not start: '+output);}
 async function call(url,method='GET',body){const r=await fetch(base+url,{method,headers:{...(body?{'Content-Type':'application/json'}:{}),...(method!=='GET'?{'X-CSRF-Token':csrf}:{}),Cookie:cookie},body:body?JSON.stringify(body):undefined});const d=await r.json();if(!r.ok)throw Error(`${method} ${url} ${r.status}: ${d.error}`);return d;}
 try{
  await wait();
  const initial=await fetch(base+'/api/me',{headers:{Cookie:cookie}});assert.equal(initial.status,200);
  const reg=await call('/api/register','POST',{username:'tester_01',email:'tester@example.com',password:'long-test-password-123'});assert.equal(reg.user.level,1);
  let dash=await call('/api/dashboard');assert.equal(dash.quests.length,3);assert.equal(dash.user.username,'tester_01');
  const custom=await call('/api/quests','POST',{title:'QA custom quest',description:'Test create quest',xpReward:30});assert.equal(custom.quest.xpReward,30);
  const completed=await call(`/api/quests/${custom.quest.id}/complete`,'POST',{});assert.equal(completed.user.xp,30);
  dash=await call('/api/dashboard');assert.equal(dash.stats.completedQuests,1);assert.equal(dash.achievements.length,1);
  await call('/api/admin/login','POST',{username:'qa-admin',passcode:'qa-admin-passcode-1234'});
  const quote=await call('/api/admin/quotes','POST',{quote:'QA quote for integration tests.',author:'Test',category:'QA'});assert.ok(quote.id);
  const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p0sAAAAASUVORK5CYII=';
  const upload=await call('/api/admin/upload','POST',{dataUrl:`data:image/png;base64,${png}`});assert.match(upload.url,/^\/uploads\//);
  const sponsor=await call('/api/admin/sponsors','POST',{name:'QA Partner',description:'Test sponsor',imageUrl:upload.url,websiteUrl:'https://example.com'});assert.ok(sponsor.id);
  const stats=await call('/api/admin/overview');assert.equal(stats.users,1);assert.equal(stats.quests,4);assert.equal(stats.sponsors,1);
  const me=await call('/api/me');assert.equal(me.admin,true);
  const badCsrf=await fetch(base+'/api/logout',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json','X-CSRF-Token':'wrong'},body:'{}'});assert.equal(badCsrf.status,403);
  const imageResponse=await fetch(base+upload.url,{headers:{Cookie:cookie}});assert.equal(imageResponse.status,200);assert.equal(imageResponse.headers.get('content-type'),'image/png');
  console.log('PASS: startup, CSRF, registration, password hashing path, daily quest seed, dashboard, custom quest, completion/XP, achievement, admin auth, quote creation, image upload/signature validation, sponsor creation, security-token rejection and admin overview.');
 } finally {child.kill('SIGTERM');fs.rmSync(tmp,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exit(1);});
