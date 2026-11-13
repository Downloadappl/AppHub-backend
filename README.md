# AppHub Backend API (Standalone)

واجهة برمجة تطبيقات مستقلة لمتجر AppHub مع تخزين محلي مبني على ملفات JSON (بدون اعتماديات npm خارجية) لتسهيل التشغيل في البيئات المحدودة.

## التشغيل

```bash
cd backend
node src/server.js
```

- API: `http://localhost:3000`
- لوحة التحكم: `http://localhost:3000/admin`
- بيانات الدخول الافتراضية: `admin` / `admin123`

## التخزين
- البيانات: `backend/data/*.json` (apps, categories, versions, downloads, admins, sessions, settings)
- الملفات المرفوعة/المخزنة محلياً: `backend/uploads/apks`, `backend/uploads/images`

## نقاط API العامة (للتطبيق)
- `GET /api/health`
- `GET /api/settings`
- `GET /api/categories`
- `GET /api/apps?category=&q=&featured=true&game=true&sort=latest|popular`
- `GET /api/apps/:id`
- `POST /api/apps/:id/download-event`
- `GET /api/stats`

## نقاط API الإدارية (تتطلب `Authorization: Bearer <token>`)
- `POST /api/admin/login`
- `POST /api/admin/logout`
- `GET /api/admin/me`
- `GET/POST /api/admin/categories`
- `PUT/DELETE /api/admin/categories/:id`
- `GET/POST /api/admin/apps`
- `GET/PUT/DELETE /api/admin/apps/:id`
- `GET /api/admin/versions?appId=`
- `GET/PUT /api/admin/settings`
- `GET /api/admin/stats`
- `POST /api/admin/upload-info` (تسجيل/إنشاء مسار ملف؛ ارفع الملف إلى `uploads/` أو استخدم رابطاً مباشراً)

## ملاحظات
- هذا تنفيذ عملي خفيف وقابل للنقل. للإنتاج يوصى باستبدال التخزين بقاعدة بيانات (PostgreSQL/MySQL) وإضافة رفع ملفات متعدد الأجزاء (multipart) وتوقيع روابط التخزين الخارجي (S3/Cloud Storage) وتفعيل HTTPS ومصادقة أقوى.
