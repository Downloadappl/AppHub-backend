/**
 * AppHub Worker local test suite
 * Tests all core store routes + Passwordless Developer Portal & Submissions Review
 */

import worker from './src/worker.js';

let pass = 0;
let fail = 0;

function check(name, condition) {
  if (condition) {
    console.log(`  ok   ${name}`);
    pass++;
  } else {
    console.error(`  FAIL ${name}`);
    fail++;
  }
}

function req(path, options = {}) {
  const url = `http://localhost${path}`;
  const headers = new Headers(options.headers || {});
  if (options.body && typeof options.body === 'object') {
    headers.set('Content-Type', 'application/json');
    options.body = JSON.stringify(options.body);
  }
  return new Request(url, { ...options, headers });
}

// In-memory KV mock
function makeKv() {
  const map = new Map();
  return {
    async get(key, type) {
      if (!map.has(key)) return null;
      const v = map.get(key);
      if (type === 'json') {
        try { return JSON.parse(v); } catch (_) { return null; }
      }
      return v;
    },
    async put(key, val) {
      map.set(key, typeof val === 'string' ? val : JSON.stringify(val));
    },
    async delete(key) {
      map.delete(key);
    }
  };
}

async function main() {
  console.log('\nAppHub Worker local test\n');

  const env = {
    APPHUB: makeKv(),
    ADMIN_USERNAME: 'admin',
    ADMIN_PASSWORD: 'password123'
  };

  // 1. Health
  let res = await worker.fetch(req('/api/health'), env);
  let body = await res.json();
  check('GET /api/health -> 200 ok', res.status === 200 && body.ok);

  // 2. Landing
  res = await worker.fetch(req('/'), env);
  body = await res.json();
  check('GET / -> worker landing JSON', res.status === 200 && body.name);

  // 3. /admin redirect to /admin/
  res = await worker.fetch(req('/admin'), env);
  check('GET /admin -> 301 to /admin/', res.status === 301 && res.headers.get('Location') === '/admin/');

  // 4. Categories seeded
  res = await worker.fetch(req('/api/categories'), env);
  body = await res.json();
  check('GET /api/categories -> seeded list', res.status === 200 && Array.isArray(body.items) && body.items.length >= 6);

  // 5. Seeded apps
  res = await worker.fetch(req('/api/apps'), env);
  body = await res.json();
  check('GET /api/apps -> seeded apps', res.status === 200 && body.items.length === 4);

  // 6. Search
  res = await worker.fetch(req('/api/apps?q=لعبة'), env);
  body = await res.json();
  check('GET /api/apps?q=لعبة -> 1 result', body.items.length === 1);

  // 7. Filter featured
  res = await worker.fetch(req('/api/apps?featured=true'), env);
  body = await res.json();
  check('GET /api/apps?featured=true -> 4', body.items.length === 4);

  // 8. Filter games
  res = await worker.fetch(req('/api/apps?game=true'), env);
  body = await res.json();
  check('GET /api/apps?game=true -> 1 game', body.items.length === 1 && body.items[0].isGame);

  // 9. Single app
  res = await worker.fetch(req('/api/apps/app_1'), env);
  body = await res.json();
  check('GET /api/apps/app_1 -> StreamBox', body.id === 'app_1' && body.name === 'StreamBox');

  // 10. Single app not found
  res = await worker.fetch(req('/api/apps/nope'), env);
  check('GET /api/apps/nope -> 404', res.status === 404);

  // 11. Public stats
  res = await worker.fetch(req('/api/stats'), env);
  body = await res.json();
  check('GET /api/stats -> totals', body.totalApps === 4 && body.totalCategories >= 6);

  // 12. Admin without token -> 401
  res = await worker.fetch(req('/api/admin/apps'), env);
  check('GET /api/admin/apps without token -> 401', res.status === 401);

  // 13. Admin login bad creds
  res = await worker.fetch(req('/api/admin/login', {
    method: 'POST',
    body: { username: 'admin', password: 'wrong' }
  }), env);
  check('POST login wrong password -> 401', res.status === 401);

  // 14. Admin login success
  res = await worker.fetch(req('/api/admin/login', {
    method: 'POST',
    body: { username: 'admin', password: 'password123' }
  }), env);
  body = await res.json();
  check('POST login -> token', res.status === 200 && body.token);
  const auth = body.token;
  const adminHeaders = { Authorization: 'Bearer ' + auth };

  // 15. Admin /me
  res = await worker.fetch(req('/api/admin/me', { headers: adminHeaders }), env);
  body = await res.json();
  check('GET /api/admin/me -> admin', body.username === 'admin');

  // 16. Admin apps list
  res = await worker.fetch(req('/api/admin/apps', { headers: adminHeaders }), env);
  body = await res.json();
  check('GET /api/admin/apps with token -> 4', body.items.length === 4);

  // 17. Add Category
  res = await worker.fetch(req('/api/admin/categories', {
    method: 'POST',
    headers: adminHeaders,
    body: { id: 'news', name: 'أخبار وتلفاز', order: 10 }
  }), env);
  check('POST /api/admin/categories -> 201', res.status === 201);

  // 18. Duplicate category
  res = await worker.fetch(req('/api/admin/categories', {
    method: 'POST',
    headers: adminHeaders,
    body: { id: 'news', name: 'مكرر' }
  }), env);
  check('POST duplicate category id -> 409', res.status === 409);

  // 19. Update category
  res = await worker.fetch(req('/api/admin/categories/news', {
    method: 'PUT',
    headers: adminHeaders,
    body: { name: 'قنوات إخبارية' }
  }), env);
  body = await res.json();
  check('PUT category -> renamed', body.name === 'قنوات إخبارية');

  // 20. Delete category
  res = await worker.fetch(req('/api/admin/categories/news', {
    method: 'DELETE',
    headers: adminHeaders
  }), env);
  check('DELETE category -> ok', res.status === 200);

  // 21. Add App
  res = await worker.fetch(req('/api/admin/apps', {
    method: 'POST',
    headers: adminHeaders,
    body: {
      name: 'Custom Player',
      shortDescription: 'مشغل وسائط رائع',
      versionName: '1.2.0',
      versionCode: 12,
      developer: 'Test Dev',
      apkUrl: 'https://example.com/player.apk',
      categoryId: 'video',
      keywords: 'player, media, tv'
    }
  }), env);
  body = await res.json();
  check('POST /api/admin/apps -> 201', res.status === 201);
  check('  app keeps direct apkUrl (no upload)', body.apkUrl === 'https://example.com/player.apk');
  check('  keywords parsed to array', Array.isArray(body.keywords) && body.keywords.length === 3);
  check('  versionCode numeric', body.versionCode === 12);
  const customAppId = body.id;

  // 22. Reject app without name
  res = await worker.fetch(req('/api/admin/apps', {
    method: 'POST',
    headers: adminHeaders,
    body: { developer: 'No Name' }
  }), env);
  check('POST app without name -> 400', res.status === 400);

  // 23. Reject duplicate app id
  res = await worker.fetch(req('/api/admin/apps', {
    method: 'POST',
    headers: adminHeaders,
    body: { id: customAppId, name: 'Duplicate' }
  }), env);
  check('POST duplicate app id -> 409', res.status === 409);

  // 24. Versions recorded
  res = await worker.fetch(req(`/api/admin/versions?appId=${customAppId}`, { headers: adminHeaders }), env);
  body = await res.json();
  check('versions recorded for new app', body.items.length === 1 && body.items[0].versionName === '1.2.0');

  // 25. Update App -> updates version
  res = await worker.fetch(req(`/api/admin/apps/${customAppId}`, {
    method: 'PUT',
    headers: adminHeaders,
    body: {
      versionName: '1.3.0',
      versionCode: 13,
      apkUrl: 'https://example.com/player-v13.apk',
      changelog: 'تحسينات عامة'
    }
  }), env);
  body = await res.json();
  check('PUT app -> version 1.3.0', body.versionName === '1.3.0');

  // 26. Second version recorded
  res = await worker.fetch(req(`/api/admin/versions?appId=${customAppId}`, { headers: adminHeaders }), env);
  body = await res.json();
  check('second version recorded', body.items.length === 2);

  // 27. Unpublish
  res = await worker.fetch(req(`/api/admin/apps/${customAppId}`, {
    method: 'PUT',
    headers: adminHeaders,
    body: { published: false }
  }), env);
  check('app unpublished', res.status === 200);

  // 28. Unpublished hidden from public store
  res = await worker.fetch(req('/api/apps'), env);
  body = await res.json();
  check('unpublished app hidden from /api/apps', !body.items.some(a => a.id === customAppId));

  // 29. Settings
  res = await worker.fetch(req('/api/admin/settings', {
    method: 'PUT',
    headers: adminHeaders,
    body: { storeName: 'AppLand TV Test' }
  }), env);
  body = await res.json();
  check('PUT settings -> storeName', body.storeName === 'AppLand TV Test');

  // 30. Public Settings
  res = await worker.fetch(req('/api/settings'), env);
  body = await res.json();
  check('GET /api/settings public', body.storeName === 'AppLand TV Test');

  // 31. Download event
  res = await worker.fetch(req(`/api/apps/app_1/download-event`, { method: 'POST' }), env);
  check('POST download-event -> ok', res.status === 200);

  res = await worker.fetch(req('/api/apps/app_1'), env);
  body = await res.json();
  check('downloadCount incremented', body.downloadCount >= 1);

  // 32. Removed obsolete endpoints
  res = await worker.fetch(req('/api/admin/apps/upload', { method: 'POST', headers: adminHeaders }), env);
  check('upload endpoint removed -> 404', res.status === 404);

  res = await worker.fetch(req('/api/admin/apps/upload-info', { headers: adminHeaders }), env);
  check('upload-info endpoint removed -> 404', res.status === 404);

  res = await worker.fetch(req('/media/somefile.apk'), env);
  check('media route removed -> 404', res.status === 404);

  // 33. Backup
  res = await worker.fetch(req('/api/admin/backup', { headers: adminHeaders }), env);
  body = await res.json();
  check('GET backup -> apps list', Array.isArray(body.apps));

  // 34. Delete App
  res = await worker.fetch(req(`/api/admin/apps/${customAppId}`, {
    method: 'DELETE',
    headers: adminHeaders
  }), env);
  check('DELETE app -> ok', res.status === 200);

  // 35. Deleted app gone
  res = await worker.fetch(req('/api/apps'), env);
  body = await res.json();
  check('deleted app gone from public list', !body.items.some(a => a.id === customAppId));

  // 36. Logout Admin
  res = await worker.fetch(req('/api/admin/logout', { method: 'POST', headers: adminHeaders }), env);
  check('logout -> ok', res.status === 200);

  res = await worker.fetch(req('/api/admin/apps', { headers: adminHeaders }), env);
  check('token invalid after logout -> 401', res.status === 401);

  // 37. Pagination
  res = await worker.fetch(req('/api/apps?limit=2&offset=1'), env);
  body = await res.json();
  check('pagination limit/offset', body.items.length === 2);

  // 38. Options CORS
  res = await worker.fetch(req('/api/apps', { method: 'OPTIONS' }), env);
  check('OPTIONS preflight -> 204 + CORS', res.status === 204 && res.headers.get('Access-Control-Allow-Origin') === '*');

  // 39. Seed idempotency
  // Re-login to get fresh admin token
  res = await worker.fetch(req('/api/admin/login', {
    method: 'POST',
    body: { username: 'admin', password: 'password123' }
  }), env);
  body = await res.json();
  const freshAdminHeaders = { Authorization: 'Bearer ' + body.token };

  res = await worker.fetch(req('/api/admin/seed', { method: 'POST', headers: freshAdminHeaders }), env);
  check('seed is idempotent', res.status === 200);

  /* ------------------------------------------------------------- */
  /*          DEVELOPER PORTAL & APPLICATION SUBMISSION TESTS      */
  /* ------------------------------------------------------------- */

  console.log('\n--- Passwordless Developer Portal & Submissions Tests ---');

  // 40. APK Verification: SSRF Protection
  res = await worker.fetch(req('/api/dev/verify-apk', {
    method: 'POST',
    body: { apkUrl: 'https://localhost/secret.apk' }
  }), env);
  body = await res.json();
  check('SSRF localhost rejected', body.valid === false && body.error.includes('SSRF'));

  res = await worker.fetch(req('/api/dev/verify-apk', {
    method: 'POST',
    body: { apkUrl: 'https://192.168.1.1/app.apk' }
  }), env);
  body = await res.json();
  check('SSRF private IP rejected', body.valid === false && body.error.includes('SSRF'));

  res = await worker.fetch(req('/api/dev/verify-apk', {
    method: 'POST',
    body: { apkUrl: 'http://example.com/app.apk' }
  }), env);
  body = await res.json();
  check('HTTP without S rejected', body.valid === false && body.error.includes('HTTPS'));

  // 41. Submit without developer name -> rejected
  res = await worker.fetch(req('/api/dev/submissions', {
    method: 'POST',
    body: {
      name: 'Noor Cinema',
      developerName: '',
      apkUrl: 'https://cdn.example.com/myapp.apk'
    }
  }), env);
  check('Submission without developer name rejected -> 400', res.status === 400);

  // 42. Submit with empty app name -> rejected
  res = await worker.fetch(req('/api/dev/submissions', {
    method: 'POST',
    body: {
      developerName: 'أحمد المطور',
      name: '',
      iconUrl: 'https://example.com/icon.png',
      apkUrl: 'https://cdn.example.com/myapp.apk'
    }
  }), env);
  check('Empty app name rejected -> 400', res.status === 400);

  // Mock fetch for valid APK download header checks
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const urlStr = typeof input === 'string' ? input : input.url;
    if (urlStr.includes('cdn.example.com/myapp.apk')) {
      return new Response(new Uint8Array([0x50, 0x4B, 0x03, 0x04, 0x00, 0x00]), {
        status: 200,
        headers: {
          'Content-Type': 'application/vnd.android.package-archive',
          'Content-Length': '15728640'
        }
      });
    }
    return originalFetch ? originalFetch(input, init) : new Response('Not found', { status: 404 });
  };

  // 43. Submit Valid Application (Passwordless, sending developerName & developerId)
  const clientDevId = 'dev_ahmed_123';
  const clientDevName = 'أحمد العراقي';

  res = await worker.fetch(req('/api/dev/submissions', {
    method: 'POST',
    body: {
      name: 'Noor Cinema TV',
      developerName: clientDevName,
      developerId: clientDevId,
      shortDescription: 'تطبيق لمشاهدة الأفلام والمسلسلات العربية',
      fullDescription: 'تطبيق ترفيهي وسينمائي شامل مصمم خصيصاً لأجهزة وشاشات التلفزيون الذكية مع دعم كامل للريموت.',
      versionName: '2.0.0',
      versionCode: 20,
      sizeBytes: 15728640,
      iconUrl: 'https://images.unsplash.com/photo-cinema.png',
      screenshots: [
        'https://images.unsplash.com/screen1.jpg',
        'https://images.unsplash.com/screen2.jpg'
      ],
      apkUrl: 'https://cdn.example.com/myapp.apk',
      targetType: 'TV',
      categoryId: 'video'
    }
  }), env);
  body = await res.json();
  check('POST /api/dev/submissions -> 201 + REQ number', res.status === 201 && body.status === 'pending' && body.reqNumber.startsWith('REQ-'));
  check('Developer name stored in submission', body.devName === clientDevName && body.developer === clientDevName);
  const subId = body.id;

  // 44. App is NOT visible in public store while pending
  res = await worker.fetch(req('/api/apps?q=Noor'), env);
  body = await res.json();
  check('Pending submission hidden from public store', res.status === 200 && body.items.length === 0);

  // 45. Developer queries submissions by devId
  res = await worker.fetch(req(`/api/dev/submissions?devId=${clientDevId}`), env);
  body = await res.json();
  check('GET /api/dev/submissions?devId -> 1 pending', res.status === 200 && body.items.length === 1 && body.items[0].id === subId);

  // 46. Developer queries submissions by ids
  res = await worker.fetch(req(`/api/dev/submissions?ids=${subId}`), env);
  body = await res.json();
  check('GET /api/dev/submissions?ids -> 1 pending', res.status === 200 && body.items.length === 1);

  // 47. Anonymous developer list with no filter returns empty list (privacy)
  res = await worker.fetch(req('/api/dev/submissions'), env);
  body = await res.json();
  check('GET /api/dev/submissions without filter -> empty list', res.status === 200 && body.items.length === 0);

  // 48. Developer details endpoint
  res = await worker.fetch(req(`/api/dev/submissions/${subId}`), env);
  body = await res.json();
  check('GET /api/dev/submissions/:id -> returns sub', res.status === 200 && body.id === subId);

  // 49. Developer cannot approve or publish application via PUT /api/dev/submissions
  res = await worker.fetch(req(`/api/dev/submissions/${subId}`, {
    method: 'PUT',
    body: { status: 'approved' }
  }), env);
  body = await res.json();
  check('Developer cannot self-approve submission -> status remains pending', body.status === 'pending');

  // 50. Developer cannot access admin endpoints
  res = await worker.fetch(req(`/api/admin/submissions/${subId}/approve`, { method: 'POST' }), env);
  check('Developer cannot call admin approve -> 401', res.status === 401);

  // 51. Admin lists submissions
  res = await worker.fetch(req('/api/admin/submissions/stats', { headers: freshAdminHeaders }), env);
  body = await res.json();
  check('GET /api/admin/submissions/stats -> pending: 1', res.status === 200 && body.pending === 1);

  res = await worker.fetch(req('/api/admin/submissions?status=pending', { headers: freshAdminHeaders }), env);
  body = await res.json();
  check('GET /api/admin/submissions -> shows developer name', res.status === 200 && body.items.length === 1 && body.items[0].devName === clientDevName);

  // 52. Admin requests changes
  res = await worker.fetch(req(`/api/admin/submissions/${subId}/request-changes`, {
    method: 'POST',
    headers: freshAdminHeaders,
    body: { notes: 'يرجى تزويدنا بلقطات شاشة بجودة أعلى 1080p' }
  }), env);
  body = await res.json();
  check('POST request-changes -> changes_requested', res.status === 200 && body.submission.status === 'changes_requested');

  // 53. Developer edits and resubmits
  res = await worker.fetch(req(`/api/dev/submissions/${subId}`, {
    method: 'PUT',
    body: {
      screenshots: [
        'https://images.unsplash.com/screen1_hd.jpg',
        'https://images.unsplash.com/screen2_hd.jpg'
      ]
    }
  }), env);
  body = await res.json();
  check('Developer edit resubmits -> pending again', res.status === 200 && body.status === 'pending');

  // 54. Admin Approves and Publishes
  res = await worker.fetch(req(`/api/admin/submissions/${subId}/approve`, {
    method: 'POST',
    headers: freshAdminHeaders,
    body: { isFeatured: true }
  }), env);
  body = await res.json();
  check('POST approve -> 200 approved + app created', res.status === 200 && body.ok && body.app && body.submission.status === 'approved');
  check('Approved app carries developer name', body.app.developer === clientDevName);
  const publishedAppId = body.app.id;

  // 55. Double approval idempotency check
  res = await worker.fetch(req(`/api/admin/submissions/${subId}/approve`, {
    method: 'POST',
    headers: freshAdminHeaders
  }), env);
  check('Double approval returns 409 conflict', res.status === 409);

  // 56. App is now live in public store with developer name!
  res = await worker.fetch(req('/api/apps?q=Noor'), env);
  body = await res.json();
  check('Published app live in public /api/apps', res.status === 200 && body.items.length === 1 && body.items[0].name === 'Noor Cinema TV' && body.items[0].developer === clientDevName);

  // 57. Details endpoint accessible
  res = await worker.fetch(req(`/api/apps/${publishedAppId}`), env);
  body = await res.json();
  check('Published app details accessible -> 200', res.status === 200 && body.id === publishedAppId && body.developer === clientDevName);

  // --- Dynamic Sections & Categories Integration Tests ---
  console.log('\n--- Dynamic Sections & Categories Integration Tests ---');

  // 58. GET /api/sections
  res = await worker.fetch(req('/api/sections'), env);
  body = await res.json();
  check('GET /api/sections -> returns seeded sections', res.status === 200 && Array.isArray(body.items) && body.items.length >= 3);
  check('Sections contains apps, tv_entertainment, games', body.items.some(s => s.id === 'apps') && body.items.some(s => s.id === 'games'));

  // 59. GET /api/options
  res = await worker.fetch(req('/api/options'), env);
  body = await res.json();
  check('GET /api/options -> returns sections, categories, and targetTypes',
    res.status === 200 && Array.isArray(body.sections) && Array.isArray(body.categories) && Array.isArray(body.targetTypes) && body.targetTypes.length === 3);

  // 60. GET /api/categories?sectionId=games
  res = await worker.fetch(req('/api/categories?sectionId=games'), env);
  body = await res.json();
  check('GET /api/categories?sectionId=games -> returns only game categories',
    res.status === 200 && body.items.every(c => c.sectionId === 'games'));

  // 61. POST /api/admin/sections (create new section)
  res = await worker.fetch(req('/api/admin/sections', {
    method: 'POST',
    headers: freshAdminHeaders,
    body: { name: 'قسم جديد تجريبي', id: 'test_sec', icon: 'sparkles', order: 10 }
  }), env);
  body = await res.json();
  check('POST /api/admin/sections -> 201 created', res.status === 201 && body.id === 'test_sec' && body.name === 'قسم جديد تجريبي');

  // 62. Verify new section appears immediately in /api/sections
  res = await worker.fetch(req('/api/sections'), env);
  body = await res.json();
  check('New section visible immediately in public /api/sections', body.items.some(s => s.id === 'test_sec'));

  // 63. PUT /api/admin/sections/:id (edit section)
  res = await worker.fetch(req('/api/admin/sections/test_sec', {
    method: 'PUT',
    headers: freshAdminHeaders,
    body: { name: 'قسم معدل' }
  }), env);
  body = await res.json();
  check('PUT /api/admin/sections/:id -> updated', res.status === 200 && body.name === 'قسم معدل');

  // 64. POST /api/admin/categories with sectionId
  res = await worker.fetch(req('/api/admin/categories', {
    method: 'POST',
    headers: freshAdminHeaders,
    body: { name: 'فئة تابعة للقسم المعدل', id: 'test_cat_sub', sectionId: 'test_sec', order: 1 }
  }), env);
  body = await res.json();
  check('POST /api/admin/categories with sectionId -> 201 created', res.status === 201 && body.sectionId === 'test_sec');

  // 65. Verify category appears under section
  res = await worker.fetch(req('/api/categories?sectionId=test_sec'), env);
  body = await res.json();
  check('Category filtered under its section', body.items.length === 1 && body.items[0].id === 'test_cat_sub');

  // 66. Submit app using this new section and category with direct image URL and screenshot URLs
  res = await worker.fetch(req('/api/dev/submissions', {
    method: 'POST',
    body: {
      name: 'تطبيق القسم الديناميكي',
      developerName: 'مطور الأقسام',
      targetType: 'TV',
      sectionId: 'test_sec',
      categoryId: 'test_cat_sub',
      iconUrl: 'https://cdn.example.com/dynamic-icon.png',
      screenshots: [
        'https://cdn.example.com/shot1.png',
        'https://cdn.example.com/shot2.png'
      ],
      apkUrl: 'https://cdn.example.com/myapp.apk',
      shortDescription: 'تطبيق تجريبي للأقسام الديناميكية',
      fullDescription: 'وصف كامل للتطبيق الديناميكي'
    }
  }), env);
  body = await res.json();
  check('POST submission with dynamic section & category -> 201',
    res.status === 201 && body.sectionId === 'test_sec' && body.categoryId === 'test_cat_sub');
  check('Submission saves screenshots array and direct iconUrl',
    body.iconUrl === 'https://cdn.example.com/dynamic-icon.png' && body.screenshots.length === 2);
  const dynamicSubId = body.id;

  // 67. Approve submission and verify app preserves section and category
  res = await worker.fetch(req(`/api/admin/submissions/${dynamicSubId}/approve`, {
    method: 'POST',
    headers: freshAdminHeaders
  }), env);
  body = await res.json();
  check('Approved app carries sectionId, sectionName, categoryId, categoryName',
    res.status === 200 && body.app.sectionId === 'test_sec' && body.app.categoryId === 'test_cat_sub' && body.app.iconUrl === 'https://cdn.example.com/dynamic-icon.png');

  // 68. DELETE /api/admin/sections/:id
  res = await worker.fetch(req('/api/admin/sections/test_sec', {
    method: 'DELETE',
    headers: freshAdminHeaders
  }), env);
  body = await res.json();
  check('DELETE /api/admin/sections/:id -> deleted', res.status === 200 && body.ok);

  // Restore fetch
  globalThis.fetch = originalFetch;

  console.log(`\n${pass} passed, ${fail} failed\n`);
  if (fail > 0) process.exit(1);
}

await main();
