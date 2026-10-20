# LAVI 2.0 — Kiến trúc và lộ trình phát triển

> Trạng thái: tài liệu thiết kế; chưa thay đổi mã production, chưa triển khai Render.
> Nhánh tài liệu: `docs/lavi-2.0-roadmap`.

## 1. Mục tiêu

Phát triển LAVI từ công cụ giao bài/trò chơi thành nền tảng lớp học số đa giáo viên, đa lớp, có dữ liệu bền vững và hỗ trợ phát triển sáu nhóm năng lực số của học sinh tiểu học.

Nguyên tắc:
- Ưu tiên tính đúng đắn, an toàn dữ liệu và phân quyền trước tính năng mới.
- Giữ nguyên production; mọi thay đổi mã chạy trong nhánh riêng và môi trường thử nghiệm.
- Không coi điểm trò chơi, thời gian trực tuyến hoặc số lần đăng nhập là bằng chứng độc lập về năng lực số.
- AI hỗ trợ học tập, không tự quyết định đánh giá quan trọng; giáo viên xem xét các đề xuất.
- Thu thập dữ liệu tối thiểu, đặc biệt với trẻ em; không đưa thông tin định danh học sinh vào dịch vụ AI bên ngoài nếu chưa được phê duyệt.

## 2. Kiến trúc logic

1. **Giao diện**: không gian giáo viên, học sinh, phụ huynh và quản trị.
2. **API**: xác thực phiên, kiểm tra vai trò, kiểm tra quyền trên từng trường/lớp/tài nguyên, xác thực dữ liệu đầu vào.
3. **Dịch vụ nghiệp vụ**:
   - Quản lý trường, giáo viên, lớp và thành viên.
   - Kho học liệu/kho bài tập, nhập Excel/Word, giao bài, bài nộp, chấm điểm.
   - Trò chơi, lượt chơi, bảng xếp hạng và lịch sử điểm.
   - Hồ sơ học tập và hồ sơ năng lực số dựa trên minh chứng.
   - Thông báo, lịch học và báo cáo.
   - Trợ lý AI có giới hạn, nhật ký và bước duyệt của giáo viên.
4. **Lớp dữ liệu**: SQLite có thể tiếp tục dùng cho thử nghiệm hiện tại nếu được chứng minh bền vững; trước khi mở rộng lớn cần đánh giá PostgreSQL. Không đổi hệ quản trị chỉ vì xu hướng; quyết định dựa trên tải, backup, giao dịch và khả năng vận hành.
5. **Vận hành**: cấu hình bí mật qua biến môi trường, log không chứa mật khẩu/token, health check, backup có mã hóa, kiểm tra phục hồi và hướng dẫn rollback.

## 3. Mô hình dữ liệu đề xuất

Các bảng chính và quan hệ:

- `schools(id, name, status, created_at)`
- `users(id, username, password_hash, role, status, created_at)`
- `school_memberships(id, school_id, user_id, role)`: người dùng thuộc trường nào và có vai trò gì.
- `classes(id, school_id, name, grade, academic_year, owner_teacher_id, status)`
- `class_memberships(id, class_id, user_id, student_code, membership_role, status)`: một học sinh có thể chuyển lớp mà không phải tạo lại lịch sử.
- `parent_student_links(id, parent_user_id, student_user_id, relationship, verified_at)`
- `learning_resources(id, school_id, owner_user_id, title, subject, grade, visibility, content_json, created_at, updated_at)`
- `assignments(id, class_id, resource_id, created_by, status, due_at, created_at)`
- `submissions(id, assignment_id, student_user_id, attempt_no, response_json, score, feedback, submitted_at, graded_by, graded_at)`
- `game_attempts(id, class_id, student_user_id, resource_id, score, correct_count, question_count, duration_seconds, played_at)`
- `score_events(id, class_id, student_user_id, source_type, source_id, points_delta, reason, created_by, created_at)`: lịch sử bất biến; tổng điểm là dữ liệu tổng hợp có thể tái tạo.
- `competency_frameworks(id, version, name, status)`
- `competency_indicators(id, framework_id, code, domain, description, grade_band, rubric_json)`
- `competency_evidence(id, student_user_id, class_id, indicator_id, source_type, source_id, evidence_url_or_json, teacher_note, observed_at, reviewed_by, status)`
- `audit_events(id, actor_user_id, school_id, class_id, action, resource_type, resource_id, result, created_at)`
- `backup_runs(id, started_at, completed_at, status, checksum, restore_tested_at)`

### Ràng buộc dữ liệu bắt buộc

- Dùng khóa ngoại, chỉ mục và giao dịch cho các thao tác liên quan nhiều bảng.
- Mọi tài nguyên thuộc lớp/trường đều phải có phạm vi sở hữu rõ ràng.
- Mỗi API đọc/ghi phải kiểm tra quyền ở máy chủ; ẩn nút trên giao diện không phải là phân quyền.
- Không dùng `student_id` toàn cục nếu mã chỉ duy nhất trong một lớp; dùng ID nội bộ ổn định và ràng buộc duy nhất theo phạm vi phù hợp.
- Chuyển lớp không được làm mất bài nộp, điểm hoặc minh chứng cũ.
- Ghi lịch sử điểm bằng sự kiện; sửa điểm phải có người sửa, thời gian, lý do và giá trị trước/sau.
- Các bảng cũ cần migration có phiên bản, chạy trong transaction và có backup trước migration.

## 4. Sáu nhóm năng lực số

1. **Sử dụng thiết bị và công cụ số**: hoàn thành thao tác học tập, quản lý tệp, nộp bài.
2. **Tìm kiếm và xử lý thông tin**: tìm theo yêu cầu, chọn nguồn phù hợp, so sánh và kiểm chứng thông tin.
3. **Giao tiếp và hợp tác số**: làm việc nhóm, phản hồi lịch sự, tôn trọng quy tắc lớp học.
4. **Sáng tạo nội dung số**: tạo bài trình bày, áp phích, truyện, sản phẩm đa phương tiện và ghi nguồn.
5. **An toàn và trách nhiệm số**: bảo vệ thông tin cá nhân, mật khẩu, nhận diện hành vi không an toàn, bản quyền và ứng xử có trách nhiệm.
6. **Giải quyết vấn đề bằng công nghệ**: chọn công cụ, thử nghiệm, phát hiện/sửa lỗi và sử dụng AI có kiểm chứng.

Mỗi chỉ báo cần có rubric theo lứa tuổi (ví dụ: cần hỗ trợ / đang hình thành / thực hiện độc lập / vận dụng linh hoạt), kèm minh chứng. Giáo viên xác nhận minh chứng quan trọng; hệ thống không suy luận năng lực chỉ từ một điểm số.

## 5. Lộ trình kỹ thuật

### Giai đoạn 0 — Khảo sát và đóng băng mốc an toàn
- Xác định chính xác production commit, branch và biến môi trường; không in bí mật vào log.
- Kiểm kê API, bảng SQLite, nơi lưu tệp, luồng sao lưu/khôi phục và các PR đang mở.
- Tạo bản sao dữ liệu thử nghiệm đã loại bỏ thông tin nhận dạng.
- Chốt bộ kiểm thử hồi quy cho đăng nhập, giao bài, nhập Excel/Word, chấm điểm, trò chơi và lịch sử điểm.

**Điều kiện qua giai đoạn:** có sơ đồ hệ thống hiện tại, backup đọc được và một lần phục hồi thử thành công.

### Giai đoạn 1 — Ổn định nền tảng
- Bảo đảm không có mật khẩu mặc định/fallback trong môi trường production; buộc đổi mật khẩu khởi tạo.
- Chuẩn hóa xử lý lỗi API, xác thực dữ liệu, session/JWT, giới hạn yêu cầu và quyền truy cập.
- Kiểm tra điểm không bị ghi trùng, lượt chơi được lưu bền vững và khôi phục đúng.
- Thêm test tự động chạy trong CI cho các luồng quan trọng.
- Kiểm tra migration, backup mã hóa, checksum và quy trình restore.

**Điều kiện qua giai đoạn:** kiểm thử hồi quy xanh; backup/restore được diễn tập; không còn lỗi nghiêm trọng đã biết trong luồng xác thực, phân quyền hoặc điểm.

### Giai đoạn 2 — Đa giáo viên, đa lớp
- Chốt mô hình trường/lớp/thành viên và quyền của từng vai trò.
- Di chuyển dữ liệu lớp 5A hiện có sang phạm vi của giáo viên hiện tại bằng migration có thể kiểm tra.
- Thử Teacher A và Teacher B: không thể đọc, sửa, xóa hoặc chấm dữ liệu chéo lớp bằng giao diện lẫn gọi API trực tiếp.
- Kiểm tra học sinh chỉ xem bài được giao cho lớp của mình; phụ huynh chỉ xem học sinh đã liên kết và xác minh.
- Chỉ sau khi kiểm thử đạt mới mở rộng tài khoản.

**Điều kiện qua giai đoạn:** test cách ly tenant/lớp đạt 100%; không có rò rỉ dữ liệu trong kiểm thử chéo vai trò.

### Giai đoạn 3 — Lớp học số
- Kho học liệu và kho bài tập dùng chung theo quyền.
- Giao bài, hạn nộp, bài nộp, phản hồi, đánh giá lại và báo cáo.
- Hồ sơ học tập số, sản phẩm và nhật ký tiến bộ.
- Tối ưu giao diện cho điện thoại/mạng yếu; lưu bản nháp và báo lỗi rõ ràng.

### Giai đoạn 4 — Hồ sơ năng lực số
- Ban hành bộ chỉ báo và rubric theo khối lớp.
- Liên kết minh chứng từ bài tập, sản phẩm, hoạt động hợp tác và tình huống an toàn số.
- Cho giáo viên xác nhận, bổ sung nhận xét và sửa đánh giá có lưu vết.
- Báo cáo tiến bộ theo thời gian, không xếp hạng học sinh chỉ dựa vào điểm năng lực.

### Giai đoạn 5 — AI và mở rộng trường
- AI tạo câu hỏi/học liệu trong vùng nháp; giáo viên duyệt trước khi giao.
- AI giải thích và gợi ý từng bước, khuyến khích học sinh tự suy nghĩ thay vì chỉ đưa đáp án.
- Kiểm soát nội dung, giới hạn dữ liệu gửi đi, nhật ký sử dụng và cơ chế báo cáo nội dung không phù hợp.
- Thử tải, đánh giá chi phí, sao lưu, giám sát và quy trình hỗ trợ trước khi mở cho trường khác.

## 6. Bộ kiểm thử bắt buộc

- **Xác thực:** tài khoản sai, token hết hạn, tài khoản bị khóa, mật khẩu khởi tạo.
- **Phân quyền:** Teacher A không đọc/sửa/xóa dữ liệu Teacher B; học sinh không gọi được API giáo viên; phụ huynh không xem học sinh chưa liên kết.
- **Dữ liệu:** khởi động lại không mất dữ liệu; nhiều yêu cầu đồng thời không làm mất điểm; thao tác thất bại không để dữ liệu nửa chừng.
- **Nhập câu hỏi:** file rỗng, sai cột, câu trùng, thiếu đáp án, đáp án không hợp lệ, tiếng Việt có dấu, Word/Excel mẫu và file lớn.
- **Chấm điểm:** trắc nghiệm, tự luận, câu bị bỏ qua, số câu khác 10, quy tắc làm tròn và sửa điểm.
- **Trò chơi:** giới hạn lượt, lưu điểm tốt nhất, xóa bộ bài, bài đã giao và bài trong kho.
- **Sao lưu:** tạo backup, kiểm tra checksum, phục hồi vào môi trường tách biệt, so sánh số bản ghi và tổng điểm.
- **Năng lực số:** mỗi đánh giá phải truy ra chỉ báo, rubric, minh chứng và người xác nhận.
- **Bảo mật:** dữ liệu không thuộc lớp bị từ chối ở API; không ghi token/mật khẩu vào log; bí mật chỉ được đọc từ biến môi trường.

## 7. Quy trình phát triển và triển khai an toàn

1. Tạo branch tính năng từ nhánh đã được xác nhận là nền tảng chuẩn; không ghép mù các branch cũ.
2. Mỗi PR chỉ xử lý một nhóm thay đổi; có migration và test đi kèm nếu sửa dữ liệu.
3. CI chạy kiểm tra cú pháp, unit/integration tests và kiểm tra bảo mật cơ bản.
4. Deploy vào dịch vụ thử nghiệm riêng với database riêng và dữ liệu giả lập.
5. Thử bằng ít nhất hai giáo viên, hai lớp và các vai trò học sinh/phụ huynh.
6. Tạo backup trước migration; thử khôi phục backup vào môi trường riêng.
7. Chỉ khi có phê duyệt rõ ràng mới lập kế hoạch cập nhật production.
8. Khi triển khai production: có cửa sổ bảo trì, backup xác nhận, kiểm tra health/login/giao bài/điểm và kế hoạch rollback cụ thể.
9. Nếu kiểm thử thất bại, tắt thay đổi hoặc quay lại bản đã biết ổn định; không khôi phục dữ liệu bằng cách ghi đè mù.

## 8. Rủi ro cần xử lý sớm từ mã hiện tại

- Một số branch tính năng nhập Excel/Word và kho bài tập được tạo từ nhánh cũ chưa bao gồm nhánh đa giáo viên. Không merge trực tiếp các branch đó trước khi hợp nhất và kiểm tra lại phân quyền.
- Mô hình hiện tại dùng SQLite và một số bảng điểm/lịch sử có khóa chính theo học sinh/trò chơi; cần xác minh các khóa này không gây đụng dữ liệu giữa các lớp trước khi triển khai đa lớp.
- Các luồng backup cần kiểm tra khả năng phục hồi đầy đủ tài khoản, quan hệ lớp, bài nộp, lịch sử điểm và dữ liệu mới, không chỉ danh sách học sinh.
- Các PR đang mở cần được kiểm tra conflict, CI và phạm vi thay đổi trước khi chọn làm nền tảng.
- Không xem PR draft hoặc kiểm tra cú pháp là bằng chứng đủ để triển khai.

## 9. Tiêu chí nghiệm thu LAVI 2.0

- 100% kiểm thử phân quyền chéo lớp trong bộ test đạt.
- Không mất dữ liệu trong các thử nghiệm restart/restore được xác định.
- Nhập mẫu Excel và Word đã được kiểm thử bằng file thật; lỗi nhập hiển thị rõ ràng và không tạo bài lỗi.
- Điểm và lịch sử điểm khớp sau khi tải lại, khởi động lại và khôi phục backup.
- Mỗi hồ sơ năng lực số có minh chứng truy xuất được và rubric rõ ràng.
- Giáo viên kiểm soát nội dung được AI tạo; học sinh được hướng dẫn sử dụng AI có trách nhiệm.
- Có hướng dẫn vận hành, sao lưu, phục hồi, xử lý sự cố và rollback.
- Production chưa được thay đổi nếu chưa có phê duyệt rõ ràng.

## 10. Bước tiếp theo

Trước khi viết thêm tính năng, cần rà soát nhánh đa giáo viên hiện có, PR nhập Excel/Word và PR kho bài tập; chọn một nền tảng chuẩn, xử lý khác biệt và chạy lại toàn bộ kiểm thử. Sau đó triển khai Giai đoạn 0–1 trước, chưa đưa hồ sơ năng lực số và AI vào production.
