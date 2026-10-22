# LAVI 2.0 — nhánh chuẩn bị và kiểm thử

LAVI 2.0 là ứng dụng tách biệt, phát triển song song; không thay thế hoặc ghi đè LAVI 5A. Mọi tài khoản và dữ liệu seed trong chế độ demo đều là dữ liệu giả lập. Chưa dùng cho hồ sơ học sinh thật.

## Chức năng hiện có trong nhánh chuẩn bị

- Đăng ký/đăng nhập giáo viên bằng email hoặc số điện thoại; chuẩn hóa thông tin liên hệ, băm mật khẩu, giới hạn đăng nhập cơ bản.
- Tách dữ liệu theo tài khoản giáo viên và kiểm tra quyền truy cập ở máy chủ.
- Quản lý lớp và danh sách học sinh.
- Ngân hàng câu hỏi, nhập câu hỏi từ Excel/Word, tạo nháp câu hỏi AI có bước giáo viên duyệt, và tải mẫu Excel theo dạng câu hỏi.
- Tạo bộ đề, giao bài, lưu bài nộp, tự chấm câu có đáp án và cho phép giáo viên chấm lại câu cần xem xét.
- Sổ giao dịch điểm thưởng/phạt có lý do; xem tổng điểm và lịch sử giao dịch.
- Tổng hợp tiến bộ, tỷ lệ kết quả và lời nhận xét khích lệ.
- Sao lưu JSON và khôi phục có kiểm tra chống khôi phục trùng; API kiểm tra tình trạng sao lưu snapshot SQLite cục bộ.
- Giao diện thích ứng điện thoại và máy tính; một số mục điều hướng cũ vẫn là khu vực chưa kết nối đầy đủ.

## Chưa sẵn sàng cho sản xuất

- Email/số điện thoại chưa được xác minh bằng OTP; chưa có quy trình gửi mã, đặt lại mật khẩu và khôi phục tài khoản hoàn chỉnh.
- Tài khoản demo và dữ liệu seed chỉ dùng trong sandbox; phải bị vô hiệu hóa tuyệt đối trong production.
- Cần chạy toàn bộ kiểm thử tự động và kiểm thử chấp nhận end-to-end trên môi trường staging riêng.
- Snapshot SQLite cục bộ nằm trên cùng ổ dữ liệu, không thay thế bản sao lưu ngoài hệ thống. Cần xác minh Persistent Disk và quy trình backup/restore độc lập.
- Chưa nghiệm thu đầy đủ game, phụ huynh, hồ sơ năng lực số, xóa/xuất dữ liệu và quy trình quản trị tài khoản.

## Chạy cục bộ

Yêu cầu Node.js 22 trở lên.

```sh
npm install
npm test
```

PowerShell:

```powershell
$env:LAVI_DEMO_MODE="true"
$env:LAVI_JWT_SECRET="local-only-secret-at-least-32-characters"
$env:LAVI_DATA_DIR="./data"
$env:PORT="3100"
npm start
```

Mở http://localhost:3100.

Tài khoản demo:
- `teacher1` / `Demo1234!`
- `teacher2` / `Demo1234!`

Chỉ dùng các tài khoản trên với dữ liệu giả lập, không dùng ở môi trường có dữ liệu thật.

## Render sandbox riêng

- Tạo Web Service riêng cho LAVI 2.0; không sửa dịch vụ `lavi-5a`.
- Branch: `lavi-2.0-sandbox` cho sandbox hiện tại.
- Root Directory: `lavi2`; Build Command: `npm install`; Start Command: `npm start`; Node 22.
- Biến môi trường sandbox: `LAVI_DEMO_MODE=true`, `LAVI_JWT_SECRET` ngẫu nhiên dài ít nhất 32 ký tự, `LAVI_DATA_DIR=/var/data`.
- Gắn Persistent Disk riêng tại `/var/data` và xác nhận đường dẫn thực tế trong log trước khi thử nghiệm lưu bền.
- Không dùng chung disk, secret hoặc cơ sở dữ liệu với LAVI 5A.

## API điểm thưởng và tiến bộ

- `GET /api/classes/:classId/points`: tổng điểm theo học sinh trong lớp.
- `GET /api/classes/:classId/students/:studentId/points`: tổng điểm và tối đa 500 giao dịch gần nhất.
- `POST /api/classes/:classId/students/:studentId/points`: ghi giao dịch cộng/trừ có lý do; số nguyên khác 0, từ -1000 đến 1000.
- `GET /api/classes/:classId/progress`: tổng hợp kết quả đã lưu, điểm thưởng và nhận xét khích lệ.

Các API yêu cầu giáo viên đăng nhập, kiểm tra quyền sở hữu lớp phía máy chủ và ghi nhật ký kiểm toán. Kiểm thử tự động bao gồm các trường hợp điểm hợp lệ/không hợp lệ, lịch sử, tổng điểm, phản hồi tiến bộ và truy cập chéo lớp. Chỉ công nhận đạt khi workflow CI thực sự chạy thành công.
