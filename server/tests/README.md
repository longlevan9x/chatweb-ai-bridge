# 🧪 Hướng Dẫn Chi Tiết Các Loại Kiểm Thử (Test Suite Guide)

Tài liệu này giải thích chi tiết mục đích, cơ chế hoạt động, luồng dữ liệu và tiêu chuẩn đánh giá của toàn bộ hệ thống kiểm thử trong **ChatGPT Web Local Bridge**.

---

## 📋 Bảng Tổng Quan Các Kịch Bản Test

| Lệnh | Tên Kịch Bản | Mục Đích Chính | Giao Thức / Endpoint | Tiêu Chuẩn ĐẠT (PASS) |
|---|---|---|---|---|
| `single` | **Single Ask & Speed** | Đo độ trễ (latency) & tốc độ sinh chữ (chars/s) | `POST /ask` | Hoàn thành < 30s, tốc độ > 15 chars/s |
| `stream` | **SSE Typewriter** | Kiểm tra streaming ký tự thời gian thực | `POST /ask/stream` (SSE) | TTFT < 3s, chữ chạy mượt mà |
| `context` | **Multi-turn Memory** | Xác minh khả năng duy trì ngữ cảnh (`newChat: false`) | `POST /ask` liên tiếp 2 lượt | Lượt 2 nhớ chính xác mã bí mật `X-999` |
| `session` | **Hybrid Session & Auto-Recycle** | Quản lý phiên theo ID & tự làm mới DOM khi quá ngưỡng | `POST /ask` (kèm `sessionId`, `maxTurns: 2`) | Lượt 2 nhớ bí mật, Lượt 3 tự kích hoạt `{ recycled: true }` |
| `stress` | **Queue Concurrency** | Kiểm tra Task Queue tuần tự hóa requests đồng thời | `POST /ask` (3 tasks đồng thời) | 100% requests thành công, không xung đột tab |
| `openai` | **OpenAI API Compat** | Kiểm tra chuẩn tương thích SDK OpenAI | `POST /v1/chat/completions` | HTTP 200, đúng schema `{ choices: [...] }` |
| `all` | **Comprehensive Suite** | Chạy liên hoàn toàn bộ 6 kịch bản tự động | Tất cả các endpoints trên | Đạt 6/6 bài test (100%) |
| `chat` | **Interactive CLI REPL**| Hội thoại 2 chiều trực tiếp trong terminal | `POST /ask` | Chat liên tục, giữ mạch trao đổi |
| `health`| **System Diagnostics** | Chẩn đoán WebSocket & trạng thái hàng đợi | `GET /status` | `connected: true`, `queueLength: 0` |

---

## 🔍 Giải Thích Chi Tiết Từng Loại Test

### 1. `single` — Single Ask & Performance Benchmark
* **Mục đích:** Kiểm tra chu trình khép kín cơ bản nhất của Bridge: Nhận request từ ứng dụng bên ngoài ➡️ đưa vào trình duyệt ChatGPT ➡️ lấy câu trả lời trọn vẹn trả về.
* **Cơ chế hoạt động:**
  ```mermaid
  sequenceDiagram
    participant TestRunner as Test Runner
    participant Server as Node.js Server
    participant Extension as Chrome Extension
    participant ChatGPT as ChatGPT Web Tab

    TestRunner->>Server: POST /ask { prompt, newChat: true }
    Server->>Extension: WebSocket send_prompt
    Extension->>ChatGPT: Tìm ô nhập & gõ text vào ProseMirror
    Extension->>ChatGPT: Chờ nút Send sẵn sàng và click Send
    ChatGPT-->>Extension: Sinh toàn bộ nội dung câu trả lời
    Extension->>Server: WebSocket complete
    Server->>TestRunner: HTTP 200 { answer } (Kèm đo thời gian & tốc độ)
  ```
* **Khi nào nên dùng:** Khi bạn mới khởi động hệ thống và muốn kiểm tra nhanh xem kết nối có hoạt động bình thường không, hoặc khi muốn đo tốc độ mạng giữa máy của bạn và server OpenAI.

---

### 2. `stream` — Real-time Server-Sent Events (SSE)
* **Mục đích:** Kiểm tra luồng truyền token tức thì không cần chờ toàn bộ câu trả lời hoàn tất.
* **Cơ chế hoạt động:**
  * ChatGPT web hiển thị chữ theo cơ chế typing.
  * Extension Content Script lắng nghe sự thay đổi của DOM (DOM MutationObserver / polling delta).
  * Mỗi khi có đoạn text mới (`delta`), Extension gửi WebSocket message `stream_chunk` về Server.
  * Server đóng vai trò SSE Producer, bắn chunk đó về Client dưới dạng `data: {"chunk": "..."}\n\n`.
* **Tiêu chuẩn đánh giá:**
  * **TTFT (Time to First Token):** Thời gian từ lúc nhấn gửi đến khi ký tự đầu tiên in ra màn hình phải dưới 3 giây.
  * **Độ mượt:** Chữ in ra liên tục như máy đánh chữ, không bị đứng hình rồi nhả một cục lớn.
* **Khi nào nên dùng:** Khi bạn tích hợp Bridge vào các giao diện Chat UI hiện đại (như Next.js, Electron App) và muốn người dùng thấy chữ chạy ngay lập tức.

---

### 3. `context` — Multi-turn Conversation Memory
* **Mục đích:** Xác minh ChatGPT có nhớ được nội dung của các câu hỏi trước trong cùng một phiên hội thoại hay không.
* **Cơ chế hoạt động:**
  * **Lượt 1 (`newChat: true`):** Gửi prompt *"Dự án bí mật có mã số là X-999. Hãy chỉ trả lời: Đã nhận."* Extension mở tab mới hoặc reset chat.
  * **Lượt 2 (`newChat: false`):** Gửi prompt *"Mã số dự án bí mật là gì?"* Extension **không mở tab mới**, mà tái sử dụng tab hiện tại và gõ tiếp vào ô chat.
  * Test Runner kiểm tra chuỗi phản hồi lượt 2 xem có chứa chuỗi `"X-999"` hay không.
* **Khi nào nên dùng:** Khi bạn xây dựng chatbot tư vấn, tác vụ hỗ trợ viết code nhiều bước (debugging vòng lặp) cần duy trì ngữ cảnh trao đổi xuyên suốt.

---

### 4. `session` — Hybrid Session Manager & Auto-Recycle
* **Mục đích:** Giải quyết bài toán *"Nên tạo nhiều hội thoại hay dùng chung một hội thoại?"*
  * **Lưu giữ phiên hội thoại:** Tự động nhận diện `sessionId`, giữ mạch hội thoại tiếp nối (`newChat: false`) mà không cần client phải quản lý cờ thủ công.
  * **Cách ly an toàn:** Nếu tab đang ở Session A mà có request từ Session B, hệ thống tự động reset (`newChat: true`) để tránh nhiễm chéo ngữ cảnh giữa 2 người dùng.
  * **Chống phình to DOM (Auto-Recycle):** Khi hội thoại đạt ngưỡng (mặc định 15 lượt, hoặc cấu hình `maxTurns: 2`), hệ thống tự động làm mới cuộc hội thoại để giải phóng RAM của trình duyệt Chrome.
* **Khi nào nên dùng:** Dành cho các hệ thống backend, chatbot đa người dùng hoặc tích hợp API cần quản lý phiên thông minh.

---

### 5. `stress` — Queue Concurrency & Tab Protection
* **Mục đích:** Trình duyệt web ChatGPT chỉ có **1 ô nhập liệu duy nhất**. Nếu nhiều tiến trình cùng lúc gõ chữ hoặc click nút Send vào DOM, trang web sẽ bị crash hoặc mất chữ. Bài test này chứng minh **Task Queue** với cơ chế `concurrency = 1` bảo vệ hệ thống tuyệt đối.
* **Cơ chế hoạt động:**
  * Bắn đồng thời 3 requests (`1+1=?`, `2+2=?`, `3+3=?`) tại cùng 1 mili-giây.
  * Hàng đợi tiếp nhận cả 3 task: Task 1 chuyển sang trạng thái `processing`, Task 2 & 3 chuyển sang trạng thái `queued`.
  * Sau khi Task 1 hoàn thành (ChatGPT trả lời xong), Task 2 mới được đẩy vào tab trình duyệt.
  * Sau khi Task 2 xong, Task 3 tiếp tục được xử lý.
* **Tiêu chuẩn đánh giá:** Cả 3 requests đều nhận kết quả chính xác 100%, không request nào bị rớt mạng hay timeout.

---

### 5. `openai` — OpenAI API Compatibility Layer (`/v1/chat/completions`)
* **Mục đích:** Cho phép bất kỳ công cụ hoặc thư viện nào hỗ trợ OpenAI API (như **Cursor**, **Cline**, **Continue.dev**, **LangChain**, **LlamaIndex**, **Aider**) cắm trực tiếp vào Bridge mà không cần sửa code.
* **Cơ chế hoạt động:**
  * Nhận request chuẩn OpenAI:
    ```json
    {
      "model": "gpt-4o",
      "messages": [
        { "role": "system", "content": "Bạn là trợ lý lập trình." },
        { "role": "user", "content": "Viết hàm đảo ngược chuỗi trong JS." }
      ]
    }
    ```
  * Server chuyển đổi danh sách `messages` thành prompt hoàn chỉnh, chuyển tiếp cho Extension.
  * Khi nhận câu trả lời, Server đóng gói lại đúng chuẩn OpenAI response format:
    ```json
    {
      "id": "chatcmpl-123456",
      "object": "chat.completion",
      "model": "gpt-4o",
      "choices": [{
        "index": 0,
        "message": { "role": "assistant", "content": "..." },
        "finish_reason": "stop"
      }]
    }
    ```
* **Khi nào nên dùng:** Khi cấu hình Base URL `http://localhost:9603/v1` vào Cursor hoặc các extension IDE để dùng AI miễn phí không cần API Key trả tiền.

---

### 6. `chat` — Interactive CLI Chat REPL
* **Mục đích:** Sử dụng ChatGPT như một ứng dụng dòng lệnh (CLI App) ngay trong Terminal của lập trình viên.
* **Đặc điểm:** Tự động giữ phiên hội thoại liên tục (`newChat: false`), có hỗ trợ gõ `exit` hoặc `quit` để thoát.

---

### 7. `health` — System Diagnostics & WebSocket Monitor
* **Mục đích:** Kiểm tra tức thì tình trạng kết nối của hệ thống:
  * Server Node.js có đang chạy không?
  * Extension Chrome đã kết nối WebSocket với Server chưa?
  * Số lượng tác vụ đang chờ trong hàng đợi là bao nhiêu?
* **Khi nào nên dùng:** Bất cứ khi nào bạn chạy test mà bị đứng hoặc timeout, hãy chạy `npm test health` để biết ngay nguyên nhân (ví dụ: quên mở trình duyệt Chrome hoặc tab ChatGPT chưa bật).

---

## 🚀 Cách Chạy Test Nhanh

```bash
# 1. Xem hướng dẫn và giải thích trực tiếp trong terminal
npm test help

# 2. Chạy từng kịch bản cụ thể
npm test single
npm test stream
npm test context
npm test stress
npm test openai

# 3. Chạy toàn bộ 5 bài test tự động
npm test all

# 4. Bật chế độ tương tác (nhấn TAB để tự hoàn thành câu lệnh)
npm test
```
