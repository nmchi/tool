# Bộ tích hợp nền tảng

`server/connectors.js` là ranh giới thao tác với nền tảng. `server/network.js` chịu trách nhiệm proxy, kiểm tra đích công khai, timeout, giới hạn phản hồi và không tự theo redirect chứa token. Hãy giữ các bảo vệ này khi thêm adapter.

## Hợp đồng

- `identity(platform, token)` đọc tài khoản đã xác thực và trả `remote_id`, `username`, `profile_url`. Không ghi thay đổi. ID từ xa được lưu cùng nền tảng và không được chia sẻ sang dự án khác.
- `sync(project, platform, account, token)` xác nhận `remote_id` trước khi ghi; đọc trạng thái hiện tại, áp dụng payload đúng giới hạn và bỏ qua ghi nếu đã khớp. Trả URL công khai, username thật và cờ `changed`.
- `verify(project, platform, profileUrl)` đọc công khai không dùng token tài khoản. Trả trạng thái, khớp thương hiệu, backlink, phương thức và lý do. Chỉ `healthy` khi có bằng chứng phù hợp. Phân biệt `unknown`, `needs_review` và `unavailable`.
- `payloadFor` chuẩn bị nội dung từ thông tin thực tế của dự án. Mọi cắt ngắn/biến đổi cần được phản ánh trong UI và tài liệu. Không tạo địa chỉ, thông tin doanh nghiệp hoặc quyền sở hữu giả.

## Hàng đợi

Các công việc `prepare`, `verify`, `sync` được lưu trong SQLite. Chỉ claim khi lô đang mở, nền tảng đã bật, không tạm dừng, còn hạn mức tốc độ và không có job khác đang chạy cho cùng dự án–nền tảng. Tối đa hai job đang chạy toàn database.

Lease 90 giây được gia hạn mỗi 20 giây. Mất tiến trình sẽ được phục hồi khi lease hết hạn. Việc cập nhật API hiện tại là idempotent và đọc trước khi ghi; đây là điều kiện cần để phục hồi an toàn. Chưa hỗ trợ adapter tự tạo tài khoản mới: trước khi thêm, phải có đối soát kết quả tạo không chắc chắn, khóa chống trùng và kiểm thử gián đoạn sau thao tác từ xa.

Lỗi 429/5xx/mạng thử lại tối đa ba lần với backoff và cooldown chung theo origin. Lỗi quyền hoặc phản hồi sai cấu trúc được bàn giao cho người quản lý. Hủy/tạm dừng lô ngăn công việc mới, cho phép thao tác đã bắt đầu hoàn tất. Thay đổi thông tin dự án làm job cũ cần người quản lý tiếp tục với phiên bản mới.

## Kiểm thử adapter mới

Kiểm tra read-before-write, chạy lại sau phản hồi bị mất, tài khoản không khớp, thiếu quyền, rate limit, sai cấu trúc, redirect, hồ sơ bị chặn và trạng thái công khai không khớp dữ liệu vừa gửi. Fixture kiểm thử phải tách khỏi logic sản phẩm. Không báo API đã kiểm thử thật khi chỉ có fixture.

Các hồ sơ HTML chỉ được xác minh theo heuristic công khai: tên thương hiệu trong nội dung và liên kết trực tiếp đúng domain. Đây không phải xác nhận chủ sở hữu của nền tảng, không hỗ trợ trang chỉ render bằng JavaScript và chưa giải mã redirect backlink. Kết quả cần kiểm tra thủ công khi có nghi ngờ.
