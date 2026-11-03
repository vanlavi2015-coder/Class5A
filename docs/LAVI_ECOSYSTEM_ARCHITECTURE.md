# LAVI – Kiến trúc hệ sinh thái giáo dục tiểu học

## Mục tiêu
Nâng cấp ứng dụng LAVI hiện hữu thành một nền tảng thống nhất phục vụ giáo viên và học sinh lớp 1–5. Giữ nguyên dữ liệu, tài khoản, lịch sử điểm/sao và các chức năng đang vận hành; mở rộng theo từng phân hệ, không thay thế toàn bộ hệ thống trong một lần.

## Nguyên tắc nâng cấp
1. Backward-compatible: API và cấu trúc dữ liệu cũ tiếp tục hoạt động trong giai đoạn chuyển đổi.
2. Data-first: mọi điểm, sao, lượt chơi, bài nộp và hoạt động phải có lịch sử; không chỉ lưu tổng số.
3. Modular monolith trước, tách dịch vụ khi có nhu cầu thực tế: giảm độ phức tạp vận hành và chi phí.
4. Role-based access: quản trị hệ thống, giáo viên, học sinh, phụ huynh; phạm vi truy cập giới hạn theo trường/lớp.
5. Mobile-first, hoạt động tốt trên máy tính, điện thoại và màn hình trình chiếu.
6. AI có kiểm soát: nội dung do AI sinh phải được giáo viên xem và duyệt trước khi giao; không tự động đưa dữ liệu học sinh nhận dạng được sang nhà cung cấp AI.
7. Bảo vệ dữ liệu trẻ em: tối thiểu hóa dữ liệu, không công khai bảng xếp hạng cá nhân mặc định, có nhật ký thao tác và cơ chế sao lưu/khôi phục.

## Kiến trúc logic

```
Web UI (Teacher / Student / Parent / Admin)
                |
          API Gateway
                |
       Application Modules
  |       |       |       |       |
Class   Learn    Game   Assign   Award
  |       |       |       |       |
  +-------+-------+-------+-------+
                |
       Shared Domain Services
 Auth/RBAC | Question Bank | AI Adapter
 Media     | Notification  | Reporting
                |
       Persistence & Storage
 SQLite hiện tại -> schema migrations -> PostgreSQL khi cần
 File storage: local/persistent disk -> object storage khi mở rộng
 Audit log + backup/restore
```

## Phân hệ sản phẩm

| Mã | Phân hệ | Phạm vi |
|---|---|---|
| CLASS | LAVI CLASS | Trường, năm học, lớp, nhóm, danh sách học sinh, hồ sơ tối thiểu |
| GAME | LAVI GAME | Thư viện game, phiên chơi, cá nhân/nhóm/toàn lớp, gọi tên ngẫu nhiên, điều khiển camera tùy chọn |
| LEARN | LAVI LEARN | Học liệu, bài học, chủ đề, khối lớp, môn học |
| ASSIGN | LAVI ASSIGN | Ngân hàng câu hỏi, tạo đề, giao bài, hạn nộp, bài nộp, chấm và phản hồi |
| AI | LAVI AI | Tạo câu hỏi từ tài liệu, gợi ý hoạt động, trợ lý giáo viên, TTS tiếng Việt; giáo viên duyệt đầu ra |
| 3D | LAVI 3D | Phòng học 3D, mô hình hình học, tương tác, triển lãm sản phẩm |
| AWARD | LAVI AWARD | Sổ cái sao thưởng, thưởng cá nhân/nhóm/đồng loạt, huy hiệu, quy tắc đổi thưởng |
| REPORT | LAVI REPORT | Báo cáo tiến bộ theo học sinh/lớp/môn/thời gian, xuất dữ liệu |
| ADMIN | LAVI ADMIN | Người dùng, vai trò, cấu hình, nhật ký, sao lưu và quản trị nội dung |

## Mô hình dữ liệu mục tiêu
- organizations, schools, academic_years, classes, class_memberships, groups
- users, roles, user_class_scopes, student_profiles
- subjects, grades, topics, learning_resources, media_assets
- question_banks, questions, question_options, games, game_sessions, game_responses
- assignments, assignment_targets, submissions, submission_answers, grading_events
- reward_ledger, reward_rules, badges, student_badges
- notifications, audit_logs, ai_generation_jobs
- schema_migrations

Các bảng hiện hữu (users, students, assignments, submissions, stars, awards, game_results, game_attempts, score_history, meta) cần được ánh xạ và di trú có kiểm tra; không xóa hoặc đổi tên trực tiếp khi chưa có backup và migration kiểm thử.

## Hợp đồng dữ liệu quan trọng
- Sao thưởng dùng sổ cái giao dịch bất biến (reward_ledger); tổng sao là giá trị tổng hợp có thể tái tính.
- Mỗi lượt chơi có session_id; lưu câu hỏi, đáp án, điểm, thời gian, người chơi và lớp tại thời điểm chơi.
- Mỗi bài nộp gắn assignment_id, student_id, attempt/version và timestamp; chấm lại tạo grading_event mới.
- Mọi thao tác quản trị quan trọng có audit log.
- Tạo mã định danh ổn định; không dựa vào tên học sinh làm khóa.

## Bảo mật và vận hành
- Băm mật khẩu; JWT ngắn hạn/refresh hoặc phiên có thu hồi; giới hạn tốc độ đăng nhập.
- Kiểm tra quyền ở server cho từng tài nguyên, không chỉ ẩn nút trên giao diện.
- Xác thực loại và dung lượng file; giới hạn upload theo cấu hình; quét/kiểm soát file khi triển khai.
- Bí mật nằm trong environment variables; không commit token hoặc khóa mã hóa.
- Backup định kỳ, kiểm tra restore định kỳ; persistent disk không thay thế backup.
- Có health check, structured logs, migration và kiểm thử API.

## Lộ trình triển khai
### P0 – Khảo sát và bảo toàn
Kiểm kê route/API, giao diện, schema, biến môi trường, Render disk/backup; lập smoke tests và chốt baseline.

### P1 – Nền tảng dùng chung
Chuẩn hóa xác thực/phân quyền, trường-năm học-lớp, API versioning, migration framework, audit log, upload/storage.

### P2 – Dạy học và trò chơi
Hợp nhất ngân hàng câu hỏi, thư viện game, game session, giao bài/nộp bài/chấm điểm.

### P3 – AI và trải nghiệm
AI sinh nội dung có duyệt, TTS tiếng Việt, gọi tên ngẫu nhiên, camera head-tilt opt-in và fallback bằng cảm ứng/bàn phím.

### P4 – Sao thưởng và báo cáo
Sổ cái sao, thưởng nhóm/đồng loạt, báo cáo tiến bộ và xuất dữ liệu.

### P5 – 3D và mở rộng trường/lớp
Tích hợp phòng học 3D, triển lãm, nhiều trường/nhiều giáo viên, phụ huynh theo phạm vi được cấp.

## Tiêu chí nghiệm thu
- Dữ liệu hiện tại không mất sau deploy/restart.
- API và chức năng đang dùng có smoke test trước/sau mỗi đợt.
- Điểm và sao không bị ghi trùng khi retry.
- Học sinh chỉ xem dữ liệu được cấp; giáo viên chỉ quản lý lớp được phân công.
- Tính năng camera xin quyền rõ ràng và có phương thức thay thế.
- Có hướng dẫn rollback và khôi phục backup.
