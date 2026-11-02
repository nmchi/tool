# Vận hành và sao lưu

Ứng dụng dành cho một workspace với người vận hành tin cậy. Mặc định chỉ nghe loopback. Đặt mã truy cập dài khi mở ra ngoài, dùng HTTPS và khai báo `ENTITY_PUBLIC_ORIGIN` đúng origin của reverse proxy. Bản này chưa có phân quyền cho từng người dùng hoặc từng dự án.

## Sao lưu

Từ checkout, khi ứng dụng đang chạy hoặc đã dừng:

```bash
pnpm run backup /duong-dan-an-toan/entity-backup.sqlite
```

Thư mục đích phải tồn tại, tệp đích chưa tồn tại. Script dùng `VACUUM INTO` để tạo bản sao nhất quán, đặt quyền 0600 và chạy `PRAGMA integrity_check`. Không sao chép riêng tệp database đang chạy bằng lệnh copy thông thường vì có thể bỏ sót WAL.

Token trong bản sao vẫn được mã hóa. Giữ riêng khóa `data/.vault-key`, hoặc `ENTITY_VAULT_KEY` đang dùng, trong nơi lưu trữ an toàn. Không có khóa đúng sẽ không mở được các tài khoản đã lưu. Bản sao vẫn chứa thông tin dự án và email nên chỉ người có quyền quản lý workspace được truy cập.

## Khôi phục

1. Dừng ứng dụng. Giữ lại database, WAL/SHM nếu có và khóa hiện tại trước khi thay đổi, để có thể quay lại.
2. Chọn một thư mục dữ liệu mới, chưa có ứng dụng nào sử dụng; đưa bản sao vào đó với tên `entity.sqlite`, quyền 0600.
3. Cung cấp đúng khóa cũ: đặt `.vault-key` quyền 0600 trong thư mục mới hoặc giữ đúng `ENTITY_VAULT_KEY`. Không tự tạo khóa mới cho database cũ.
4. Đặt `ENTITY_DATA_DIR` tới thư mục mới rồi chạy `pnpm start` từ checkout. Kiểm tra dự án và danh tính tài khoản bằng thao tác đọc trước khi tạo lô cập nhật.

Kiểm thử backup trong repository thực sự mở bản sao, đọc dự án và giải mã lại token thử nghiệm bằng khóa gốc. Việc này không chứng minh dịch vụ bên ngoài vẫn chấp nhận token sau khôi phục.

## Khởi động lại và lịch theo dõi

Database, khóa và dependency có thể được giữ qua snapshot; tiến trình đang chạy không được giả định sẽ sống qua lần khởi động mới. Chạy lại `pnpm start`. Queue tự phục hồi lease đã hết hạn và scheduler tự tạo kiểm tra đến hạn.

Một job đang chờ xử lý/đã lỗi cần được xem xét ở giao diện. Không đăng ký lại tài khoản bị đình chỉ. Tắt theo dõi trong dự án để ngừng tạo kiểm tra mới, hoặc tạm dừng nền tảng để ngừng claim tác vụ của nền tảng đó. Thao tác đang chạy có thể hoàn tất.

## Dữ liệu nhạy cảm

Không bật log toàn bộ request/body hoặc response API. Token chỉ nhập ở biểu mẫu kết nối tài khoản, được mã hóa và không xuất lại qua state/CSV. Mã truy cập workspace chỉ lưu trong sessionStorage của tab. Khi ngắt kết nối, token bị xóa khỏi bản dữ liệu đang hoạt động; các bản sao cũ vẫn cần được quản lý và token có thể được thu hồi trên nền tảng.
