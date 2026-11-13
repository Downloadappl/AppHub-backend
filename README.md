# AppHub Backend — Cloudflare Workers

نفس واجهة REST الخاصة بالخادم، لكن على Cloudflare Workers مع تخزين KV.
**لا يوجد رفع ملفات APK.** كل تطبيق يُنشر برابط مباشر (`apkUrl`) تستضيفه في أي مكان.

---

## 1) المتطلبات

- حساب Cloudflare
- Node.js 18+ على جهازك
- Wrangler: `npm install` داخل هذا المجلد

---

## 2) خطوات النشر

```bash
cd cloudflare
npm install
npx wrangler login
```

### أ) أنشئ مخزن KV

```bash
npx wrangler kv namespace create APPHUB
```

سيطبع لك الناتج شيئاً مثل:

```json
{
  "id": "a1b2c3d4e5f6..."
}
```

انسخ الـ `id` وضعه مكان `REPLACE_WITH_YOUR_KV_NAMESPACE_ID` في [`wrangler.jsonc`](wrangler.jsonc).

### ب) كلمة مرور المدير (سر — لا تُكتب في الكود)

```bash
npx wrangler secret put ADMIN_PASSWORD
```

اكتب كلمة مرور قوية. اسم المستخدم الافتراضي `admin` ويمكن تغييره من `ADMIN_USERNAME` في `wrangler.jsonc`.

### ج) انشر

```bash
npm run deploy
```

---

## 3) نقاط النهاية

| الطريقة | المسار | الوصف |
|---|---|---|
| GET | `/api/health` | فحص حالة الخدمة |
| GET | `/api/settings` | إعدادات المتجر |
| GET | `/api/categories` | الأقسام المنشورة |
| GET | `/api/apps` | التطبيقات + فلاتر: `q`, `category`, `featured`, `game`, `sort=latest\|popular`, `limit`, `offset` |
| GET | `/api/apps/:id` | تفاصيل تطبيق |
| POST | `/api/apps/:id/download-event` | تسجيل عملية تحميل (يزيد العدّاد) |
| GET | `/api/stats` | إحصائيات المتجر |
| POST | `/api/admin/login` | تسجيل دخول المدير → `token` |
| POST | `/api/admin/logout` | إنهاء الجلسة |
| GET | `/api/admin/me` | بيانات المدير الحالي |
| GET/POST | `/api/admin/apps` | قائمة/إضافة تطبيق |
| GET/PUT/DELETE | `/api/admin/apps/:id` | تعديل/حذف/تفاصيل |
| GET/POST | `/api/admin/categories` | قائمة/إضافة قسم |
| PUT/DELETE | `/api/admin/categories/:id` | تعديل/حذف قسم |
| GET | `/api/admin/versions?appId=` | سجل الإصدارات |
| GET/PUT | `/api/admin/settings` | إعدادات المتجر |
| GET | `/api/admin/stats` | إحصائيات تفصيلية |
| GET | `/api/admin/backup` | تصدير JSON للنسخ الاحتياطي |
| POST | `/api/admin/seed` | إعادة تعيين البيانات التجريبية |

المصادقة: أرسل `Authorization: Bearer <token>` في كل طلبات `/api/admin/*`.

---

## 4) لوحة التحكم

الـ Worker يقدّم لوحة التحكم من نفس النطاق على:

```
https://<your-worker>.workers.dev/admin/
```

هذا يعني **لا حاجة لإعداد CORS**، ويمكنك استخدام نفس لوحة `admin-panel` المنشورة على GitHub Pages مع إدخال رابط الـ Worker في شاشة "إعداد الخادم" (يُحفظ في `localStorage`).

---

## 5) اختبار محلي بدون نشر

```bash
npm test          # 46 اختبار يغطي كل المسارات
npm run dev       # تشغيل محلي على 127.0.0.1:8787 مع KV وهمي
```

---

## 6) ملاحظات مهمة

- **KV is eventually consistent**: قد يتأخر ظهور التعديل حتى ~60 ثانية عالمياً. يكفي هذا لمتجر تطبيقات، لكن لا تستخدمه لعمليات نقدية فورية.
- **لا ترفع ملفات APK إلى الخادم**: استخدم روابط مباشرة. أمثلة مناسبة:
  - GitHub Releases: `https://github.com/<user>/<repo>/releases/download/<tag>/app.apk`
  - Google Drive برابط مباشر، أو أي CDN/استضافة تدعم direct link.
- يجب أن يدعم رابط APK طلبات `Range` لعرض خاصية "استكمال التحميل" في التطبيق، وأن يكون `Content-Type: application/vnd.android.package-archive`.
- **الإنتاج**: غيّر كلمة المرور الافتراضية، وفكّر في إضافة تحديد معدل (rate limiting) على `/api/admin/login`.
- حدود Cloudflare المجانية سخية (100k طلب/يوم) وكافية تماماً لعدد التطبيقات المستهدف.

---

## 7) ربط تطبيق Android

في [`../app/build.gradle.kts`](../app/build.gradle.kts):

```kotlin
buildConfigField("String", "API_BASE_URL", "\"https://<your-worker>.workers.dev/\"")
```

ثم أعد بناء التطبيق. التطبيق سيعمل أيضاً بدون خادم (بيانات محلية/كاش) لكن لعرض البيانات الحقيقية يلزم الرابط.
