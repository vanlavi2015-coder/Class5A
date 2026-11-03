# LAVI EXPO – Render riêng

Mã nguồn được đặt trên nhánh lavi-expo-render của repo vanlavi2015-coder/Class5A. Không merge vào main và không sửa dịch vụ LAVI 5A hiện tại.

## Tạo Render Web Service mới
- Repository: https://github.com/vanlavi2015-coder/Class5A
- Branch: lavi-expo-render
- Runtime: Node
- Build command: npm install
- Start command: node expo-server.js
- Health check path: /api/health
- Chỉ chạy 1 instance vì phiên đăng nhập hiện được lưu trong bộ nhớ tiến trình.

## Environment Variables
- EXPO_TEACHER_PASSWORD: tự đặt mật khẩu giáo viên mạnh.
- EXPO_DATA_DIR: /var/data

## Persistent Disk
Gắn Persistent Disk vào service:
- Mount path: /var/data
- Size: 1 GB

Cơ sở dữ liệu JSON và tệp ảnh/video được lưu trên disk này để tồn tại qua redeploy/restart.

## Sau khi deploy
Mở https://TEN-SERVICE.onrender.com/expo/
Giáo viên đăng nhập, đặt 2–8 nhóm, nhập danh sách học sinh, tạo/in QR. Học sinh quét QR, chọn nhóm và tên. Kiểm tra nộp sản phẩm, duyệt, bình chọn, nhận xét từ ít nhất hai thiết bị.

## Lưu ý
- Không dùng filesystem tạm cho dữ liệu thật.
- Mỗi tệp tải lên tối đa 5 MB.
- Bản đầu dùng JSON trên Persistent Disk, phù hợp thử nghiệm một lớp. Khi mở rộng nên chuyển sang PostgreSQL và object storage.
- Không chia sẻ mật khẩu giáo viên.
