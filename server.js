'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

loadEnv();
const PORT = Number(process.env.PORT || 3000);
const IS_PROD = process.env.NODE_ENV === 'production';
const SESSION_SECRET = process.env.SESSION_SECRET || 'development-only-secret-change-this-before-deploying';
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || '';
const ADMIN_PASSCODE = process.env.ADMIN_PASSCODE || '';
const APP_ORIGIN = process.env.APP_ORIGIN || '';
const ROOT = __dirname;
const DATA_DIR = resolveDir(process.env.DATA_DIR || './data');
const UPLOAD_DIR = resolveDir(process.env.UPLOAD_DIR || './uploads');
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const DB_FILE = path.join(DATA_DIR, 'uno.json');
const sessions = new Map();
const rateBuckets = new Map();
const MAX_BODY = 7 * 1024 * 1024;
const MIME_EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' };

function loadEnv() {
  const file = path.join(__dirname, '.env');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && !Object.hasOwn(process.env, m[1])) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}
function resolveDir(p) { return path.isAbsolute(p) ? p : path.resolve(ROOT, p); }
function initialDb() { return { users: [], quests: [], achievements: [], quotes: [{ id: id(), quote: 'Discipline is choosing what you want most over what you want now.', author: 'UNO LEVELING', category: 'Discipline', active: true }], sponsors: [], nextId: 1 }; }
function id() { return crypto.randomBytes(12).toString('hex'); }
function readDb() {
  if (!fs.existsSync(DB_FILE)) { const fresh = initialDb(); writeDb(fresh); return fresh; }
  try { const data = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); for (const k of ['users','quests','achievements','quotes','sponsors']) if (!Array.isArray(data[k])) data[k] = []; return data; }
  catch { throw new Error('Database file is unreadable. Restore a backup of data/uno.json.'); }
}
let db = readDb();
function writeDb(next = db) { const tmp = DB_FILE + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(next, null, 2), { mode: 0o600 }); fs.renameSync(tmp, DB_FILE); }
function safeUser(u) { return { id: u.id, username: u.username, email: u.email, xp: u.xp, level: levelFor(u.xp), streak: u.streak, lastActiveDate: u.lastActiveDate || null, createdAt: u.createdAt }; }
function levelFor(xp) { return Math.floor(Math.max(0, xp) / 100) + 1; }
function rankFor(level) { if (level >= 30) return 'TRANSCENDENT'; if (level >= 20) return 'ELITE'; if (level >= 12) return 'VANGUARD'; if (level >= 7) return 'ASCENDANT'; if (level >= 4) return 'DISCIPLINED'; return 'ROOKIE'; }
function today() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC' }).format(new Date()); }
function parseCookies(header = '') { return Object.fromEntries(header.split(';').map(x => x.trim()).filter(Boolean).map(x => { const i = x.indexOf('='); return [x.slice(0, i), decodeURIComponent(x.slice(i + 1))]; })); }
function sign(value) { return crypto.createHmac('sha256', SESSION_SECRET).update(value).digest('hex'); }
function safeEqual(a, b) { const aa = Buffer.from(String(a)); const bb = Buffer.from(String(b)); return aa.length === bb.length && crypto.timingSafeEqual(aa, bb); }
function newSession(res) {
  const sid = crypto.randomBytes(32).toString('hex'); const csrf = crypto.randomBytes(24).toString('hex');
  sessions.set(sid, { csrf, userId: null, admin: false, createdAt: Date.now() });
  const cookie = `uno.sid=${sid}.${sign(sid)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=604800${IS_PROD ? '; Secure' : ''}`;
  res.setHeader('Set-Cookie', cookie); return sessions.get(sid);
}
function getSession(req, res) {
  const cookies = parseCookies(req.headers.cookie); const raw = cookies['uno.sid'] || ''; const dot = raw.indexOf('.');
  if (dot > 0) { const sid = raw.slice(0, dot); if (safeEqual(raw.slice(dot + 1), sign(sid))) { const s = sessions.get(sid); if (s && Date.now() - s.createdAt < 7 * 86400000) return s; sessions.delete(sid); } }
  return newSession(res);
}
function json(res, status, data) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); }
function fail(res, status, message) { json(res, status, { error: message }); }
function readBody(req) { return new Promise((resolve, reject) => { let size = 0; const chunks = []; req.on('data', c => { size += c.length; if (size > MAX_BODY) { reject(Object.assign(new Error('Request is too large.'), { status: 413 })); req.destroy(); } else chunks.push(c); }); req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch { reject(Object.assign(new Error('Invalid JSON body.'), { status: 400 })); } }); req.on('error', reject); }); }
function requireCsrf(req, session) { return safeEqual(req.headers['x-csrf-token'] || '', session.csrf); }
function requireUser(session, res) { const user = db.users.find(u => u.id === session.userId); if (!user) { fail(res, 401, 'Please sign in to continue.'); return null; } return user; }
function requireAdmin(session, res) { if (!session.admin) { fail(res, 401, 'Administrator sign-in required.'); return false; } return true; }
function rateLimit(req, res, key, limit = 20, windowMs = 60000) { const ip = req.socket.remoteAddress || 'unknown'; const k = `${key}:${ip}`; const now = Date.now(); let b = rateBuckets.get(k); if (!b || now - b.start > windowMs) b = { start: now, count: 0 }; b.count++; rateBuckets.set(k, b); if (b.count > limit) { fail(res, 429, 'Too many attempts. Please wait a minute and try again.'); return false; } return true; }
function award(user, amount) { user.xp += amount; const newLevel = levelFor(user.xp); const oldLevel = levelFor(user.xp - amount); if (newLevel > oldLevel) unlock(user.id, 'Level up', `Reached level ${newLevel}.`); }
function unlock(userId, title, description) { if (!db.achievements.some(a => a.userId === userId && a.title === title)) db.achievements.push({ id: id(), userId, title, description, unlockedAt: new Date().toISOString() }); }
function ensureDailyQuests(user) {
  const day = today(); const existing = db.quests.filter(q => q.userId === user.id && q.day === day);
  if (existing.length) return;
  const templates = [
    ['Plan your day', 'Write down your three most important priorities.', 20],
    ['Focused learning', 'Spend 25 minutes learning something useful.', 25],
    ['Move with purpose', 'Take a healthy movement break today.', 20]
  ];
  for (const [title, description, xp] of templates) db.quests.push({ id: id(), userId: user.id, title, description, xpReward: xp, completed: false, day, createdAt: new Date().toISOString(), completedAt: null, daily: true });
  writeDb();
}
function publicDashboard(user) {
  ensureDailyQuests(user);
  const quests = db.quests.filter(q => q.userId === user.id).sort((a,b) => b.createdAt.localeCompare(a.createdAt));
  const achievements = db.achievements.filter(a => a.userId === user.id).sort((a,b) => b.unlockedAt.localeCompare(a.unlockedAt));
  const activeQuote = db.quotes.filter(q => q.active).sort((a,b) => b.createdAt?.localeCompare(a.createdAt || '') || 0)[0] || null;
  const sponsors = db.sponsors.filter(s => s.active).map(({id,name,description,imageUrl,websiteUrl}) => ({id,name,description,imageUrl,websiteUrl}));
  const completed = quests.filter(q => q.completed).length;
  return { user: { ...safeUser(user), rank: rankFor(levelFor(user.xp)), xpIntoLevel: user.xp % 100, xpToNextLevel: 100 - (user.xp % 100) }, quests, achievements, stats: { totalQuests: quests.length, completedQuests: completed, completionRate: quests.length ? Math.round(completed / quests.length * 100) : 0 }, quote: activeQuote, sponsors };
}
function serveStatic(req, res, pathname) {
  const routes = { '/': 'index.html', '/admin': 'admin.html' };
  const rel = routes[pathname] || pathname.replace(/^\//, '');
  const file = path.resolve(ROOT, 'public', rel);
  if (!file.startsWith(path.resolve(ROOT, 'public') + path.sep) && file !== path.resolve(ROOT, 'public', 'index.html')) return fail(res, 403, 'Forbidden.');
  fs.readFile(file, (err, data) => { if (err) return fail(res, 404, 'Page not found.'); const ext = path.extname(file); const types = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.svg':'image/svg+xml', '.png':'image/png', '.jpg':'image/jpeg', '.webp':'image/webp', '.gif':'image/gif' }; res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream', 'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600' }); res.end(data); });
}

async function handle(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`); const p = url.pathname;
  res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin'); res.setHeader('X-Frame-Options', 'DENY'); res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'");
  if (APP_ORIGIN && req.headers.origin && req.headers.origin !== APP_ORIGIN) return fail(res, 403, 'Origin not allowed.');
  const session = getSession(req, res);
  if (p.startsWith('/api/') && req.method !== 'GET' && req.method !== 'HEAD' && !requireCsrf(req, session)) return fail(res, 403, 'Security token expired. Refresh the page and try again.');

  if (p === '/api/csrf' && req.method === 'GET') return json(res, 200, { csrf: session.csrf });
  if (p === '/api/me' && req.method === 'GET') { const user = db.users.find(u => u.id === session.userId); return json(res, 200, { user: user ? safeUser(user) : null, admin: session.admin }); }
  if (p === '/api/register' && req.method === 'POST') {
    if (!rateLimit(req,res,'register',8)) return;
    const b = await readBody(req); const username = String(b.username || '').trim(); const email = String(b.email || '').trim().toLowerCase(); const password = String(b.password || '');
    if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) return fail(res,400,'Username must be 3–20 characters using letters, numbers or underscores.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 150) return fail(res,400,'Enter a valid email address.');
    if (password.length < 10 || password.length > 128) return fail(res,400,'Password must be at least 10 characters.');
    if (db.users.some(u => u.username.toLowerCase() === username.toLowerCase() || u.email === email)) return fail(res,409,'That username or email is already registered.');
    const salt = crypto.randomBytes(16).toString('hex'); const hash = crypto.scryptSync(password,salt,64).toString('hex');
    const user = { id:id(), username, email, salt, passwordHash:hash, xp:0, streak:0, lastActiveDate:null, createdAt:new Date().toISOString() }; db.users.push(user); session.userId = user.id; writeDb(); return json(res,201,{user:safeUser(user)});
  }
  if (p === '/api/login' && req.method === 'POST') {
    if (!rateLimit(req,res,'login',10)) return;
    const b = await readBody(req); const login = String(b.login || '').trim().toLowerCase(); const password = String(b.password || '');
    const user = db.users.find(u => u.username.toLowerCase() === login || u.email === login);
    if (!user || !safeEqual(crypto.scryptSync(password,user.salt,64).toString('hex'),user.passwordHash)) return fail(res,401,'Incorrect username/email or password.');
    session.userId = user.id; return json(res,200,{user:safeUser(user)});
  }
  if (p === '/api/logout' && req.method === 'POST') { session.userId = null; session.admin = false; return json(res,200,{ok:true}); }
  if (p === '/api/dashboard' && req.method === 'GET') { const user = requireUser(session,res); if (!user) return; return json(res,200,publicDashboard(user)); }
  if (p === '/api/quests' && req.method === 'POST') {
    const user = requireUser(session,res); if (!user) return; const b = await readBody(req); const title = String(b.title || '').trim(); const description = String(b.description || '').trim(); const xpReward = Number(b.xpReward || 25);
    if (title.length < 2 || title.length > 70) return fail(res,400,'Quest title must be 2–70 characters.'); if (description.length > 240) return fail(res,400,'Description is too long.'); if (!Number.isInteger(xpReward) || xpReward < 5 || xpReward > 50) return fail(res,400,'XP reward must be between 5 and 50.');
    const quest = { id:id(), userId:user.id, title, description, xpReward, completed:false, day:today(), createdAt:new Date().toISOString(), completedAt:null, daily:false }; db.quests.push(quest); writeDb(); return json(res,201,{quest});
  }
  const completeMatch = p.match(/^\/api\/quests\/([a-f0-9]+)\/complete$/);
  if (completeMatch && req.method === 'POST') {
    const user = requireUser(session,res); if (!user) return; const quest = db.quests.find(q => q.id === completeMatch[1] && q.userId === user.id); if (!quest) return fail(res,404,'Quest not found.'); if (quest.completed) return fail(res,409,'This quest is already complete.');
    quest.completed = true; quest.completedAt = new Date().toISOString(); award(user,quest.xpReward);
    const yesterday = new Date(Date.now()-86400000).toISOString().slice(0,10); const day = today(); if (user.lastActiveDate !== day) user.streak = user.lastActiveDate === yesterday ? user.streak + 1 : 1; user.lastActiveDate = day;
    const completedCount = db.quests.filter(q => q.userId === user.id && q.completed).length; if (completedCount >= 1) unlock(user.id,'First steps','Completed your first quest.'); if (completedCount >= 10) unlock(user.id,'Quest finisher','Completed 10 quests.'); if (user.streak >= 7) unlock(user.id,'Seven-day focus','Maintained a seven-day streak.');
    writeDb(); return json(res,200,{quest,user:safeUser(user),rank:rankFor(levelFor(user.xp))});
  }
  const deleteQuest = p.match(/^\/api\/quests\/([a-f0-9]+)$/);
  if (deleteQuest && req.method === 'DELETE') { const user = requireUser(session,res); if (!user) return; const q = db.quests.findIndex(q => q.id === deleteQuest[1] && q.userId === user.id && !q.completed); if (q < 0) return fail(res,404,'Open quest not found.'); db.quests.splice(q,1); writeDb(); return json(res,200,{ok:true}); }
  if (p === '/api/admin/login' && req.method === 'POST') {
    if (!rateLimit(req,res,'admin-login',6)) return; const b = await readBody(req);
    if (!ADMIN_USERNAME || !ADMIN_PASSCODE || !safeEqual(String(b.username || ''),ADMIN_USERNAME) || !safeEqual(String(b.passcode || ''),ADMIN_PASSCODE)) return fail(res,401,'Administrator credentials are incorrect or not configured.');
    session.admin = true; return json(res,200,{ok:true});
  }
  if (p === '/api/admin/logout' && req.method === 'POST') { session.admin = false; return json(res,200,{ok:true}); }
  if (p.startsWith('/api/admin/')) {
    if (!requireAdmin(session,res)) return;
    if (p === '/api/admin/overview' && req.method === 'GET') return json(res,200,{users:db.users.length,quests:db.quests.length,completed:db.quests.filter(q=>q.completed).length,sponsors:db.sponsors.length,quotes:db.quotes.length});
    if (p === '/api/admin/users' && req.method === 'GET') return json(res,200,db.users.map(safeUser));
    if (p === '/api/admin/quotes' && req.method === 'GET') return json(res,200,db.quotes);
    if (p === '/api/admin/quotes' && req.method === 'POST') { const b=await readBody(req); const quote=String(b.quote||'').trim(); if(quote.length<5||quote.length>400)return fail(res,400,'Quote must be 5–400 characters.'); const item={id:id(),quote,author:String(b.author||'Unknown').slice(0,60),category:String(b.category||'Discipline').slice(0,40),active:b.active!==false,createdAt:new Date().toISOString()};db.quotes.push(item);writeDb();return json(res,201,item); }
    const quoteToggle=p.match(/^\/api\/admin\/quotes\/([a-f0-9]+)$/); if(quoteToggle&&req.method==='PATCH'){const q=db.quotes.find(x=>x.id===quoteToggle[1]);if(!q)return fail(res,404,'Quote not found.');const b=await readBody(req);if(typeof b.active==='boolean')q.active=b.active;writeDb();return json(res,200,q);} if(quoteToggle&&req.method==='DELETE'){db.quotes=db.quotes.filter(x=>x.id!==quoteToggle[1]);writeDb();return json(res,200,{ok:true});}
    if (p === '/api/admin/sponsors' && req.method === 'GET') return json(res,200,db.sponsors);
    if (p === '/api/admin/sponsors' && req.method === 'POST') { const b=await readBody(req);const name=String(b.name||'').trim();if(name.length<2||name.length>80)return fail(res,400,'Sponsor name must be 2–80 characters.');const websiteUrl=validHttpUrl(b.websiteUrl);const item={id:id(),name,description:String(b.description||'').slice(0,240),imageUrl:String(b.imageUrl||''),websiteUrl,active:b.active!==false,createdAt:new Date().toISOString()};db.sponsors.push(item);writeDb();return json(res,201,item); }
    const sponsor=p.match(/^\/api\/admin\/sponsors\/([a-f0-9]+)$/);if(sponsor&&req.method==='PATCH'){const s=db.sponsors.find(x=>x.id===sponsor[1]);if(!s)return fail(res,404,'Sponsor not found.');const b=await readBody(req);for(const k of ['name','description','imageUrl'])if(typeof b[k]==='string')s[k]=b[k].slice(0,k==='description'?240:300);if(typeof b.active==='boolean')s.active=b.active;if(typeof b.websiteUrl==='string')s.websiteUrl=validHttpUrl(b.websiteUrl);writeDb();return json(res,200,s);}if(sponsor&&req.method==='DELETE'){const s=db.sponsors.find(x=>x.id===sponsor[1]);if(s?.imageUrl?.startsWith('/uploads/')){const f=path.join(UPLOAD_DIR,path.basename(s.imageUrl));if(fs.existsSync(f))fs.unlinkSync(f);}db.sponsors=db.sponsors.filter(x=>x.id!==sponsor[1]);writeDb();return json(res,200,{ok:true});}
    if (p === '/api/admin/upload' && req.method === 'POST') { const b=await readBody(req);const match=String(b.dataUrl||'').match(/^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/=]+)$/);if(!match)return fail(res,400,'Upload a JPG, PNG, WEBP or GIF image.');const mime=match[1];const bytes=Buffer.from(match[2],'base64');if(!bytes.length||bytes.length>5*1024*1024)return fail(res,400,'Image must be smaller than 5 MB.');const signatures={'image/jpeg':bytes[0]===0xff&&bytes[1]===0xd8,'image/png':bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),'image/gif':bytes.subarray(0,3).toString()==='GIF','image/webp':bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP'};if(!signatures[mime])return fail(res,400,'The image file does not match its declared format.');const filename=`${crypto.randomBytes(16).toString('hex')}${MIME_EXT[mime]}`;fs.writeFileSync(path.join(UPLOAD_DIR,filename),bytes,{flag:'wx'});return json(res,201,{url:`/uploads/${filename}`}); }
    return fail(res,404,'Admin endpoint not found.');
  }
  if (p.startsWith('/uploads/')) { const name=path.basename(p); if(name!==p.slice('/uploads/'.length))return fail(res,400,'Invalid file path.');const file=path.join(UPLOAD_DIR,name);fs.readFile(file,(err,data)=>{if(err)return fail(res,404,'Image not found.');const ext=path.extname(file);const mime={'.jpg':'image/jpeg','.png':'image/png','.webp':'image/webp','.gif':'image/gif'}[ext];if(!mime)return fail(res,404,'Image not found.');res.writeHead(200,{'Content-Type':mime,'X-Content-Type-Options':'nosniff','Cache-Control':'public, max-age=86400'});res.end(data);});return; }
  if (p.startsWith('/api/')) return fail(res,404,'API endpoint not found.');
  if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(req,res,p);
  return fail(res,405,'Method not allowed.');
}
function validHttpUrl(value) { const s=String(value||'').trim();if(!s)return '';try{const u=new URL(s);return ['http:','https:'].includes(u.protocol)?u.toString():'';}catch{return '';} }
const server = http.createServer((req,res)=>{ Promise.resolve(handle(req,res)).catch(err=>{ if(!res.headersSent)fail(res,err.status||500,err.status?err.message:'Something went wrong. Please try again.'); else res.destroy(); if(!IS_PROD)process.stderr.write(`${err.stack||err}\n`); }); });
server.listen(PORT,'0.0.0.0',()=>process.stdout.write(`UNO LEVELING running on port ${PORT}\n`));
