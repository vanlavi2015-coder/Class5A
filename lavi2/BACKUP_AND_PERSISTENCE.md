# LAVI 2.0 — Sao lưu bền vững

## Mục tiêu
Không mất dữ liệu lớp, học sinh, ngân hàng câu hỏi, bài kiểm tra, kết quả và sổ điểm thưởng khi ứng dụng khởi động lại hoặc deploy phiên bản mới.

## 1. Lưu cơ sở dữ liệu trên Persistent Disk
- Tạo một Web Service Render riêng cho LAVI 2.0; không thay đổi service LAVI 5A đang hoạt động.
- Gắn Persistent Disk riêng cho LAVI 2.0 tại đường dẫn `/var/data`.
- Đặt biến môi trường `LAVI_DATA_DIR=/var/data`.
- Giữ `LAVI_JWT_SECRET` ổn định qua các lần deploy; không đưa giá trị bí mật vào GitHub.
- Không dùng chung disk giữa LAVI 2.0 và LAVI 5A.
- Kiểm tra log khởi động để xác nhận ứng dụng đang dùng `/var/data/lavi2-sandbox.sqlite`. Chỉ cấu hình biến môi trường không đủ nếu chưa gắn disk thật.

## 2. Sao lưu ra tệp độc lập
LAVI 2.0 có API xuất dữ liệu `GET /api/backup` và khôi phục `POST /api/backup/restore`. Giao diện sao lưu cho phép tải tệp JSON về thiết bị. Tệp bao gồm lớp, học sinh, ngân hàng câu hỏi, câu hỏi, bộ đề, bài giao, kết quả, lịch sử điểm thưởng và nhật ký kiểm toán của tài khoản giáo viên.

- Giáo viên đăng nhập rồi mở mục Sao lưu.
- Tải tệp JSON xuống máy tính và lưu thêm một bản ở nơi an toàn khác.
- Đặt tên tệp theo ngày; không gửi tệp qua nhóm công khai vì có dữ liệu học sinh.
- Thử khôi phục bằng một bản sao kiểm thử trước khi cần khôi phục dữ liệu thật.

## 3. Kiểm tra sao lưu sau khi triển khai
- Tạo một lớp kiểm thử, thêm học sinh và một giao dịch điểm thử.
- Tải bản sao lưu xuống thiết bị.
- Khởi động lại/redeploy service và xác nhận dữ liệu kiểm thử vẫn còn.
- Kiểm tra tệp sao lưu có các mảng `classes`, `students`, `question_banks`, `questions`, `test_sets`, `test_set_questions`, `assignments`, `scores`, `point_transactions`, `audit_events`.
- Kiểm tra khôi phục trên môi trường riêng, không thử lần đầu trên dữ liệu thật.

## 4. Giới hạn hiện tại — cần nói rõ
- API xuất JSON là thao tác thủ công, không phải bản sao lưu tự động theo lịch.
- Persistent Disk bảo vệ dữ liệu SQLite khỏi việc filesystem tạm bị xóa khi deploy/restart, nhưng không thay thế bản sao lưu độc lập.
- Khôi phục hiện tại là kiểu bổ sung dữ liệu, tạo ID mới và không xóa dữ liệu đang có; không phải phục hồi nguyên trạng/rollback.
- Chưa được tuyên bố “sao lưu bền vững đã xác minh” cho đến khi Render có disk riêng, health check đạt và đã thử khởi động lại cùng khôi phục.
- Bản LAVI 2.0 vẫn đang ở nhánh chuẩn bị sản xuất; không đưa dữ liệu học sinh thật vào trước khi vượt qua các cổng bảo mật và kiểm thử.

## 6. Snapshot SQLite tự động trên máy chủ (mới bổ sung trong nhánh chuẩn bị)

Khi tiến trình Node chạy liên tục, LAVI 2.0 tạo snapshot SQLite đầu tiên khoảng một phút sau khi khởi động, sau đó mỗi 24 giờ. Snapshot dùng `VACUUM INTO` để tạo tệp cơ sở dữ liệu nhất quán, giữ tối đa 14 bản gần nhất trong thư mục `backups` bên trong `LAVI_DATA_DIR`.

- API trạng thái: `GET /api/backup/status` (cần đăng nhập giáo viên).
- Trạng thái trả về thư mục lưu, thời điểm snapshot gần nhất, kích thước tệp và lỗi gần nhất.
- Nếu `LAVI_DATA_DIR` không trỏ tới `/var/data`, API sẽ báo `persistentDiskConfigured: false`.
- Đây là snapshot cùng ổ đĩa, không phải bản sao ngoài hệ thống. Nếu ổ đĩa bị mất hoặc bị xóa, các snapshot này cũng có thể mất.
- Snapshot đầu tiên chỉ chạy khi tiến trình máy chủ thực sự khởi động; việc mã nguồn có chức năng này không chứng minh Render đã gắn Persistent Disk hoặc lịch sao lưu đã chạy thành công.

## 5. Khuyến nghị vận hành
Trước khi dùng thật, cần thêm bản sao lưu tự động định kỳ tới kho riêng được mã hóa, theo dõi kết quả sao lưu và thử khôi phục định kỳ. Không lưu token hoặc khóa mã hóa trong mã nguồn.
