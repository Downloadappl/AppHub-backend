const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const DATA_DIR = path.join(__dirname, '..', 'data');
const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');
const ADMIN_DIR = path.join(__dirname, '..', '..', 'admin-panel');

function ensureDirs() {
  [DATA_DIR, UPLOADS_DIR, path.join(UPLOADS_DIR, 'apks'), path.join(UPLOADS_DIR, 'images')].forEach(d => {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  });
}

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return fallback;
  }
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

function dbFile(name) { return path.join(DATA_DIR, `${name}.json`); }

function getDb() {
  return {
    apps: readJson(dbFile('apps'), []),
    categories: readJson(dbFile('categories'), []),
    versions: readJson(dbFile('versions'), []),
    downloads: readJson(dbFile('downloads'), []),
    admins: readJson(dbFile('admins'), []),
    settings: readJson(dbFile('settings'), { storeName: 'AppHub', welcomeMessage: 'اكتشف أفضل التطبيقات والألعاب' }),
    sessions: readJson(dbFile('sessions'), [])
  };
}

function saveDb(db) {
  writeJson(dbFile('apps'), db.apps);
  writeJson(dbFile('categories'), db.categories);
  writeJson(dbFile('versions'), db.versions);
  writeJson(dbFile('downloads'), db.downloads);
  writeJson(dbFile('admins'), db.admins);
  writeJson(dbFile('settings'), db.settings);
  writeJson(dbFile('sessions'), db.sessions);
}

function seedIfNeeded() {
  const db = getDb();
  if (db.admins.length === 0) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.pbkdf2Sync('admin123', salt, 100000, 32, 'sha256').toString('hex');
    db.admins.push({
      id: 'admin-1',
      username: 'admin',
      passwordHash: hash,
      salt,
      role: 'owner',
      createdAt: new Date().toISOString()
    });
  }
  if (db.categories.length === 0) {
    db.categories = [
      { id: 'all', name: 'جميع التطبيقات', icon: null, order: 0, published: true },
      { id: 'video', name: 'تطبيقات المشاهدة', icon: null, order: 1, published: true },
      { id: 'sports', name: 'الرياضة', icon: null, order: 2, published: true },
      { id: 'tools', name: 'الأدوات', icon: null, order: 3, published: true },
      { id: 'ai', name: 'الذكاء الاصطناعي', icon: null, order: 4, published: true },
      { id: 'social', name: 'التواصل الاجتماعي', icon: null, order: 5, published: true },
      { id: 'tv', name: 'تطبيقات التلفزيون', icon: null, order: 6, published: true },
      { id: 'games', name: 'الألعاب', icon: null, order: 7, published: true },
      { id: 'misc', name: 'تطبيقات متنوعة', icon: null, order: 8, published: true }
    ];
  }
  if (db.apps.length === 0) {
    db.apps = sampleApps();
  }
  saveDb(db);
}

function sampleApps() {
  const now = new Date().toISOString();
  return [
    mkApp({ id: 'app_1', name: 'StreamBox', shortDescription: 'مشغل وسائط بسيط وسريع', fullDescription: 'تطبيق لمشاهدة الفيديوهات وتنظيم المحتوى بواجهة سهلة.', versionName: '2.1.0', versionCode: 21, sizeBytes: 28*1024*1024, developer: 'Arix Studio', categoryId: 'video', categoryName: 'تطبيقات المشاهدة', isFeatured: true, targetType: 'BOTH', downloadCount: 12500, keywords: ['video','stream','مشاهدة'], createdAt: now }),
    mkApp({ id: 'app_2', name: 'Sport Live', shortDescription: 'نتائج ومباريات مباشرة', fullDescription: 'تابع الجداول والنتائج والتنبيهات الرياضية.', versionName: '1.4.2', versionCode: 14, sizeBytes: 19*1024*1024, developer: 'Sportify Labs', categoryId: 'sports', categoryName: 'الرياضة', isFeatured: true, targetType: 'BOTH', downloadCount: 9800, keywords: ['sport','live','رياضة'], createdAt: now }),
    mkApp({ id: 'app_4', name: 'AI Chat Hub', shortDescription: 'مساعد ذكي للمحادثة', fullDescription: 'مساعد ذكي بواجهة بسيطة للهاتف والتلفزيون.', versionName: '1.8.0', versionCode: 18, sizeBytes: 34*1024*1024, developer: 'Neural Apps', categoryId: 'ai', categoryName: 'الذكاء الاصطناعي', isFeatured: true, targetType: 'BOTH', downloadCount: 15200, keywords: ['ai','chat','ذكاء'], createdAt: now }),
    mkApp({ id: 'game_1', name: 'Sky Racer', shortDescription: 'لعبة سباق سريعة', fullDescription: 'سباقات ممتعة مع تحكم سهل للريموت.', versionName: '1.0.7', versionCode: 7, sizeBytes: 58*1024*1024, developer: 'Pixel Drive', categoryId: 'games', categoryName: 'الألعاب', isFeatured: true, isGame: true, targetType: 'BOTH', downloadCount: 18300, keywords: ['game','racing','لعبة'], createdAt: now })
  ];
}
function mkApp(o) {
  return Object.assign({
    apkUrl: null, sha256: null, iconUrl: null, screenshots: [], packageName: null, minSdk: 21, published: true, isGame: false, isFeatured: false, updatedAt: o.createdAt || new Date().toISOString()
  }, o);
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Admin-Token',
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function sendText(res, status, text, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, {
    'Content-Type': type,
    'Access-Control-Allow-Origin': '*'
  });
  res.end(text);
}

function notFound(res) { sendJson(res, 404, { error: 'Not found' }); }

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; if (data.length > 20 * 1024 * 1024) { reject(new Error('Body too large')); req.destroy(); } });
    req.on('end', () => {
      if (!data) return resolve({});
      const ct = (req.headers['content-type'] || '').toLowerCase();
      try {
        if (ct.includes('application/json')) resolve(JSON.parse(data));
        else if (ct.includes('application/x-www-form-urlencoded')) {
          const params = new URLSearchParams(data);
          const obj = {}; for (const [k,v] of params.entries()) obj[k]=v; resolve(obj);
        } else {
          // try json
          resolve(JSON.parse(data));
        }
      } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

function getToken(req) {
  const auth = req.headers['authorization'] || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7);
  return req.headers['x-admin-token'] || null;
}

function requireAdmin(req, res, db) {
  const token = getToken(req);
  if (!token) { sendJson(res, 401, { error: 'Unauthorized' }); return null; }
  const session = db.sessions.find(s => s.token === token && new Date(s.expiresAt).getTime() > Date.now());
  if (!session) { sendJson(res, 401, { error: 'Invalid or expired session' }); return null; }
  const admin = db.admins.find(a => a.id === session.adminId);
  if (!admin) { sendJson(res, 401, { error: 'Unauthorized' }); return null; }
  return admin;
}

function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256').toString('hex');
}

function serveStatic(req, res, pathname) {
  // serve admin panel and uploads
  let filePath = null;
  if (pathname === '/admin' || pathname === '/admin/') filePath = path.join(ADMIN_DIR, 'index.html');
  else if (pathname.startsWith('/admin/')) filePath = path.join(ADMIN_DIR, pathname.replace('/admin/', ''));
  else if (pathname.startsWith('/uploads/')) filePath = path.join(__dirname, '..', pathname);

  if (!filePath) return false;
  const resolved = path.resolve(filePath);
  const allowed = [path.resolve(ADMIN_DIR), path.resolve(UPLOADS_DIR)];
  if (!allowed.some(a => resolved.startsWith(a))) { sendJson(res, 403, { error: 'Forbidden' }); return true; }
  if (!fs.existsSync(resolved) || fs.statSync(resolved).isDirectory()) {
    if (pathname.startsWith('/admin')) {
      const index = path.join(ADMIN_DIR, 'index.html');
      if (fs.existsSync(index)) { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); fs.createReadStream(index).pipe(res); return true; }
    }
    return false;
  }
  const ext = path.extname(resolved).toLowerCase();
  const types = { '.html':'text/html; charset=utf-8', '.css':'text/css', '.js':'application/javascript', '.json':'application/json', '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.svg':'image/svg+xml', '.apk':'application/vnd.android.package-archive', '.webp':'image/webp' };
  res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream', 'Access-Control-Allow-Origin': '*' });
  fs.createReadStream(resolved).pipe(res);
  return true;
}

function computeStats(db) {
  const apps = db.apps.filter(a => a.published !== false);
  const games = apps.filter(a => a.isGame || a.categoryId === 'games');
  const totalDownloads = apps.reduce((s,a)=>s + (Number(a.downloadCount)||0), 0) + db.downloads.length;
  const top = [...apps].sort((a,b)=> (b.downloadCount||0)-(a.downloadCount||0)).slice(0,10);
  const latest = [...apps].sort((a,b)=> new Date(b.updatedAt||b.createdAt||0)-new Date(a.updatedAt||a.createdAt||0)).slice(0,10);
  return { totalApps: apps.length, totalGames: games.length, totalDownloads, topApps: top, latestApps: latest, totalCategories: db.categories.length };
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Admin-Token'
      });
      return res.end();
    }

    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = url.pathname;

    // static
    if ((pathname.startsWith('/admin') || pathname.startsWith('/uploads/')) && req.method === 'GET') {
      if (serveStatic(req, res, pathname)) return;
    }

    const db = getDb();

    // Public API
    if (req.method === 'GET' && pathname === '/api/health') return sendJson(res, 200, { ok: true, service: 'apphub-backend', time: new Date().toISOString() });
    if (req.method === 'GET' && pathname === '/api/settings') return sendJson(res, 200, db.settings);
    if (req.method === 'GET' && pathname === '/api/categories') {
      const cats = db.categories.filter(c => c.published !== false).sort((a,b)=>(a.order||0)-(b.order||0));
      return sendJson(res, 200, { items: cats });
    }
    if (req.method === 'GET' && pathname === '/api/apps') {
      const q = (url.searchParams.get('q') || '').toLowerCase().trim();
      const category = url.searchParams.get('category');
      const featured = url.searchParams.get('featured');
      const game = url.searchParams.get('game');
      let apps = db.apps.filter(a => a.published !== false);
      if (category && category !== 'all') apps = apps.filter(a => a.categoryId === category || (category === 'games' && a.isGame));
      if (featured === 'true') apps = apps.filter(a => a.isFeatured);
      if (game === 'true') apps = apps.filter(a => a.isGame);
      if (q) apps = apps.filter(a => [a.name,a.shortDescription,a.fullDescription,a.categoryName,a.developer,a.packageName,...(a.keywords||[])].filter(Boolean).join(' ').toLowerCase().includes(q));
      const sort = url.searchParams.get('sort');
      if (sort === 'popular') apps.sort((a,b)=>(b.downloadCount||0)-(a.downloadCount||0));
      else if (sort === 'latest') apps.sort((a,b)=> new Date(b.updatedAt||b.createdAt||0)-new Date(a.updatedAt||a.createdAt||0));
      else apps.sort((a,b)=>(b.isFeatured?1:0)-(a.isFeatured?1:0));
      return sendJson(res, 200, { items: apps });
    }
    if (req.method === 'GET' && pathname.startsWith('/api/apps/')) {
      const id = pathname.split('/')[3];
      const app = db.apps.find(a => a.id === id);
      if (!app) return notFound(res);
      return sendJson(res, 200, app);
    }
    if (req.method === 'POST' && pathname.startsWith('/api/apps/') && pathname.endsWith('/download-event')) {
      const id = pathname.split('/')[3];
      const body = await parseBody(req).catch(()=>({}));
      const app = db.apps.find(a => a.id === id);
      if (app) {
        app.downloadCount = (Number(app.downloadCount)||0) + 1;
        app.updatedAt = new Date().toISOString();
      }
      db.downloads.push({ id: crypto.randomUUID(), appId: id, event: body.event || 'download', at: new Date().toISOString(), meta: body.meta || null });
      saveDb(db);
      return sendJson(res, 200, { ok: true });
    }
    if (req.method === 'GET' && pathname === '/api/stats') return sendJson(res, 200, computeStats(db));

    // Admin auth
    if (req.method === 'POST' && pathname === '/api/admin/login') {
      const body = await parseBody(req);
      const { username, password } = body || {};
      const admin = db.admins.find(a => a.username === username);
      if (!admin || hashPassword(String(password||''), admin.salt) !== admin.passwordHash) {
        return sendJson(res, 401, { error: 'بيانات الدخول غير صحيحة' });
      }
      const token = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + 7*24*60*60*1000).toISOString();
      db.sessions = db.sessions.filter(s => new Date(s.expiresAt).getTime() > Date.now());
      db.sessions.push({ token, adminId: admin.id, createdAt: new Date().toISOString(), expiresAt });
      saveDb(db);
      return sendJson(res, 200, { token, expiresAt, admin: { id: admin.id, username: admin.username, role: admin.role } });
    }
    if (req.method === 'POST' && pathname === '/api/admin/logout') {
      const token = getToken(req);
      if (token) { db.sessions = db.sessions.filter(s => s.token !== token); saveDb(db); }
      return sendJson(res, 200, { ok: true });
    }
    if (req.method === 'GET' && pathname === '/api/admin/me') {
      const admin = requireAdmin(req, res, db); if (!admin) return;
      return sendJson(res, 200, { id: admin.id, username: admin.username, role: admin.role });
    }

    // Admin CRUD
    if (pathname.startsWith('/api/admin/')) {
      const admin = requireAdmin(req, res, db); if (!admin) return;

      if (req.method === 'GET' && pathname === '/api/admin/stats') return sendJson(res, 200, computeStats(db));

      if (pathname === '/api/admin/categories') {
        if (req.method === 'GET') return sendJson(res, 200, { items: db.categories.sort((a,b)=>(a.order||0)-(b.order||0)) });
        if (req.method === 'POST') {
          const body = await parseBody(req);
          const cat = { id: body.id || `cat_${Date.now()}`, name: body.name || 'قسم جديد', icon: body.icon || null, order: Number(body.order||0), published: body.published !== false };
          db.categories.push(cat); saveDb(db); return sendJson(res, 201, cat);
        }
      }
      if (pathname.startsWith('/api/admin/categories/')) {
        const id = pathname.split('/').pop();
        const idx = db.categories.findIndex(c => c.id === id);
        if (idx === -1) return notFound(res);
        if (req.method === 'PUT') {
          const body = await parseBody(req);
          db.categories[idx] = Object.assign({}, db.categories[idx], body, { id });
          saveDb(db); return sendJson(res, 200, db.categories[idx]);
        }
        if (req.method === 'DELETE') {
          db.categories.splice(idx,1); saveDb(db); return sendJson(res, 200, { ok: true });
        }
      }

      if (pathname === '/api/admin/apps') {
        if (req.method === 'GET') return sendJson(res, 200, { items: db.apps });
        if (req.method === 'POST') {
          const body = await parseBody(req);
          const id = body.id || `app_${Date.now()}`;
          const now = new Date().toISOString();
          const app = mkApp(Object.assign({}, body, { id, createdAt: now, updatedAt: now }));
          db.apps.push(app);
          db.versions.push({ id: `ver_${Date.now()}`, appId: id, versionName: app.versionName, versionCode: app.versionCode, apkUrl: app.apkUrl, sha256: app.sha256, sizeBytes: app.sizeBytes, changelog: body.changelog || '', createdAt: now });
          saveDb(db); return sendJson(res, 201, app);
        }
      }
      if (pathname.startsWith('/api/admin/apps/')) {
        const id = pathname.split('/')[4];
        const idx = db.apps.findIndex(a => a.id === id);
        if (idx === -1) return notFound(res);
        if (req.method === 'GET') return sendJson(res, 200, db.apps[idx]);
        if (req.method === 'PUT') {
          const body = await parseBody(req);
          const prev = db.apps[idx];
          db.apps[idx] = Object.assign({}, prev, body, { id, updatedAt: new Date().toISOString() });
          if (body.versionName || body.versionCode || body.apkUrl) {
            db.versions.push({ id: `ver_${Date.now()}`, appId: id, versionName: db.apps[idx].versionName, versionCode: db.apps[idx].versionCode, apkUrl: db.apps[idx].apkUrl, sha256: db.apps[idx].sha256, sizeBytes: db.apps[idx].sizeBytes, changelog: body.changelog || '', createdAt: new Date().toISOString() });
          }
          saveDb(db); return sendJson(res, 200, db.apps[idx]);
        }
        if (req.method === 'DELETE') {
          db.apps.splice(idx,1); saveDb(db); return sendJson(res, 200, { ok: true });
        }
      }

      if (req.method === 'GET' && pathname === '/api/admin/versions') {
        const appId = url.searchParams.get('appId');
        const items = appId ? db.versions.filter(v => v.appId === appId) : db.versions;
        return sendJson(res, 200, { items });
      }

      if (req.method === 'PUT' && pathname === '/api/admin/settings') {
        const body = await parseBody(req);
        db.settings = Object.assign({}, db.settings, body);
        saveDb(db); return sendJson(res, 200, db.settings);
      }

      if (req.method === 'POST' && pathname === '/api/admin/upload-info') {
        // Metadata endpoint for APK/image uploads (actual multipart upload can be added with a library; this provides URL registration flow)
        const body = await parseBody(req);
        const kind = body.kind || 'file';
        const filename = (body.filename || `upload_${Date.now()}`).replace(/[^A-Za-z0-9._-]/g, '_');
        const sub = kind === 'apk' ? 'apks' : 'images';
        const publicUrl = `/uploads/${sub}/${filename}`;
        return sendJson(res, 200, { ok: true, filename, url: publicUrl, note: 'ارفع الملف إلى المسار المشار إليه على الخادم (أو استخدم رابطاً مباشراً). يدعم هذا التنفيذ تخزين الملفات محلياً في مجلد uploads.' });
      }

      return notFound(res);
    }

    // root
    if (req.method === 'GET' && pathname === '/') {
      return sendJson(res, 200, { name: 'AppHub Backend API', ok: true, admin: '/admin', docs: '/api/health' });
    }

    return notFound(res);
  } catch (e) {
    console.error(e);
    return sendJson(res, 500, { error: 'Internal server error', message: e.message });
  }
});

ensureDirs();
seedIfNeeded();
server.listen(PORT, HOST, () => {
  console.log(`AppHub backend running on http://${HOST}:${PORT}`);
  console.log(`Admin panel: http://localhost:${PORT}/admin`);
  console.log('Default admin credentials: admin / admin123 (change after first login in production)');
});
