# 🧩 ChatGPT & Gemini Local Web Bridge — Chrome Extension

> **Extension Chrome Manifest V3** đóng vai trò cầu nối tương tác trực tiếp với DOM của trang web **ChatGPT** (`https://chatgpt.com`) và **Google Gemini** (`https://gemini.google.com`), nhận lệnh từ Node.js Server qua WebSocket và stream dữ liệu phản hồi thời gian thực.

---

## 📁 Cấu Trúc File Extension

| File | Chức năng chi tiết |
|---|---|
| [`shared/bridge-constants.js`](file:///e:/code/project/javascript/chatweb-ai-bridge/extension/shared/bridge-constants.js) | **Mô-đun Dùng Chung:** Định nghĩa hằng số cổng server (`9603`), danh sách Action (`ASK`, `STREAM_CHUNK`, `INPUT_SUBMITTED`, ...), timeout ngưỡng an toàn. Hỗ trợ nạp đa môi trường (Service Worker `importScripts` và Content Script `window`). |
| [`shared/bridge-utils.js`](file:///e:/code/project/javascript/chatweb-ai-bridge/extension/shared/bridge-utils.js) | **Mô-đun Dùng Chung:** Đóng gói toàn bộ tiện ích dùng chung giữa các Content Scripts: `isExtensionValid()`, `safeSendMessage()`, `sleep()`, `queryAny()`, `queryAllAny()`, `dataUrlToFile()`, `writeImageToClipboard()`, `setInputFiles()`, và `injectFloatingBadge()`. |
| [`manifest.json`](file:///e:/code/project/javascript/chatweb-ai-bridge/extension/manifest.json) | Tệp cấu hình Manifest V3: Khai báo nạp chuỗi `shared/bridge-constants.js` + `shared/bridge-utils.js` trước `content.js` và `content-gemini.js`. Permissions (`tabs`, `sidePanel`, `storage`, `alarms`, `scripting`, `clipboardWrite`, `clipboardRead`), host permissions, phím tắt mở Side Panel `Ctrl+Shift+B`. |
| [`background.js`](file:///e:/code/project/javascript/chatweb-ai-bridge/extension/background.js) | Service Worker trung tâm: Quản lý WebSocket với `localhost:9603`, nạp `shared/bridge-constants.js`, định tuyến đa nền tảng (`chatgpt` / `gemini`), tự động tìm hoặc mở tab AI tương ứng, điều hướng URL sạch khi `newChat: true`, đồng bộ log với Side Panel, và mở rộng InputMutex an toàn động (60s cho tác vụ có ảnh vision, 15s cho văn bản thường). |
| [`content.js`](file:///e:/code/project/javascript/chatweb-ai-bridge/extension/content.js) | Content Script chạy trong tab **ChatGPT**: Kế thừa các hàm từ `window.__BRIDGE_UTILS__`, tập trung hoàn toàn vào ProseMirror editor, xử lý submit, streaming token và phát hiện tài khoản ChatGPT. |
| [`content-gemini.js`](file:///e:/code/project/javascript/chatweb-ai-bridge/extension/content-gemini.js) | Content Script chạy trong tab **Google Gemini**: Kế thừa các hàm từ `window.__BRIDGE_UTILS__`, tập trung hoàn toàn vào Quill editor (`rich-textarea`), Lit/Angular shadow DOM traversal, và streaming Markdown phản hồi. |
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

### 6. Kiến Trúc Tái Sử Dụng Mã Nguồn Dùng Chung (Shared Modules Architecture)
- **Vấn đề giải quyết:** Trước đây, cả `content.js` và `content-gemini.js` đều phải tự định nghĩa lại các hàm tiện ích (`isExtensionValid`, `safeSendMessage`, `sleep`, `queryAny`, `queryAllAny`, `dataUrlToFile`, `writeImageToClipboard`, `setInputFiles`, `injectFloatingBadge`), dẫn đến lặp lại hơn 400 dòng code.
- **Cơ chế nạp chuẩn Chrome MV3:**
  - `manifest.json` nạp chuỗi `shared/bridge-constants.js` và `shared/bridge-utils.js` trước mỗi content script trong cùng một Isolated World.
  - `background.js` nạp `shared/bridge-constants.js` qua `importScripts()` và nạp kèm các file shared khi thực hiện dynamic injection qua `chrome.scripting.executeScript`.
  - Các hàm tiện ích được đóng gói trong namespace an toàn `window.__BRIDGE_UTILS__` và `self.__BRIDGE_CONSTANTS__` kết hợp guard clause fallback, đảm bảo không bao giờ bị lỗi ngay cả khi nạp đơn lẻ.
