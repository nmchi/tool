import { ArrowRight, CircleHelp } from 'lucide-react';

import { Button, Modal } from '../components/ui';
export function GuideModal({ close }: { close: () => void }) {
  return (
    <Modal
      title="Bắt đầu với Entity Workspace"
      description="Bản đầu tiên cho một workspace, nhiều website và nhiều nền tảng."
      onClose={close}
    >
      <div className="modal-body guide-content">
        <ol>
          <li>
            <strong>Tạo dự án.</strong>
            <p>Nhập thông tin thương hiệu thật, website, username và email bạn quản lý.</p>
          </li>
          <li>
            <strong>Chọn nền tảng.</strong>
            <p>
              Dùng danh mục có sẵn hoặc nhập URL mẫu. Xem xét độ phù hợp và bật nền tảng mới trước
              khi chạy.
            </p>
          </li>
          <li>
            <strong>Tạo lô công việc.</strong>
            <p>
              “Chuẩn bị hồ sơ” tạo quy trình đăng ký có hỗ trợ. Hoàn thiện hồ sơ trên nền tảng rồi
              nhập URL ở mục “Cần xử lý”.
            </p>
          </li>
          <li>
            <strong>Kết nối API khi phù hợp.</strong>
            <p>
              GitHub và GitLab hỗ trợ cập nhật tên, mô tả, website của tài khoản đã có. Kết nối
              token, kiểm tra tài khoản rồi tạo lô “Cập nhật qua API”.
            </p>
          </li>
          <li>
            <strong>Kiểm tra và duy trì.</strong>
            <p>
              Theo dõi tình trạng hồ sơ, khớp thương hiệu và backlink. Lưu thông tin quyền quản lý,
              email và 2FA trong chi tiết hồ sơ. Lịch kiểm tra tự động cần ứng dụng chạy liên tục.
              Xuất CSV để đối soát.
            </p>
          </li>
        </ol>
        <div className="info-strip">
          <CircleHelp size={18} />
          <p>
            Bản này chưa tự đăng ký tài khoản trên các nền tảng, chưa đọc hộp thư, xử lý CAPTCHA/2FA
            hoặc xác nhận Google lập chỉ mục. Các bước đó được bàn giao cho bạn.
          </p>
        </div>
        <div className="modal-actions">
          <Button onClick={close}>
            Đã hiểu
            <ArrowRight size={15} />
          </Button>
        </div>
      </div>
    </Modal>
  );
}
