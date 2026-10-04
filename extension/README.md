# 🧩 ChatGPT & Gemini Local Web Bridge — Chrome Extension

> **Extension Chrome Manifest V3** đóng vai trò cầu nối tương tác trực tiếp với DOM của trang web **ChatGPT** (`https://chatgpt.com`) và **Google Gemini** (`https://gemini.google.com`), nhận lệnh từ Node.js Server qua WebSocket và stream dữ liệu phản hồi thời gian thực.

---

## 📁 Cấu Trúc File Extension

| File | Chức năng chi tiết |
|---|---|
| [`manifest.json`](file:///e:/code/project/javascript/chatweb-ai-bridge/extension/manifest.json) | Tệp cấu hình Manifest V3: Permissions (`tabs`, `sidePanel`, `storage`, `alarms`, `scripting`, `clipboardWrite`, `clipboardRead`), host permissions cho cả `chatgpt.com` và `gemini.google.com`, phím tắt mở Side Panel `Ctrl+Shift+B`. |
| [`background.js`](file:///e:/code/project/javascript/chatweb-ai-bridge/extension/background.js) | Service Worker trung tâm: Quản lý WebSocket với `localhost:9603`, định tuyến đa nền tảng (`chatgpt` / `gemini`), tự động tìm hoặc mở tab AI tương ứng, điều hướng URL sạch khi `newChat: true`, đồng bộ log với Side Panel, và mở rộng InputMutex an toàn động (60s cho tác vụ có ảnh vision, 15s cho văn bản thường). |
| [`content.js`](file:///e:/code/project/javascript/chatweb-ai-bridge/extension/content.js) | Content Script chạy trong tab **ChatGPT**: Đóng gói IIFE chống lỗi redeclaration, tự động gõ văn bản vào ProseMirror, nạp ảnh Multimodal Vision qua System Clipboard / File Input, chờ thumbnail tải lên, cơ chế chờ nút Send thích ứng (15s), bắt token streaming theo thời gian thực và hiển thị Floating Badge. |
| [`content-gemini.js`](file:///e:/code/project/javascript/chatweb-ai-bridge/extension/content-gemini.js) | Content Script chạy trong tab **Google Gemini**: Tự động hóa Quill editor (`rich-textarea div[contenteditable="true"]`, `.ql-editor`), nạp ảnh Multimodal Vision bằng cách ghi PNG Blob vào OS Clipboard hoặc prototype descriptor setter, kích hoạt dispatch input event cho Lit/Angular, phát hiện nút Send/Stop và stream Markdown response thời gian thực. |
| [`sidepanel.html`](file:///e:/code/project/javascript/chatweb-ai-bridge/extension/sidepanel.html) | Giao diện Side Panel mở ở cạnh phải trình duyệt để giám sát log, metrics và gửi test prompt trực tiếp. |
| [`sidepanel.js`](file:///e:/code/project/javascript/chatweb-ai-bridge/extension/sidepanel.js) | Logic điều khiển Side Panel: Lắng nghe log thời gian thực, lưu trữ lịch sử bằng `chrome.storage.local`, hỗ trợ copy kết quả nhanh. |
| [`sidepanel.css`](file:///e:/code/project/javascript/chatweb-ai-bridge/extension/sidepanel.css) | Toàn bộ style cho Side Panel (Dark-mode, Glassmorphism, JetBrains Mono font). |
| [`popup.html`](file:///e:/code/project/javascript/chatweb-ai-bridge/extension/popup.html) & [`popup.js`](file:///e:/code/project/javascript/chatweb-ai-bridge/extension/popup.js) | Giao diện Popup nhỏ khi bấm vào biểu tượng tiện ích trên toolbar. |
| `icons/` | Chứa các icon chuẩn của extension (16x16, 48x48, 128x128). |

---

## ⚙️ Các Cơ Chế Cốt Lõi

### 1. Cơ Chế Chờ Nút Send Thích Ứng (Adaptive Wait)
- Khi nhập văn bản vào ProseMirror, ChatGPT có thể mất một khoảng thời gian ngắn để render nút Send.
- `content.js` sử dụng vòng lặp thăm dò mỗi 150ms kéo dài tối đa **15 giây** kết hợp `MutationObserver`.
- Nếu sau 1.5 giây nút chưa sáng, script kích hoạt **Reactive Nudge** (bơm phím ảo Space + Backspace và kích hoạt sự kiện input) để ép React cập nhật state form.

### 2. Chống Xung Đột Biến Toàn Cục (IIFE Wrapper)
- Mọi biến trong `content.js` được bọc bên trong `(() => { ... })()` và được bảo vệ bởi cờ `window.__CHATGPT_BRIDGE_LOADED__`, ngăn ngừa hoàn toàn lỗi `Identifier 'SELECTORS' has already been declared`.

### 3. Điều Hướng Tab Sạch Khi `newChat: true`
- Thay vì click nút "+ New chat" trên giao diện dễ bị lỗi khi thanh sidebar thu gọn, `background.js` tự động điều hướng tab về `https://chatgpt.com/` bằng `chrome.tabs.update()`.

### 4. Side Panel Giám Sát Thời Gian Thực
- Mở bằng cách bấm vào biểu tượng extension trên toolbar hoặc bấm phím tắt **`Ctrl+Shift+B`** (trên Windows).
- Lưu trữ 200 bản ghi log gần nhất trong `chrome.storage.local`, không bị mất khi đóng mở panel.

### 5. Nạp Ảnh Multimodal Vision & Vượt Rào Cản Trusted Clipboard
- **Thách thức:** Chromium đánh dấu mọi sự kiện giả lập `new ClipboardEvent('paste')` là `isTrusted: false`. Cả ChatGPT và Google Gemini đều kiểm tra và từ chối các sự kiện clipboard không đáng tin này. Đồng thời, các input file ẩn bị chặn nếu gán trực tiếp `.files` do cơ chế theo dõi state của Lit/Angular và React.
- **Giải pháp:**
  1. Khai báo quyền `"clipboardWrite"` và `"clipboardRead"` trong Manifest V3.
  2. Chuyển đổi Base64 Data URL thành `image/png` Blob, sau đó ghi trực tiếp vào OS System Clipboard bằng API `navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])`.
  3. Với fallback File Input, sử dụng `Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'files').set.call(input, dt.files)` kèm phát dispatch các sự kiện `input` và `change` với `{ bubbles: true, composed: true }`.
  4. Script tự động lắng nghe và chờ thumbnail đính kèm xuất hiện trong DOM (`attachment-thumbnail`, `.image-preview`, `mat-chip`, ...) trước khi kích hoạt gõ prompt và nhấn nút gửi.
  5. `background.js` tự động kéo dài `safetyTimeoutMs` từ 15s lên **60s** khi phát hiện request có đính kèm `images`, loại bỏ hoàn toàn cảnh báo nhả InputMutex vội vã.
