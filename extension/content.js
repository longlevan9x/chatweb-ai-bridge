(() => {
  const UTILS = (typeof window !== 'undefined' && window.__BRIDGE_UTILS__) || {};

  // Cơ chế phòng vệ: Nhận diện Extension Context còn hợp lệ hay đã bị reload/invalidated
  const isExtensionValid = UTILS.isExtensionValid || (() => {
    try {
      return Boolean(typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id);
    } catch (_) {
      return false;
    }
  });

  // Tránh nạp đè nếu script cũ vẫn còn sống; nếu script cũ đã chết do reload extension thì cho phép nạp mới
  if (window.__CHATGPT_BRIDGE_LOADED__ && window.__CHATGPT_BRIDGE_IS_ALIVE__ && window.__CHATGPT_BRIDGE_IS_ALIVE__()) {
    console.log('ℹ️ [ChatGPT Bridge] Content Script đã tồn tại và đang hoạt động, bỏ qua injection trùng lặp.');
    return;
  }
  window.__CHATGPT_BRIDGE_LOADED__ = true;
  window.__CHATGPT_BRIDGE_IS_ALIVE__ = isExtensionValid;

  console.log('🚀 [ChatGPT Bridge v2.0] Content Script nạp thành công trên tab ChatGPT.');

  // Wrapper gửi tin an toàn tuyệt đối, không bao giờ ném Uncaught Error khi extension reload
  const safeSendMessage = UTILS.safeSendMessage || ((message) => {
    if (!isExtensionValid()) return Promise.resolve(null);
    try {
      const p = chrome.runtime.sendMessage(message);
      if (p && typeof p.catch === 'function') return p.catch(() => null);
      return Promise.resolve(p);
    } catch (_) {
      return Promise.resolve(null);
    }
  });

  // Bộ chọn DOM linh hoạt hỗ trợ mọi phiên bản giao diện ChatGPT (home & thread)
  const SELECTORS = {
  editor: [
    'div.ProseMirror',
    'div[contenteditable="true"].ProseMirror',
    'div.ProseMirror[data-composer-markdown]',
    'form[data-chatgpt-composer] div[contenteditable="true"]',
    '#prompt-textarea',
    'textarea[data-id="root"]'
  ],
  stopButton: [
    'button[data-testid="stop-button"]',
    'button[aria-label="Stop generating"]',
    'button[aria-label*="Stop"]',
    'button[aria-label*="Dừng"]',
    'button:has(rect)'
  ],
  assistantMessage: [
    '[data-markdown-text-style="assistant-message"]',
    '[class*="MarkdownRoot"]',
    '[data-chatgpt-search-unit-key*="assistant"]',
    '[data-content-search-unit-key*="assistant"]',
    '[data-conversation-role="assistant"]',
    '[data-message-author-role="assistant"]',
    '.markdown.prose'
  ],
  cloudflare: [
    '#challenge-form',
    'div.cf-turnstile',
    'iframe[src*="cloudflare"]',
    '#cf-stage'
  ],
  errorBanner: [
    'div[class*="text-token-text-error"]',
    'div[data-testid*="error"]',
    '.bg-red-500\\/10',
    'div[class*="border-danger"]'
  ]
};

const queryAny = UTILS.queryAny || ((selectors, root = document) => {
  for (const sel of selectors) {
    try {
      const el = root.querySelector(sel);
      if (el) return el;
    } catch (_) {}
  }
  return null;
});

const queryAllAny = UTILS.queryAllAny || ((selectors, root = document) => {
  for (const sel of selectors) {
    try {
      const list = root.querySelectorAll(sel);
      if (list && list.length > 0) return Array.from(list);
    } catch (_) {}
  }
  return [];
});

// Bóc tách văn bản bảo toàn cấu trúc Markdown & Code blocks
function extractCleanMarkdown(element) {
  if (!element) return '';
  let md = null;
  try {
    if (element.matches && (element.matches('[data-markdown-text-style="assistant-message"]') || element.matches('[class*="MarkdownRoot"]'))) {
      md = element;
    } else {
      md = element.querySelector('[data-markdown-text-style="assistant-message"]') ||
           element.querySelector('[class*="MarkdownRoot"]') ||
           element.querySelector('.markdown') ||
           element;
    }
  } catch (e) {
    md = element;
  }

  if (!md) return '';

  // Xử lý các code block giữ nguyên syntax ```
  const codeBlocks = md.querySelectorAll('pre');
  if (codeBlocks.length === 0) {
    return (md.innerText || md.textContent || '').trim();
  }

  // Clone để tránh ảnh hưởng DOM thật
  const clone = md.cloneNode(true);
  clone.querySelectorAll('pre').forEach(pre => {
    const codeEl = pre.querySelector('code');
    const lang = codeEl ? (codeEl.className.match(/language-(\w+)/) || [])[1] || '' : '';
    const codeText = codeEl ? codeEl.innerText : pre.innerText;
    pre.innerText = `\n\`\`\`${lang}\n${codeText.trim()}\n\`\`\`\n`;
  });

  return (clone.innerText || clone.textContent || '').trim();
}

// Kiểm tra lỗi hệ thống hoặc Cloudflare chặn
function checkSystemErrors() {
  const cf = queryAny(SELECTORS.cloudflare);
  if (cf) {
    return 'CLOUDFLARE_CHALLENGE: Trình duyệt yêu cầu xác minh bảo mật Cloudflare. Vui lòng bấm xác minh trên tab ChatGPT.';
  }

  const errBanner = queryAny(SELECTORS.errorBanner);
  if (errBanner) {
    const text = errBanner.innerText?.trim();
    if (text && text.length > 5) {
      return text;
    }
  }

  // Kiểm tra thông báo rate limit thông dụng trong DOM
  const bodyText = document.body.innerText || '';
  if (bodyText.includes("You've reached your usage limit")) {
    return "RATE_LIMIT: You've reached your usage limit for the current model. Vui lòng đợi hoặc đổi model.";
  }
  if (bodyText.includes("Something went wrong")) {
    return "OPENAI_ERROR: Something went wrong. Vui lòng thử lại.";
  }

  return null;
}

function isChatGPTErrorText(text) {
  if (!text || typeof text !== 'string') return false;
  const lower = text.trim().toLowerCase();
  if (!lower || lower.length > 350) return false;
  return lower.startsWith('something went wrong') ||
         lower.startsWith('an error occurred') ||
         lower.startsWith('đã xảy ra lỗi') ||
         lower.includes("you've reached your usage limit");
}

function reportProgress(text) {
  console.log('[ChatGPT Bridge] ' + text);
  safeSendMessage({ action: 'LOG', text });
}

async function enterTextIntoChatGPT(editor, text) {
  reportProgress('1. Đang chuẩn bị ô nhập liệu ProseMirror...');
  editor.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  editor.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  editor.focus();
  editor.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
  editor.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  editor.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await sleep(100);

  // 1. Tạo vùng chọn (Selection Range) CHÍNH XÁC bên trong editor (tránh selectAll toàn bộ trang web)
  try {
    const sel = window.getSelection();
    if (sel) {
      const range = document.createRange();
      range.selectNodeContents(editor);
      sel.removeAllRanges();
      sel.addRange(range);
    }
  } catch (e) {}

  // 2. InsertText qua execCommand
  let execOk = false;
  try {
    execOk = document.execCommand('insertText', false, text);
  } catch (e) {}

  const hasTextNow = () => (editor.textContent || editor.innerText || '').trim().length > 0;

  // 3. Fallback InputEvent beforeinput + ClipboardEvent paste nếu cần
  if (!execOk || !hasTextNow()) {
    try {
      editor.dispatchEvent(new InputEvent('beforeinput', {
        inputType: 'insertText',
        data: text,
        bubbles: true,
        cancelable: true,
        composed: true
      }));
    } catch (e) {}

    if (!hasTextNow()) {
      reportProgress('Thử phương thức ClipboardEvent paste...');
      try {
        const dt = new DataTransfer();
        dt.setData('text/plain', text);
        const pasteEvt = new ClipboardEvent('paste', {
          clipboardData: dt,
          bubbles: true,
          cancelable: true,
          composed: true
        });
        editor.dispatchEvent(pasteEvt);
      } catch (e) {}
    }
  }

  // 4. Kích hoạt sự kiện Input & Change
  editor.dispatchEvent(new InputEvent('input', {
    inputType: 'insertText',
    data: text,
    bubbles: true,
    cancelable: true,
    composed: true
  }));
  editor.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  editor.dispatchEvent(new Event('change', { bubbles: true, composed: true }));

  await sleep(250);
  reportProgress(`2. Đã điền xong câu hỏi (${(editor.textContent || '').trim().length} ký tự).`);
}

async function triggerSend(editor, initialCount = 0) {
  reportProgress('3. Đang đợi nút Send chuyển đổi và sẵn sàng...');
  const form = editor.closest('form') || document.querySelector('form[data-chatgpt-composer]') || document.querySelector('form');

  const maxWaitMs = 15000; // Tối đa 15 giây chờ nút Send xuất hiện và sẵn sàng
  const startTime = Date.now();
  let nudged = false;
  let lastReportedStatus = '';

  const isSent = () => {
    // 1. Text trong ô nhập liệu đã biến mất hoàn toàn (ChatGPT dọn sạch khi submit)
    const textRemaining = (editor.textContent || editor.innerText || '').trim();
    if (textRemaining.length === 0) return true;

    // 2. Nút Stop đã xuất hiện (ChatGPT đang xử lý / sinh chữ)
    if (queryAny(SELECTORS.stopButton)) return true;

    // 3. Số lượng tin nhắn assistant trên màn hình đã tăng thêm
    if (queryAllAny(SELECTORS.assistantMessage).length > initialCount) return true;

    return false;
  };

  while (Date.now() - startTime < maxWaitMs) {
    // Nếu phát hiện tin nhắn đã được gửi đi thành công -> hoàn tất ngay lập tức
    if (isSent()) {
      reportProgress('🚀 Tin nhắn đã được gửi đi thành công!');
      return true;
    }

    // Tìm các ứng viên nút Send
    let sendBtn = null;
    const candidates = [
      form ? form.querySelector('button[data-testid="send-button"]') : null,
      form ? form.querySelector('button[type="submit"]') : null,
      form ? form.querySelector('button[aria-label*="Send"], button[aria-label*="Gửi"]') : null,
      document.querySelector('button[data-testid="send-button"]'),
      document.querySelector('button[type="submit"]'),
      document.querySelector('button[aria-label*="Send"], button[aria-label*="Gửi"]'),
      form ? form.querySelector('button.bg-composer-primary') : null
    ].filter(Boolean);

    for (const btn of candidates) {
      const label = (btn.getAttribute('aria-label') || '').toLowerCase();
      const isVoice = label.includes('voice') || label.includes('giọng nói') || label.includes('dictate');
      if (!isVoice) {
        sendBtn = btn;
        break;
      }
    }

    if (sendBtn) {
      const isDisabled = sendBtn.disabled || sendBtn.getAttribute('aria-disabled') === 'true';
      if (!isDisabled) {
        reportProgress(`4. Tìm thấy nút Send (${sendBtn.getAttribute('aria-label') || 'Submit'}), đang bấm gửi...`);

        // Chỉ click nút Send một lần duy nhất
        sendBtn.focus();
        sendBtn.click();

        await sleep(500);
        continue;
      } else {
        const msg = '⏳ Nút Send đã xuất hiện nhưng đang bị disabled (đang đợi React kích hoạt)...';
        if (lastReportedStatus !== msg) {
          lastReportedStatus = msg;
          reportProgress(msg);
        }
      }
    } else {
      const elapsed = Math.round((Date.now() - startTime) / 1000);

      // Nudge 1: Sau 2.5s nếu nút Send chưa hiện (vẫn ở chế độ Voice), chủ động kích thích editor
      if (elapsed >= 3 && !nudged) {
        nudged = true;
        reportProgress('⚡ Đang kích thích ô soạn thảo để ép ChatGPT hiển thị nút Send...');
        editor.focus();
        editor.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
        editor.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
      }

      // Nudge 2: Cứ mỗi 3s, thử bấm Enter trực tiếp trên editor
      if (elapsed >= 4 && elapsed % 3 === 0) {
        const msg = `⏳ Đang đợi nút Send (${elapsed}s)... thử phát lệnh Enter trực tiếp`;
        if (lastReportedStatus !== msg) {
          lastReportedStatus = msg;
          reportProgress(msg);
        }
        editor.focus();
        const enterOpts = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true, composed: true, shiftKey: false };
        editor.dispatchEvent(new KeyboardEvent('keydown', enterOpts));
        editor.dispatchEvent(new KeyboardEvent('keyup', enterOpts));
      }
    }

    await sleep(350);
  }

  if (isSent()) {
    return true;
  }

  throw new Error('Nút Send của ChatGPT không hiển thị hoặc không kích hoạt được sau 15 giây. Vui lòng kiểm tra lại tab ChatGPT.');
}

// Trạng thái điều phối đơn nhiệm & hủy tác vụ trong tab ChatGPT
let isExecuting = false;
let activeTaskId = null;
let activePollTimer = null;
let activeReject = null;

function cleanupActiveTask() {
  if (activePollTimer) {
    clearInterval(activePollTimer);
    activePollTimer = null;
  }
  isExecuting = false;
  activeTaskId = null;
  activeReject = null;
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // Phản hồi nhịp tim kiểm tra tab sống & đồng bộ tài khoản
  if (request.action === 'PING' || request.action === 'CHECK_ACCOUNT') {
    reportChatGPTAccount().catch(() => {});
    sendResponse({ action: 'PONG', version: '2.1' });
    return false;
  }

  // Nhận lệnh hủy tác vụ từ server/background
  if (request.action === 'CANCEL_TASK') {
    if (activeTaskId === request.id) {
      console.log(`🛑 [ChatGPT Bridge] Nhận lệnh CANCEL_TASK cho id: ${request.id}`);
      reportProgress(`Đã hủy tác vụ ${request.id}`);
      if (typeof activeReject === 'function') {
        activeReject(new Error(`Tác vụ ${request.id} đã bị hủy bởi hệ thống.`));
      }
      cleanupActiveTask();
    }
    return false;
  }

  // Chuỗi xử lý tuần tự (FIFO Chain) bảo đảm không bao giờ gọi đè tác vụ trên tab ChatGPT
  let executionChain = Promise.resolve();

  if (request.action === 'ASK') {
    console.log('📥 [ChatGPT Bridge] Tiếp nhận yêu cầu ASK:', request.prompt?.slice(0, 50) + '... (ID: ' + request.id + ')');

    executionChain = executionChain.then(async () => {
      isExecuting = true;
      activeTaskId = request.id;
      try {
        const answer = await handleAskRequest(request);
        console.log('✅ [ChatGPT Bridge] Trả lời thành công (' + answer.length + ' ký tự)');
        safeSendMessage({
          action: 'TASK_RESULT',
          id: request.id,
          status: 'success',
          answer: answer
        });
        try {
          sendResponse({ id: request.id, status: 'success', answer });
        } catch (e) {}
      } catch (err) {
        console.log('❌ [ChatGPT Bridge] Lỗi:', err.message);
        safeSendMessage({
          action: 'TASK_RESULT',
          id: request.id,
          status: 'error',
          error: err.message
        });
        try {
          sendResponse({ id: request.id, status: 'error', error: err.message });
        } catch (e) {}
      } finally {
        cleanupActiveTask();
      }
    });

    return true; // Giữ kênh async cho sendResponse
  }
});

async function handleAskRequest(request) {
  // 0. Kiểm tra lỗi hệ thống / Cloudflare trước khi chạy
  const systemErr = checkSystemErrors();
  if (systemErr) {
    throw new Error(systemErr);
  }

  // 1. Tự động mở New Chat nếu có yêu cầu (tránh reload nếu đang ở màn hình home)
  if (request.newChat) {
    const isAlreadyHome = !!document.querySelector('form[data-composer-placement="home"]');
    if (!isAlreadyHome) {
      const newChatBtn = document.querySelector('button[aria-label*="New chat"], button[aria-label*="Đoạn chat mới"], button[data-testid="create-new-chat-button"], a[aria-label*="New chat"], a[href="/"]');
      if (newChatBtn) {
        reportProgress('Đang bấm tạo New Chat trên giao diện...');
        newChatBtn.click();
        await sleep(1000);
      }
    }
  }

  // 2. Ghi nhận trạng thái tin nhắn hiện tại trước khi gửi
  const initialItems = queryAllAny(SELECTORS.assistantMessage);
  const initialCount = initialItems.length;
  const initialLastText = initialItems.length > 0 ? extractCleanMarkdown(initialItems[initialItems.length - 1]) : '';

  // Chuyển Data URL (Base64) sang File object để nạp vào trang web (tái sử dụng từ UTILS)
  const dataUrlToFile = UTILS.dataUrlToFile || function(dataUrl, defaultName = 'upload.png') {
    try {
      const parts = dataUrl.split(',');
      if (parts.length < 2) return null;
      const mimeMatch = parts[0].match(/:(.*?);/);
      const mime = mimeMatch ? mimeMatch[1] : 'image/png';
      const bstr = atob(parts[1]);
      let n = bstr.length;
      const u8arr = new Uint8Array(n);
      while (n--) {
        u8arr[n] = bstr.charCodeAt(n);
      }
      const ext = mime.split('/')[1] || 'png';
      const filename = defaultName.includes('.') ? defaultName : `${defaultName}.${ext}`;
      return new File([u8arr], filename, { type: mime });
    } catch (e) {
      console.log('⚠️ [ChatGPT Bridge] Lỗi dataUrlToFile:', e.message);
      return null;
    }
  };

  // Chờ tiến trình upload ảnh hoàn tất trên ChatGPT
  async function waitForChatGPTImageUpload(maxWaitMs = 12000) {
    const startTime = Date.now();
    reportProgress('⏳ Đang đợi hình ảnh tải lên máy chủ ChatGPT...');
    while (Date.now() - startTime < maxWaitMs) {
      const previews = document.querySelectorAll('[data-testid*="attachment"], [data-testid*="image"], div[class*="attachment"], img[src^="blob:"], .image-preview');
      if (previews && previews.length > 0) {
        await sleep(1500); // Đợi thêm chút để thumbnail render hoàn chỉnh
        reportProgress('✅ Hình ảnh đã tải lên ChatGPT thành công!');
        return true;
      }
      await sleep(350);
    }
    reportProgress('⚠️ Hết thời gian chờ preview ảnh, tiếp tục gửi...');
    return false;
  }

  // Tải hình ảnh lên giao diện ChatGPT Web
  async function uploadImagesToChatGPT(editor, images) {
    if (!Array.isArray(images) || images.length === 0) return;
    reportProgress(`🖼️ Đang nạp ${images.length} hình ảnh vào ChatGPT...`);

    const files = [];
    for (let i = 0; i < images.length; i++) {
      const f = dataUrlToFile(images[i], `image_${i + 1}.png`);
      if (f) files.push(f);
    }

    if (files.length === 0) return;

    const dt = new DataTransfer();
    files.forEach(f => dt.items.add(f));

    let injected = false;

    // Cách 1: Nạp qua input file ẩn của ChatGPT bằng prototype setter
    const fileInputs = Array.from(document.querySelectorAll('input[type="file"]'));
    for (const input of fileInputs) {
      try {
        const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'files');
        if (descriptor && descriptor.set) {
          descriptor.set.call(input, dt.files);
        } else {
          input.files = dt.files;
        }
        input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
        input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
        injected = true;
      } catch (e) {}
    }

    // Cách 2: Bắn ClipboardEvent paste trực tiếp vào ô soạn thảo với Object.defineProperty & composed: true
    try {
      editor.focus();
      const pasteEvt = new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        composed: true
      });
      Object.defineProperty(pasteEvt, 'clipboardData', {
        value: dt,
        writable: false,
        enumerable: true,
        configurable: true
      });
      editor.dispatchEvent(pasteEvt);
      injected = true;
    } catch (e) {}

    // Cách 3: Giả lập Drag & Drop vào editor và form
    try {
      const dropTargets = [editor, editor.closest('form'), document.querySelector('form')].filter(Boolean);
      for (const t of dropTargets) {
        const opts = { bubbles: true, cancelable: true, composed: true };
        const enterEvt = new DragEvent('dragenter', opts);
        Object.defineProperty(enterEvt, 'dataTransfer', { value: dt, configurable: true });
        t.dispatchEvent(enterEvt);

        const overEvt = new DragEvent('dragover', opts);
        Object.defineProperty(overEvt, 'dataTransfer', { value: dt, configurable: true });
        t.dispatchEvent(overEvt);

        const dropEvt = new DragEvent('drop', opts);
        Object.defineProperty(dropEvt, 'dataTransfer', { value: dt, configurable: true });
        t.dispatchEvent(dropEvt);
      }
      injected = true;
    } catch (e) {}

    if (injected) {
      await waitForChatGPTImageUpload();
    }
  }

  // 3. Tìm khung nhập liệu (Textarea hoặc ProseMirror) có retry
  let editor = null;
  for (let i = 0; i < 15; i++) {
    editor = queryAny(SELECTORS.editor);
    if (editor) break;
    await sleep(200);
  }

  if (!editor) {
    throw new Error('Không tìm thấy khung nhập tin nhắn của ChatGPT. Vui lòng kiểm tra lại tab ChatGPT.');
  }

  // 3.1. Nếu có hình ảnh đính kèm, nạp hình ảnh trước khi điền câu hỏi
  if (Array.isArray(request.images) && request.images.length > 0) {
    await uploadImagesToChatGPT(editor, request.images);
  }

  // 4. Điền nội dung vào ô soạn thảo
  console.log('✍️ [ChatGPT Bridge] Đang điền câu hỏi vào ô chat...');
  await enterTextIntoChatGPT(editor, request.prompt);

  // 5. Kích hoạt gửi câu hỏi với cơ chế chờ thích ứng
  await triggerSend(editor, initialCount);

  // 5.1. Báo cho Background biết đã gửi câu hỏi thành công để nhả Input Mutex (chuyển giao cho provider khác nhập liệu)
  safeSendMessage({ action: 'INPUT_SUBMITTED', id: request.id, provider: 'chatgpt' });

  // 6. Chờ phản hồi với thuật toán Streaming & Text Stability đa tầng
  return await waitForAssistantResponse(request, initialCount, initialLastText);
}

function waitForAssistantResponse(request, initialCount, initialLastText) {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    const timeoutMs = request.timeout || 180000;
    let lastText = '';
    let lastSentLength = 0;
    let stableCount = 0;
    let hasStarted = false;

    activeReject = reject;
    reportProgress('⏳ Đang theo dõi phản hồi từ ChatGPT...');

    activePollTimer = setInterval(() => {
      // 1. Kiểm tra nhanh nếu có lỗi xuất hiện trong lúc sinh
      const systemErr = checkSystemErrors();
      if (systemErr) {
        cleanupActiveTask();
        reportProgress('❌ Phát hiện lỗi hệ thống: ' + systemErr);
        reject(new Error(systemErr));
        return;
      }

      const stopBtn = queryAny(SELECTORS.stopButton);
      const assistantItems = queryAllAny(SELECTORS.assistantMessage);

      // Bóc tách nội dung tin nhắn và phân biệt chính xác lượt mới so với lượt cũ
      let currentText = '';
      let isNewTurn = false;

      if (assistantItems.length > initialCount) {
        currentText = extractCleanMarkdown(assistantItems[assistantItems.length - 1]);
        isNewTurn = true;
      } else if (assistantItems.length > 0) {
        const rawText = extractCleanMarkdown(assistantItems[assistantItems.length - 1]);
        if (initialCount === 0) {
          currentText = rawText;
          isNewTurn = true;
        } else if (rawText !== initialLastText) {
          currentText = rawText;
          isNewTurn = true;
        } else {
          // Vẫn là tin nhắn của lượt trước -> Không gán vào currentText
          currentText = '';
          isNewTurn = false;
        }
      }

      // Nhận diện khi ChatGPT đã bắt đầu sinh câu trả lời mới
      if (stopBtn || assistantItems.length > initialCount || (isNewTurn && currentText.length > 0)) {
        if (!hasStarted) {
          hasStarted = true;
          reportProgress('📡 ChatGPT đã bắt đầu gõ câu trả lời...');
        }
      }

      // Kiểm tra Context Extension còn sống không trong vòng lặp polling
      if (!isExtensionValid()) {
        cleanupActiveTask();
        console.log('⚠️ [ChatGPT Bridge] Extension context đã bị vô hiệu hóa do reload tiện ích.');
        reject(new Error('Extension context invalidated'));
        return;
      }

      // Xử lý Streaming: bắn chunk về extension background nếu có chữ mới của lượt này
      if (request.stream && isNewTurn && currentText.length > lastSentLength) {
        const chunk = currentText.slice(lastSentLength);
        lastSentLength = currentText.length;
        safeSendMessage({
          action: 'STREAM_CHUNK',
          id: request.id,
          chunk,
          fullText: currentText
        });
      }

      // Nếu đang có nút Stop -> vẫn đang tiếp tục sinh chữ
      if (stopBtn) {
        stableCount = 0;
        lastText = currentText;
      } else if (hasStarted) {
        // Nút Stop đã biến mất, chỉ hoàn tất KHI ĐÃ CÓ TEXT MỚI CỦA LƯỢT NÀY
        if (isNewTurn && currentText.length > 0) {
          if (currentText === lastText) {
            stableCount++;
            // Nếu văn bản giữ nguyên không đổi trong 2 nhịp liên tiếp (~900ms)
            if (stableCount >= 2) {
              if (isChatGPTErrorText(currentText)) {
                cleanupActiveTask();
                reportProgress('❌ ChatGPT báo lỗi: ' + currentText);
                reject(new Error('ChatGPT Error: ' + currentText));
                return;
              }
              cleanupActiveTask();
              reportProgress('🎉 ChatGPT đã hoàn tất toàn bộ câu trả lời (' + currentText.length + ' ký tự)!');
              resolve(currentText);
              return;
            }
          } else {
            stableCount = 0;
            lastText = currentText;
          }
        }
      }

      // Quản lý timeout
      if (Date.now() - startTime > timeoutMs) {
        cleanupActiveTask();
        if (isNewTurn && currentText.length > 0 && !isChatGPTErrorText(currentText)) {
          resolve(currentText);
        } else {
          const errMsg = isChatGPTErrorText(currentText) ? 'ChatGPT Error: ' + currentText : 'Timeout: Quá thời gian chờ phản hồi từ ChatGPT (' + (timeoutMs / 1000) + 's).';
          reject(new Error(errMsg));
        }
      }
    }, 450);
  });
}

const sleep = UTILS.sleep || ((ms) => new Promise(r => setTimeout(r, ms)));

// Tạo nút nổi Bridge Console trên giao diện ChatGPT để 1-click mở ngay Sidebar
function injectFloatingBridgeButton() {
  if (UTILS.injectFloatingBadge) {
    UTILS.injectFloatingBadge({
      id: 'chatgpt-bridge-floating-btn',
      labelText: 'Bridge Logs',
      dotColor: '#10b981',
      badgeTitle: 'Bấm để mở ChatGPT Bridge Console (hoặc phím tắt Ctrl+Shift+B)',
      logPrefix: '[ChatGPT Bridge]'
    });
    return;
  }

  // Fallback nếu UTILS chưa kịp nạp
  if (document.getElementById('chatgpt-bridge-floating-btn')) return;
  const btn = document.createElement('div');
  btn.id = 'chatgpt-bridge-floating-btn';
  btn.textContent = 'Bridge Logs';
  btn.onclick = () => safeSendMessage({ action: 'OPEN_SIDEPANEL' });
  document.body.appendChild(btn);
}

  // Lấy thông tin tài khoản ChatGPT từ NextAuth session API
  async function fetchChatGPTAuthSession() {
    try {
      const res = await fetch('/api/auth/session', {
        headers: { 'Accept': 'application/json' },
        credentials: 'same-origin'
      });
      if (res.ok) {
        const data = await res.json();
        if (data && data.user && (data.user.name || data.user.email)) {
          const email = data.user.email || null;
          const name = data.user.name || (email ? email.split('@')[0] : 'ChatGPT User');
          return { name, email };
        }
      }
    } catch (e) {}
    return null;
  }

  // Quét LocalStorage tìm thông tin tài khoản ChatGPT được cache
  function detectChatGPTUserFromLocalStorage() {
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key) continue;
        if (key.includes('user') || key.includes('auth') || key.includes('profile') || key.includes('session')) {
          const val = localStorage.getItem(key);
          if (val && (val.includes('@') || val.includes('"name"'))) {
            try {
              const parsed = JSON.parse(val);
              const user = parsed.user || parsed.profile || parsed;
              const email = user.email || (typeof user === 'string' && user.includes('@') ? user : null);
              const name = user.name || (email ? email.split('@')[0] : null);
              if (email || name) {
                return { name: name || email.split('@')[0], email: email || null };
              }
            } catch (err) {}
          }
        }
      }
    } catch (e) {}
    return null;
  }

  // Quét DOM tìm thông tin tài khoản ChatGPT
  function detectChatGPTAccountFromDOM() {
    try {
      // 1. Kiểm tra các button profile phổ biến trên ChatGPT
      const profileSelectors = [
        'button[data-testid="profile-button"]',
        'div[data-testid="profile-button"]',
        '[data-testid="accounts-profile-button"]',
        'button[data-testid*="user"]',
        'button[aria-label*="Profile" i]',
        'button[aria-label*="User" i]',
        'button[aria-label*="Tài khoản" i]',
        'nav button[aria-haspopup="menu"]',
        'nav div[role="button"][aria-haspopup="menu"]'
      ];

      for (const sel of profileSelectors) {
        let btn = null;
        try {
          btn = document.querySelector(sel);
        } catch (e) {}
        if (!btn) continue;

        const text = (btn.innerText || btn.textContent || '').trim();
        const ariaLabel = (btn.getAttribute('aria-label') || '').trim();
        const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
        const cleanLines = lines.filter(l => !/^(loading|đang tải|profile|user menu|tài khoản|free|plus|pro|team|enterprise|upgrade|nâng cấp|settings|cài đặt)/i.test(l));

        let name = cleanLines[0] || '';
        let email = lines.find(l => l.includes('@')) || '';

        const img = btn.querySelector('img');
        if (img && img.alt) {
          const alt = img.alt.trim();
          if (alt.includes('@') && !email) {
            email = alt;
          } else if (!name && !/^(loading|profile|avatar|user|ảnh đại diện)/i.test(alt)) {
            name = alt;
          }
        }

        if (!name && ariaLabel && !/^(loading|profile|user menu|tài khoản)/i.test(ariaLabel)) {
          name = ariaLabel.replace(/Profile|User menu|Tài khoản|menu/gi, '').trim();
        }

        if (name || email) {
          return {
            name: name || (email ? email.split('@')[0] : 'ChatGPT User'),
            email: email || null
          };
        }
      }

      // 2. Tìm trong sidebar navigation (nav)
      const nav = document.querySelector('nav');
      if (nav) {
        const allTextEls = nav.querySelectorAll('div, span, p');
        for (const el of allTextEls) {
          if (el.children.length === 0) {
            const t = (el.textContent || '').trim();
            if (t.includes('@') && !t.includes(' ') && t.length < 100) {
              return { name: t.split('@')[0], email: t };
            }
          }
        }
      }

      // 3. Quét thẻ script __NEXT_DATA__ nếu có
      const nextDataEl = document.getElementById('__NEXT_DATA__');
      if (nextDataEl && nextDataEl.textContent) {
        try {
          const json = JSON.parse(nextDataEl.textContent);
          const user = json?.props?.pageProps?.user;
          if (user && (user.name || user.email)) {
            return {
              name: user.name || (user.email ? user.email.split('@')[0] : 'ChatGPT User'),
              email: user.email || null
            };
          }
        } catch (e) {}
      }
    } catch (e) {}
    return null;
  }

  // Nhận diện tổng hợp tài khoản ChatGPT
  async function detectChatGPTAccount() {
    // 1. NextAuth Session API (chuẩn xác nhất trên chatgpt.com)
    const apiAcc = await fetchChatGPTAuthSession();
    if (apiAcc && (apiAcc.name || apiAcc.email)) {
      return apiAcc;
    }

    // 2. LocalStorage cache
    const lsAcc = detectChatGPTUserFromLocalStorage();
    if (lsAcc && (lsAcc.name || lsAcc.email)) {
      return lsAcc;
    }

    // 3. Quét DOM
    return detectChatGPTAccountFromDOM();
  }

  let lastReportedAccountKey = null;

  async function reportChatGPTAccount() {
    try {
      const acc = await detectChatGPTAccount();
      if (acc && (acc.name || acc.email)) {
        const key = `${acc.name}_${acc.email}`;
        if (lastReportedAccountKey === key) return true;
        lastReportedAccountKey = key;

        console.log(`👤 [ChatGPT Bridge] Nhận diện tài khoản ChatGPT: ${acc.name} ${acc.email ? '(' + acc.email + ')' : ''}`);
        safeSendMessage({
          action: 'UPDATE_ACCOUNT_INFO',
          provider: 'chatgpt',
          user: acc
        });
        return true;
      }
    } catch (e) {}
    return false;
  }

  // Tự động quét và theo dõi khi DOM ChatGPT thay đổi (React render)
  let observerConnected = false;
  function startAccountObserver() {
    if (observerConnected || !document.body) return;
    try {
      const obs = new MutationObserver(() => {
        reportChatGPTAccount().then((found) => {
          if (found) {
            obs.disconnect();
          }
        });
      });
      obs.observe(document.body, { childList: true, subtree: true });
      observerConnected = true;
      setTimeout(() => obs.disconnect(), 30000);
    } catch (e) {}
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      injectFloatingBridgeButton();
      setTimeout(reportChatGPTAccount, 800);
      setTimeout(reportChatGPTAccount, 2500);
      setTimeout(reportChatGPTAccount, 6000);
      startAccountObserver();
    });
  } else {
    injectFloatingBridgeButton();
    setTimeout(reportChatGPTAccount, 800);
    setTimeout(reportChatGPTAccount, 2500);
    setTimeout(reportChatGPTAccount, 6000);
    startAccountObserver();
  }
})();
