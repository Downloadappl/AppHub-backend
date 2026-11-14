# AppLand TV Backend — Cloudflare Workers

واجهة البرمجة والتطبيق الخلفي (REST API) لمتجر تطبيقات الشاشات والتلفاز الذكي **AppLand TV (آب لاند)** على Cloudflare Workers مع قاعدة بيانات Cloudflare KV وبوابة المطورين المتكاملة.

> **ملاحظة معمارية**: لا يتم تخزين ملفات APK محلياً على الخادم توفيراً للتكلفة وسرعة الاستجابة. كل تطبيق يُنشر برابط تنزيل مباشر (`apkUrl`) مستضاف على GitHub Releases أو CDN موثوق يدعم HTTPS واستكمال التحميل.

---

## 1) المميزات الرئيسية

1. **بوابة مطورين متكاملة (`/dev/`)**:
   - تسجيل حساب جديد، تسجيل الدخول، استعادة كلمة المرور عبر كود الحساب أو الرمز السري.
   - إدارة الملف الشخصي، اسم المطور، البريد، الروابط الاجتماعية.
   - تقديم طلبات نشر التطبيقات بنموذج احترافي وفحص آني لرابط الـ APK.
   - متابعة حالة الطلبات (قيد المراجعة، طلب تعديل، مقبول، مرفوض).
   - تعديل الطلبات وإعادة إرسالها فوراً عند طلب تغييرات من الإدارة.
   - مركز إشعارات داخلي للمطورين لكل تحديث على طلباتهم.

2. **فحص آمن لروابط الـ APK ومكافحة SSRF**:
   - التحقق الصارم من بروتوكول HTTPS.
   - حظر الاستدعاء إلى العناوين المحلية والشبكات الخاصة (SSRF Protection).
   - فحص استجابة الرابط والترويسات والتأكد من دعم نوع المحتوى.

3. **إدارة متقدمة لطلبات المطورين في لوحة الإدارة (`/admin/submissions.html`)**:
   - استعراض كافة الطلبات مع عداد للطلبات المعلقة.
   - فلترة حسب الحالة وبحث بالاسم أو الحزمة أو معرف المطور.
   - نافذة فحص كاملة: استعراض الشاشات، فحص الرابط المباشر، إرسال ملاحظات تعديل، رفض مع سبب، أو قبول بنقرة واحدة.
   - **النشر التلقائي الفوري**: بمجرد القبول يتم إدراج التطبيق والإصدار تلقائياً في المتجر ويصبح متاحاً فوراً لتطبيق التلفاز (`/api/apps`).

4. **إشعارات تيليجرام للإدارة (Telegram Notifications)**:
   - إرسال إشعار فوري لمدير المتجر عبر بوت تيليجرام عند تقديم تطبيق جديد أو إعادة إرساله.
   - خيار تفعيل/تعطيل وزر اختبار فوري من صفحة الإعدادات.

---

## 2) متطلبات التشغيل والنشر

- حساب Cloudflare مجاني أو مدفوع
- Node.js 18+
- أداة Wrangler مثبتة: `npm install`

---

## 3) خطوات النشر على Cloudflare

```bash
cd cloudflare
npm install
npx wrangler login
```

### أ) إنشاء مخزن البيانات (KV Namespace)
```bash
npx wrangler kv namespace create APPHUB
```
انسخ الـ `id` وضعه في ملف `wrangler.jsonc` تحت:
```jsonc
"kv_namespaces": [
  {
    "binding": "APPHUB",
    "id": "معرف_الـ_KV_الخاص_بك"
  }
]
```

### ب) تعيين كلمة مرور الإدارة
```bash
npx wrangler secret put ADMIN_PASSWORD
```

### ج) النشر التلقائي (الخادم + لوحة الإدارة وبوابة المطورين)
```bash
npm run deploy
```
سيقوم Wrangler بنشر كود الـ Worker ومعه كافة صفحات لوحة الإدارة وبوابة المطورين على نفس النطاق بدون مشاكل CORS.

---

## 4) خريطة المسارات ونقاط النهاية (API Reference)

### أ) المسارات العامة (تطبيق التلفاز والزوار)
| الطريقة | المسار | الوصف |
|---|---|---|
| GET | `/api/health` | فحص صحة الخادم |
| GET | `/api/settings` | إعدادات المتجر العامة |
| GET | `/api/categories` | قائمة الأقسام المصرح بنشرها |
| GET | `/api/apps` | قائمة التطبيقات (فلاتر: `q`, `category`, `featured`, `game`, `targetDevice`, `sort`, `limit`, `offset`) |
| GET | `/api/apps/:id` | تفاصيل التطبيق الكاملة وصور الشاشة |
| POST | `/api/apps/:id/download-event` | تسجيل تحميل وزيادة العداد |
| GET | `/api/stats` | ملخص إحصائيات المتجر |

### ب) مسارات بوابة المطورين (`/api/dev/*`)
| الطريقة | المسار | المصادقة | الوصف |
|---|---|---|---|
| POST | `/api/dev/register` | عام | تسجيل حساب مطور جديد |
| POST | `/api/dev/login` | عام | تسجيل دخول المطور والحصول على Token |
| POST | `/api/dev/logout` | Dev Token | تسجيل الخروج وإلغاء الجلسة |
| POST | `/api/dev/reset-password` | عام | استعادة كلمة المرور عبر الرمز التعريفي |
| GET | `/api/dev/me` | Dev Token | بيانات الحساب والملف الشخصي |
| PUT | `/api/dev/profile` | Dev Token | تحديث بيانات المطور (الاسم، البريد، الروابط) |
| POST | `/api/dev/verify-apk` | Dev Token | فحص مباشر لرابط APK وحماية SSRF |
| GET | `/api/dev/submissions` | Dev Token | قائمة طلبات المطور مع الإحصائيات |
| POST | `/api/dev/submissions` | Dev Token | تقديم تطبيق جديد للمراجعة |
| GET | `/api/dev/submissions/:id` | Dev Token | تفاصيل طلب معين وملاحظات الإدارة |
| PUT | `/api/dev/submissions/:id` | Dev Token | تعديل طلب (في حالة طلب تعديل) وإعادة الإرسال |
| GET | `/api/dev/notifications` | Dev Token | استعراض إشعارات المطور |
| POST | `/api/dev/notifications/read` | Dev Token | تحديد الإشعارات كمقروءة |

### ج) مسارات لوحة الإدارة (`/api/admin/*`)
| الطريقة | المسار | المصادقة | الوصف |
|---|---|---|---|
| POST | `/api/admin/login` | عام | تسجيل دخول المدير |
| POST | `/api/admin/logout` | Admin Token | تسجيل خروج المدير |
| GET | `/api/admin/me` | Admin Token | بيانات المدير |
| GET/POST | `/api/admin/apps` | Admin Token | إدارة التطبيقات المنشورة |
| GET/PUT/DELETE | `/api/admin/apps/:id` | Admin Token | تعديل وحذف تطبيق منشور |
| GET/POST | `/api/admin/categories` | Admin Token | إدارة وتعديل الأقسام |
| PUT/DELETE | `/api/admin/categories/:id` | Admin Token | تعديل أو حذف قسم |
| GET | `/api/admin/versions` | Admin Token | سجل إصدارات التطبيقات |
| GET/PUT | `/api/admin/settings` | Admin Token | تعديل إعدادات المتجر وتيليجرام |
| GET | `/api/admin/stats` | Admin Token | الإحصائيات العامة الشاملة |
| GET | `/api/admin/submissions` | Admin Token | قائمة طلبات المطورين مع الفلترة |
| GET | `/api/admin/submissions/stats` | Admin Token | عدادات الطلبات المعلقة والمقبولة |
| GET | `/api/admin/submissions/:id` | Admin Token | تفاصيل الطلب للمراجعة |
| POST | `/api/admin/submissions/:id/approve` | Admin Token | قبول الطلب ونشره تلقائياً بالمتجر |
| POST | `/api/admin/submissions/:id/request-changes` | Admin Token | طلب تعديلات من المطور مع تدوين الملاحظات |
| POST | `/api/admin/submissions/:id/reject` | Admin Token | رفض الطلب مع توضيح السبب |
| POST | `/api/admin/telegram/test` | Admin Token | إرسال رسالة اختبار عبر بوت تيليجرام |
| GET | `/api/admin/backup` | Admin Token | تصدير نسخة احتياطية لكامل البيانات |
| POST | `/api/admin/seed` | Admin Token | إعادة تعيين البيانات النموذجية الأولية |

---

## 5) الاختبارات الآلية (Automated Tests)

تم تضمين جناح اختبارات شامل يغطي 67 اختباراً دقيقاً:
- 46 اختباراً للوظائف الأساسية (المتجر، الأقسام، المصادقة، التنزيل).
- 21 اختباراً لبوابة المطورين، التحقق من الروابط، حظر SSRF، دورة مراجعة الطلبات، النشر التلقائي، واكتشاف التعارضات.

لتشغيل الاختبارات محلياً:
```bash
node test-local.mjs
```
النتيجة المتوقعة:
```
67 passed, 0 failed
```
