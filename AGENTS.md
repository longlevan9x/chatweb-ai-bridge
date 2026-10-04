# Project Rules & Instructions for AI Agents

> Kim chỉ nam tiêu chuẩn kỹ thuật & quy định phát triển cho toàn bộ dự án **ChatGPT & Google Gemini Web AI Bridge**.

---

## ⚡ Active Customizations

- **Skill Độc Lập**: [`.agents/skills/senior-code-optimizer/SKILL.md`](file:///e:/code/project/javascript/chatweb-ai-bridge/.agents/skills/senior-code-optimizer/SKILL.md)
  - Kích hoạt khi người dùng yêu cầu: *"tối ưu code"*, *"refactor theo chuẩn senior"*, *"audit chất lượng code"*, hoặc *"áp dụng optimization playbook"*.
- **Quy Chuẩn Luôn Bật (Always-On Rule)**: [`.agents/rules/senior-engineering-standards.md`](file:///e:/code/project/javascript/chatweb-ai-bridge/.agents/rules/senior-engineering-standards.md)
- **Cẩm Nang Chi Tiết**: [`OPTIMIZATION_PLAYBOOK.md`](file:///e:/code/project/javascript/chatweb-ai-bridge/OPTIMIZATION_PLAYBOOK.md)

---

## 🏛️ Quy Định Kỹ Thuật Bắt Buộc (Core Directives)

1. **Phân Tách Lớp Rõ Ràng**:
   - Routes: `server/routes/*.js`
   - Giao diện: `server/views/dashboard.html`
   - WebSocket: `server/websocket.js`
   - Cấu hình & Lỗi: `server/config.js`, `server/errors.js`
   - Orchestrator: `server/server.js` (< 80 dòng)
2. **Triệt Tiêu Lỗi Tiện Ích Trình Duyệt**:
   - Tuyệt đối không gọi `chrome.runtime.sendMessage` trần trong Content Scripts. Luôn bọc qua `safeSendMessage()` và kiểm tra `isExtensionValid()`.
   - Tuân thủ Google `Trusted Types` trên `gemini.google.com` (chỉ dùng `document.createElement`, `document.createTextNode`, không dùng `innerHTML`).
   - **Cấm dùng `console.warn` trong Extension**: Tuyệt đối không dùng `console.warn` trong toàn bộ mã nguồn Extension (`extension/*.js`). Trình duyệt Chrome sẽ tự động đánh dấu các lệnh `console.warn` thành cảnh báo lỗi vàng/đỏ trên trang `chrome://extensions` (Errors badge), gây hiểu lầm cho người dùng. Bắt buộc dùng `console.log` cho mọi thông tin cảnh báo/ghi log.
3. **Bảo Vệ Bộ Nhớ & Hàng Đợi**:
   - `Concurrency = 1` cho tác vụ điều khiển tab.
   - Giới hạn trần Session (LRU Eviction + TTL sweep).
   - Lắng nghe `req.on('aborted')` để hủy task khi client ngắt kết nối.
4. **Tuân Thủ SOLID & Pragmatic DRY**:
   - **Single Responsibility (S)**: Mỗi module chỉ giữ một trách nhiệm duy nhất (Routes, Views, WebSockets, Queue tách rời).
   - **Open/Closed (O)**: Mở rộng Provider mới (Claude, DeepSeek) qua Content Script & Config, không sửa lõi Queue.
   - **Pragmatic DRY (Rule of Three)**: Tái sử dụng logic khi lặp lại từ 3 lần trở lên (`safeSendMessage`, `resolveProvider`), tránh tạo abstraction vội vã.
5. **Clean Code Conventions**:
   - Đặt tên: `camelCase` (hàm/biến), `PascalCase` (Class/Error), `UPPER_SNAKE_CASE` (constants/configs).
   - Dùng **Early Return & Guard Clauses** để code luôn phẳng, cấm lồng `if/else` quá 2 tầng.
   - 100% `async/await` kết hợp `try/catch` có định danh lỗi, cấm nuốt lỗi im lặng.
6. **Kiểm Thử Trước Khi Hoàn Tất**:
   - Luôn chạy và đảm bảo vượt qua: `npm run check` và `npm run test:verify`.
