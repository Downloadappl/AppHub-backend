/**
 * Local smoke test for the Worker without wrangler:
 *   node test-local.mjs
 *
 * Mocks the KV namespace and the assets binding, then exercises the API
 * end-to-end (seed, login, categories, apps, stats, media rejection).
 */

import worker from './src/worker.js';

function makeKv() {
  const store = new Map();
  return {
    store,
    async get(key) {
      return store.has(key) ? store.get(key) : null;
    },
    async put(key, value) {
      store.set(key, String(value));
    },
    async delete(key) {
      store.delete(key);
    }
  };
}

const kv = makeKv();
const env = {
  APPHUB: kv,
  ASSETS: {
    async fetch() {
      return new Response('not found', { status: 404 });
    }
  },
  ADMIN_USERNAME: 'admin',
  ADMIN_PASSWORD: 'admin123'
};

const BASE = 'https://apphub-api.example.workers.dev';

function req(path, init = {}) {
  return new Request(BASE + path, {
    method: init.method || 'GET',
    headers: Object.assign({ 'Content-Type': 'application/json' }, init.headers || {}),
    body: init.body === undefined ? undefined : JSON.stringify(init.body)
  });
}

let pass = 0;
let fail = 0;

function check(name, condition, detail) {
  if (condition) {
    pass++;
    console.log(`  ok   ${name}`);
  } else {
    fail++;
    console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`);
  }
}

async function main() {
  console.log('\nAppHub Worker local test\n');

  // 1. health
  let res = await worker.fetch(req('/api/health'), env);
  let body = await res.json();
  check('GET /api/health -> 200 ok', res.status === 200 && body.ok === true, JSON.stringify(body));

  // 2. root
  res = await worker.fetch(req('/'), env);
  body = await res.json();
  check('GET / -> worker landing JSON', res.status === 200 && body.runtime === 'cloudflare-worker');

  // 3. admin redirect
  res = await worker.fetch(req('/admin'), env);
  check('GET /admin -> 301 to /admin/', res.status === 301 && res.headers.get('Location') === '/admin/');

  // 4. seeded categories (public)
  res = await worker.fetch(req('/api/categories'), env);
  body = await res.json();
  check('GET /api/categories -> seeded list', res.status === 200 && body.items.length === 9, `len=${body.items?.length}`);

  // 5. seeded apps (public)
  res = await worker.fetch(req('/api/apps'), env);
  body = await res.json();
  check('GET /api/apps -> seeded apps', res.status === 200 && body.items.length === 4, `len=${body.items?.length}`);

  // 6. search (Arabic)
  res = await worker.fetch(req('/api/apps?q=' + encodeURIComponent('لعبة')), env);
  body = await res.json();
  check('GET /api/apps?q=لعبة -> 1 result', res.status === 200 && body.items.length === 1, `len=${body.items?.length}`);

  // 7. filter featured
  res = await worker.fetch(req('/api/apps?featured=true'), env);
  body = await res.json();
  check('GET /api/apps?featured=true -> 4', res.status === 200 && body.items.length === 4, `len=${body.items?.length}`);

  // 8. filter game
  res = await worker.fetch(req('/api/apps?game=true'), env);
  body = await res.json();
  check('GET /api/apps?game=true -> 1 game', res.status === 200 && body.items.every(a => a.isGame), `len=${body.items?.length}`);

  // 9. single app
  res = await worker.fetch(req('/api/apps/app_1'), env);
  body = await res.json();
  check('GET /api/apps/app_1 -> StreamBox', res.status === 200 && body.name === 'StreamBox');

  // 10. missing app
  res = await worker.fetch(req('/api/apps/nope'), env);
  check('GET /api/apps/nope -> 404', res.status === 404);

  // 11. stats
  res = await worker.fetch(req('/api/stats'), env);
  body = await res.json();
  check('GET /api/stats -> totals', res.status === 200 && body.totalApps === 4 && body.totalGames === 1, JSON.stringify({ a: body.totalApps, g: body.totalGames }));

  // 12. admin without token
  res = await worker.fetch(req('/api/admin/apps'), env);
  check('GET /api/admin/apps without token -> 401', res.status === 401);

  // 13. wrong login
  res = await worker.fetch(req('/api/admin/login', { method: 'POST', body: { username: 'admin', password: 'wrong' } }), env);
  check('POST login wrong password -> 401', res.status === 401);

  // 14. correct login
  res = await worker.fetch(req('/api/admin/login', { method: 'POST', body: { username: 'admin', password: 'admin123' } }), env);
  body = await res.json();
  check('POST login -> token', res.status === 200 && typeof body.token === 'string' && body.token.length === 64, JSON.stringify(body).slice(0, 80));
  const token = body.token;
  const auth = { Authorization: 'Bearer ' + token };

  // 15. me
  res = await worker.fetch(req('/api/admin/me', { headers: auth }), env);
  body = await res.json();
  check('GET /api/admin/me -> admin', res.status === 200 && body.username === 'admin');

  // 16. admin apps list
  res = await worker.fetch(req('/api/admin/apps', { headers: auth }), env);
  body = await res.json();
  check('GET /api/admin/apps with token -> 4', res.status === 200 && body.items.length === 4, `len=${body.items?.length}`);

  // 17. create category
  res = await worker.fetch(req('/api/admin/categories', {
    method: 'POST',
    headers: auth,
    body: { name: 'قسم تجريبي', order: 20 }
  }), env);
  body = await res.json();
  check('POST /api/admin/categories -> 201', res.status === 201 && body.name === 'قسم تجريبي', JSON.stringify(body));
  const catId = body.id;

  // 18. duplicate category id rejected
  res = await worker.fetch(req('/api/admin/categories', {
    method: 'POST',
    headers: auth,
    body: { id: catId, name: 'مكرر' }
  }), env);
  check('POST duplicate category id -> 409', res.status === 409);

  // 19. update category
  res = await worker.fetch(req(`/api/admin/categories/${catId}`, {
    method: 'PUT',
    headers: auth,
    body: { name: 'قسم معدل' }
  }), env);
  body = await res.json();
  check('PUT category -> renamed', res.status === 200 && body.name === 'قسم معدل' && body.id === catId);

  // 20. delete category
  res = await worker.fetch(req(`/api/admin/categories/${catId}`, { method: 'DELETE', headers: auth }), env);
  body = await res.json();
  check('DELETE category -> ok', res.status === 200 && body.ok === true);

  // 21. create app (direct URL, no upload)
  const newApp = {
    name: 'Test Player',
    shortDescription: 'وصف مختصر',
    fullDescription: 'وصف كامل',
    categoryId: 'video',
    versionName: '1.2.3',
    versionCode: 123,
    sizeBytes: 12345678,
    developer: 'QA',
    packageName: 'com.qa.testplayer',
    apkUrl: 'https://example.com/testplayer-1.2.3.apk',
    sha256: 'a'.repeat(64),
    keywords: ['test', 'video', 'تجربة'],
    isFeatured: true,
    targetType: 'TV'
  };

  res = await worker.fetch(req('/api/admin/apps', { method: 'POST', headers: auth, body: newApp }), env);
  body = await res.json();
  check('POST /api/admin/apps -> 201', res.status === 201 && body.name === 'Test Player', JSON.stringify(body).slice(0, 120));
  check('  app keeps direct apkUrl (no upload)', body.apkUrl === newApp.apkUrl);
  check('  keywords parsed to array', Array.isArray(body.keywords) && body.keywords.length === 3, JSON.stringify(body.keywords));
  check('  versionCode numeric', body.versionCode === 123);
  const appId = body.id;

  // 22. missing name rejected
  res = await worker.fetch(req('/api/admin/apps', { method: 'POST', headers: auth, body: { shortDescription: 'بلا اسم' } }), env);
  check('POST app without name -> 400', res.status === 400);

  // 23. duplicate id rejected
  res = await worker.fetch(req('/api/admin/apps', { method: 'POST', headers: auth, body: { id: appId, name: 'مكرر' } }), env);
  check('POST duplicate app id -> 409', res.status === 409);

  // 24. version recorded
  res = await worker.fetch(req('/api/admin/versions?appId=' + appId, { headers: auth }), env);
  body = await res.json();
  check('versions recorded for new app', res.status === 200 && body.items.length === 1 && body.items[0].versionName === '1.2.3', JSON.stringify(body.items?.length));

  // 25. update app -> new version entry
  res = await worker.fetch(req(`/api/admin/apps/${appId}`, {
    method: 'PUT',
    headers: auth,
    body: { versionName: '1.3.0', versionCode: 130, apkUrl: 'https://example.com/testplayer-1.3.0.apk' }
  }), env);
  body = await res.json();
  check('PUT app -> version 1.3.0', res.status === 200 && body.versionName === '1.3.0' && body.name === 'Test Player');

  res = await worker.fetch(req('/api/admin/versions?appId=' + appId, { headers: auth }), env);
  body = await res.json();
  check('second version recorded', res.status === 200 && body.items.length === 2, `len=${body.items?.length}`);

  // 26. unpublish hides from public
  res = await worker.fetch(req(`/api/admin/apps/${appId}`, { method: 'PUT', headers: auth, body: { published: false } }), env);
  body = await res.json();
  check('app unpublished', res.status === 200 && body.published === false);

  res = await worker.fetch(req('/api/apps'), env);
  body = await res.json();
  check('unpublished app hidden from /api/apps', res.status === 200 && body.items.length === 4, `len=${body.items?.length}`);

  // republish
  await worker.fetch(req(`/api/admin/apps/${appId}`, { method: 'PUT', headers: auth, body: { published: true } }), env);

  // 27. settings
  res = await worker.fetch(req('/api/admin/settings', { method: 'PUT', headers: auth, body: { storeName: 'متجري' } }), env);
  body = await res.json();
  check('PUT settings -> storeName', res.status === 200 && body.storeName === 'متجري');

  res = await worker.fetch(req('/api/settings'), env);
  body = await res.json();
  check('GET /api/settings public', res.status === 200 && body.storeName === 'متجري');

  // 28. download event increments
  res = await worker.fetch(req(`/api/apps/${appId}/download-event`, { method: 'POST', body: { event: 'download' } }), env);
  check('POST download-event -> ok', res.status === 200);

  res = await worker.fetch(req('/api/apps/' + appId), env);
  body = await res.json();
  check('downloadCount incremented', res.status === 200 && body.downloadCount === 1, `count=${body.downloadCount}`);

  // 29. media/upload endpoints removed
  res = await worker.fetch(req('/api/admin/upload', { method: 'POST', headers: auth, body: {} }), env);
  check('upload endpoint removed -> 404', res.status === 404);

  res = await worker.fetch(req('/api/admin/upload-info', { method: 'POST', headers: auth, body: {} }), env);
  check('upload-info endpoint removed -> 404', res.status === 404);

  res = await worker.fetch(req('/media/some/key.apk'), env);
  check('media route removed -> 404', res.status === 404);

  // 30. backup + delete
  res = await worker.fetch(req('/api/admin/backup', { headers: auth }), env);
  body = await res.json();
  check('GET backup -> apps list', res.status === 200 && Array.isArray(body.apps) && body.apps.length === 5, `len=${body.apps?.length}`);

  res = await worker.fetch(req(`/api/admin/apps/${appId}`, { method: 'DELETE', headers: auth }), env);
  check('DELETE app -> ok', res.status === 200);

  res = await worker.fetch(req('/api/apps'), env);
  body = await res.json();
  check('deleted app gone from public list', res.status === 200 && body.items.length === 4, `len=${body.items?.length}`);

  // 31. logout invalidates token
  res = await worker.fetch(req('/api/admin/logout', { method: 'POST', headers: auth }), env);
  check('logout -> ok', res.status === 200);

  res = await worker.fetch(req('/api/admin/apps', { headers: auth }), env);
  check('token invalid after logout -> 401', res.status === 401);

  // 32. pagination
  res = await worker.fetch(req('/api/apps?limit=2&offset=1'), env);
  body = await res.json();
  check('pagination limit/offset', res.status === 200 && body.items.length === 2 && body.total === 4, JSON.stringify({ len: body.items?.length, total: body.total }));

  // 33. CORS preflight
  res = await worker.fetch(new Request(BASE + '/api/apps', { method: 'OPTIONS' }), env);
  check('OPTIONS preflight -> 204 + CORS', res.status === 204 && res.headers.get('Access-Control-Allow-Origin') === '*');

  // 34. re-seed does not duplicate
  const auth2 = (await (await worker.fetch(req('/api/admin/login', { method: 'POST', body: { username: 'admin', password: 'admin123' } }), env)).json()).token;
  await worker.fetch(req('/api/admin/seed', { method: 'POST', headers: { Authorization: 'Bearer ' + auth2 } }), env);
  res = await worker.fetch(req('/api/apps'), env);
  body = await res.json();
  check('seed is idempotent', res.status === 200 && body.items.length === 4, `len=${body.items?.length}`);

  /* ------------------------------------------------------------- */
  /*          DEVELOPER PORTAL & APPLICATION SUBMISSION TESTS      */
  /* ------------------------------------------------------------- */

  console.log('\n--- Developer Portal & Application Submissions Tests ---');

  // 35. Developer Registration
  res = await worker.fetch(req('/api/dev/register', {
    method: 'POST',
    body: {
      fullName: 'أحمد المطور',
      username: 'ahmed_dev',
      email: 'ahmed@example.com',
      password: 'password123',
      confirmPassword: 'password123'
    }
  }), env);
  body = await res.json();
  check('POST /api/dev/register -> 201 + token', res.status === 201 && body.ok && body.token);
  const devToken = body.token;
  const devAuth = { Authorization: 'Bearer ' + devToken };

  // 36. Duplicate register rejected
  res = await worker.fetch(req('/api/dev/register', {
    method: 'POST',
    body: {
      fullName: 'أحمد آخر',
      username: 'ahmed_dev',
      email: 'different@example.com',
      password: 'password123'
    }
  }), env);
  check('Duplicate username rejected -> 409', res.status === 409);

  // 37. Developer Login
  res = await worker.fetch(req('/api/dev/login', {
    method: 'POST',
    body: { username: 'ahmed_dev', password: 'password123' }
  }), env);
  body = await res.json();
  check('POST /api/dev/login -> 200 + token', res.status === 200 && body.token);

  // 38. Developer Me
  res = await worker.fetch(req('/api/dev/me', { headers: devAuth }), env);
  body = await res.json();
  check('GET /api/dev/me -> profile', res.status === 200 && body.username === 'ahmed_dev');

  // 39. Developer cannot access admin APIs
  res = await worker.fetch(req('/api/admin/apps', { headers: devAuth }), env);
  check('Developer token rejected on admin API -> 401', res.status === 401);

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

  // 41. Submit New Application (Mocking a valid URL for testing)
  // Let's test submission with missing required fields
  res = await worker.fetch(req('/api/dev/submissions', {
    method: 'POST',
    headers: devAuth,
    body: { name: '' }
  }), env);
  check('Empty app submission rejected -> 400', res.status === 400);

  // 42. Submit valid app
  // In our test, global fetch for verifyApkUrl: let's mock globalThis.fetch for apk check or test with a valid mocked endpoint
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

  res = await worker.fetch(req('/api/dev/submissions', {
    method: 'POST',
    headers: devAuth,
    body: {
      name: 'Noor Cinema TV',
      shortDescription: 'تطبيق لمشاهدة الأفلام والمسلسلات العربية',
      fullDescription: 'تطبيق ترفيهي وسينمائي شامل مصمم خصيصاً لأجهزة وشاشات التلفزيون الذكية مع دعم كامل للريموت.',
      versionName: '2.0.0',
      versionCode: 20,
      sizeBytes: 15728640,
      developer: 'Noor Media Studio',
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
  const subId = body.id;

  // 43. App is NOT in public store while pending
  res = await worker.fetch(req('/api/apps?q=Noor'), env);
  body = await res.json();
  check('Pending submission hidden from public store', res.status === 200 && body.items.length === 0);

  // 44. Developer list submissions
  res = await worker.fetch(req('/api/dev/submissions'), env);
  // (without auth -> fails)
  res = await worker.fetch(req('/api/dev/submissions', { headers: devAuth }), env);
  body = await res.json();
  check('GET /api/dev/submissions -> 1 pending', res.status === 200 && body.items.length === 1 && body.items[0].id === subId);

  // 45. Developer notifications
  res = await worker.fetch(req('/api/dev/notifications', { headers: devAuth }), env);
  body = await res.json();
  check('GET /api/dev/notifications -> received welcome and submission notifs', res.status === 200 && body.items.length >= 2);

  // 46. Admin Submissions List & Stats
  const adminHeaders = { Authorization: 'Bearer ' + auth2 };
  res = await worker.fetch(req('/api/admin/submissions/stats', { headers: adminHeaders }), env);
  body = await res.json();
  check('GET /api/admin/submissions/stats -> pending: 1', res.status === 200 && body.pending === 1);

  res = await worker.fetch(req('/api/admin/submissions?status=pending', { headers: adminHeaders }), env);
  body = await res.json();
  check('GET /api/admin/submissions?status=pending -> returns sub', res.status === 200 && body.items.length === 1 && body.items[0].id === subId);

  // 47. Admin Request Changes
  res = await worker.fetch(req(`/api/admin/submissions/${subId}/request-changes`, {
    method: 'POST',
    headers: adminHeaders,
    body: { notes: 'يرجى تزويدنا بلقطات شاشة بجودة أعلى 1080p' }
  }), env);
  body = await res.json();
  check('POST request-changes -> changes_requested', res.status === 200 && body.submission.status === 'changes_requested');

  // 48. Developer Resubmit
  res = await worker.fetch(req(`/api/dev/submissions/${subId}`, {
    method: 'PUT',
    headers: devAuth,
    body: {
      screenshots: [
        'https://images.unsplash.com/screen1_hd.jpg',
        'https://images.unsplash.com/screen2_hd.jpg'
      ]
    }
  }), env);
  body = await res.json();
  check('Developer edit resubmits -> pending again', res.status === 200 && body.status === 'pending');

  // 49. Admin Approve and Publish
  res = await worker.fetch(req(`/api/admin/submissions/${subId}/approve`, {
    method: 'POST',
    headers: adminHeaders,
    body: { isFeatured: true }
  }), env);
  body = await res.json();
  check('POST approve -> 200 approved + app created', res.status === 200 && body.ok && body.app && body.submission.status === 'approved');
  const publishedAppId = body.app.id;

  // 50. Double approval idempotency check
  res = await worker.fetch(req(`/api/admin/submissions/${subId}/approve`, {
    method: 'POST',
    headers: adminHeaders
  }), env);
  check('Double approval returns 409 conflict', res.status === 409);

  // 51. App is now live in public store!
  res = await worker.fetch(req('/api/apps?q=Noor'), env);
  body = await res.json();
  check('Published app live in public /api/apps', res.status === 200 && body.items.length === 1 && body.items[0].name === 'Noor Cinema TV');

  // 52. Details endpoint
  res = await worker.fetch(req(`/api/apps/${publishedAppId}`), env);
  body = await res.json();
  check('Published app details accessible -> 200', res.status === 200 && body.id === publishedAppId && body.apkUrl === 'https://cdn.example.com/myapp.apk');

  // Restore fetch
  globalThis.fetch = originalFetch;

  console.log(`\n${pass} passed, ${fail} failed\n`);
  if (fail > 0) process.exit(1);
}

await main();
