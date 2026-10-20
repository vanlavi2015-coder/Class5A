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


## Multi-teacher rollout (feature branch)

This branch adds server-side tenant ownership for teachers while keeping the existing `teacher` account and class 5A data assigned to the legacy owner `teacher`.

- The default `teacher` account is the account administrator for creating teacher accounts.
- In LAVI, open **Tài khoản** and create a teacher login with a class name and a strong initial password.
- The new teacher signs in directly with that username/password and starts with an empty, isolated roster.
- That teacher can add students in **Tài khoản**; each student receives a separate login and password.
- Teacher APIs scope assignments, submissions, rosters, stars, notifications, monthly scores, exports, and grading operations to the signed-in teacher's roster.
- Encrypted backups now include teacher ownership and account records so restoration does not merge every class into 5A.
- Existing class 5A records migrate with owner `teacher`; the current live service is not changed until this branch is reviewed and merged.

### Test

Use Node.js 22 or later (required for `node:sqlite`):

```bash
npm install
npm test
```

The integration test checks that teacher 2 cannot see teacher 1's assignments or students, that cross-class grading is rejected, and that both rosters and assignments remain isolated after a server restart.

**Deployment caution:** do not deploy this branch to the live service until the integration test passes in CI and a backup of the live persistent disk/database is confirmed.
