---
name: senior-code-optimizer
description: >-
  Audits, refactors, and optimizes code against Senior and Staff Engineer standards defined in OPTIMIZATION_PLAYBOOK.md.
  Use when the user asks to optimize code, audit architecture, check code quality, refactor modules, or apply senior engineering rules to this or similar projects.
---

# Senior Code Optimizer & Architectural Auditor

Kỹ năng này cung cấp quy trình chuẩn mực từng bước (Runbook) để kiểm tra, tối ưu hóa và tái cấu trúc mã nguồn theo tiêu chuẩn **Senior / Staff Software Engineer** dựa trên cẩm nang [OPTIMIZATION_PLAYBOOK.md](file:///e:/code/project/javascript/chatweb-ai-bridge/OPTIMIZATION_PLAYBOOK.md).

---

## 🎯 Mục Tiêu & Triết Lý

1. **"Write for Humans, Optimize for Failure"**: Code phải rõ ràng, phòng vệ trước mọi kịch bản lỗi (mạng rớt, browser reload, client disconnect, memory leak).
2. **"Separation of Concerns"**: Phân tách rõ ràng giữa Routes, WebSocket, View Presentation, Business Logic và Core Queue.
3. **"Zero Carelessness"**: Không để lại magic numbers, không dùng biến vô hạn, xử lý triệt để vòng đời timers và abort signals.

---

## 🛠️ Quy Trình Tối Ưu Hóa 5 Bước (Optimization Workflow)

Mỗi khi người dùng yêu cầu tối ưu hóa hoặc kiểm tra code, AI Agent thực hiện tuần tự 5 bước sau:

### Bước 1: Quét Lỗi & Anti-Patterns (Static & Architecture Scan)
Kiểm tra các "mùi hôi của code" (Code Smells), đối chiếu với SOLID & DRY:
- [ ] **Single Responsibility (S in SOLID)**: Mỗi file/module chỉ làm 1 việc duy nhất. Có file nào ôm đồm cả Express, WebSocket, SSE, Session và HTML không?
- [ ] **Open/Closed (O in SOLID)**: Hệ thống có dễ dàng mở rộng thêm Provider mới (Claude, DeepSeek) mà không phải sửa đổi lõi TaskQueue hay Server không?
- [ ] **Dependency Inversion (D in SOLID)**: Các tầng API cấp cao có phụ thuộc vào lớp trừu tượng TaskQueue thay vì gọi socket thô của trình duyệt không?
- [ ] **Pragmatic DRY & Rule of Three**: Các logic lặp lại từ 3 lần trở lên (như `safeSendMessage`, `resolveProvider`, config limits) đã được gom dùng chung chưa? Có bị bẫy "trừu tượng hóa vội vã" khi 2 logic chỉ vô tình giống nhau không?
- [ ] **Code Conventions**:
  - Đặt tên chuẩn: `camelCase` (hàm/biến), `PascalCase` (Class/Error), `UPPER_SNAKE_CASE` (configs).
  - Áp dụng kỹ thuật **Early Return & Guard Clauses** (code phẳng, không lồng `if/else` sâu).
  - Không nuốt lỗi (`catch (e) {}` không có mục đích).
- [ ] **No Magic Numbers**: Toàn bộ timeout, port, kích thước cache phải tập trung ở `config.js`.
- [ ] **Memory Safety**: Mọi Map/Set/Cache phải có giới hạn trần và dọn dẹp LRU/TTL.

### Bước 2: Phòng Vệ Vòng Đời & Ngoại Lệ Mạng (Lifecycle & Resilience)
- [ ] **Client Disconnect**: Có lắng nghe `req.on('aborted')` để hủy tác vụ qua `AbortController` không?
- [ ] **Extension Invalidation**: Mọi lệnh gọi `chrome.runtime.sendMessage` trong Content Script phải dùng `safeSendMessage()` và kiểm tra `Boolean(chrome?.runtime?.id)`.
- [ ] **Exponential Backoff**: Cơ chế kết nối lại có công thức `1000 * Math.pow(1.35, attempt) + jitter` không?
- [ ] **Outbox Buffer**: Khi socket rớt mạng, kết quả đã hoàn tất có được đệm lại để gửi bù ngay khi reconnect không?
- [ ] **Trusted Types**: Thao tác DOM trên Google Gemini có tuyệt đối tránh `innerHTML` / `outerHTML` và chỉ dùng `document.createElement` / `createTextNode` không?

### Bước 3: Tái Cấu Trúc Module Hóa (Modular Refactoring)
- Tách các Router API vào `server/routes/` chuyên biệt (`ask.js`, `openai.js`, `sessions.js`, `dashboard.js`).
- Tách giao diện Web vào `server/views/` (`dashboard.html`).
- Tách WebSocket Hub vào `server/websocket.js`.
- File `server/server.js` chỉ giữ vai trò Bootstrap Orchestrator (< 80 dòng).
- Dọn dẹp thư mục gốc: chuyển các file dump HTML nghiên cứu vào `docs/dom-samples/`.

### Bước 4: Chạy Bộ Kiểm Thử Tự Động (Verification)
Chạy bộ lệnh kiểm tra tự động trong thư mục `server`:
```bash
# 1. Kiểm tra cú pháp toàn bộ hệ thống
npm run check

# 2. Chạy bộ kiểm thử tích hợp 5 kịch bản kiến trúc
npm run test:verify
```
Yêu cầu: Toàn bộ 5 bài test phải ĐẠT (100% PASS).

### Bước 5: Ký Duyệt Qua Checklist 10 Điểm Vàng
Rà soát lại danh sách kiểm tra trong [OPTIMIZATION_PLAYBOOK.md](file:///e:/code/project/javascript/chatweb-ai-bridge/OPTIMIZATION_PLAYBOOK.md#7-checklist-10-điểm-vàng-trước-khi-merge-code-code-review-checklist) trước khi báo cáo hoàn thành cho người dùng.
