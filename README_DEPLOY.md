# LAVI 5A Online V4

Bản triển khai thật cho lớp 5A. App là Node.js/Express và dùng SQLite.

## Render
- Runtime: Node
- Build: `npm install`
- Start: `npm start`
- Health: `/api/health`
- Data dir: `/var/data`
- Persistent disk: `/var/data` (1 GB)
- Biến bắt buộc: `LAVI_TEACHER_PASSWORD`
- `LAVI_JWT_SECRET` được Render tự tạo nếu dùng render.yaml.

Lưu ý: persistent disk của Render là dịch vụ trả phí và chỉ dùng được với một instance; phù hợp lớp 5A quy mô nhỏ. Nếu sau này cần mở rộng nhiều lớp/nhiều instance, chuyển database sang Postgres.
