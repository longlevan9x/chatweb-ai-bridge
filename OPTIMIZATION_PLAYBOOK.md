# 🏆 SENIOR CODE OPTIMIZATION & ENGINEERING PLAYBOOK

> **Cẩm Nang Quy Chuẩn Tối Ưu Hóa & Thiết Kế Phần Mềm Chuẩn Senior / Staff Engineer**  
> *Dành riêng cho dự án ChatGPT & Google Gemini Local Web Bridge và làm kim chỉ nam phát triển lâu dài cho mọi kỹ sư & AI Agents.*

---

## 📑 MỤC LỤC

1. [Triết Lý Cốt Lõi (Core Philosophy)](#1-triết-lý-cốt-lõi-core-philosophy)
2. [Quy Chuẩn Viết Code & Mẫu Thiết Kế (Coding Patterns)](#2-quy-chuẩn-viết-code--mẫu-thiết-kế-coding-patterns)
3. [Tối Ưu Hóa Bộ Nhớ & Quản Lý Vòng Đời (Memory & Lifecycle Optimization)](#3-tối-ưu-hóa-bộ-nhớ--quản-lý-vòng-đời-memory--lifecycle-optimization)
4. [Khả Năng Chịu Lỗi & Tự Phục Hồi Mạng (Resilience & Self-Healing)](#4-khả-năng-chịu-lỗi--tự-phục-hồi-mạng-resilience--self-healing)
5. [Quy Chuẩn DOM & Tương Thích Nền Tảng (DOM & Security Standards)](#5-quy-chuẩn-dom--tương-thích-nền-tảng-dom--security-standards)
6. [Cấu Trúc Thư Mục & Phân Tách Trách Nhiệm (Directory & Modularity)](#6-cấu-trúc-thư-mục--phân-tách-trách-nhiệm-directory--modularity)
7. [Checklist 10 Điểm Vàng Trước Khi Merge Code (Code Review Checklist)](#7-checklist-10-điểm-vàng-trước-khi-merge-code-code-review-checklist)

---

## 1. Triết Lý Cốt Lõi (Core Philosophy)

### 1.1. "Write for Humans, Optimize for Failure"
* **Code cho người đọc**: Viết mã sao cho một kỹ sư mới vào dự án (hoặc một AI agent mới) có thể hiểu ngay luồng nghiệp vụ mà không phải đoán mò.
* **Defensive by Default**: Giả định mọi phụ thuộc bên ngoài đều có thể hỏng: mạng WebSocket bị ngắt, DOM của ChatGPT/Gemini đổi class, client đóng tab, Chrome đưa tab vào chế độ ngủ (Memory Saver).

### 1.2. "No Premature Optimization, but Zero Carelessness"
* Không tối ưu hóa vi mô mù quáng (ví dụ: dùng `for` thay vì `forEach` khi mảng có 3 phần tử).
* Nhưng **tuyệt đối không cẩu thả** với các bài toán tài nguyên lớn: không để `Map` lưu trữ vô hạn gây tràn RAM (Unbounded Memory Growth), không để `setTimeout` không được xóa, không để luồng stream SSE mở vô tận khi client đã ngắt kết nối.

---

## 2. Quy Chuẩn Viết Code & Mẫu Thiết Kế (Coding Patterns)

### 2.1. Phân Tầng Lỗi Chuyên Biệt (Typed Domain Errors)
* **Quy tắc**: Tuyệt đối không ném lỗi chung chung `new Error("...")`. Mọi lỗi phải được định danh qua hệ thống Custom Error Classes kế thừa `BridgeError`.
* **Mã nguồn mẫu (`server/errors.js`)**:
  ```javascript
  class BridgeError extends Error {
    constructor(message, statusCode = 500, code = 'BRIDGE_ERROR') {
      super(message);
      this.name = this.constructor.name;
      this.statusCode = statusCode;
      this.code = code;
    }
  }

  class TaskTimeoutError extends BridgeError {
    constructor(timeoutMs) {
      super(`Timeout: Quá thời gian chờ phản hồi (${timeoutMs / 1000}s)`, 504, 'TASK_TIMEOUT');
    }
  }
  ```

### 2.2. Loại Bỏ Magic Numbers (Centralized Configuration)
* **Quy tắc**: Mọi tham số thời gian (timeout, interval), cổng mạng (port), kích thước bộ nhớ đệm (buffer size) phải được tập trung tại `config.js` và có thể ghi đè bằng `process.env`.
* **Mã nguồn mẫu (`server/config.js`)**:
  ```javascript
  module.exports = {
    server: { port: parseInt(process.env.PORT, 10) || 9603 },
    queue: { defaultTimeoutMs: 180000, maxSize: 200 },
    session: { maxTurnsPerSession: 15, ttlMs: 1800000, maxSessions: 2000 }
  };
  ```

### 2.3. Hủy Tác Vụ Chủ Động qua `AbortSignal`
* **Quy tắc**: Khi Client đóng kết nối HTTP (nhấn `Ctrl+C` hoặc tắt ứng dụng), server phải hủy ngay tác vụ đang đợi trong Queue hoặc đang chạy trên tab, không được để tác vụ chạy ngầm vô ích.
* **Cách thực thi chuẩn Node.js**:
  ```javascript
  const abortController = new AbortController();
  req.on('aborted', () => abortController.abort());

  await taskQueue.enqueue({
    prompt,
    signal: abortController.signal
  });
  ```

### 2.4. Ứng Dụng Thực Chiến 5 Nguyên Lý SOLID
1. **S - Single Responsibility Principle (Đơn Trách Nhiệm)**: Mỗi module chỉ giữ một trách nhiệm duy nhất và chỉ có 1 lý do để thay đổi.
   - `queue.js`: Chỉ quản lý hàng đợi và điều phối task FIFO.
   - `websocket.js`: Chỉ xử lý vòng đời kết nối WebSocket với tiện ích Chrome.
   - `views/dashboard.html`: Chỉ hiển thị giao diện UI, tách biệt khỏi mã logic JavaScript của server.
   - `routes/*.js`: Tách riêng từng nhóm nghiệp vụ (`ask.js`, `openai.js`, `sessions.js`, `dashboard.js`).
2. **O - Open/Closed Principle (Mở Rộng, Đóng Sửa Đổi)**:
   - Thêm AI Provider mới (Claude Web, DeepSeek Web) chỉ cần khai báo thêm cấu hình Provider và nạp `content-claude.js` tuân thủ contract message, mà không phải sửa đổi lõi `TaskQueue` hay viết lại `server.js`.
3. **L - Liskov Substitution Principle (Thay Thế Tương Thích)**:
   - ChatGPT Content Script và Gemini Content Script hoàn toàn thay thế được cho nhau đối với `TaskQueue`: Cả hai đều tuân thủ cùng giao thức (`PING/PONG`, `ASK` -> `STREAM_CHUNK` -> `TASK_RESULT`).
4. **I - Interface Segregation Principle (Phân Tách Giao Diện API)**:
   - Khách hàng cần hỏi đơn lẻ dùng `/ask`; cần streaming chữ chạy dùng `/ask/stream` (SSE); cần tích hợp Cursor/Cline dùng `/v1/chat/completions`. Không ép client phải phụ thuộc vào giao diện mà họ không dùng.
5. **D - Dependency Inversion Principle (Đảo Ngược Phụ Thuộc)**:
   - Các Route cấp cao không phụ thuộc trực tiếp vào socket của trình duyệt, mà phụ thuộc vào trừu tượng `TaskQueue`. Dù socket rớt mạng, reconnect hay chuyển tab, API layer vẫn độc lập.

### 2.5. Tư Duy DRY Chuẩn Mực (Pragmatic DRY & Rule of Three)
* **Cái bẫy của Junior**: Thấy 2 đoạn code tương tự nhau là vội vã gom thành hàm chung ➡️ Tạo ra "Wrong Abstraction" (Trừu tượng hóa sai), khiến code bị trói chặt khi 2 nghiệp vụ tiến hóa theo 2 hướng khác nhau (*"Duplication is far cheaper than the wrong abstraction"*).
* **Quy tắc "Rule of Three" của Senior**:
  1. **Lần 1**: Viết code giải quyết vấn đề cụ thể.
  2. **Lần 2**: Chấp nhận lặp lại nhỏ nếu ngữ cảnh nghiệp vụ có thể thay đổi độc lập.
  3. **Lần 3**: Khi sự tương đồng lặp lại lần thứ 3 và bản chất bài toán đã hoàn toàn sáng tỏ ➡️ Mới trừu tượng hóa thành hàm dùng chung.
* **Ví dụ DRY đúng đắn trong dự án**:
  - `resolveProvider(provider, model)`: Dùng chung ở cả `/ask` và `/v1/chat/completions`.
  - `safeSendMessage(payload)`: Tái sử dụng ở mọi điểm gửi tin của Content Scripts để triệt tiêu lỗi context invalidation.
  - `config.js`: Nguồn sự thật duy nhất cho mọi con số cấu hình.

### 2.6. Quy Chuẩn Viết Code (Clean Code Conventions)
1. **Quy Tắc Đặt Tên (Naming Conventions)**:
   - **Biến & Hàm**: `camelCase` mô tả rõ hành vi nghiệp vụ (ví dụ: `isExtensionValid()`, `waitForAssistantResponse()`, `safeSendMessage()`).
   - **Hằng số & Cấu hình**: `UPPER_SNAKE_CASE` (ví dụ: `MAX_LOGS`, `DEFAULT_TIMEOUT_MS`).
   - **Classes & Types**: `PascalCase` (ví dụ: `BridgeError`, `TaskTimeoutError`, `SessionManager`).
   - **Tệp Route**: Danh từ số nhiều ngắn gọn (`ask.js`, `openai.js`, `sessions.js`).
2. **Kỹ Thuật Early Return & Guard Clauses**:
   - Kiểm tra điều kiện lỗi ngay đầu hàm và thoát sớm (`if (!prompt) return res.status(400)...;`).
   - Giữ code phẳng (Flat Structure), tuyệt đối không lồng ghép `if/else` quá 2 tầng.
3. **Async / Await Thay Vì Callback Hell**:
   - 100% code bất đồng bộ dùng `async/await` kết hợp `try/catch` có định danh ngữ cảnh lỗi.
4. **Không Nuốt Lỗi (No Silent Failures)**:
   - Không viết `catch (e) {}` trống rỗng trừ khi có lý do phòng vệ có chủ đích (như fallback promise). Luôn log hoặc chuyển tiếp lỗi qua custom error class.

---

## 3. Tối Ưu Hóa Bộ Nhớ & Quản Lý Vòng Đời (Memory & Lifecycle Optimization)

### 3.1. Cơ Chế Giới Hạn Bộ Nhớ & Dọn Dẹp LRU (Least Recently Used)
* **Vấn đề**: Lưu trữ Session bằng `new Map()` mà không có ngưỡng giới hạn sẽ khiến RAM của Node.js tăng dần theo thời gian (Memory Leak).
* **Giải pháp chuẩn Senior (`server/session-manager.js`)**:
  1. **Cap Ngưỡng Cứng**: Giới hạn tối đa 2.000 sessions (`maxSessions`).
  2. **LRU Eviction**: Khi đạt 2.000 sessions, tự động tìm và xóa session có `lastActiveAt` cũ nhất để nhường chỗ cho session mới.
  3. **TTL Background Sweep**: Dùng `setInterval(..., 5 * 60 * 1000).unref()` để quét và xóa các session không hoạt động quá 30 phút.

### 3.2. Chống Tràn Bộ Nhớ DOM Trình Duyệt (Auto-Recycle Pattern)
* **Vấn đề**: Một phiên chat kéo dài hàng trăm câu hỏi làm DOM của ChatGPT/Gemini có hàng chục nghìn node HTML, gây đơ lag trình duyệt.
* **Giải pháp**: Tự động reset tab (`newChat: true`) khi số lượt trao đổi đạt ngưỡng an toàn (mặc định 15 lượt). Người dùng vừa giữ được mạch hội thoại ngắn hạn, vừa bảo vệ tab trình duyệt luôn nhẹ và phản hồi dưới 1 giây.

---

## 4. Khả Năng Chịu Lỗi & Tự Phục Hồi Mạng (Resilience & Self-Healing)

### 4.1. Thuật Toán Exponential Backoff kết hợp Jitter
* **Vấn đề**: Khi Server khởi động lại, nếu Extension gửi yêu cầu reconnect mỗi 1 giây cố định, hàng trăm client sẽ tấn công server cùng lúc (hiện tượng Thundering Herd).
* **Giải pháp chuẩn Senior (`extension/background.js`)**:
  ```javascript
  function scheduleReconnect() {
    retryAttempt++;
    // Tăng theo cấp số nhân (tối đa 10s)
    const backoff = Math.min(1000 * Math.pow(1.35, retryAttempt), 10000);
    // Cộng thêm nhiễu ngẫu nhiên (jitter) 0-500ms để phân tán thời điểm kết nối
    const jitter = Math.random() * 500;
    setTimeout(checkAndConnect, Math.round(backoff + jitter));
  }
  ```

### 4.2. Bộ Đệm Ngoại Tuyến (Outbox Buffer Pattern)
* **Vấn đề**: Extension vừa trích xuất xong câu trả lời 2.000 chữ từ DOM thì WebSocket bị đứt đúng 0.5s. Nếu vứt bỏ gói tin `TASK_RESULT`, client bên ngoài sẽ bị timeout 180s oan uổng.
* **Giải pháp**: Lưu kết quả vào `pendingResultsBuffer`. Ngay khi WebSocket kết nối lại thành công, tự động xả (`flushPendingBuffer`) để gửi bù kết quả về Server ngay lập tức.

### 4.3. Tắt Ứng Dụng An Toàn (Graceful Shutdown)
* **Quy tắc**: Khi server nhận tín hiệu `SIGINT` (Ctrl+C) hoặc `SIGTERM` từ Docker/Kubernetes, không dùng `process.exit(0)` đột ngột.
* **Quy trình chuẩn**:
  1. Ngừng nhận request HTTP mới.
  2. Đóng toàn bộ WebSocket clients.
  3. Đợi các task đang phản hồi dở dang hoàn tất (tối đa 4s).
  4. Đóng Server và thoát tiến trình sạch sẽ.

---

## 5. Quy Chuẩn DOM & Tương Thích Nền Tảng (DOM & Security Standards)

### 5.1. Tuân Thủ Nghiêm Ngặt Google `Trusted Types`
* **Vấn đề**: Google Gemini (`gemini.google.com`) cấm hoàn toàn việc gán chuỗi trực tiếp vào `.innerHTML` hoặc `.outerHTML`. Vi phạm sẽ ném `TypeError: This document requires 'TrustedHTML' assignment`.
* **Giải pháp chuẩn Senior (`extension/content-gemini.js`)**:
  - **Nhập liệu**: Sử dụng `document.execCommand('insertText', false, text)` được chứng nhận an toàn bởi trình duyệt.
  - **Bóc tách Code Block**: Sử dụng DOM Text Node `document.createTextNode(...)` và thay thế phần tử qua `block.replaceWith(textNode)` thay vì ghi đè HTML.
  - **Tạo UI / Floating Badge**: Dựng hoàn toàn bằng `document.createElement()` và `textContent`.

### 5.2. Đóng Gói IIFE & Tránh Lỗi Redeclaration
* **Vấn đề**: Khi Extension nạp lại script vào tab cũ, nếu dùng biến `const SELECTORS = ...` ở top-level sẽ gây lỗi `SyntaxError: Identifier 'SELECTORS' has already been declared`.
* **Giải pháp**: Bọc toàn bộ Content Script trong `(() => { ... })()` và bảo vệ bằng cờ trạng thái `window.__BRIDGE_LOADED__`.

### 5.3. Triệt Tiêu Lỗi "Extension Context Invalidated" Khi Reload
* **Vấn đề**: Khi bạn reload Extension tại `chrome://extensions`, toàn bộ các tab trình duyệt (`chatgpt.com`, `gemini.google.com`) đang mở sẽ bị đứt liên kết với Background Service Worker. Bất kỳ lệnh gọi `chrome.runtime.sendMessage` hoặc sự kiện click/hover nào vào DOM của script cũ sẽ quăng lỗi `Uncaught Error: Extension context invalidated`.
* **Giải pháp chuẩn Senior (`extension/content.js`, `extension/content-gemini.js`)**:
  1. **Wrapper `safeSendMessage()`**: Luôn kiểm tra `Boolean(chrome?.runtime?.id)` trước khi gửi và bắt lỗi Promise rejection `.catch(() => null)`.
  2. **Watchdog Định Kỳ**: Content Script chạy một timer nhẹ quét trạng thái Extension. Nếu phát hiện context đã chết, tự động chuyển Badge sang trạng thái `⚠️ Bridge cần F5` và gán hành vi click thành `window.location.reload()`.
  3. **Auto-Reload từ Background (`background.js`)**: Lắng nghe sự kiện `chrome.runtime.onInstalled` và chủ động quét reload các tab `chatgpt.com` / `gemini.google.com` để tự động tái kết nối.

### 5.4. Cấm Tuyệt Đối `console.warn` Trong Chrome Extension
* **Vấn đề**: Trình duyệt Chrome tự động theo dõi Console của các Content Scripts & Background Service Workers. Khi phát hiện bất kỳ lệnh `console.warn(...)` nào, Chrome sẽ tự động gán cờ cảnh báo lỗi (nút vàng/đỏ `Errors` badge) trên trang quản lý tiện ích `chrome://extensions`. Điều này làm người dùng hoang mang dù đó chỉ là log thông tin nghiệp vụ bình thường.
* **Quy chuẩn chuẩn Senior**:
  - Tuyệt đối **cấm sử dụng `console.warn`** trong toàn bộ thư mục `extension/`.
  - Thay vào đó, sử dụng `console.log('⚠️ [Prefix] ...')` để ghi thông tin cảnh báo mà không kích hoạt cờ lỗi của Chrome.

---

## 6. Cấu Trúc Thư Mục & Phân Tách Trách Nhiệm (Directory & Modularity)

```text
chatweb-ai-bridge/
├── server/                           # TẦNG BACKEND & APIS
│   ├── config.js                     # Nguồn sự thật duy nhất cho cấu hình & tham số
│   ├── errors.js                     # Định nghĩa hệ thống Custom Domain Error Classes
│   ├── queue.js                      # FIFO Concurrency Engine (kế thừa EventEmitter)
│   ├── session-manager.js            # Quản lý phiên hội thoại, LRU cache & Auto-Recycle
│   ├── websocket.js                  # WebSocket Hub kết nối Chrome Extension
│   ├── routes/                       # Các Router API phân tầng chuyên trách (Separation of Concerns)
│   │   ├── ask.js                    # Endpoints /ask và /ask/stream (SSE Streaming)
│   │   ├── openai.js                 # Chuẩn OpenAI /v1/chat/completions & /v1/models
│   │   ├── sessions.js               # Quản trị phiên hội thoại /sessions
│   │   └── dashboard.js              # Phục vụ Web Dashboard & Health Metrics
│   ├── views/                        # Tầng hiển thị giao diện độc lập (Decoupled UI)
│   │   └── dashboard.html            # Web Dashboard (Glassmorphism & Live Prompt Tester)
│   ├── server.js                     # Bootstrap Server, nạp middleware & Graceful Shutdown
│   └── tests/                        # TẦNG KIỂM THỬ ĐỘC LẬP
│       ├── test-runner.js            # Universal Test CLI Runner (7 kịch bản tự động)
│       ├── verify-bridge.js          # Integration Verification test suite
│       └── README.md                 # Cẩm nang giải thích từng bài test
├── extension/                        # TẦNG TRÌNH DUYỆT CHROME (MANIFEST V3)
│   ├── manifest.json                 # Cấu hình quyền và host permissions
│   ├── background.js                 # Multi-Provider Router, Outbox Buffer, Tab Guard
│   ├── content.js                    # Driver tự động hóa tab ChatGPT (ProseMirror)
│   ├── content-gemini.js             # Driver tự động hóa tab Google Gemini (Quill/Lit)
│   ├── sidepanel.*                   # Console giám sát thời gian thực (Glassmorphism)
│   └── popup.*                       # Popup giám sát nhanh và khởi chạy tab AI
├── docs/                             # TÀI LIỆU KỸ THUẬT & DỮ LIỆU MẪU
│   └── dom-samples/                  # Snapshots DOM phục vụ phân tích kỹ thuật
│       ├── chatgpt.html              # DOM Snapshot của ChatGPT Thread View
│       ├── chatgptstart*.html        # DOM Snapshot của ChatGPT New Chat View
│       └── README.md                 # Tài liệu giải thích mục đích các mẫu DOM
├── scripts/                          # Tiện ích phát triển & công cụ hỗ trợ
│   └── generate-icons.js             # Tự động tạo bộ icon PNG chuẩn cho Extension
├── OPTIMIZATION_PLAYBOOK.md          # 👈 Cẩm nang chuẩn mực kỹ thuật này
├── ARCHITECTURE.md                   # Bản vẽ kiến trúc chi tiết cho Dev & AI
└── README.md                         # Tài liệu hướng dẫn sử dụng tổng quan
```

---

## 7. Checklist 10 Điểm Vàng Trước Khi Merge Code (Code Review Checklist)

Trước khi coi một tính năng mới là "hoàn thành", hãy kiểm tra qua 10 câu hỏi sau:

1. [ ] **Error Handling**: Các lỗi tiềm ẩn có dùng Custom Error Class có mã định danh không? Có `try/catch` nào bị nuốt lỗi (silent failure) không?
2. [ ] **No Magic Numbers**: Các con số thời gian, kích thước mảng có nằm trong `config.js` không?
3. [ ] **Memory Safety**: Có cấu trúc dữ liệu nào (Map/Array/Set) có nguy cơ phình to vô hạn không? Đã có LRU eviction hoặc TTL dọn dẹp chưa?
4. [ ] **Abort Cleanup**: Khi Client ngắt kết nối HTTP hoặc đóng tab, task có tự động bị hủy để giải phóng tài nguyên không?
5. [ ] **Event Listener Cleanup**: Các listener (`addEventListener`, `chrome.tabs.onUpdated`) có được `removeListener` khi kết thúc vòng đời không?
6. [ ] **Trusted Types Safe**: Code can thiệp DOM trên các trang của Google có dùng `innerHTML`/`outerHTML` không? (Bắt buộc dùng `document.createElement` / `replaceWith(TextNode)`).
7. [ ] **Network Resilience**: Cơ chế kết nối lại có áp dụng Exponential Backoff + Jitter không? Có Outbox Buffer lưu kết quả khi socket rớt không?
8. [ ] **Single Concurrency**: Với thao tác tự động hóa tab trình duyệt, đã đảm bảo `Concurrency = 1` qua Task Queue chưa?
9. [ ] **Graceful Shutdown**: Server có xử lý tín hiệu `SIGINT` và `SIGTERM` để đóng sạch kết nối không?
10. [ ] **Automated Verification**: Mã nguồn mới có vượt qua 100% bài kiểm tra tích hợp trong `npm run test:verify` không?
