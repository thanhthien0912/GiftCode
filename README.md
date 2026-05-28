# 🎮 GiftCode Bot

Công cụ nhập giftcode cho **Play Together VNG** bằng Node.js + Express, lưu dữ liệu trên MongoDB và có giao diện web để quản lý người chơi, lịch sử và kết quả nhập.

## Tính năng
- Thêm người chơi từng dòng hoặc nhập hàng loạt
- Nhập giftcode cho toàn bộ danh sách hoặc từng người chơi
- Xem lịch sử, tổng hợp code đã nhập, xóa lịch sử bằng mật khẩu admin
- Giao diện gọn, chạy tốt trên desktop và mobile

## Chạy nhanh
```bash
npm install
npm start
```

## Biến môi trường
- `MONGODB_URI` — chuỗi kết nối MongoDB
- `MONGODB_DB` — tên database
- `ADMIN_PASSWORD` — mật khẩu xóa lịch sử
- `PORT` — cổng chạy ứng dụng
