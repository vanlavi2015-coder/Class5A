# LAVI 2.0 Sandbox

Đây là ứng dụng thử nghiệm độc lập, không thay thế website LAVI 5A hiện tại. Mọi dữ liệu được tạo sẵn đều là dữ liệu giả lập.

## Phạm vi MVP 0.2

- Trang chủ có lựa chọn đăng ký và đăng nhập giáo viên bằng email hoặc số điện thoại.
- Email được chuẩn hóa chữ thường; số điện thoại Việt Nam dạng 0xxxxxxxxx được chuẩn hóa thành +84xxxxxxxxx.
- Mật khẩu tối thiểu 8 ký tự, lưu dưới dạng băm; giới hạn số lần đăng ký/đăng nhập theo địa chỉ kết nối.
- Bản thử nghiệm chưa gửi OTP; email/số điện thoại chưa được xác minh quyền sở hữu. Không dùng cho tài khoản thật hoặc dữ liệu học sinh thật.
- Đăng nhập bằng hai tài khoản giáo viên giả lập vẫn được giữ để kiểm thử phân quyền.
- Mỗi giáo viên chỉ xem lớp và danh sách học sinh giả lập thuộc tài khoản đó.
- Mỗi giáo viên chỉ xem lớp và danh sách học sinh giả lập thuộc tài khoản đó.
- API kiểm tra quyền truy cập phía máy chủ; không dựa vào việc ẩn giao diện.
- SQLite riêng, migration version đầu tiên, nhật ký đăng nhập cơ bản và thời hạn JWT ngắn.
- Chưa có nhập Excel/Word, chấm điểm, trò chơi, phụ huynh hoặc hồ sơ năng lực số. Các phần đó sẽ được thêm sau khi kiểm thử nền tảng phân quyền.

## Chạy thử cục bộ

Yêu cầu Node.js 22 trở lên.

```sh
npm install
```

Thiết lập biến môi trường (PowerShell):

```powershell
$env:LAVI_DEMO_MODE="true"
$env:LAVI_JWT_SECRET="local-only-secret-at-least-32-characters"
$env:LAVI_DATA_DIR="./data"
$env:PORT="3100"
npm start
```

Mở http://localhost:3100.

Tài khoản thử:
- `teacher1` / `Demo1234!`
- `teacher2` / `Demo1234!`

Tất cả tên học sinh và tên lớp trong môi trường này đều là giả lập. Không dùng các tài khoản demo cho bất kỳ môi trường nào có dữ liệu thật.

## Kiểm tra

```sh
npm test
```

## Triển khai Render thử nghiệm

Tạo **Web Service mới**, không sửa service LAVI cũ:
- Repository: repository thử nghiệm riêng khi đã tạo được; trong giai đoạn bootstrap hiện tại, mã nằm trong thư mục `lavi2/` của nhánh `lavi-2.0-sandbox`.
- Branch: `lavi-2.0-sandbox`
- Root Directory: `lavi2`
- Build Command: `npm install`
- Start Command: `npm start`
- Environment: Node 22
- Environment variables: `LAVI_DEMO_MODE=true`, `LAVI_JWT_SECRET` (chuỗi ngẫu nhiên dài tối thiểu 32 ký tự), `LAVI_DATA_DIR=/var/data`
- Gắn Persistent Disk riêng vào `/var/data` nếu cần giữ dữ liệu thử qua lần deploy. Tuyệt đối không dùng disk hoặc secrets của LAVI production.

Tên dịch vụ, URL và cấu hình Render chỉ được xác nhận sau khi người quản trị tạo dịch vụ mới. Không kết nối nhánh này với service production.

## Đăng ký/đăng nhập thử

- Chọn tab **Đăng ký**, nhập họ tên, Gmail hoặc số điện thoại, mật khẩu và xác nhận mật khẩu.
- Khi đăng ký thành công, tài khoản giáo viên được tạo và chuyển tới trang chủ riêng. Tài khoản mới chưa có lớp.
- Đăng xuất rồi đăng nhập bằng email/số điện thoại đã đăng ký và mật khẩu.
- Để kiểm thử phân quyền demo, dùng `teacher1` hoặc `teacher2` với mật khẩu `Demo1234!`.
- Không nhập email/số điện thoại cá nhân thật trên website thử nghiệm cho tới khi có xác minh OTP và chính sách bảo mật hoàn chỉnh.

## Các API đã bổ sung trong nhánh chuẩn bị sản xuất

- `GET /api/classes/:classId/points`: tổng điểm thưởng theo học sinh trong lớp.
- `GET /api/classes/:classId/students/:studentId/points`: tổng điểm và tối đa 500 giao dịch gần nhất.
- `POST /api/classes/:classId/students/:studentId/points`: thêm giao dịch cộng/trừ điểm có lý do; điểm là số nguyên khác 0 trong khoảng -1000 đến 1000.
- `GET /api/classes/:classId/progress`: tổng hợp kết quả đã lưu và gợi ý phản hồi khích lệ theo tỷ lệ hoàn thành.

Các API này yêu cầu đăng nhập giáo viên, kiểm tra quyền sở hữu lớp ở máy chủ và ghi nhật ký kiểm toán. Đây mới là API nền; giao diện giáo viên cần được nối với API và phải kiểm thử end-to-end trước khi dùng thực tế.

## Giới hạn và bước kế tiếp

Đây là MVP để xác minh phân vùng dữ liệu; chưa phải hệ thống sẵn sàng dùng trong trường học. Trước khi mở rộng cần bổ sung kiểm thử tự động về phân quyền chéo lớp, giới hạn đăng nhập, CSRF/CORS phù hợp, quy trình reset mật khẩu, quản trị tài khoản, kiểm thử migration và backup/restore. Sau đó mới xây kho câu hỏi, nhập Excel/Word, chấm điểm, game, lịch sử điểm bất biến và sáu nhóm năng lực số.
