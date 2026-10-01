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

## 4. Persistent Disk — BẮT BUỘC để giữ điểm
Render mặc định dùng filesystem tạm thời; dữ liệu ghi vào đó có thể mất khi service redeploy/restart. Persistent Disk giữ lại dữ liệu dưới mount path. 

Cấu hình:
- Mount Path: `/var/data`
- Size: `1 GB` là đủ cho LAVI 5A ở giai đoạn hiện tại.
- Không cần đặt `LAVI_DATA_DIR` nếu dùng đúng mount path `/var/data`.

SQLite sẽ lưu tại:
`/var/data/lavi5a.sqlite`

Lưu ý: Persistent Disk hiện yêu cầu service trả phí trên Render.

## 5. Sau khi deploy
1. Mở URL Web Service và đăng nhập.
2. Kiểm tra điểm học sinh.
3. Thử cập nhật một điểm nhỏ.
4. Refresh trang và kiểm tra lại.
5. Chỉ khi điểm vẫn còn mới tiếp tục nhập/cập nhật dữ liệu hàng loạt.

Lưu ý: dữ liệu lớp học là dữ liệu cá nhân của học sinh. Chỉ chia sẻ tài khoản/đường link cho người cần sử dụng; không đưa mật khẩu mặc định lên nhóm công khai.
