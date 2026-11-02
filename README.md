# Entity Workspace

Ứng dụng web tiếng Việt để quản lý entity profile cho **nhiều website/thương hiệu** trong một workspace. Mỗi dự án có thông tin, tài khoản, hồ sơ và hàng đợi riêng. Không có domain khách hàng nào được dùng làm cấu hình mặc định của dự án.

## Khả năng của bản 0.1

- Tạo và chỉnh sửa dự án; chuẩn hóa tên, website, username, mô tả, email và URL logo.
- Nhập TXT/CSV hoặc dán danh sách URL: xem trước, lọc trùng, phân loại sơ bộ hồ sơ/bài đăng/chuyển hướng/báo cáo. Phân loại dựa trên URL, chưa khẳng định trang còn hoạt động.
- Hai chế độ nhập riêng: **danh mục nền tảng từ URL mẫu** và **hồ sơ thực tế của một dự án**. Danh mục mới mặc định chưa bật; hồ sơ đang có được giữ nguyên khi nhập hàng loạt.
- Tạo lô tối đa 500 cặp dự án–nền tảng; chống trùng công việc đang mở, tạm dừng/tiếp tục/hủy lô, phục hồi lease sau gián đoạn.
- Đăng ký có hỗ trợ: chuẩn bị thông tin, chuyển bước đăng ký/xác minh cho người quản lý, nhận URL rồi kiểm tra công khai.
- **GitHub và GitLab:** xác thực token và kiểm tra đúng tài khoản. GitHub: cập nhật tên/mô tả/website qua API, đọc trước khi ghi để chạy lại an toàn. GitLab: API chỉ cho quản trị viên sửa hồ sơ, nên ứng dụng chỉ đối chiếu và bàn giao cho người quản lý khi chưa khớp. Một tài khoản API chỉ thuộc một dự án trong bản này.
- **Hộp thư xác minh:** kết nối Gmail/Google Workspace bằng App Password (IMAP), Google Workspace bằng service account (Gmail API, chỉ đọc, domain-wide delegation), IMAP khác, hoặc chế độ thủ công. Mỗi website bắt buộc có email riêng (không trùng website khác, kể cả biến thể `+tag` hay dấu chấm của Gmail); mọi hồ sơ entity của website dùng đúng email đó. Hộp thư Workspace có thể nhận alias của nhiều website; Gmail cá nhân chỉ phục vụ website có email trùng địa chỉ Gmail. Kết nối được kiểm tra trước khi lưu; bí mật được mã hóa như token. Chưa dùng để tự đăng ký (giai đoạn tiếp theo).
- **Schema entity:** sinh JSON-LD `Organization`/`Person` với `sameAs` gồm các hồ sơ đang ở trạng thái “Đang hoạt động”, để dán vào trang chủ.
- Kiểm tra hồ sơ: tách tình trạng trang, khớp thương hiệu, backlink và chỉ thị `noindex`. Trang đăng nhập/CAPTCHA, HTTP 403 hoặc lỗi mạng không được coi là hồ sơ đã xác minh hay đã bị xóa.
- Lưu bằng chứng dạng dữ liệu, lịch sử kiểm tra, lịch sử tác vụ; thông tin sở hữu/email/2FA do người quản lý khai báo được phân biệt với kết quả kiểm tra tự động.
- Theo dõi sau 1/7/30 ngày kể từ lần xác minh đầu, sau đó mỗi 30 ngày; cần ứng dụng đang chạy. Tác vụ đang chờ người xử lý không được tự tạo lại.
- Token mã hóa AES-256-GCM, gắn với ID tài khoản; CSV không chứa token. Có công cụ sao lưu SQLite và kiểm tra toàn vẹn.

**Phạm vi tự động hóa:** bản này chưa tự tạo tài khoản mới trên các website, chưa tự đọc hộp thư, tải logo, xử lý CAPTCHA/2FA, hay xác nhận Google lập chỉ mục. Các URL có JavaScript động hoặc liên kết trung gian có thể cần kiểm tra thủ công. Các adapter API được kiểm thử bằng phản hồi giả lập; chưa xác nhận bằng tài khoản thật.

## Chạy

Yêu cầu **Node.js 24+**, pnpm **11.25.0** và thư mục ghi được cho dữ liệu. Không cần dịch vụ database riêng.

```bash
cd tool
corepack enable
corepack install
pnpm install --frozen-lockfile
pnpm run build
pnpm start
```

Corepack dùng phiên bản pnpm đã ghim trong `package.json`. Trong cloud environment, checkout có sẵn tại `/workspace/tool`; chuyển vào đó thay vì clone lại. Chỉ dùng `pnpm-lock.yaml`; không tạo lockfile của trình quản lý khác.

Server mặc định nghe trên loopback, cổng **4310**, phục vụ cả API và giao diện. Dữ liệu được tạo trong `data/`. Có thể dừng bằng Ctrl+C; dữ liệu và hàng đợi vẫn được giữ. Tác vụ đang chạy bị ngắt đột ngột được phục hồi sau khi lease 90 giây hết hạn.

Khi server đang chạy, dùng `pnpm run smoke` ở terminal khác để kiểm tra giao diện build và API nội bộ. Kiểm tra này không gọi nền tảng bên ngoài hoặc tạo công việc.

Để phát triển với giao diện tự cập nhật:

```bash
pnpm run dev
```

Giao diện phát triển dùng cổng **5173**, API dùng **4310**. Chạy các lệnh từ checkout hiện có; mỗi cloud task đã được cô lập, không cần tạo Git worktree mới.

`pnpm start` và server phát triển đọc `.env` nếu có. Xem [.env.example](.env.example). Khi mở truy cập ngoài máy, phải đặt `ENTITY_ACCESS_TOKEN` tối thiểu 24 ký tự. Khi dùng reverse proxy, cấu hình `ENTITY_PUBLIC_ORIGIN` đúng origin giao diện và dùng HTTPS. Đây là workspace dùng chung một mã truy cập, chưa có tài khoản người dùng/RBAC hoặc phân quyền SaaS.

## Quy trình đầu tiên

1. Tạo dự án bằng thông tin thương hiệu của bạn.
2. Trong **Nền tảng**, xem danh mục có sẵn hoặc nhập URL mẫu. Nút **Nạp danh sách tham khảo** dùng dữ liệu URL bạn đã cung cấp trong `examples/reference-urls.txt`; các tên/domain trong tệp chỉ là dữ liệu tham khảo, không được gán cho dự án mới.
3. Xem xét nền tảng, URL đăng ký và khả năng hỗ trợ trước khi bật. Bản này gộp theo hostname đã bỏ `www`, không tự coi các subdomain/ngôn ngữ là cùng một tài khoản.
4. Tạo lô **Chuẩn bị hồ sơ**. Trong **Cần xử lý**, sao chép thông tin, mở nền tảng, hoàn tất các bước đăng ký/xác minh và cung cấp URL công khai.
5. Nếu có hồ sơ sẵn, dùng **Thêm URL** hoặc nhập ở chế độ **Hồ sơ của dự án**, rồi tạo lô **Kiểm tra hồ sơ**.
6. Với GitHub/GitLab, kết nối token của đúng tài khoản rồi tạo lô **Cập nhật qua API**. GitHub dùng tối đa 160 ký tự mô tả và được cập nhật tự động; GitLab (255 ký tự) được đối chiếu, nếu chưa khớp thì công việc chuyển sang **Cần xử lý** để bạn sửa trên gitlab.com.
7. Mở chi tiết hồ sơ để khai báo quyền quản lý/email/2FA, xem lịch sử và kiểm tra lại. Xuất CSV ở trang hồ sơ hoặc hàng đợi.
8. Khi đã có hồ sơ đang hoạt động, bấm **Schema** trên thẻ dự án để sao chép JSON-LD và dán vào `<head>` trang chủ. Tạo lại sau khi có thêm hồ sơ được xác minh.

GitHub cần token được phép đọc và cập nhật hồ sơ người dùng (`user` với classic token, hoặc quyền Profile tương ứng khi loại token hỗ trợ). GitLab cần quyền `read_user`. Kết nối thành công xác nhận khả năng đọc danh tính; quyền ghi còn được kiểm tra khi chạy cập nhật. Hãy dùng giao diện tài khoản để nhập token; không nhập mật khẩu vào mô tả hoặc tệp URL.

## Mạng

Ứng dụng giữ proxy HTTP/HTTPS và CA trust của môi trường. Không tắt xác minh TLS. API GitHub dùng `api.github.com`; GitLab dùng `gitlab.com`. Kiểm tra HTML cần hostname của nền tảng tương ứng, kể cả biến thể `www` trong URL.

Trong cloud environment có allowlist, cần cho phép đúng hostname trong environment settings trước khi chạy với tài khoản thật. Việc bật nền tảng trong ứng dụng không thay đổi chính sách mạng của máy. Các adapter không theo chuyển hướng khi gửi token; trình kiểm tra HTML chỉ theo chuyển hướng trong cùng hostname đã chuẩn hóa. URL nội bộ, địa chỉ IP, cổng tùy ý và DNS trỏ về mạng riêng bị từ chối.

## Kiểm thử

```bash
pnpm run check
pnpm run test:e2e
pnpm audit
```

`check` chạy build/type-check và các kiểm thử nghiệp vụ/API. E2E mở Chromium để kiểm tra hai dự án, bàn giao thủ công, xác minh nội dung, metadata quản lý, API cập nhật, nhập danh mục và xuất CSV. **Các nền tảng bên ngoài được giả lập; không tạo/cập nhật tài khoản thật trong test.** Dữ liệu test nằm trong thư mục tạm và được dọn sau chạy.

E2E dùng `CHROMIUM_PATH` nếu đặt, sau đó thử Chromium hệ thống ở `/usr/bin/chromium`, hoặc trình duyệt Playwright đã cài. Để cài trình duyệt trên máy khác:

```bash
pnpm exec playwright-core install --with-deps chromium
```

Ảnh chụp test nằm trong `test-results/` và không được đưa vào Git.

## Dữ liệu và vận hành

- `data/entity.sqlite`: dự án, hồ sơ, công việc, metadata tài khoản và token đã mã hóa.
- `data/.vault-key`: khóa cục bộ tạo với quyền 0600 nếu không dùng `ENTITY_VAULT_KEY`. Giữ khóa này khi di chuyển/khôi phục dữ liệu; không đưa vào Git hoặc báo cáo.
- `dist/`: giao diện sau build, có thể tạo lại bằng `pnpm run build`.

Hướng dẫn sao lưu/khôi phục: [docs/OPERATIONS.md](docs/OPERATIONS.md). Hướng dẫn mở rộng adapter: [docs/CONNECTORS.md](docs/CONNECTORS.md).

Giới hạn hiện tại: một hồ sơ chính cho mỗi dự án–nền tảng; danh mục gộp theo hostname, chưa gộp các alias phức tạp; chưa có trình duyệt đăng ký tự động, hộp thư, thông báo ngoài ứng dụng, báo cáo cohort tuổi thọ 30/90/180 ngày hay quản trị nhiều người dùng. Queue hiển thị 2.000 tác vụ gần nhất, CSV xuất toàn bộ; lịch sử chi tiết có tối đa 100 mục gần nhất mỗi lần đọc.
