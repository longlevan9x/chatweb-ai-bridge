# ChatGPT & Google Gemini Local Web Bridge 🚀

> Cầu nối kép điều khiển **ChatGPT Web** (`chatgpt.com`) và **Google Gemini Web** (`gemini.google.com`) từ máy tính cục bộ thông qua Chrome Extension (100% JavaScript).

---

## 🌟 Tính Năng Nổi Bật

- **Dual-Provider Power (ChatGPT & Gemini)**: Hỗ trợ chuyển đổi linh hoạt giữa **ChatGPT** và **Google Gemini** chỉ bằng một tham số `provider: "gemini"|"chatgpt"` hoặc thông qua model name.
- **Zero API Cost**: Sử dụng trực tiếp tài khoản ChatGPT và Google Gemini đang đăng nhập trên trình duyệt Chrome, không cần API Key, không tốn phí token.
- **Tương thích chuẩn OpenAI API**: Endpoint `/v1/chat/completions` & `/v1/models` cho phép cắm trực tiếp vào **Cursor, Cline, Aider, LangChain, LlamaIndex, Continue.dev**. Tự động định tuyến sang Gemini khi chọn model `gemini-2.0-flash`, `gemini-1.5-pro`...
- **Real-time Token Streaming**: Hỗ trợ Server-Sent Events (SSE) qua `/ask/stream` và `/v1/chat/completions?stream=true`.
- **Quản lý Phiên Lai & Tự Làm Mới (Hybrid Session & Auto-Recycle)**: Tự động ghi nhớ mạch hội thoại theo `sessionId`, cách ly an toàn giữa các session, và tự động reset hội thoại sau 15 lượt để giải phóng RAM, chống đơ giật DOM.
- **Hàng đợi tuần tự thông minh (FIFO Task Queue)**: Concurrency = 1, chống xung đột DOM, tự động xử lý TTL timeout, retry an toàn.
- **Chrome Side Panel Console (`Ctrl+Shift+B`)**: Bảng điều khiển thời gian thực tích hợp sẵn ngay bên cạnh tab AI, lưu trữ 200 bản ghi log, cho phép test prompt và theo dõi luồng dữ liệu.
- **Bộ Kiểm Thử Tương Tác CLI Thông Minh (`npm test`)**: Hỗ trợ 7 kịch bản kiểm thử (bao gồm kiểm thử Gemini), Tab Autocomplete, thuật toán Levenshtein tự động sửa lỗi gõ phím.
- **Cơ chế Tự Phục Hồi & Chống Đóng Băng (Self-Healing)**:
  - Tab Health Guard: Tự động phát hiện và mở lại tab `chatgpt.com` hoặc `gemini.google.com` nếu bị đóng.
  - Adaptive Send Button Wait: Vòng lặp thăm dò 15s kết hợp Reactive Nudge đánh thức React/Angular State khi nút Send trễ render.
  - IIFE Encapsulation: Chống lỗi `Identifier already declared` khi nạp lại script.
  - Anti-Throttling: Tự động kích hoạt tab khi có yêu cầu để vượt qua chế độ Memory Saver của Chrome.

---

## 📁 Cấu Trúc Dự Án Hoàn Chỉnh

```text
chatweb-ai-bridge/
├── server/
│   ├── package.json                  # Cấu hình scripts ("start", "test")
│   ├── server.js                     # Core Express Server (REST API, SSE, WSS, OpenAI compat, Multi-provider)
│   ├── queue.js                      # FIFO Task Queue Engine (Concurrency=1, Provider Routing, Metrics)
│   ├── session-manager.js            # Quản lý Hybrid Session, cách ly phiên & Auto-Recycle DOM
│   └── tests/                        # Toàn bộ mã nguồn kiểm thử tập trung
│       ├── test-runner.js            # Universal Test Runner & Interactive CLI REPL (7 kịch bản test)
│       ├── test-ask.js               # Test gửi 1 câu hỏi cơ bản
│       ├── test-batch.js             # Test bắn đồng thời nhiều câu hỏi
│       ├── test-openai-compat.js     # Test tương thích chuẩn OpenAI SDK
│       ├── advanced-test.js          # Test hiệu năng và đo lường latency
│       ├── verify-bridge.js          # Test tích hợp E2E toàn diện
│       └── README.md                 # Hướng dẫn chi tiết từng loại test
├── extension/
│   ├── manifest.json                 # Chrome Manifest V3 (hỗ trợ chatgpt.com & gemini.google.com)
│   ├── background.js                 # Service worker (Multi-provider Tab Guard, WebSocket Hub, Relay)
│   ├── content.js                    # Content script cho ChatGPT (ProseMirror, Streaming, IIFE)
│   ├── content-gemini.js             # Content script cho Google Gemini (Quill Editor, Streaming, IIFE)
│   ├── sidepanel.html                # Giao diện Side Panel Console theo dõi log thời gian thực
│   ├── sidepanel.js                  # Logic điều khiển Side Panel (log persist, test prompt)
│   ├── sidepanel.css                 # Giao diện Dark-mode Glassmorphism cho Side Panel
│   ├── popup.html / popup.js         # Giao diện Popup trên thanh công cụ
│   ├── icons/                        # Bộ icon chuẩn (16, 48, 128)
│   └── README.md                     # Tài liệu chi tiết về Chrome Extension
├── scripts/
│   ├── generate-icons.js             # Script tạo icon PNG
│   └── test-dom-extract.js           # Kiểm thử bóc tách Markdown AST từ HTML
├── ARCHITECTURE.md                   # Tài liệu kiến trúc chuẩn Enterprise cho Dev & AI
└── README.md                         # Tài liệu hướng dẫn sử dụng tổng quan
```

---

## ⚡ Hướng Dẫn Cài Đặt & Sử Dụng

### Bước 1: Khởi động Local Server
Mở terminal tại thư mục `server`:
```bash
cd server
npm install
npm start
```
Server sẽ chạy tại `http://localhost:9603`. Bạn có thể truy cập ngay vào trình duyệt để xem **Web Dashboard**.

### Bước 2: Cài đặt Chrome Extension
1. Mở Chrome / Edge / Brave, truy cập: `chrome://extensions/`
2. Bật công tắc **Developer mode** ở góc phải trên.
3. Bấm **Load unpacked** (Tải tiện ích đã giải nén) và chọn thư mục `extension`.
4. Mở tab [https://chatgpt.com](https://chatgpt.com) và đăng nhập tài khoản.
5. Nhấn tổ hợp phím **`Ctrl+Shift+B`** để mở **Side Panel Console** theo dõi log trực quan.
6. Kiểm tra terminal của Server:
   ```text
   ✅ [Bridge Server] Chrome Extension đã kết nối WebSocket!
   ```

---

## 🚀 Các Phương Thức Tích Hợp

### 1. Gọi API Kèm Quản Lý Phiên (Session-Based Hybrid)

Hệ thống tự động ghi nhớ mạch nói chuyện khi cùng `sessionId`, và tự động làm mới khi vượt quá 15 lượt (`maxTurns`):

```javascript
// Lượt 1: Bắt đầu hội thoại (Tự động newChat: true)
await fetch('http://localhost:9603/ask', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    prompt: 'Tôi tên là Nam, đang học lập trình NodeJS.',
    sessionId: 'session-nam-01'
  })
});

// Lượt 2: Hỏi tiếp nối (Tự động newChat: false, nhớ được tên Nam)
const res = await fetch('http://localhost:9603/ask', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    prompt: 'Tôi tên gì và đang học gì?',
    sessionId: 'session-nam-01'
  })
});
const data = await res.json();
console.log(data.answer);
// => "Bạn tên là Nam và đang học lập trình NodeJS."
```

### 2. Tương Thích Chuẩn OpenAI SDK (Cursor / Cline / LangChain / Python)

Bạn có thể trỏ bất kỳ công cụ AI nào hỗ trợ OpenAI API về máy chủ cục bộ:
- **Base URL**: `http://localhost:9603/v1`
- **API Key**: `chatgpt-bridge-local` (hoặc bất kỳ chuỗi nào)

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:9603/v1",
    api_key="chatgpt-bridge-local"
)

# Streaming với hiệu ứng máy đánh chữ
stream = client.chat.completions.create(
    model="gpt-4o",
    messages=[{"role": "user", "content": "Viết bài thơ ngắn về mùa thu"}],
    stream=True
)
for chunk in stream:
    if chunk.choices[0].delta.content:
        print(chunk.choices[0].delta.content, end="", flush=True)
```

---

## 🧪 Hệ Thống Kiểm Thử Toàn Diện (Interactive Test Runner)

Chỉ cần một lệnh duy nhất trong thư mục `server`:

```bash
# 1. Xem hướng dẫn và giải thích chi tiết toàn bộ các bài test
npm test help

# 2. Chạy từng kịch bản cụ thể:
npm test single   # Đo tốc độ phản hồi & latency đơn lẻ (ChatGPT)
npm test stream   # Kiểm tra luồng chữ chạy từng token (SSE)
npm test context  # Kiểm tra bộ nhớ ngữ cảnh nhiều lượt
npm test session  # Kiểm tra Hybrid Session & Auto-Recycle DOM
npm test gemini   # Kiểm thử cầu nối Google Gemini Web (gemini.google.com)
npm test stress   # Bắn đồng thời 3 câu hỏi kiểm tra Task Queue
npm test openai   # Kiểm thử tương thích chuẩn OpenAI API
npm test all      # Chạy liên hoàn toàn bộ 7 bài test tự động

# 3. Chế độ chat trực tiếp từ Terminal
npm test chat

# 4. Chế độ tương tác REPL (hỗ trợ phím TAB tự động điền lệnh và gợi ý lỗi gõ)
npm test
```

---

## 📖 Tài Liệu Tham Chiếu Bổ Sung

- [**`OPTIMIZATION_PLAYBOOK.md`**](file:///e:/code/project/javascript/chatweb-ai-bridge/OPTIMIZATION_PLAYBOOK.md): Cẩm nang quy chuẩn tối ưu hóa & thiết kế phần mềm chuẩn Senior (LRU, Typed Errors, TrustedHTML, AbortSignal, Checklist 10 điểm vàng).
- [**`ARCHITECTURE.md`**](file:///e:/code/project/javascript/chatweb-ai-bridge/ARCHITECTURE.md): Bản vẽ kiến trúc chi tiết, sơ đồ tuần tự và phân tích cách khắc phục các vấn đề kỹ thuật sâu (nút Send trễ, IIFE, Session Recycle).
- [**`server/tests/README.md`**](file:///e:/code/project/javascript/chatweb-ai-bridge/server/tests/README.md): Hướng dẫn chi tiết về các loại bài kiểm thử, tiêu chí đánh giá ĐẠT/HỎNG.
- [**`extension/README.md`**](file:///e:/code/project/javascript/chatweb-ai-bridge/extension/README.md): Hướng dẫn chi tiết về thành phần Chrome Extension, Side Panel và Service Worker.
