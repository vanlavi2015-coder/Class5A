# LAVI 5A Online V3

Bản hoàn thiện theo hướng dùng thật cho lớp 5A: 32 học sinh, tài khoản riêng, giao bài, nộp bài, chấm/điều chỉnh điểm và sao, thông báo, đổi nhóm, sao lưu dữ liệu.

## Điểm mới V3
- SQLite lưu dữ liệu bền vững thay cho `db.json`.
- WAL mode cho SQLite.
- Tài khoản giáo viên + 32 học sinh.
- JWT đăng nhập 30 ngày.
- Mật khẩu băm bcrypt.
- Giao/nộp/chấm bài, sao, huy hiệu và thông báo dùng chung.
- API sao lưu JSON.
- Có health check `/api/health`.

## Chạy thử trên máy
```bash
npm install
npm start
```
Mở `http://localhost:3000`.

Tài khoản giáo viên: `teacher` / `Lavi@2026`
Học sinh: `hs01` ... `hs32` / `1234`

Đổi mật khẩu giáo viên sau lần đăng nhập đầu.

## Triển khai online
Xem `DEPLOY_RENDER.md`. Nếu dùng Render, nên gắn Persistent Disk vào thư mục dữ liệu (mặc định `./data`, có thể đặt `LAVI_DATA_DIR`). Không nên dùng gói hosting không có persistent storage cho dữ liệu lớp học lâu dài.
