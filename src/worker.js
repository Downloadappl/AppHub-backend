/**
 * AppHub Store API — Cloudflare Worker
 * Same REST API as the Node backend, ported to Workers runtime.
 *
 * Bindings (wrangler.jsonc):
 *   APPHUB  — KV namespace (JSON storage)
 *   ASSETS  — Workers Assets (serves ../admin-panel at /admin)
 *   ADMIN_USERNAME, ADMIN_PASSWORD (secret)
 *
 * APK files are NOT uploaded through this API. Every app is published with a
 * direct download URL (apkUrl) hosted anywhere you like (GitHub Releases,
 * Google Drive direct link, a CDN, another host, ...).
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Admin-Token',
  'Access-Control-Max-Age': '86400'
};

const DEFAULT_SETTINGS = {
  storeName: 'AppHub',
  welcomeMessage: 'اكتشف أفضل التطبيقات والألعاب',
  storeDescription: ''
};

const DEFAULT_CATEGORIES = [
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

const SAMPLE_APPS = [
  ['app_1', 'StreamBox', 'مشغل وسائط بسيط وسريع', 'تطبيق لمشاهدة الفيديوهات وتنظيم المحتوى بواجهة سهلة.', '2.1.0', 21, 28 * 1024 * 1024, 'Arix Studio', 'video', 'تطبيقات المشاهدة', true, false, 'BOTH', 12500, ['video', 'stream', 'مشاهدة']],
  ['app_2', 'Sport Live', 'نتائج ومباريات مباشرة', 'تابع الجداول والنتائج والتنبيهات الرياضية.', '1.4.2', 14, 19 * 1024 * 1024, 'Sportify Labs', 'sports', 'الرياضة', true, false, 'BOTH', 9800, ['sport', 'live', 'رياضة']],
  ['app_4', 'AI Chat Hub', 'مساعد ذكي للمحادثة', 'مساعد ذكي بواجهة بسيطة للهاتف والتلفزيون.', '1.8.0', 18, 34 * 1024 * 1024, 'Neural Apps', 'ai', 'الذكاء الاصطناعي', true, false, 'BOTH', 15200, ['ai', 'chat', 'ذكاء']],
  ['game_1', 'Sky Racer', 'لعبة سباق سريعة', 'سباقات ممتعة مع تحكم سهل للريموت.', '1.0.7', 7, 58 * 1024 * 1024, 'Pixel Drive', 'games', 'الألعاب', true, true, 'BOTH', 18300, ['game', 'racing', 'لعبة']]
];

/* ------------------------------ helpers ------------------------------ */

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: Object.assign({
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    }, CORS, extraHeaders)
  });
}

function notFound() { return json({ error: 'Not found' }, 404); }
function unauthorized() { return json({ error: 'Unauthorized' }, 401); }

async function readBody(request) {
  const ct = (request.headers.get('content-type') || '').toLowerCase();
  try {
    if (ct.includes('application/json')) return await request.json();
    if (ct.includes('application/x-www-form-urlencoded')) {
      const form = await request.formData();
      const out = {};
      for (const [k, v] of form.entries()) out[k] = v;
      return out;
    }
    const text = await request.text();
    return text ? JSON.parse(text) : {};
  } catch (_) {
    return {};
  }
}

function toBool(v, dflt = true) {
  if (v === undefined || v === null || v === '') return dflt;
  return v === true || v === 'true' || v === 1 || v === '1';
}

function toNum(v, dflt = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : dflt;
}

function splitList(v) {
  if (Array.isArray(v)) return v.filter(Boolean);
  if (typeof v === 'string') return v.split(',').map(s => s.trim()).filter(Boolean);
  return [];
}

/* --------------------------- storage (KV) ---------------------------- */

const EMPTY_DB = () => ({
  apps: [],
  categories: [],
  versions: [],
  downloads: [],
  admins: [],
  settings: { ...DEFAULT_SETTINGS },
  sessions: []
});

async function getDb(env) {
  const keys = ['apps', 'categories', 'versions', 'downloads', 'admins', 'settings', 'sessions'];
  const values = await Promise.all(keys.map(k => env.APPHUB.get(k)));
  const db = EMPTY_DB();
  keys.forEach((k, i) => {
    if (values[i]) {
      try { db[k] = JSON.parse(values[i]); } catch (_) { /* keep empty */ }
    }
  });
  return db;
}

async function saveDb(env, db) {
  const keys = ['apps', 'categories', 'versions', 'downloads', 'admins', 'settings', 'sessions'];
  await Promise.all(keys.map(k => env.APPHUB.put(k, JSON.stringify(db[k] || []))));
}

/* ------------------------------ crypto ------------------------------- */

const enc = new TextEncoder();

function toHex(buf) {
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function fromHex(hex) {
  const clean = String(hex || '').trim();
  if (clean.length % 2 !== 0 || /[^0-9a-f]/i.test(clean)) return null;
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(clean.substr(i * 2, 2), 16);
  return bytes;
}

async function hashPassword(password, saltHex) {
  const salt = fromHex(saltHex);
  if (!salt) throw new Error('invalid salt');
  const key = await crypto.subtle.importKey('raw', enc.encode(String(password)), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100000 },
    key,
    256
  );
  return toHex(bits);
}

/** Constant-time-ish comparison to avoid trivially short-circuit leaks. */
function safeEqual(a, b) {
  const sa = String(a || '');
  const sb = String(b || '');
  if (sa.length !== sb.length) return false;
  let diff = 0;
  for (let i = 0; i < sa.length; i++) diff |= sa.charCodeAt(i) ^ sb.charCodeAt(i);
  return diff === 0;
}

/* ------------------------------ seeding ------------------------------ */

function mkApp(o) {
  const now = new Date().toISOString();
  return Object.assign({
    id: o.id,
    name: o.name,
    shortDescription: o.shortDescription || '',
    fullDescription: o.fullDescription || o.shortDescription || '',
    versionName: o.versionName || '1.0.0',
    versionCode: toNum(o.versionCode, 1),
    sizeBytes: toNum(o.sizeBytes, 0),
    developer: o.developer || null,
    iconUrl: o.iconUrl || null,
    screenshots: Array.isArray(o.screenshots) ? o.screenshots : [],
    apkUrl: o.apkUrl || null,
    sha256: o.sha256 || null,
    packageName: o.packageName || null,
    categoryId: o.categoryId || 'misc',
    categoryName: o.categoryName || 'تطبيقات متنوعة',
    isFeatured: toBool(o.isFeatured, false),
    isGame: toBool(o.isGame, false),
    targetType: o.targetType || 'BOTH',
    downloadCount: toNum(o.downloadCount, 0),
    minSdk: toNum(o.minSdk, 21),
    keywords: splitList(o.keywords),
    published: toBool(o.published, true),
    createdAt: o.createdAt || now,
    updatedAt: now
  }, o.id ? {} : { id: `app_${Date.now()}` });
}

function sampleDbApps() {
  const now = new Date().toISOString();
  return SAMPLE_APPS.map(row => mkApp({
    id: row[0], name: row[1], shortDescription: row[2], fullDescription: row[3],
    versionName: row[4], versionCode: row[5], sizeBytes: row[6], developer: row[7],
    categoryId: row[8], categoryName: row[9], isFeatured: row[10], isGame: row[11],
    targetType: row[12], downloadCount: row[13], keywords: row[14],
    createdAt: now, updatedAt: now
  }));
}

/**
 * Idempotent first-run seed. Uses a marker key so concurrent requests do not
 * duplicate data (KV is eventually consistent, so a short lock is used).
 */
async function ensureSeed(env) {
  const marker = await env.APPHUB.get('seed:v1');
  if (marker) return;

  const db = await getDb(env);

  if (!db.admins.length) {
    const salt = toHex(crypto.getRandomValues(new Uint8Array(16)));
    const username = env.ADMIN_USERNAME || 'admin';
    const password = env.ADMIN_PASSWORD || 'admin123';
    db.admins.push({
      id: 'admin-1',
      username,
      passwordHash: await hashPassword(password, salt),
      salt,
      role: 'owner',
      createdAt: new Date().toISOString()
    });
  }

  if (!db.categories.length) db.categories = JSON.parse(JSON.stringify(DEFAULT_CATEGORIES));
  if (!db.apps.length) db.apps = sampleDbApps();

  await saveDb(env, db);
  await env.APPHUB.put('seed:v1', new Date().toISOString());
}

/* -------------------------------- auth ------------------------------- */

function bearerToken(request) {
  const auth = request.headers.get('authorization') || '';
  const m = /^Bearer\s+(.+)$/i.exec(auth.trim());
  if (m) return m[1].trim();
  return (request.headers.get('x-admin-token') || '').trim() || null;
}

async function requireAdmin(request, env, db) {
  const token = bearerToken(request);
  if (!token) return { error: unauthorized() };
  const now = Date.now();
  db.sessions = (db.sessions || []).filter(s => new Date(s.expiresAt).getTime() > now);
  const session = db.sessions.find(s => s.token === token);
  if (!session) return { error: unauthorized() };
  const admin = (db.admins || []).find(a => a.id === session.adminId);
  if (!admin) return { error: unauthorized() };
  return { admin };
}

/* ------------------------------- stats ------------------------------- */

function computeStats(db) {
  const apps = (db.apps || []).filter(a => toBool(a.published, true));
  const games = apps.filter(a => toBool(a.isGame, false) || a.categoryId === 'games');
  const totalDownloads = apps.reduce((s, a) => s + toNum(a.downloadCount, 0), 0)
    + (db.downloads || []).length;
  const top = [...apps].sort((a, b) => toNum(b.downloadCount, 0) - toNum(a.downloadCount, 0)).slice(0, 10);
  const latest = [...apps]
    .sort((a, b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0))
    .slice(0, 10);
  return {
    totalApps: apps.length,
    totalGames: games.length,
    totalDownloads,
    totalCategories: (db.categories || []).length,
    topApps: top,
    latestApps: latest
  };
}

/* ---------------------------- normalization -------------------------- */

function normalizeCategory(body) {
  return {
    id: body.id || `cat_${Date.now()}`,
    name: (body.name || 'قسم جديد').toString(),
    icon: body.icon || null,
    order: toNum(body.order, 0),
    published: toBool(body.published, true)
  };
}

function normalizeApp(body, existing) {
  const base = existing || {};
  const app = mkApp(Object.assign({}, base, body, {
    id: base.id || body.id,
    createdAt: base.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    isFeatured: toBool(body.isFeatured !== undefined ? body.isFeatured : base.isFeatured, false),
    isGame: toBool(body.isGame !== undefined ? body.isGame : base.isGame, false),
    published: toBool(body.published !== undefined ? body.published : base.published, true),
    versionCode: toNum(body.versionCode !== undefined ? body.versionCode : base.versionCode, 1),
    sizeBytes: toNum(body.sizeBytes !== undefined ? body.sizeBytes : base.sizeBytes, 0),
    minSdk: toNum(body.minSdk !== undefined ? body.minSdk : base.minSdk, 21),
    downloadCount: toNum(body.downloadCount !== undefined ? body.downloadCount : base.downloadCount, 0),
    keywords: body.keywords !== undefined ? splitList(body.keywords) : (base.keywords || []),
    screenshots: body.screenshots !== undefined
      ? (Array.isArray(body.screenshots) ? body.screenshots : splitList(body.screenshots))
      : (base.screenshots || [])
  }));
  return app;
}

function findAppIndex(db, id) {
  return (db.apps || []).findIndex(a => a.id === id);
}

/* ------------------------------- router ------------------------------ */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const pathname = url.pathname;
    const method = request.method.toUpperCase();

    if (method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

    try {
      // Static: admin panel.
      // The panel lives in ../admin-panel and is mounted at the Worker root by
      // the assets binding, so /admin/ -> /index.html, /admin/css/x -> /css/x.
      // A trailing slash matters: the panel links css/js relatively.
      if (method === 'GET' && pathname === '/admin') {
        return new Response(null, { status: 301, headers: Object.assign({ Location: '/admin/' }, CORS) });
      }

      if ((method === 'GET' || method === 'HEAD') && (pathname === '/admin/' || pathname.startsWith('/admin/'))) {
        if (!env.ASSETS) {
          return json({
            error: 'لوحة التحكم غير مضمّنة في هذا الـ Worker',
            hint: 'استخدم لوحة التحكم المنشورة (GitHub Pages) وأدخل عنوان هذا الـ Worker في شاشة الإعدادات.'
          }, 404);
        }
        const rest = pathname.replace(/^\/admin\/?/, '');
        const assetPath = '/' + (rest === '' ? 'index.html' : rest);
        const assetRes = await env.ASSETS.fetch(new Request(new URL(assetPath, url.origin).toString(), request));
        if (assetRes.status === 404) return notFound();
        return assetRes;
      }

      // Any other non-API path is served from the panel bundle when present,
      // which keeps /css/... and /js/... working if someone opens the panel
      // from a sub-path.
      if (method === 'GET' && !pathname.startsWith('/api/') && env.ASSETS) {
        const assetRes = await env.ASSETS.fetch(new Request(url.toString(), request));
        if (assetRes.status !== 404) return assetRes;
      }

      // Root: JSON health/landing route (the Worker runs before assets).
      if (method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
        return json({
          name: 'AppHub Backend API',
          ok: true,
          runtime: 'cloudflare-worker',
          admin: '/admin/',
          health: '/api/health'
        });
      }

      if (method === 'GET' && pathname === '/api/health') {
        return json({ ok: true, service: 'apphub-backend', runtime: 'cloudflare-worker', time: new Date().toISOString() });
      }

      await ensureSeed(env);
      const db = await getDb(env);

      /* ---------------------------- public API ---------------------------- */

      if (method === 'GET' && pathname === '/api/settings') {
        return json(db.settings || DEFAULT_SETTINGS);
      }

      if (method === 'GET' && pathname === '/api/categories') {
        const cats = [...(db.categories || [])]
          .filter(c => toBool(c.published, true))
          .sort((a, b) => toNum(a.order, 0) - toNum(b.order, 0));
        return json({ items: cats });
      }

      if (method === 'GET' && pathname === '/api/apps') {
        const q = (url.searchParams.get('q') || '').toLowerCase().trim();
        const category = url.searchParams.get('category');
        const featured = url.searchParams.get('featured');
        const game = url.searchParams.get('game');
        const sort = url.searchParams.get('sort');
        const limit = toNum(url.searchParams.get('limit'), 0);
        const offset = toNum(url.searchParams.get('offset'), 0);

        let apps = (db.apps || []).filter(a => toBool(a.published, true));

        if (category && category !== 'all') {
          apps = apps.filter(a => a.categoryId === category || (category === 'games' && toBool(a.isGame, false)));
        }
        if (featured === 'true') apps = apps.filter(a => toBool(a.isFeatured, false));
        if (game === 'true') apps = apps.filter(a => toBool(a.isGame, false));

        if (q) {
          apps = apps.filter(a => [
            a.name, a.shortDescription, a.fullDescription, a.categoryName, a.developer, a.packageName
          ].filter(Boolean).join(' ').toLowerCase().includes(q)
            || (a.keywords || []).some(k => String(k).toLowerCase().includes(q)));
        }

        if (sort === 'popular') apps.sort((a, b) => toNum(b.downloadCount, 0) - toNum(a.downloadCount, 0));
        else if (sort === 'latest') apps.sort((a, b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0));
        else apps.sort((a, b) => (toBool(b.isFeatured, false) ? 1 : 0) - (toBool(a.isFeatured, false) ? 1 : 0));

        const total = apps.length;
        if (offset > 0) apps = apps.slice(offset);
        if (limit > 0) apps = apps.slice(0, limit);

        return json({ items: apps, total, limit: limit || null, offset: offset || 0 });
      }

      const appMatch = /^\/api\/apps\/([^/]+)$/.exec(pathname);
      if (method === 'GET' && appMatch) {
        const id = decodeURIComponent(appMatch[1]);
        const app = (db.apps || []).find(a => a.id === id);
        if (!app) return notFound();
        return json(app);
      }

      const evtMatch = /^\/api\/apps\/([^/]+)\/download-event$/.exec(pathname);
      if (method === 'POST' && evtMatch) {
        const id = decodeURIComponent(evtMatch[1]);
        const body = await readBody(request);
        const app = (db.apps || []).find(a => a.id === id);
        if (app) {
          app.downloadCount = toNum(app.downloadCount, 0) + 1;
          app.updatedAt = new Date().toISOString();
        }
        db.downloads = db.downloads || [];
        db.downloads.push({
          id: crypto.randomUUID(),
          appId: id,
          event: body.event || 'download',
          at: new Date().toISOString(),
          meta: body.meta || null
        });
        if (db.downloads.length > 20000) db.downloads = db.downloads.slice(-20000);
        await saveDb(env, db);
        return json({ ok: true });
      }

      if (method === 'GET' && pathname === '/api/stats') {
        return json(computeStats(db));
      }

      /* ---------------------------- admin auth ---------------------------- */

      if (method === 'POST' && pathname === '/api/admin/login') {
        const body = await readBody(request);
        const username = String(body.username || '').trim();
        const password = String(body.password || '');

        let admin = (db.admins || []).find(a => a.username === username);

        // Allow env-provided admin when the KV record is missing (cold start).
        if (!admin && env.ADMIN_USERNAME && username === env.ADMIN_USERNAME) {
          const salt = toHex(crypto.getRandomValues(new Uint8Array(16)));
          admin = {
            id: 'admin-env',
            username,
            salt,
            passwordHash: await hashPassword(env.ADMIN_PASSWORD || 'admin123', salt),
            role: 'owner',
            createdAt: new Date().toISOString()
          };
          db.admins = db.admins || [];
          db.admins.push(admin);
        }

        if (!admin) return json({ error: 'بيانات الدخول غير صحيحة' }, 401);

        const hash = await hashPassword(password, admin.salt);
        if (!safeEqual(hash, admin.passwordHash)) {
          return json({ error: 'بيانات الدخول غير صحيحة' }, 401);
        }

        const token = toHex(crypto.getRandomValues(new Uint8Array(32)));
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
        db.sessions = (db.sessions || []).filter(s => new Date(s.expiresAt).getTime() > Date.now());
        db.sessions.push({ token, adminId: admin.id, createdAt: new Date().toISOString(), expiresAt });
        if (db.sessions.length > 200) db.sessions = db.sessions.slice(-200);
        await saveDb(env, db);

        return json({ token, expiresAt, admin: { id: admin.id, username: admin.username, role: admin.role } });
      }

      if (method === 'POST' && pathname === '/api/admin/logout') {
        const token = bearerToken(request);
        if (token) {
          db.sessions = (db.sessions || []).filter(s => s.token !== token);
          await saveDb(env, db);
        }
        return json({ ok: true });
      }

      if (method === 'GET' && pathname === '/api/admin/me') {
        const auth = await requireAdmin(request, env, db);
        if (auth.error) return auth.error;
        return json({ id: auth.admin.id, username: auth.admin.username, role: auth.admin.role });
      }

      /* ---------------------------- admin CRUD ---------------------------- */

      if (pathname.startsWith('/api/admin/')) {
        const auth = await requireAdmin(request, env, db);
        if (auth.error) return auth.error;

        if (method === 'GET' && pathname === '/api/admin/stats') {
          return json(computeStats(db));
        }

        // ---- categories ----
        if (method === 'GET' && pathname === '/api/admin/categories') {
          const cats = [...(db.categories || [])].sort((a, b) => toNum(a.order, 0) - toNum(b.order, 0));
          return json({ items: cats });
        }

        if (method === 'POST' && pathname === '/api/admin/categories') {
          const body = await readBody(request);
          const cat = normalizeCategory(body);
          if ((db.categories || []).some(c => c.id === cat.id)) {
            return json({ error: 'معرّف القسم مستخدم مسبقاً' }, 409);
          }
          db.categories = db.categories || [];
          db.categories.push(cat);
          await saveDb(env, db);
          return json(cat, 201);
        }

        const catMatch = /^\/api\/admin\/categories\/([^/]+)$/.exec(pathname);
        if (catMatch) {
          const id = decodeURIComponent(catMatch[1]);
          const idx = (db.categories || []).findIndex(c => c.id === id);
          if (idx === -1) return notFound();

          if (method === 'GET') return json(db.categories[idx]);

          if (method === 'PUT') {
            const body = await readBody(request);
            const merged = Object.assign({}, db.categories[idx], body, { id });
            merged.order = toNum(merged.order, 0);
            merged.published = toBool(merged.published, true);
            db.categories[idx] = merged;
            await saveDb(env, db);
            return json(merged);
          }

          if (method === 'DELETE') {
            db.categories.splice(idx, 1);
            await saveDb(env, db);
            return json({ ok: true });
          }
        }

        // ---- apps ----
        if (method === 'GET' && pathname === '/api/admin/apps') {
          return json({ items: db.apps || [] });
        }

        if (method === 'POST' && pathname === '/api/admin/apps') {
          const body = await readBody(request);
          if (!body.name || !String(body.name).trim()) {
            return json({ error: 'اسم التطبيق مطلوب' }, 400);
          }
          const now = new Date().toISOString();
          let id = body.id ? String(body.id).trim() : `app_${Date.now()}`;
          if ((db.apps || []).some(a => a.id === id)) {
            return json({ error: 'معرّف التطبيق مستخدم مسبقاً' }, 409);
          }
          const app = normalizeApp(body, null);
          app.id = id;
          app.createdAt = now;
          app.updatedAt = now;

          db.apps = db.apps || [];
          db.apps.push(app);

          db.versions = db.versions || [];
          db.versions.push({
            id: `ver_${Date.now()}`,
            appId: app.id,
            versionName: app.versionName,
            versionCode: app.versionCode,
            apkUrl: app.apkUrl,
            sha256: app.sha256,
            sizeBytes: app.sizeBytes,
            changelog: body.changelog || '',
            createdAt: now
          });

          await saveDb(env, db);
          return json(app, 201);
        }

        const adminAppMatch = /^\/api\/admin\/apps\/([^/]+)$/.exec(pathname);
        if (adminAppMatch) {
          const id = decodeURIComponent(adminAppMatch[1]);
          const idx = findAppIndex(db, id);
          if (idx === -1) return notFound();

          if (method === 'GET') return json(db.apps[idx]);

          if (method === 'PUT') {
            const body = await readBody(request);
            const before = db.apps[idx];
            const updated = normalizeApp(body, before);
            updated.id = id;
            db.apps[idx] = updated;

            if (body.versionName !== undefined || body.versionCode !== undefined || body.apkUrl !== undefined) {
              db.versions = db.versions || [];
              db.versions.push({
                id: `ver_${Date.now()}`,
                appId: id,
                versionName: updated.versionName,
                versionCode: updated.versionCode,
                apkUrl: updated.apkUrl,
                sha256: updated.sha256,
                sizeBytes: updated.sizeBytes,
                changelog: body.changelog || '',
                createdAt: new Date().toISOString()
              });
            }
            await saveDb(env, db);
            return json(updated);
          }

          if (method === 'DELETE') {
            db.apps.splice(idx, 1);
            await saveDb(env, db);
            return json({ ok: true });
          }
        }

        // ---- versions ----
        if (method === 'GET' && pathname === '/api/admin/versions') {
          const appId = url.searchParams.get('appId');
          const items = appId
            ? (db.versions || []).filter(v => v.appId === appId)
            : (db.versions || []);
          return json({ items });
        }

        // ---- settings ----
        if (method === 'GET' && pathname === '/api/admin/settings') {
          return json(db.settings || DEFAULT_SETTINGS);
        }

        if (method === 'PUT' && pathname === '/api/admin/settings') {
          const body = await readBody(request);
          db.settings = Object.assign({}, db.settings || DEFAULT_SETTINGS, body);
          await saveDb(env, db);
          return json(db.settings);
        }

        // ---- maintenance ----
        if (method === 'GET' && pathname === '/api/admin/backup') {
          return json({
            exportedAt: new Date().toISOString(),
            apps: db.apps || [],
            categories: db.categories || [],
            versions: db.versions || [],
            settings: db.settings || DEFAULT_SETTINGS
          }, 200, { 'Content-Disposition': 'attachment; filename="apphub-backup.json"' });
        }

        if (method === 'POST' && pathname === '/api/admin/seed') {
          db.categories = JSON.parse(JSON.stringify(DEFAULT_CATEGORIES));
          db.apps = sampleDbApps();
          db.versions = [];
          await saveDb(env, db);
          return json({ ok: true, apps: db.apps.length, categories: db.categories.length });
        }

        return notFound();
      }

      return notFound();
    } catch (err) {
      console.error('worker error', err && err.stack ? err.stack : err);
      return json({ error: 'Internal server error', message: String(err && err.message || err) }, 500);
    }
  }
};
