# Triển khai LAVI 5A Online V3 trên Render

## 1. Đưa thư mục này lên GitHub
Tạo repository riêng, upload toàn bộ mã nguồn.

## 2. Tạo Web Service
- Build Command: `npm install`
- Start Command: `npm start`
- Node: 22+

## 3. Biến môi trường
- `LAVI_JWT_SECRET`: một chuỗi bí mật dài, ngẫu nhiên.
- `LAVI_TEACHER_PASSWORD`: mật khẩu giáo viên ban đầu.
- `LAVI_DATA_DIR`: có thể bỏ trống. Khi có Persistent Disk gắn tại `/var/data`, LAVI tự động dùng `/var/data` để lưu SQLite.

## 4. Lưu dữ liệu bền vững trên Render Free

Render Free không giữ filesystem qua redeploy/restart/spin-down, nên SQLite local chỉ là bộ nhớ tạm. LAVI đã bổ sung cơ chế **sao lưu điểm mã hóa lên GitHub** để không phụ thuộc filesystem.

### Cấu hình GitHub backup
- Tạo một branch riêng tên `lavi-data` trong repository.
- Tạo **Fine-grained Personal Access Token** chỉ cấp quyền **Contents: Read and write** cho repository này.
- Trên Render → Environment thêm:
  - `LAVI_BACKUP_TOKEN` = token GitHub
  - `LAVI_BACKUP_KEY` = một chuỗi bí mật dài do cô tự đặt, ví dụ tối thiểu 32 ký tự
  - Không cần đặt `LAVI_BACKUP_REPO`, `LAVI_BACKUP_BRANCH` nếu dùng mặc định.
- LAVI mã hóa dữ liệu bằng AES-256-GCM trước khi ghi backup. File backup trên GitHub không chứa dữ liệu điểm dạng đọc được nếu không có `LAVI_BACKUP_KEY`.
- Backup được ghi vào `backup/lavi5a.enc.json` trên branch `lavi-data`, **không ghi vào branch main**, tránh mỗi lần lưu điểm lại kích hoạt deploy.

GitHub hỗ trợ Fine-grained token với quyền Contents write cho API tạo/cập nhật file. urlTài liệu GitHub về quyền tokenhttps://docs.github.com/en/rest/repos/contents

## 5. Sau khi deploy
1. Mở URL Web Service và đăng nhập.
2. Kiểm tra điểm học sinh.
3. Thử cập nhật một điểm nhỏ.
4. Refresh trang và kiểm tra lại.
5. Chỉ khi điểm vẫn còn mới tiếp tục nhập/cập nhật dữ liệu hàng loạt.

Lưu ý: dữ liệu lớp học là dữ liệu cá nhân của học sinh. Chỉ chia sẻ tài khoản/đường link cho người cần sử dụng; không đưa mật khẩu mặc định lên nhóm công khai.
