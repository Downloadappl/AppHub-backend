/**
 * AppLand Store API — Cloudflare Worker
 * Complete Developer Portal, Application Submission, Review & Publishing System
 *
 * Bindings (wrangler.jsonc):
 *   APPHUB  — KV namespace (JSON storage)
 *   ASSETS  — Workers Assets (serves ../admin-panel at /admin and /dev)
 *   ADMIN_USERNAME, ADMIN_PASSWORD (secret)
 *   TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID (optional)
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Admin-Token, X-Dev-Token, X-Dev-Id, X-Dev-Name',
  'Access-Control-Max-Age': '86400'
};

const DEFAULT_SETTINGS = {
  storeName: 'AppLand — آب لاند',
  welcomeMessage: 'اكتشف أفضل تطبيقات وألعاب الشاشات والتلفاز الذكي',
  storeDescription: 'متجر التطبيقات المعتمد لشاشات وأجهزة Android TV',
  telegramEnabled: false,
  telegramBotToken: '',
  telegramChatId: ''
};

const DEFAULT_SECTIONS = [
  { id: 'apps', name: 'تطبيقات عامة', icon: 'smartphone', order: 1, published: true },
  { id: 'tv_entertainment', name: 'تطبيقات التلفزيون والترفيه', icon: 'tv', order: 2, published: true },
  { id: 'games', name: 'ألعاب التلفزيون', icon: 'gamepad-2', order: 3, published: true }
];

const DEFAULT_CATEGORIES = [
  { id: 'all', sectionId: 'apps', name: 'جميع التطبيقات', icon: null, order: 0, published: true },
  { id: 'video', sectionId: 'tv_entertainment', name: 'تطبيقات المشاهدة', icon: 'tv', order: 1, published: true },
  { id: 'sports', sectionId: 'tv_entertainment', name: 'الرياضة', icon: null, order: 2, published: true },
  { id: 'tools', sectionId: 'apps', name: 'الأدوات', icon: null, order: 3, published: true },
  { id: 'ai', sectionId: 'apps', name: 'الذكاء الاصطناعي', icon: null, order: 4, published: true },
  { id: 'social', sectionId: 'apps', name: 'التواصل الاجتماعي', icon: null, order: 5, published: true },
  { id: 'tv', sectionId: 'tv_entertainment', name: 'تطبيقات التلفزيون', icon: null, order: 6, published: true },
  { id: 'games', sectionId: 'games', name: 'الألعاب', icon: null, order: 7, published: true },
  { id: 'misc', sectionId: 'apps', name: 'تطبيقات متنوعة', icon: null, order: 8, published: true }
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

function notFound(msg = 'Not found') { return json({ error: msg }, 404); }
function badRequest(msg = 'Bad request') { return json({ error: msg }, 400); }
function unauthorized(msg = 'Unauthorized') { return json({ error: msg }, 401); }
function forbidden(msg = 'Forbidden') { return json({ error: msg }, 403); }

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

const DB_KEYS = [
  'apps',
  'sections',
  'categories',
  'versions',
  'downloads',
  'admins',
  'settings',
  'sessions',
  'developers',
  'dev_sessions',
  'submissions',
  'notifications'
];

const EMPTY_DB = () => ({
  apps: [],
  sections: [],
  categories: [],
  versions: [],
  downloads: [],
  admins: [],
  settings: { ...DEFAULT_SETTINGS },
  sessions: [],
  developers: [],
  dev_sessions: [],
  submissions: [],
  notifications: []
});

async function getDb(env) {
  const values = await Promise.all(DB_KEYS.map(k => env.APPHUB.get(k)));
  const db = EMPTY_DB();
  DB_KEYS.forEach((k, i) => {
    if (values[i]) {
      try { db[k] = JSON.parse(values[i]); } catch (_) { /* keep empty */ }
    }
  });
  if (!db.developers) db.developers = [];
  if (!db.dev_sessions) db.dev_sessions = [];
  if (!db.submissions) db.submissions = [];
  if (!db.notifications) db.notifications = [];
  if (!db.sections || !db.sections.length) {
    db.sections = JSON.parse(JSON.stringify(DEFAULT_SECTIONS));
  }
  if (!db.categories || !db.categories.length) {
    db.categories = JSON.parse(JSON.stringify(DEFAULT_CATEGORIES));
  }
  // Ensure every category has a valid sectionId
  if (db.categories && db.categories.length) {
    db.categories.forEach(c => {
      if (!c.sectionId) {
        if (c.id === 'games') c.sectionId = 'games';
        else if (['video', 'sports', 'tv'].includes(c.id)) c.sectionId = 'tv_entertainment';
        else c.sectionId = 'apps';
      }
    });
  }
  return db;
}

async function saveDb(env, db) {
  await Promise.all(DB_KEYS.map(k => env.APPHUB.put(k, JSON.stringify(db[k] || []))));
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
    sectionId: o.sectionId || null,
    sectionName: o.sectionName || null,
    categoryId: o.categoryId || 'misc',
    categoryName: o.categoryName || 'تطبيقات متنوعة',
    isFeatured: toBool(o.isFeatured, false),
    isGame: toBool(o.isGame, false),
    targetType: (o.targetType || 'BOTH').toUpperCase(),
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
  return SAMPLE_APPS.map(row => {
    const catId = row[8];
    const catName = row[9];
    let secId = 'apps';
    let secName = 'تطبيقات عامة';
    if (catId === 'games') {
      secId = 'games';
      secName = 'ألعاب التلفزيون';
    } else if (['video', 'sports', 'tv'].includes(catId)) {
      secId = 'tv_entertainment';
      secName = 'تطبيقات التلفزيون والترفيه';
    }
    return mkApp({
      id: row[0], name: row[1], shortDescription: row[2], fullDescription: row[3],
      versionName: row[4], versionCode: row[5], sizeBytes: row[6], developer: row[7],
      sectionId: secId, sectionName: secName,
      categoryId: catId, categoryName: catName, isFeatured: row[10], isGame: row[11],
      targetType: row[12], downloadCount: row[13], keywords: row[14],
      createdAt: now, updatedAt: now
    });
  });
}

async function ensureSeed(env) {
  const marker = await env.APPHUB.get('seed:v2');
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

  if (!db.sections.length) db.sections = JSON.parse(JSON.stringify(DEFAULT_SECTIONS));
  if (!db.categories.length) db.categories = JSON.parse(JSON.stringify(DEFAULT_CATEGORIES));
  if (!db.apps.length) db.apps = sampleDbApps();

  await saveDb(env, db);
  await env.APPHUB.put('seed:v2', new Date().toISOString());
}

/* -------------------------------- auth ------------------------------- */

function bearerToken(request, headerName = 'authorization') {
  const auth = request.headers.get(headerName) || '';
  const m = /^Bearer\s+(.+)$/i.exec(auth.trim());
  if (m) return m[1].trim();
  const direct = (request.headers.get(headerName) || '').trim();
  if (direct && !direct.toLowerCase().startsWith('bearer ')) return direct;
  return null;
}

async function requireAdmin(request, env, db) {
  const token = bearerToken(request, 'authorization') || bearerToken(request, 'x-admin-token');
  if (!token) return { error: unauthorized('يرجى تسجيل الدخول كـ مدير') };
  const now = Date.now();
  db.sessions = (db.sessions || []).filter(s => new Date(s.expiresAt).getTime() > now);
  const session = db.sessions.find(s => s.token === token);
  if (!session) return { error: unauthorized('جلسة المدير منتهية أو غير صالحة') };
  const admin = (db.admins || []).find(a => a.id === session.adminId);
  if (!admin) return { error: unauthorized('حساب المدير غير موجود') };
  return { admin };
}

/* ----------------------- APK Link Verification & SSRF ---------------- */

function isPrivateIpOrHost(hostname) {
  const h = hostname.toLowerCase().trim();
  if (h === 'localhost' || h === '127.0.0.1' || h === '0.0.0.0' || h === '::1') return true;
  if (h.endsWith('.local') || h.endsWith('.internal') || h.endsWith('.lan') || h.endsWith('.home') || h.endsWith('.corp')) return true;

  // IPv4 Private & Reserved Ranges:
  // 10.0.0.0/8
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
  // 127.0.0.0/8
  if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
  // 169.254.0.0/16 (link-local & AWS/Cloudflare metadata)
  if (/^169\.254\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
  // 172.16.0.0/12
  const m172 = /^172\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(h);
  if (m172) {
    const sec = parseInt(m172[1], 10);
    if (sec >= 16 && sec <= 31) return true;
  }
  // 192.168.0.0/16
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
  // 0.0.0.0/8
  if (/^0\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)) return true;

  // IPv6 check
  if (h.startsWith('fe80:') || h.startsWith('fc00:') || h.startsWith('fd00:')) return true;

  return false;
}

async function verifyApkUrl(urlStr) {
  if (!urlStr || typeof urlStr !== 'string') {
    return { valid: false, error: 'رابط APK مطلوب' };
  }
  let parsed;
  try {
    parsed = new URL(urlStr.trim());
  } catch (_) {
    return { valid: false, error: 'صيغة الرابط غير صحيحة' };
  }

  // 1. Must be HTTPS
  if (parsed.protocol !== 'https:') {
    return { valid: false, error: 'يجب أن يبدأ الرابط بـ HTTPS حصراً لضمان الأمان والتوافق' };
  }

  // 2. SSRF Protection
  if (isPrivateIpOrHost(parsed.hostname)) {
    return { valid: false, error: 'غير مسموح بروابط الشبكات الداخلية أو المحلية (SSRF Protection)' };
  }

  // 3. Extension check in path or search query
  const pathLower = parsed.pathname.toLowerCase();
  const searchLower = parsed.search.toLowerCase();
  const hasApkExt = pathLower.endsWith('.apk') || pathLower.includes('.apk') || searchLower.includes('.apk');

  // 4. Remote inspection via fetch with timeout and range
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 6000);

  try {
    // Try Range GET (first 1024 bytes) to verify APK ZIP header
    let res = await fetch(urlStr, {
      method: 'GET',
      headers: {
        'User-Agent': 'AppLand-APK-Verifier/1.0',
        'Range': 'bytes=0-1023'
      },
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    // If Range was rejected (416, 403, 400), fallback to HEAD
    if (!res.ok && res.status !== 206) {
      const headController = new AbortController();
      const headTimeout = setTimeout(() => headController.abort(), 5000);
      res = await fetch(urlStr, {
        method: 'HEAD',
        headers: { 'User-Agent': 'AppLand-APK-Verifier/1.0' },
        signal: headController.signal
      });
      clearTimeout(headTimeout);
    }

    if (!res.ok && res.status !== 206) {
      return { valid: false, error: `الرابط غير متاح حالياً (رمز الاستجابة: ${res.status})` };
    }

    // SSRF re-check on final URL if redirected
    if (res.url) {
      const finalUrl = new URL(res.url);
      if (finalUrl.protocol !== 'https:' || isPrivateIpOrHost(finalUrl.hostname)) {
        return { valid: false, error: 'تم توجيه الرابط إلى وجهة غير آمنة أو غير مسموحة' };
      }
    }

    const ct = (res.headers.get('content-type') || '').toLowerCase();
    const cl = res.headers.get('content-length') || res.headers.get('content-range');

    // Reject HTML/login pages
    if (ct.includes('text/html') || ct.includes('application/xhtml+xml')) {
      return { valid: false, error: 'الرابط يعيد صفحة ويب عادية (HTML) وليس ملف APK قابل للتحميل المباشر' };
    }

    let detectedSize = 0;
    if (cl) {
      const sizeMatch = /\/(\d+)$/.exec(cl) || /^(\d+)$/.exec(cl);
      if (sizeMatch) detectedSize = parseInt(sizeMatch[1], 10);
    }

    // Check APK Magic Number (PK\x03\x04 = 0x50, 0x4B, 0x03, 0x04)
    let isZipMagic = false;
    try {
      if (res.body && typeof res.arrayBuffer === 'function') {
        const buf = await res.arrayBuffer();
        if (buf && buf.byteLength >= 4) {
          const bytes = new Uint8Array(buf);
          if (bytes[0] === 0x50 && bytes[1] === 0x4B && bytes[2] === 0x03 && bytes[3] === 0x04) {
            isZipMagic = true;
          }
        }
      }
    } catch (_) {
      // Body consumption may fail if already streamed
    }

    if (!hasApkExt && !isZipMagic && !ct.includes('vnd.android.package-archive')) {
      return { valid: false, error: 'الملف لا يبدو أنه حزمة أندرويد حقيقية (APK signature mismatch)' };
    }

    return {
      valid: true,
      sizeBytes: detectedSize || null,
      contentType: ct || 'application/vnd.android.package-archive',
      magicVerified: isZipMagic
    };
  } catch (err) {
    clearTimeout(timeoutId);
    if (err && err.name === 'AbortError') {
      return { valid: false, error: 'انتهت مهلة الاتصال بالرابط (تأكد من سرعة الخادم المستضيف للملف)' };
    }
    return { valid: false, error: `فشل التحقق من الرابط: ${err.message || 'خطأ اتصال'}` };
  }
}

/* ----------------------- Telegram Notification Helper ---------------- */

async function sendTelegramNotification(env, db, text) {
  try {
    const token = env.TELEGRAM_BOT_TOKEN || db.settings?.telegramBotToken;
    const chatId = env.TELEGRAM_CHAT_ID || db.settings?.telegramChatId;
    const enabled = env.TELEGRAM_ENABLED !== undefined
      ? toBool(env.TELEGRAM_ENABLED)
      : toBool(db.settings?.telegramEnabled, false);

    if (!token || !chatId || !enabled) return false;

    const tgUrl = `https://api.telegram.org/bot${token}/sendMessage`;
    const res = await fetch(tgUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true
      })
    });
    return res.ok;
  } catch (err) {
    console.error('Telegram notification error (ignored):', err);
    return false;
  }
}

function sendDevNotification(db, devId, submissionId, title, message, type = 'info') {
  db.notifications = db.notifications || [];
  const notif = {
    id: `notif_${Date.now()}_${crypto.randomUUID().slice(0, 6)}`,
    devId,
    submissionId: submissionId || null,
    title,
    message,
    type, // 'info', 'success', 'warning', 'danger'
    read: false,
    createdAt: new Date().toISOString()
  };
  db.notifications.unshift(notif);
  if (db.notifications.length > 5000) db.notifications = db.notifications.slice(0, 5000);
  return notif;
}

function generateReqNumber(db) {
  const year = new Date().getFullYear();
  const count = (db.submissions || []).length + 1;
  return `REQ-${year}-${String(count).padStart(4, '0')}`;
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

  const subs = db.submissions || [];
  const pendingSubmissions = subs.filter(s => s.status === 'pending' || s.status === 'in_review').length;

  return {
    totalApps: apps.length,
    totalGames: games.length,
    totalDownloads,
    totalSections: (db.sections || []).length,
    totalCategories: (db.categories || []).length,
    pendingSubmissions,
    totalDevelopers: (db.developers || []).length,
    topApps: top,
    latestApps: latest
  };
}

function normalizeSection(body) {
  return {
    id: body.id || `sec_${Date.now()}`,
    name: (body.name || 'قسم جديد').toString(),
    icon: body.icon || 'folder',
    order: toNum(body.order, 0),
    published: toBool(body.published, true)
  };
}

function normalizeCategory(body, defaultSectionId = 'apps') {
  return {
    id: body.id || `cat_${Date.now()}`,
    sectionId: body.sectionId || defaultSectionId,
    name: (body.name || 'فئة جديدة').toString(),
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
      // 1. Static asset rewrites:
      // Redirect /admin -> /admin/
      if (method === 'GET' && pathname === '/admin') {
        return new Response(null, { status: 301, headers: Object.assign({ Location: '/admin/' }, CORS) });
      }
      // Redirect /dev -> /dev/
      if (method === 'GET' && pathname === '/dev') {
        return new Response(null, { status: 301, headers: Object.assign({ Location: '/dev/' }, CORS) });
      }

      // Serve Admin Panel static assets (/admin/*)
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

      // Serve Developer Portal static assets (/dev/*)
      if ((method === 'GET' || method === 'HEAD') && (pathname === '/dev/' || pathname.startsWith('/dev/'))) {
        if (env.ASSETS) {
          const rest = pathname.replace(/^\/dev\/?/, '');
          const assetPath = '/dev/' + (rest === '' ? 'index.html' : rest);
          const assetRes = await env.ASSETS.fetch(new Request(new URL(assetPath, url.origin).toString(), request));
          if (assetRes.status !== 404) return assetRes;
        }
      }

      // Serve fallback from assets if requested at root non-API paths
      if (method === 'GET' && !pathname.startsWith('/api/') && env.ASSETS) {
        const assetRes = await env.ASSETS.fetch(new Request(url.toString(), request));
        if (assetRes.status !== 404) return assetRes;
      }

      // Root landing
      if (method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
        return json({
          name: 'AppLand Store API',
          title: 'متجر آب لاند — خادم النظام',
          ok: true,
          runtime: 'cloudflare-worker',
          admin: '/admin/',
          developers: '/dev/',
          health: '/api/health'
        });
      }

      if (method === 'GET' && pathname === '/api/health') {
        return json({
          ok: true,
          service: 'appland-backend',
          name: 'AppLand API',
          runtime: 'cloudflare-worker',
          time: new Date().toISOString()
        });
      }

      await ensureSeed(env);
      const db = await getDb(env);

      /* ==================================================================== */
      /*                              PUBLIC API                              */
      /* ==================================================================== */

      if (method === 'GET' && pathname === '/api/settings') {
        return json(db.settings || DEFAULT_SETTINGS);
      }

      if (method === 'GET' && pathname === '/api/sections') {
        const secs = [...(db.sections || [])]
          .filter(s => toBool(s.published, true))
          .sort((a, b) => toNum(a.order, 0) - toNum(b.order, 0));
        return json({ items: secs });
      }

      if (method === 'GET' && pathname === '/api/categories') {
        const sectionId = url.searchParams.get('sectionId');
        let cats = [...(db.categories || [])].filter(c => toBool(c.published, true));
        if (sectionId) {
          cats = cats.filter(c => c.sectionId === sectionId);
        }
        cats.sort((a, b) => toNum(a.order, 0) - toNum(b.order, 0));
        return json({ items: cats });
      }

      if (method === 'GET' && pathname === '/api/options') {
        const sections = [...(db.sections || [])]
          .filter(s => toBool(s.published, true))
          .sort((a, b) => toNum(a.order, 0) - toNum(b.order, 0));
        const categories = [...(db.categories || [])]
          .filter(c => toBool(c.published, true))
          .sort((a, b) => toNum(a.order, 0) - toNum(b.order, 0));
        return json({
          sections,
          categories,
          targetTypes: [
            { id: 'TV', name: 'Android TV (مخصص للشاشات وأجهزة التلفزيون)', hint: 'الواجهة مخصصة للتحكم بالريموت كونترول' },
            { id: 'BOTH', name: 'Both (متوافق مع الشاشات والهواتف)', hint: 'يعمل بسلاسة على التلفاز والهاتف الذكي' },
            { id: 'PHONE', name: 'Android Phone (هواتف فقط)', hint: 'مخصص للهواتف والأجهزة اللوحية' }
          ]
        });
      }

      if (method === 'GET' && pathname === '/api/apps') {
        const q = (url.searchParams.get('q') || '').toLowerCase().trim();
        const category = url.searchParams.get('category');
        const section = url.searchParams.get('section');
        const featured = url.searchParams.get('featured');
        const game = url.searchParams.get('game');
        const sort = url.searchParams.get('sort');
        const targetType = url.searchParams.get('targetType');
        const limit = toNum(url.searchParams.get('limit'), 0);
        const offset = toNum(url.searchParams.get('offset'), 0);

        let apps = (db.apps || []).filter(a => toBool(a.published, true));

        // Filter by device target (TV / PHONE / BOTH)
        if (targetType) {
          const t = targetType.toUpperCase();
          apps = apps.filter(a => a.targetType === t || a.targetType === 'BOTH');
        }

        if (section && section !== 'all') {
          apps = apps.filter(a => a.sectionId === section);
        }

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

      /* ==================================================================== */
      /*                      DEVELOPER PORTAL API (/api/dev/*)               */
      /* ==================================================================== */

      // 1. Verify APK link (HTTPS & SSRF protected)
      if (method === 'POST' && pathname === '/api/dev/verify-apk') {
        const body = await readBody(request);
        const result = await verifyApkUrl(body.url || body.apkUrl);
        return json(result);
      }

      // 2. List developer's submissions (filtered by devId or ids or devName)
      if (method === 'GET' && pathname === '/api/dev/submissions') {
        const devId = url.searchParams.get('devId');
        const ids = url.searchParams.get('ids');
        const devName = url.searchParams.get('devName');
        const status = url.searchParams.get('status');

        let items = db.submissions || [];
        if (devId) {
          items = items.filter(s => s.devId === devId);
        } else if (ids) {
          const idList = ids.split(',').map(s => s.trim());
          items = items.filter(s => idList.includes(s.id) || idList.includes(s.reqNumber));
        } else if (devName) {
          items = items.filter(s => (s.devName || s.developer || '').toLowerCase() === devName.toLowerCase());
        } else {
          // If no filter, return empty array to prevent exposing other developers' pending submissions
          items = [];
        }

        if (status && status !== 'all') {
          items = items.filter(s => s.status === status);
        }
        items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        return json({ items });
      }

      // 3. Create new application submission (No login required; saves developer name)
      if (method === 'POST' && pathname === '/api/dev/submissions') {
        const body = await readBody(request);

        const devName = String(body.developerName || body.devName || body.developer || '').trim();
        if (!devName) return badRequest('اسم المطور مطلوب');
        if (!body.name || !String(body.name).trim()) return badRequest('اسم التطبيق مطلوب');
        if (!body.iconUrl || !String(body.iconUrl).trim()) return badRequest('أيقونة التطبيق مطلوبة');
        if (!body.apkUrl || !String(body.apkUrl).trim()) return badRequest('رابط APK المباشر مطلوب');

        const categoryId = body.categoryId || 'misc';
        const category = (db.categories || []).find(c => c.id === categoryId) || { id: 'misc', name: 'تطبيقات متنوعة', sectionId: 'apps' };

        let section = null;
        if (body.sectionId) {
          section = (db.sections || []).find(s => s.id === body.sectionId);
        }
        if (!section && category.sectionId) {
          section = (db.sections || []).find(s => s.id === category.sectionId);
        }
        if (!section) {
          section = (db.sections || [])[0] || { id: 'apps', name: 'تطبيقات عامة' };
        }

        // Verify APK link
        const verification = await verifyApkUrl(body.apkUrl);
        if (!verification.valid) {
          return badRequest(`فشل التحقق من رابط APK: ${verification.error}`);
        }

        let screenshots = [];
        if (Array.isArray(body.screenshots)) {
          screenshots = body.screenshots.map(s => String(s).trim()).filter(Boolean).slice(0, 5);
        } else if (typeof body.screenshots === 'string') {
          screenshots = body.screenshots.split(/[\r\n,]+/).map(s => s.trim()).filter(Boolean).slice(0, 5);
        }
        if (screenshots.length === 0 && body.screenshot) screenshots.push(String(body.screenshot).trim());

        const now = new Date().toISOString();
        const reqNumber = generateReqNumber(db);
        const devId = String(body.developerId || body.devId || ('dev_' + crypto.randomUUID().slice(0, 8)));

        const sub = {
          id: `sub_${Date.now()}_${crypto.randomUUID().slice(0, 6)}`,
          reqNumber,
          devId,
          devName,
          developer: devName,
          name: String(body.name).trim(),
          packageName: body.packageName || `com.${devName.toLowerCase().replace(/[^a-z0-9]/g, '') || 'app'}.${String(body.name).toLowerCase().replace(/[^a-z0-9]/g, '')}`,
          versionName: body.versionName || '1.0.0',
          versionCode: toNum(body.versionCode, 1),
          sizeBytes: toNum(body.sizeBytes || verification.sizeBytes, 0),
          iconUrl: String(body.iconUrl).trim(),
          screenshots,
          apkUrl: body.apkUrl.trim(),
          targetType: (body.targetType || 'TV').toUpperCase(),
          sectionId: section.id,
          sectionName: section.name,
          categoryId: category.id,
          categoryName: category.name,
          shortDescription: body.shortDescription || '',
          fullDescription: body.fullDescription || body.shortDescription || '',
          status: 'pending', // Strictly pending! Developer cannot approve or publish
          adminNotes: null,
          rejectionReason: null,
          reviewedBy: null,
          reviewedAt: null,
          publishedAppId: null,
          apkVerification: verification,
          createdAt: now,
          updatedAt: now
        };

        db.submissions = db.submissions || [];
        db.submissions.unshift(sub);

        // Telegram notification to Admin if configured
        await sendTelegramNotification(
          env,
          db,
          `📥 <b>طلب تطبيق جديد في AppLand</b>\n\n` +
          `📱 <b>التطبيق:</b> ${sub.name}\n` +
          `👤 <b>المطور:</b> ${sub.devName}\n` +
          `🔖 <b>رقم الطلب:</b> <code>${sub.reqNumber}</code>\n` +
          `📺 <b>الجهاز المستهدف:</b> ${sub.targetType}\n` +
          `📂 <b>القسم:</b> ${sub.sectionName} — ${sub.categoryName}\n\n` +
          `🔗 راجع الطلب في لوحة الإدارة`
        );

        await saveDb(env, db);
        return json(sub, 201);
      }

      // 4. Details and resubmission of specific submission
      const devSubMatch = /^\/api\/dev\/submissions\/([^/]+)$/.exec(pathname);
      if (devSubMatch) {
        const id = decodeURIComponent(devSubMatch[1]);
        const sub = (db.submissions || []).find(s => s.id === id || s.reqNumber === id);
        if (!sub) return notFound('الطلب غير موجود');

        if (method === 'GET') {
          return json(sub);
        }

        // Edit submission (only allowed if pending or changes_requested)
        if (method === 'PUT') {
          if (sub.status !== 'pending' && sub.status !== 'changes_requested') {
            return badRequest('لا يمكن تعديل هذا الطلب في حالته الحالية');
          }

          const body = await readBody(request);
          if (body.developerName || body.devName || body.developer) {
            const newDev = String(body.developerName || body.devName || body.developer).trim();
            if (newDev) {
              sub.devName = newDev;
              sub.developer = newDev;
            }
          }
          if (body.name) sub.name = String(body.name).trim();
          if (body.iconUrl) sub.iconUrl = String(body.iconUrl).trim();
          if (body.screenshots) {
            sub.screenshots = (Array.isArray(body.screenshots) ? body.screenshots : splitList(body.screenshots)).map(s => String(s).trim()).filter(Boolean).slice(0, 5);
          }
          if (body.shortDescription !== undefined) sub.shortDescription = body.shortDescription;
          if (body.fullDescription !== undefined) sub.fullDescription = body.fullDescription;
          if (body.targetType) sub.targetType = body.targetType.toUpperCase();
          if (body.versionName) sub.versionName = body.versionName;
          if (body.versionCode) sub.versionCode = toNum(body.versionCode, sub.versionCode);
          if (body.sizeBytes) sub.sizeBytes = toNum(body.sizeBytes, sub.sizeBytes);
          if (body.sectionId) {
            const sec = (db.sections || []).find(s => s.id === body.sectionId);
            if (sec) {
              sub.sectionId = sec.id;
              sub.sectionName = sec.name;
            }
          }
          if (body.categoryId) {
            const cat = (db.categories || []).find(c => c.id === body.categoryId);
            if (cat) {
              sub.categoryId = cat.id;
              sub.categoryName = cat.name;
              if (!sub.sectionId && cat.sectionId) {
                const sec = (db.sections || []).find(s => s.id === cat.sectionId);
                if (sec) {
                  sub.sectionId = sec.id;
                  sub.sectionName = sec.name;
                }
              }
            }
          }

          if (body.apkUrl && body.apkUrl !== sub.apkUrl) {
            const verification = await verifyApkUrl(body.apkUrl);
            if (!verification.valid) return badRequest(`فشل التحقق من رابط APK الجديد: ${verification.error}`);
            sub.apkUrl = body.apkUrl.trim();
            sub.apkVerification = verification;
          }

          // Security check: Developer cannot set status to 'approved' or 'rejected'!
          // If status was changes_requested, putting it back to pending
          if (sub.status === 'changes_requested') {
            sub.status = 'pending';
            sub.adminNotes = null;
          }

          sub.updatedAt = new Date().toISOString();
          await saveDb(env, db);
          return json(sub);
        }
      }

      /* ==================================================================== */
      /*                         ADMIN PANEL API (/api/admin/*)               */
      /* ==================================================================== */

      if (pathname.startsWith('/api/admin/')) {
        // Admin Login
        if (method === 'POST' && pathname === '/api/admin/login') {
          const body = await readBody(request);
          const username = (body.username || '').trim();
          const password = body.password || '';

          const admin = (db.admins || []).find(a => a.username === username);
          if (!admin) return unauthorized('اسم المستخدم أو كلمة المرور غير صحيحة');

          const computedHash = await hashPassword(password, admin.salt);
          if (!safeEqual(computedHash, admin.passwordHash)) {
            return unauthorized('اسم المستخدم أو كلمة المرور غير صحيحة');
          }

          const token = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
          const expiresAt = new Date(Date.now() + 14 * 24 * 3600 * 1000).toISOString();
          db.sessions = db.sessions || [];
          db.sessions.push({ token, adminId: admin.id, createdAt: new Date().toISOString(), expiresAt });
          await saveDb(env, db);

          return json({
            token,
            admin: { id: admin.id, username: admin.username, role: admin.role }
          });
        }

        // Admin Logout
        if (method === 'POST' && pathname === '/api/admin/logout') {
          const token = bearerToken(request, 'authorization') || bearerToken(request, 'x-admin-token');
          if (token) {
            db.sessions = (db.sessions || []).filter(s => s.token !== token);
            await saveDb(env, db);
          }
          return json({ ok: true });
        }

        // Authenticated Admin Guard
        const adminAuth = await requireAdmin(request, env, db);
        if (adminAuth.error) return adminAuth.error;
        const currentAdmin = adminAuth.admin;

        if (method === 'GET' && pathname === '/api/admin/me') {
          return json({ id: currentAdmin.id, username: currentAdmin.username, role: currentAdmin.role });
        }

        // ---- DEVELOPER SUBMISSIONS (ADMIN) ----

        if (method === 'GET' && pathname === '/api/admin/submissions/stats') {
          const subs = db.submissions || [];
          return json({
            total: subs.length,
            pending: subs.filter(s => s.status === 'pending').length,
            in_review: subs.filter(s => s.status === 'in_review').length,
            changes_requested: subs.filter(s => s.status === 'changes_requested').length,
            approved: subs.filter(s => s.status === 'approved').length,
            rejected: subs.filter(s => s.status === 'rejected').length
          });
        }

        if (method === 'GET' && pathname === '/api/admin/submissions') {
          const status = url.searchParams.get('status');
          const q = (url.searchParams.get('q') || '').toLowerCase().trim();
          const sort = url.searchParams.get('sort'); // 'newest' | 'oldest'

          let items = [...(db.submissions || [])];

          if (status && status !== 'all') {
            items = items.filter(s => s.status === status);
          }

          if (q) {
            items = items.filter(s => [
              s.name, s.devName, s.devEmail, s.reqNumber, s.categoryName
            ].filter(Boolean).join(' ').toLowerCase().includes(q));
          }

          if (sort === 'oldest') {
            items.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
          } else {
            items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
          }

          return json({ items, total: items.length });
        }

        // Specific Submission review actions
        const adminSubMatch = /^\/api\/admin\/submissions\/([^/]+)$/.exec(pathname);
        if (adminSubMatch) {
          const id = decodeURIComponent(adminSubMatch[1]);
          const sub = (db.submissions || []).find(s => s.id === id);
          if (!sub) return notFound('طلب المطور غير موجود');

          if (method === 'GET') {
            return json(sub);
          }

          // Admin update details before publish
          if (method === 'PUT') {
            const body = await readBody(request);
            if (body.name) sub.name = String(body.name).trim();
            if (body.shortDescription !== undefined) sub.shortDescription = body.shortDescription;
            if (body.fullDescription !== undefined) sub.fullDescription = body.fullDescription;
            if (body.targetType) sub.targetType = body.targetType.toUpperCase();
            if (body.versionName) sub.versionName = body.versionName;
            if (body.versionCode) sub.versionCode = toNum(body.versionCode, sub.versionCode);
            if (body.sizeBytes) sub.sizeBytes = toNum(body.sizeBytes, sub.sizeBytes);
            if (body.apkUrl) sub.apkUrl = body.apkUrl.trim();
            if (body.categoryId) {
              const cat = (db.categories || []).find(c => c.id === body.categoryId);
              if (cat) {
                sub.categoryId = cat.id;
                sub.categoryName = cat.name;
              }
            }
            if (body.status && ['pending', 'in_review', 'changes_requested', 'approved', 'rejected'].includes(body.status)) {
              sub.status = body.status;
            }
            sub.updatedAt = new Date().toISOString();
            await saveDb(env, db);
            return json(sub);
          }
        }

        // Approve and Publish application
        const approveMatch = /^\/api\/admin\/submissions\/([^/]+)\/approve$/.exec(pathname);
        if (method === 'POST' && approveMatch) {
          const id = decodeURIComponent(approveMatch[1]);
          const sub = (db.submissions || []).find(s => s.id === id);
          if (!sub) return notFound('الطلب غير موجود');

          // Idempotency: prevent double publish
          if (sub.status === 'approved' && sub.publishedAppId && (db.apps || []).some(a => a.id === sub.publishedAppId)) {
            return json({ error: 'تم نشر هذا التطبيق مسبقاً بنجاح', appId: sub.publishedAppId }, 409);
          }

          const body = await readBody(request);
          const now = new Date().toISOString();

          // Create app entry in public store
          const appId = sub.publishedAppId || `app_${Date.now()}`;
          const isGame = toBool(body.isGame !== undefined ? body.isGame : (sub.sectionId === 'games' || sub.categoryId === 'games'), false);
          const isFeatured = toBool(body.isFeatured !== undefined ? body.isFeatured : false, false);

          const app = normalizeApp({
            id: appId,
            name: body.name || sub.name,
            shortDescription: body.shortDescription || sub.shortDescription,
            fullDescription: body.fullDescription || sub.fullDescription,
            versionName: body.versionName || sub.versionName,
            versionCode: toNum(body.versionCode || sub.versionCode, 1),
            sizeBytes: toNum(body.sizeBytes || sub.sizeBytes, 0),
            developer: body.developer || sub.developer || sub.devName,
            iconUrl: body.iconUrl || sub.iconUrl,
            screenshots: body.screenshots || sub.screenshots,
            apkUrl: (body.apkUrl || sub.apkUrl).trim(),
            packageName: body.packageName || sub.packageName,
            sectionId: body.sectionId || sub.sectionId,
            sectionName: body.sectionName || sub.sectionName,
            categoryId: body.categoryId || sub.categoryId,
            categoryName: body.categoryName || sub.categoryName,
            targetType: (body.targetType || sub.targetType || 'TV').toUpperCase(),
            isFeatured,
            isGame,
            published: true,
            downloadCount: 0
          }, null);

          app.createdAt = now;
          app.updatedAt = now;

          db.apps = db.apps || [];
          const existingAppIdx = db.apps.findIndex(a => a.id === app.id);
          if (existingAppIdx !== -1) {
            db.apps[existingAppIdx] = app;
          } else {
            db.apps.push(app);
          }

          // Record version
          db.versions = db.versions || [];
          db.versions.push({
            id: `ver_${Date.now()}`,
            appId: app.id,
            versionName: app.versionName,
            versionCode: app.versionCode,
            apkUrl: app.apkUrl,
            sha256: null,
            sizeBytes: app.sizeBytes,
            changelog: 'الإصدار الأول المنشور عبر بوابة المطورين',
            createdAt: now
          });

          // Update submission status
          sub.status = 'approved';
          sub.publishedAppId = app.id;
          sub.reviewedBy = currentAdmin.username;
          sub.reviewedAt = now;
          sub.updatedAt = now;

          // Notify Developer
          sendDevNotification(
            db,
            sub.devId,
            sub.id,
            'تمت الموافقة على تطبيقك ونشره! 🎉',
            `تهانينا! تمت مراجعة تطبيقك (${sub.name}) والموافقة عليه ونشره رسمياً في متجر آب لاند لشاشات Android TV.`,
            'success'
          );

          await saveDb(env, db);

          return json({
            ok: true,
            message: 'تمت الموافقة على التطبيق ونشره في المتجر بنجاح',
            app,
            submission: sub
          });
        }

        // Request changes from developer
        const requestChangesMatch = /^\/api\/admin\/submissions\/([^/]+)\/request-changes$/.exec(pathname);
        if (method === 'POST' && requestChangesMatch) {
          const id = decodeURIComponent(requestChangesMatch[1]);
          const sub = (db.submissions || []).find(s => s.id === id);
          if (!sub) return notFound('الطلب غير موجود');

          const body = await readBody(request);
          const notes = String(body.notes || body.reason || '').trim();
          if (!notes) return badRequest('يرجى كتابة ملاحظات التعديل للمطور');

          const now = new Date().toISOString();
          sub.status = 'changes_requested';
          sub.adminNotes = notes;
          sub.reviewedBy = currentAdmin.username;
          sub.reviewedAt = now;
          sub.updatedAt = now;

          sendDevNotification(
            db,
            sub.devId,
            sub.id,
            'طلبك يحتاج إلى تعديل ⚠️',
            `طلب المشرف تعديلات على تطبيق (${sub.name}): ${notes}. يرجى التعديل من لوحة المطور وإعادة الإرسال.`,
            'warning'
          );

          await saveDb(env, db);
          return json({ ok: true, submission: sub });
        }

        // Reject submission
        const rejectMatch = /^\/api\/admin\/submissions\/([^/]+)\/reject$/.exec(pathname);
        if (method === 'POST' && rejectMatch) {
          const id = decodeURIComponent(rejectMatch[1]);
          const sub = (db.submissions || []).find(s => s.id === id);
          if (!sub) return notFound('الطلب غير موجود');

          const body = await readBody(request);
          const reason = String(body.reason || body.notes || '').trim();
          if (!reason) return badRequest('يرجى تحديد سبب الرفض');

          const now = new Date().toISOString();
          sub.status = 'rejected';
          sub.rejectionReason = reason;
          sub.reviewedBy = currentAdmin.username;
          sub.reviewedAt = now;
          sub.updatedAt = now;

          sendDevNotification(
            db,
            sub.devId,
            sub.id,
            'تم رفض طلب نشر التطبيق ❌',
            `نأسف، تم رفض طلب تقديم (${sub.name}). السبب: ${reason}`,
            'danger'
          );

          await saveDb(env, db);
          return json({ ok: true, submission: sub });
        }

        // Test Telegram Integration
        if (method === 'POST' && pathname === '/api/admin/telegram/test') {
          const ok = await sendTelegramNotification(
            env,
            db,
            '🔔 <b>رسالة اختبار من متجر AppLand</b>\n\nنظام الإشعارات عبر تيليجرام يعمل بنجاح!'
          );
          return json({ ok, message: ok ? 'تم إرسال الرسالة بنجاح' : 'تعذر الإرسال، تأكد من صحة التوكن ومعرف الشات' });
        }

        // ---- APPS (ADMIN) ----
        if (method === 'GET' && pathname === '/api/admin/apps') {
          return json({ items: db.apps || [] });
        }

        if (method === 'POST' && pathname === '/api/admin/apps') {
          const body = await readBody(request);
          if (!body.name || !String(body.name).trim()) {
            return badRequest('اسم التطبيق مطلوب');
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

        // ---- SECTIONS (ADMIN) ----
        if (method === 'GET' && pathname === '/api/admin/sections') {
          return json({ items: db.sections || [] });
        }

        if (method === 'POST' && pathname === '/api/admin/sections') {
          const body = await readBody(request);
          if (!body.name || !String(body.name).trim()) return badRequest('اسم القسم مطلوب');
          let id = body.id ? String(body.id).trim() : `sec_${Date.now()}`;
          if ((db.sections || []).some(s => s.id === id)) {
            return json({ error: 'معرّف القسم مستخدم مسبقاً' }, 409);
          }
          const sec = normalizeSection(Object.assign({}, body, { id }));
          db.sections = db.sections || [];
          db.sections.push(sec);
          await saveDb(env, db);
          return json(sec, 201);
        }

        const adminSecMatch = /^\/api\/admin\/sections\/([^/]+)$/.exec(pathname);
        if (adminSecMatch) {
          const id = decodeURIComponent(adminSecMatch[1]);
          const idx = (db.sections || []).findIndex(s => s.id === id);
          if (idx === -1) return notFound('القسم غير موجود');

          if (method === 'GET') return json(db.sections[idx]);

          if (method === 'PUT') {
            const body = await readBody(request);
            const before = db.sections[idx];
            const updated = Object.assign({}, before, {
              name: body.name !== undefined ? String(body.name).trim() : before.name,
              icon: body.icon !== undefined ? body.icon : before.icon,
              order: body.order !== undefined ? toNum(body.order, before.order) : before.order,
              published: body.published !== undefined ? toBool(body.published, before.published) : before.published
            });
            db.sections[idx] = updated;

            // Update sectionName in any categories referencing this section
            if (db.categories && before.name !== updated.name) {
              db.categories.forEach(c => {
                if (c.sectionId === id) c.sectionName = updated.name;
              });
            }

            await saveDb(env, db);
            return json(updated);
          }

          if (method === 'DELETE') {
            db.sections.splice(idx, 1);
            await saveDb(env, db);
            return json({ ok: true, deleted: id });
          }
        }

        // ---- CATEGORIES (ADMIN) ----
        if (method === 'GET' && pathname === '/api/admin/categories') {
          return json({ items: db.categories || [] });
        }

        if (method === 'POST' && pathname === '/api/admin/categories') {
          const body = await readBody(request);
          if (!body.name || !String(body.name).trim()) return badRequest('اسم الفئة مطلوب');
          let id = body.id ? String(body.id).trim() : `cat_${Date.now()}`;
          if ((db.categories || []).some(c => c.id === id)) {
            return json({ error: 'معرّف الفئة مستخدم مسبقاً' }, 409);
          }
          const defaultSecId = (db.sections && db.sections[0] ? db.sections[0].id : 'apps');
          const cat = normalizeCategory(Object.assign({}, body, { id }), defaultSecId);
          db.categories = db.categories || [];
          db.categories.push(cat);
          await saveDb(env, db);
          return json(cat, 201);
        }

        const adminCatMatch = /^\/api\/admin\/categories\/([^/]+)$/.exec(pathname);
        if (adminCatMatch) {
          const id = decodeURIComponent(adminCatMatch[1]);
          const idx = (db.categories || []).findIndex(c => c.id === id);
          if (idx === -1) return notFound();

          if (method === 'GET') return json(db.categories[idx]);

          if (method === 'PUT') {
            const body = await readBody(request);
            const before = db.categories[idx];
            const updated = Object.assign({}, before, {
              sectionId: body.sectionId !== undefined ? body.sectionId : before.sectionId,
              name: body.name !== undefined ? String(body.name).trim() : before.name,
              icon: body.icon !== undefined ? body.icon : before.icon,
              order: body.order !== undefined ? toNum(body.order, before.order) : before.order,
              published: body.published !== undefined ? toBool(body.published, before.published) : before.published
            });
            db.categories[idx] = updated;
            await saveDb(env, db);
            return json(updated);
          }

          if (method === 'DELETE') {
            db.categories.splice(idx, 1);
            await saveDb(env, db);
            return json({ ok: true });
          }
        }

        // ---- VERSIONS ----
        if (method === 'GET' && pathname === '/api/admin/versions') {
          const appId = url.searchParams.get('appId');
          const items = appId
            ? (db.versions || []).filter(v => v.appId === appId)
            : (db.versions || []);
          return json({ items });
        }

        // ---- SETTINGS ----
        if (method === 'GET' && pathname === '/api/admin/settings') {
          return json(db.settings || DEFAULT_SETTINGS);
        }

        if (method === 'PUT' && pathname === '/api/admin/settings') {
          const body = await readBody(request);
          db.settings = Object.assign({}, db.settings || DEFAULT_SETTINGS, body);
          await saveDb(env, db);
          return json(db.settings);
        }

        // ---- BACKUP & MAINTENANCE ----
        if (method === 'GET' && pathname === '/api/admin/backup') {
          return json({
            exportedAt: new Date().toISOString(),
            apps: db.apps || [],
            sections: db.sections || [],
            categories: db.categories || [],
            versions: db.versions || [],
            submissions: db.submissions || [],
            developers: (db.developers || []).map(d => ({ id: d.id, fullName: d.fullName, username: d.username, email: d.email, createdAt: d.createdAt })),
            settings: db.settings || DEFAULT_SETTINGS
          }, 200, { 'Content-Disposition': 'attachment; filename="appland-backup.json"' });
        }

        if (method === 'POST' && pathname === '/api/admin/seed') {
          db.sections = JSON.parse(JSON.stringify(DEFAULT_SECTIONS));
          db.categories = JSON.parse(JSON.stringify(DEFAULT_CATEGORIES));
          db.apps = sampleDbApps();
          db.versions = [];
          await saveDb(env, db);
          return json({ ok: true, apps: db.apps.length, sections: db.sections.length, categories: db.categories.length });
        }

        return notFound();
      }

      return notFound();
    } catch (err) {
      console.error('Worker error:', err && err.stack ? err.stack : err);
      return json({ error: 'Internal server error', message: String(err && err.message || err) }, 500);
    }
  }
};
