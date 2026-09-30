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
- `LAVI_DATA_DIR`: `/opt/render/project/src/data` nếu dùng Persistent Disk tại `/opt/render/project/src/data`.

## 4. Persistent Disk
Nếu dịch vụ hỗ trợ Persistent Disk, gắn disk vào đúng thư mục `LAVI_DATA_DIR`. SQLite sẽ lưu tại `lavi5a.sqlite` trong thư mục này.

## 5. Sau khi deploy
Mở URL của Web Service và đăng nhập bằng tài khoản giáo viên. Đổi mật khẩu ngay.

Lưu ý: dữ liệu lớp học là dữ liệu cá nhân của học sinh. Chỉ chia sẻ tài khoản/đường link cho người cần sử dụng; không đưa mật khẩu mặc định lên nhóm công khai.
