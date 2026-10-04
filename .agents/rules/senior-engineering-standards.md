# Senior Engineering & Optimization Standards (Always On)

Tất cả các tác vụ lập trình, chỉnh sửa mã nguồn hoặc tái cấu trúc trong dự án này phải tuân thủ nghiêm ngặt các quy tắc sau:

1. **Typed Domain Errors**: Tuyệt đối không ném `new Error("...")` chung chung. Luôn dùng các Custom Error Classes từ `server/errors.js` (kế thừa `BridgeError`).
2. **Centralized Configuration**: Không sử dụng Magic Numbers. Tất cả thời gian timeout, cổng mạng, ngưỡng bộ nhớ phải lấy từ `server/config.js` và hỗ trợ ghi đè qua `process.env`.
3. **Memory Safety**: Mọi cấu trúc dữ liệu lưu trữ (Sessions, Buffers, Caches) phải có ngưỡng trần giới hạn (capping) và cơ chế dọn dẹp LRU / TTL.
4. **AbortSignal Handling**: Các API bất đồng bộ phải bọc `AbortController` và lắng nghe `req.on('aborted')` để dừng tác vụ trong TaskQueue khi client ngắt kết nối.
5. **Safe Messaging in Content Scripts**: Trong Content Script của Chrome Extension, không gọi trực tiếp `chrome.runtime.sendMessage(...)` trần. Luôn dùng `safeSendMessage()` và kiểm tra `isExtensionValid()` để triệt tiêu lỗi `Extension context invalidated`.
6. **Google Trusted Types Compliance**: Tuyệt đối không gán chuỗi trực tiếp vào `.innerHTML` hoặc `.outerHTML` trên các trang thuộc Google (`gemini.google.com`). Luôn dùng `document.createElement()`, `document.createTextNode()` và `replaceWith()`.
7. **Single Concurrency on Browser Automation**: Thao tác tự động hóa tab trình duyệt phải luôn được tuần tự hóa với `Concurrency = 1` qua `TaskQueue`.
8. **Graceful Shutdown**: Server Node.js phải xử lý tín hiệu `SIGINT` và `SIGTERM` để đóng sạch WebSocket clients và HTTP server trước khi thoát tiến trình.
9. **Separation of Concerns & SOLID**:
   - **Single Responsibility (S)**: Phân tách rõ ràng giữa Routes (`server/routes/`), View Presentation (`server/views/`), WebSocket Hub (`server/websocket.js`) và Orchestrator (`server/server.js`).
   - **Open/Closed (O)**: Mở rộng thêm Provider mới qua cấu hình và Content Script độc lập mà không can thiệp vào lõi Queue/Server.
   - **Dependency Inversion (D)**: Các Route phụ thuộc vào abstraction `TaskQueue`, không can thiệp socket trần.
10. **Pragmatic DRY (Rule of Three)**: Tái sử dụng logic khi lặp lại từ 3 lần trở lên (`safeSendMessage`, `resolveProvider`, `config.js`). Tuyệt đối không tạo trừu tượng hóa vội vã (premature abstraction) khi ngữ cảnh nghiệp vụ khác biệt.
11. **Clean Code Conventions**:
    - Đặt tên: `camelCase` (hàm/biến), `PascalCase` (Class/Error), `UPPER_SNAKE_CASE` (constants/configs).
    - Cấu trúc hàm: Áp dụng **Early Return & Guard Clauses** để code luôn phẳng, cấm lồng `if/else` quá 2 tầng.
    - Xử lý bất đồng bộ: 100% dùng `async/await` kết hợp `try/catch` có định danh lỗi, cấm nuốt lỗi im lặng (`catch (e) {}` không mục đích).
12. **Automated Verification**: Sau khi sửa mã nguồn, luôn xác thực bằng `npm run check` và `npm run test:verify`.
13. **Zero `console.warn` in Chrome Extension**: Tuyệt đối không sử dụng `console.warn` trong toàn bộ mã nguồn Chrome Extension (`extension/*.js`). Chrome tự động thu thập và gắn cờ `console.warn` thành lỗi/cảnh báo trên trang quản lý tiện ích (`chrome://extensions` Errors badge), gây hiểu lầm cho người dùng. Thay vào đó, luôn sử dụng `console.log` kết hợp icon định danh (ví dụ `console.log('⚠️ [Prefix] ...')`).
