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

  console.log(`\n${pass} passed, ${fail} failed\n`);
  if (fail > 0) process.exit(1);
}

await main();
