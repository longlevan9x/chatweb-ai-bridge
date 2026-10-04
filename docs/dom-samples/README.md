# DOM Samples for ChatGPT Web Reverse-Engineering

Thư mục này chứa các bản snapshot HTML thô (DOM dumps) được trích xuất từ trình duyệt web trong quá trình phân tích và dịch ngược cấu trúc giao diện của ChatGPT Web:

- **`chatgptstart.html`**: Snapshot màn hình khởi tạo cuộc trò chuyện mới (`https://chatgpt.com/`).
- **`chatgptstart2.html`**: Snapshot khi người dùng chuẩn bị nhập prompt vào ô soạn thảo.
- **`chatgpt.html`**: Snapshot đầy đủ một luồng hội thoại có các khối Markdown, code snippet và nút tương tác.

Các tệp này được lưu trữ để phục vụ mục đích kiểm tra selector ngoại tuyến (offline DOM parsing test) và không ảnh hưởng đến luồng chạy thực tế của ứng dụng.
