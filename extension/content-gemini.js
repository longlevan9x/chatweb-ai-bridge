/**
 * Google Gemini Web Bridge Content Script v1.0
 * Tự động hóa nhập liệu, bấm Send, streaming phản hồi trên gemini.google.com
 */

(() => {
  // Cơ chế phòng vệ: Nhận diện Extension Context còn hợp lệ hay đã bị reload/invalidated
  function isExtensionValid() {
    try {
      return Boolean(typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id);
    } catch (e) {
      return false;
    }
  }

  // Tránh nạp đè nếu script cùng version vẫn còn sống; nếu version mới hơn hoặc script cũ chết thì cho phép nạp mới
  const SCRIPT_VERSION = '1.2.0';
  if (window.__GEMINI_BRIDGE_LOADED__ && window.__GEMINI_BRIDGE_VERSION__ === SCRIPT_VERSION && window.__GEMINI_BRIDGE_IS_ALIVE__ && window.__GEMINI_BRIDGE_IS_ALIVE__()) {
    console.log('ℹ️ [Gemini Bridge] Content Script cùng phiên bản đã tồn tại, bỏ qua injection trùng lặp.');
    return;
  }
  window.__GEMINI_BRIDGE_LOADED__ = true;
  window.__GEMINI_BRIDGE_VERSION__ = SCRIPT_VERSION;

  console.log('🚀 [Gemini Bridge v1.0] Content Script nạp thành công trên tab Google Gemini.');

  // Wrapper gửi tin an toàn tuyệt đối, không bao giờ ném Uncaught Error khi extension reload
  function safeSendMessage(message) {
    if (!isExtensionValid()) {
      return Promise.resolve(null);
    }
    try {
      const p = chrome.runtime.sendMessage(message);
      if (p && typeof p.catch === 'function') {
        return p.catch(() => null);
      }
      return Promise.resolve(p);
    } catch (e) {
      return Promise.resolve(null);
    }
  }

  // Bộ chọn DOM chính xác cho Google Gemini Web (đã xác thực trực tiếp trên DOM)
  const SELECTORS = {
    editor: [
      'rich-textarea div.ql-editor[contenteditable="true"]',
      'rich-textarea div[contenteditable="true"]',
      'div.ql-editor[contenteditable="true"]',
      'div[contenteditable="true"][role="textbox"]',
      'rich-textarea .ql-editor',
      'div[contenteditable="true"]',
      'textarea[aria-label*="prompt"]',
      'textarea[aria-label*="Gemini"]',
      'textarea'
    ],
    sendButton: [
      'button[aria-label="Send message"]',
      'button[aria-label*="Send message"]',
      'button[aria-label*="Send"]',
      'gem-icon-button.send-button button',
      'div[data-test-id="send-button-container"] button',
      'button[aria-label*="Gửi tin nhắn"]',
      'button[aria-label*="Gửi"]',
      'button[aria-label*="Submit"]',
      'button.send-button',
      'button[data-test-id="send-button"]',
      'div.send-button-container button'
    ],
    stopButton: [
      'button[aria-label*="Stop response"]',
      'button[aria-label*="Stop generating"]',
      'button[aria-label*="Dừng phản hồi"]',
      'button[aria-label*="Dừng tạo"]',
      'button.stop-button',
      'div.send-button-container button[aria-label*="Stop"]',
      'div.send-button-container button[aria-label*="Dừng"]'
    ],
    modelResponse: [
      'model-response',
      'message-content',
      'div.model-response-text'
    ],
    errorBanner: [
      'div[class*="error-message"]',
      'div[class*="error-container"]',
      'div[class*="error"]',
      'div[role="alert"]',
      'snack-bar-container',
      'mat-snack-bar-container',
      'simple-snack-bar',
      '.response-error',
      'model-response [data-is-error="true"]',
      'model-response .error',
      'div.error-content'
    ]
  };

  // Nhận diện thông báo lỗi hệ thống từ Google Gemini Web (tiếng Anh & tiếng Việt)
  function isGeminiErrorText(text) {
    if (!text || typeof text !== 'string') return false;
    const trimmed = text.trim();
    if (!trimmed) return false;
    const lower = trimmed.toLowerCase();

    // 1. Tiền tố lỗi đặc trưng từ hệ thống Gemini Web
    const errorPrefixes = [
      'sorry, something went wrong',
      'something went wrong',
      'please try your request again',
      'please try again',
      'an error occurred',
      'rất tiếc, đã xảy ra lỗi',
      'đã xảy ra lỗi',
      'vui lòng thử lại',
      'google workspace encountered an error'
    ];

    for (const prefix of errorPrefixes) {
      if (lower.startsWith(prefix) && lower.length < 350) {
        return true;
      }
    }

    // 2. Chứa toàn văn cụm từ lỗi trong đoạn phản hồi ngắn (< 300 ký tự)
    const errorPhrases = [
      'sorry, something went wrong. please try your request again',
      'sorry, something went wrong',
      'something went wrong. please try your request again',
      'something went wrong. please try again',
      'please try your request again',
      'an error occurred. please try again',
      'rất tiếc, đã xảy ra lỗi. vui lòng thử lại yêu cầu của bạn',
      'rất tiếc, đã xảy ra lỗi. vui lòng thử lại',
      'rất tiếc, đã xảy ra lỗi',
      'đã xảy ra lỗi. vui lòng thử lại yêu cầu',
      'đã xảy ra lỗi. vui lòng thử lại sau',
      'đã xảy ra lỗi. vui lòng thử lại',
      'vui lòng thử lại yêu cầu'
    ];

    for (const phrase of errorPhrases) {
      if (lower.includes(phrase) && lower.length < 300) {
        return true;
      }
    }

    // 3. Quá hạn mức / Rate limit / Quota
    if (lower.length < 250) {
      if (
        (lower.includes('quota') || lower.includes('usage limit') || lower.includes('rate limit') || lower.includes('giới hạn')) &&
        (lower.includes('exceeded') || lower.includes('reached') || lower.includes('vượt quá') || lower.includes('đạt') || lower.includes('hết'))
      ) {
        return true;
      }
    }

    return false;
  }

  function isElementVisible(el) {
    if (!el) return false;
    if (el.offsetParent === null && el.offsetWidth === 0 && el.offsetHeight === 0) return false;
    try {
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    } catch (_) {
      return el.offsetWidth > 0 || el.offsetHeight > 0;
    }
  }

  function queryAnyVisible(selectors) {
    for (const sel of selectors) {
      try {
        const list = document.querySelectorAll(sel);
        for (const el of list) {
          if (isElementVisible(el)) return el;
        }
      } catch (_) {
        // Selector không hợp lệ hoặc DOM node không thể truy vấn — thử tiếp
      }
    }
    return null;
  }

  // Tìm chính xác nút Send của ô soạn thảo Gemini (loại bỏ nhầm lẫn nút Feedback, Mic, Audio)
  function findGeminiSendButton() {
    const editor = queryAny(SELECTORS.editor);
    const root = editor ? (editor.closest('.input-area-container') || editor.closest('form') || editor.closest('.text-input-field') || editor.parentElement?.parentElement?.parentElement || document) : document;

    const candidates = root.querySelectorAll('button, [role="button"]');
    for (const btn of candidates) {
      if (!isElementVisible(btn)) continue;
      const label = (btn.getAttribute('aria-label') || '').toLowerCase();

      // Loại bỏ các nút feedback, mic, add file
      if (label.includes('phản hồi') || label.includes('feedback') || label.includes('voice') || label.includes('mic') || label.includes('audio') || label.includes('attach') || label.includes('tệp')) {
        continue;
      }

      // Nhận diện nút Send thực thụ
      if (
        label === 'send message' ||
        label === 'gửi tin nhắn' ||
        label === 'gửi' ||
        label.includes('send message') ||
        label.includes('gửi tin nhắn') ||
        label.includes('send prompt') ||
        label.includes('gửi lời nhắc') ||
        btn.classList.contains('send-button') ||
        btn.getAttribute('data-test-id') === 'send-button' ||
        btn.getAttribute('mattooltip')?.toLowerCase().includes('send') ||
        btn.getAttribute('mattooltip')?.toLowerCase().includes('gửi')
      ) {
        return btn;
      }
    }
    return null;
  }

  // Tìm nút Stop khi Gemini đang sinh phản hồi
  function findGeminiStopButton() {
    const buttons = document.querySelectorAll('button, [role="button"]');
    for (const btn of buttons) {
      if (!isElementVisible(btn)) continue;
      const label = (btn.getAttribute('aria-label') || '').toLowerCase();
      const tooltip = (btn.getAttribute('mattooltip') || '').toLowerCase();

      if (
        label.includes('stop') ||
        label.includes('dừng') ||
        tooltip.includes('stop') ||
        tooltip.includes('dừng') ||
        btn.classList.contains('stop-button') ||
        btn.getAttribute('data-test-id')?.includes('stop')
      ) {
        return btn;
      }

      // Kiểm tra mat-icon hoặc svg stop bên trong
      const matIcon = btn.querySelector('mat-icon');
      if (matIcon) {
        const iconText = (matIcon.innerText || matIcon.textContent || '').trim().toLowerCase();
        const fontIcon = (matIcon.getAttribute('fonticon') || '').toLowerCase();
        if (iconText === 'stop' || fontIcon === 'stop' || iconText === 'pause' || fontIcon === 'pause') {
          return btn;
        }
      }
    }
    return null;
  }

  // Kiểm tra Gemini có đang trong quá trình sinh phản hồi hoặc suy nghĩ (thinking) hay không
  function isGeminiGenerating() {
    // 1. Có nút Stop hiển thị
    if (findGeminiStopButton()) return true;

    // 2. Thẻ pending-response, pending-request hoặc thinking-dots-animation, gpi-static-text-loader (mẫu dom-samples/gemini.html)
    if (document.querySelector('pending-response, pending-request, thinking-dots-animation, .thinking-dots-animation, .gpi-static-text-loader')) {
      return true;
    }

    // 3. Có progress bar bên trong vùng chat area (không query ra ngoài body/sidebar)
    const chatArea = document.querySelector('chat-window, main, [role="main"]');
    if (chatArea) {
      const progress = chatArea.querySelector('mat-progress-bar, .loading-indicator');
      if (progress && isElementVisible(progress)) return true;
    }

    return false;
  }

  function isSendButtonAvailable() {
    const btn = findGeminiSendButton();
    if (!btn || !isElementVisible(btn)) return false;
    const isDisabled = btn.hasAttribute('disabled') ||
                       btn.getAttribute('aria-disabled') === 'true' ||
                       btn.classList.contains('disabled');
    return !isDisabled;
  }

  function queryAny(selectors) {
    for (const sel of selectors) {
      try {
        const el = document.querySelector(sel);
        if (el) return el;
      } catch (_) {
        // Selector không hợp lệ hoặc DOM node không thể truy vấn — thử tiếp
      }
    }
    return null;
  }

  function queryAllAny(selectors) {
    for (const sel of selectors) {
      try {
        const list = document.querySelectorAll(sel);
        if (list && list.length > 0) return Array.from(list);
      } catch (_) {
        // Selector không hợp lệ hoặc DOM node không thể truy vấn — thử tiếp
      }
    }
    return [];
  }

  function reportProgress(text) {
    console.log('[Gemini Bridge] ' + text);
    safeSendMessage({ action: 'LOG', text: `[Gemini Tab] ${text}` });
  }

  function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  // Bóc tách text và bảo tồn Code Blocks trong câu trả lời của Gemini
  // Tuân thủ nghiêm ngặt TrustedHTML của Google (dùng TextNode thay vì outerHTML/innerHTML)
  function extractGeminiMarkdown(container) {
    if (!container) return '';
    const contentRoot = container.querySelector('message-content') ||
                        container.querySelector('div.markdown') ||
                        container.querySelector('div.response-content') ||
                        container;

    // Lấy nội dung trực tiếp từ live DOM element trước (chuẩn TrustedHTML và không bị mất trên detached clone)
    const raw = (contentRoot.innerText || contentRoot.textContent || '').trim();

    // Nếu có code blocks, bóc tách cấu trúc markdown sạch
    const codeBlocks = contentRoot.querySelectorAll('code-block');
    if (codeBlocks.length > 0) {
      try {
        const clone = contentRoot.cloneNode(true);
        clone.querySelectorAll('h6, [aria-label*="Gemini said"], button, gem-icon-button, .code-block-decoration .buttons').forEach(el => {
          try { el.remove(); } catch (_) { /* Node đã bị detach khỏi DOM — an toàn bỏ qua */ }
        });
        clone.querySelectorAll('code-block').forEach((block) => {
          try {
            const langEl = block.querySelector('.code-block-decoration span, .header-formatted span');
            const lang = (langEl?.innerText || langEl?.textContent || '').trim().toLowerCase();
            const codeEl = block.querySelector('code[data-test-id="code-content"], pre code, code') || block;
            const codeText = codeEl.innerText || codeEl.textContent || '';
            const textNode = document.createTextNode(`\n\`\`\`${lang}\n${codeText.trim()}\n\`\`\`\n`);
            block.replaceWith(textNode);
          } catch (_) {
            /* Bỏ qua nếu block code có cấu trúc dị thường */
          }
        });
        const formatted = (clone.innerText || clone.textContent || '').trim();
        if (formatted.length > 0) return formatted;
      } catch (_) {
        // Fallback về raw text nếu cloneNode gặp sự cố
      }
    }

    return raw;
  }

  // Nhập văn bản vào trình soạn thảo của Gemini (Quill / Rich-Textarea)
  async function enterTextIntoGemini(editor, text) {
    reportProgress('1. Chuẩn bị ô nhập liệu Gemini...');
    editor.focus();
    editor.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    editor.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await sleep(100);

    // 1. Xóa nội dung cũ nếu có
    try {
      const sel = window.getSelection();
      if (sel) {
        const range = document.createRange();
        range.selectNodeContents(editor);
        sel.removeAllRanges();
        sel.addRange(range);
      }
    } catch (_) {
      // Selection range lỗi trên editor bị ẩn hoặc chưa mount
    }

    // 2. Chèn text bằng execCommand (an toàn 100% với TrustedHTML của Google)
    let ok = false;
    try {
      ok = document.execCommand('insertText', false, text);
    } catch (_) {
      // execCommand có thể bị trình duyệt chặn ở một số bối cảnh
    }

    // 3. Fallback an toàn TrustedHTML nếu execCommand không hoạt động
    const hasText = () => (editor.textContent || editor.innerText || '').trim().length > 0;

    if (!ok || !hasText()) {
      try {
        while (editor.firstChild) editor.removeChild(editor.firstChild);
        const p = document.createElement('p');
        const lines = text.split('\n');
        lines.forEach((line, i) => {
          if (i > 0) p.appendChild(document.createElement('br'));
          if (line) p.appendChild(document.createTextNode(line));
        });
        editor.appendChild(p);
      } catch (_) {
        // Fallback DOM manipulation thất bại nếu node bị lock
      }
    }

    // 4. Kích hoạt chuỗi sự kiện để Angular / Lit State của Gemini nhận diện văn bản
    editor.dispatchEvent(new InputEvent('beforeinput', { inputType: 'insertText', data: text, bubbles: true }));
    editor.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true }));
    editor.dispatchEvent(new Event('change', { bubbles: true }));
    editor.dispatchEvent(new KeyboardEvent('keyup', { key: 'a', bubbles: true }));

    await sleep(200);
    reportProgress('2. Đã nhập xong nội dung vào Gemini (' + text.length + ' ký tự)');
  }

  // Kích hoạt gửi câu hỏi với cơ chế kiểm tra đa tầng isSent
  async function triggerSendGemini(editor, initialCount = 0) {
    const maxWaitMs = 15000;
    const startTime = Date.now();
    let nudged = false;
    let clickSent = false;
    let lastReportedStatus = '';

    const isSent = () => {
      // 1. Trạng thái sinh hoặc nút Stop hoặc pending-request/thinking-dots đã xuất hiện
      if (isGeminiGenerating()) return true;

      // 2. Text trong ô soạn thảo đã được dọn sạch hoàn toàn sau khi bấm gửi
      const textRemaining = (editor.textContent || editor.innerText || '').trim();
      if (textRemaining.length === 0 && clickSent) return true;

      // 3. Số lượng thẻ model-response đã tăng thêm
      if (queryAllAny(SELECTORS.modelResponse).length > initialCount) return true;

      return false;
    };

    reportProgress('3. Đang kích hoạt gửi câu hỏi lên Gemini...');

    while (Date.now() - startTime < maxWaitMs) {
      if (isSent()) {
        reportProgress('🚀 Tin nhắn đã được gửi đi thành công!');
        return true;
      }

      const sendBtn = findGeminiSendButton();
      if (sendBtn) {
        const isDisabled = sendBtn.hasAttribute('disabled') ||
                           btnAriaDisabled(sendBtn) ||
                           sendBtn.classList.contains('disabled');
        if (!isDisabled) {
          if (!clickSent) {
            clickSent = true;
            reportProgress('4. Đang click nút Gửi tin nhắn...');
            sendBtn.focus();
            sendBtn.click();

            // Cho Gemini ít nhất 800ms để chuyển sang trạng thái pending
            await sleep(800);
            continue;
          }
        } else {
          const msg = '⏳ Nút Gửi đang chờ sẵn sàng...';
          if (lastReportedStatus !== msg) {
            lastReportedStatus = msg;
            reportProgress(msg);
          }
        }
      } else {
        const elapsed = Math.round((Date.now() - startTime) / 1000);

        if (elapsed >= 2 && !nudged) {
          nudged = true;
          reportProgress('⚡ Đang kích thích ô soạn thảo để hiện nút Gửi...');
          editor.focus();
          document.execCommand('insertText', false, ' ');
          document.execCommand('delete', false, null);
          editor.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true }));
        }

        // Fallback duy nhất khi không tìm thấy nút Send sau 4 giây: Bấm Enter trên editor
        if (elapsed >= 4 && !clickSent) {
          editor.focus();
          const enterOpts = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true, composed: true, shiftKey: false };
          editor.dispatchEvent(new KeyboardEvent('keydown', enterOpts));
          editor.dispatchEvent(new KeyboardEvent('keyup', enterOpts));
          clickSent = true;
          await sleep(800);
        }
      }

      await sleep(350);
    }

    if (isSent()) {
      return true;
    }

    throw new Error('Nút Gửi của Gemini không khả dụng hoặc không phản hồi sau 15 giây. Vui lòng kiểm tra lại tab gemini.google.com.');
  }

  function btnAriaDisabled(btn) {
    return btn.getAttribute('aria-disabled') === 'true';
  }

  // Trạng thái điều phối đơn nhiệm & hủy tác vụ
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

  // Bắt luồng phản hồi và streaming từ Gemini với cơ chế chống resolve sớm
  function monitorGeminiResponse(request, initialCount, initialLastText, timeoutMs = 180000) {
    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      let hasStarted = false;
      let seenGenerating = false;
      let lastText = '';
      let stableCount = 0;
      let lastSentLength = 0;
      let lastTextChangeTime = Date.now();

      activeReject = reject;

      activePollTimer = setInterval(() => {
        // Guard: Extension context còn hợp lệ không?
        if (!isExtensionValid()) {
          cleanupActiveTask();
          console.log('⚠️ [Gemini Bridge] Extension context đã bị vô hiệu hóa do reload tiện ích.');
          reject(new Error('Extension context invalidated'));
          return;
        }

        // 1. Kiểm tra lỗi hệ thống hoặc quota banner trên tab Gemini
        for (const sel of SELECTORS.errorBanner) {
          try {
            const list = document.querySelectorAll(sel);
            for (const errEl of list) {
              if (isElementVisible(errEl)) {
                const errText = (errEl.innerText || errEl.textContent || '').trim();
                if (errText.length > 0 && (
                  isGeminiErrorText(errText) ||
                  errText.toLowerCase().includes('error') ||
                  errText.toLowerCase().includes('lỗi') ||
                  errText.toLowerCase().includes('quota') ||
                  errText.toLowerCase().includes('something went wrong') ||
                  errText.toLowerCase().includes('try again')
                )) {
                  cleanupActiveTask();
                  console.log(`❌ [Gemini Bridge] Phát hiện banner lỗi: "${errText}"`);
                  reportProgress(`❌ Gemini báo lỗi: ${errText}`);
                  reject(new Error(`Gemini Web Error: ${errText}`));
                  return;
                }
              }
            }
          } catch (_) {}
        }

        // 1.1 Kiểm tra phần tử thông báo lỗi xuất hiện ngay sau user-query mới nhất
        try {
          const userQueries = document.querySelectorAll('user-query');
          if (userQueries.length > 0) {
            const lastQuery = userQueries[userQueries.length - 1];
            let nextEl = lastQuery.nextElementSibling;
            while (nextEl) {
              const text = (nextEl.innerText || nextEl.textContent || '').trim();
              if (text.length > 0 && isGeminiErrorText(text)) {
                cleanupActiveTask();
                console.log(`❌ [Gemini Bridge] Phát hiện thông báo lỗi sau user-query: "${text}"`);
                reportProgress(`❌ Gemini báo lỗi: ${text}`);
                reject(new Error(`Gemini Web Error: ${text}`));
                return;
              }
              nextEl = nextEl.nextElementSibling;
            }
          }
        } catch (_) {}

        // Tự động tắt popup nhắc đăng nhập nếu bất ngờ xuất hiện
        dismissModals();

        // 2. Kiểm tra trạng thái AI đang sinh (Stop button, Shimmer, Progress)
        const isGenerating = isGeminiGenerating();
        if (isGenerating) {
          seenGenerating = true;
        }

        // 3. Trích xuất văn bản phản hồi mới
        const responses = queryAllAny(SELECTORS.modelResponse);
        let currentText = '';
        let isNewTurn = false;

        if (responses.length > initialCount) {
          // Thẻ model-response mới đã xuất hiện
          const lastEl = responses[responses.length - 1];
          currentText = extractGeminiMarkdown(lastEl);
          isNewTurn = true;
        } else if (responses.length > 0) {
          const lastEl = responses[responses.length - 1];
          const rawText = extractGeminiMarkdown(lastEl);
          if (initialCount === 0) {
            currentText = rawText;
            isNewTurn = true;
          } else if (rawText !== initialLastText) {
            currentText = rawText;
            isNewTurn = true;
          } else {
            // Vẫn là câu trả lời của lượt cũ -> Giữ currentText là rỗng
            currentText = '';
            isNewTurn = false;
          }
        }

        // 3.1 Chặn ngay lập tức nếu nội dung hoặc container phản hồi là thông báo lỗi
        if (isNewTurn) {
          if (currentText.length > 0 && isGeminiErrorText(currentText)) {
            cleanupActiveTask();
            console.log(`❌ [Gemini Bridge] Phát hiện câu trả lời là thông báo lỗi: "${currentText}"`);
            reportProgress(`❌ Gemini báo lỗi: ${currentText}`);
            reject(new Error(`Gemini Web Error: ${currentText}`));
            return;
          }

          if (responses.length > 0) {
            const lastEl = responses[responses.length - 1];
            const rawContainerText = (lastEl.innerText || lastEl.textContent || '').trim();
            if (rawContainerText.length > 0 && isGeminiErrorText(rawContainerText)) {
              cleanupActiveTask();
              console.log(`❌ [Gemini Bridge] Phát hiện container phản hồi chứa lỗi: "${rawContainerText}"`);
              reportProgress(`❌ Gemini báo lỗi: ${rawContainerText}`);
              reject(new Error(`Gemini Web Error: ${rawContainerText}`));
              return;
            }

            // Kiểm tra nút Retry (Thử lại) xuất hiện bên trong model-response do lỗi
            const retryBtn = lastEl.querySelector('button[aria-label*="Retry"], button[aria-label*="Thử lại"], button.retry-button');
            if (retryBtn && rawContainerText.length < 350) {
              cleanupActiveTask();
              console.log(`❌ [Gemini Bridge] Phát hiện nút Thử lại (Retry) do lỗi: "${rawContainerText}"`);
              reportProgress(`❌ Gemini báo lỗi: ${rawContainerText || 'Sorry, something went wrong. Please try your request again.'}`);
              reject(new Error(`Gemini Web Error: ${rawContainerText || 'Sorry, something went wrong. Please try your request again.'}`));
              return;
            }
          }
        }

        // 4. Đánh dấu đã bắt đầu sinh câu trả lời
        if (!hasStarted) {
          if (isGenerating || responses.length > initialCount || (isNewTurn && currentText.length > 0)) {
            hasStarted = true;
            lastText = currentText;
            lastTextChangeTime = Date.now();
            reportProgress('📡 Gemini đã bắt đầu sinh câu trả lời...');
          }
        }

        // 5. Streaming chunk (chỉ bắn khi ĐÃ là lượt mới, có text mới và KHÔNG phải lỗi)
        if (request.stream && isNewTurn && currentText.length > lastSentLength && !isGeminiErrorText(currentText)) {
          const chunk = currentText.slice(lastSentLength);
          lastSentLength = currentText.length;
          safeSendMessage({ action: 'STREAM_CHUNK', id: request.id, chunk, fullText: currentText });
        }

        // 6. Đánh giá hoàn tất
        if (isGenerating) {
          // AI vẫn đang sinh hoặc đang suy nghĩ (thinking) — theo dõi text thay đổi
          if (currentText !== lastText) {
            lastText = currentText;
            lastTextChangeTime = Date.now();
          }
          stableCount = 0;
        } else if (hasStarted) {
          // AI không còn hiển thị animation/stop/pending nữa
          const uqCount = document.querySelectorAll('user-query').length;
          const mrCount = document.querySelectorAll('model-response').length;

          // Nếu số user-query vẫn nhiều hơn model-response -> Gemini vẫn chưa sinh xong response cho lượt này
          if (uqCount > 0 && uqCount > mrCount) {
            stableCount = 0;
            return;
          }

          if (isNewTurn && currentText.length > 0) {
            if (currentText === lastText) {
              stableCount++;

              // Ngưỡng ổn định văn bản:
              // - Đã thấy stop/shimmer/thinking: cần text đứng yên ít nhất 4 nhịp (~1.8s)
              // - Chưa thấy stop/shimmer: cần text đứng yên ít nhất 6 nhịp (~2.7s) để chống rớt chunk
              const requiredCount = seenGenerating ? 4 : 6;

              if (stableCount >= requiredCount) {
                const sendBtn = findGeminiSendButton();
                const sendReady = isSendButtonAvailable();

                // Nếu tìm thấy send button nhưng vẫn bị disabled -> AI vẫn chưa hoàn toàn sẵn sàng
                if (sendBtn && !sendReady && stableCount < 9) {
                  return;
                }

                if (isGeminiErrorText(currentText)) {
                  cleanupActiveTask();
                  console.log(`❌ [Gemini Bridge] Từ chối resolve vì phát hiện lỗi: "${currentText}"`);
                  reportProgress(`❌ Gemini báo lỗi: ${currentText}`);
                  reject(new Error(`Gemini Web Error: ${currentText}`));
                  return;
                }

                cleanupActiveTask();
                reportProgress(`🎉 Gemini đã hoàn tất phản hồi (${currentText.length} ký tự)!`);
                resolve(currentText);
                return;
              }
            } else {
              lastText = currentText;
              lastTextChangeTime = Date.now();
              stableCount = 0;
            }
          }
        }

        // 7. Chốt chặn an toàn (Watchdog Text Invariant):
        // Nếu đã bắt đầu, có text mới (> 20 ký tự), KHÔNG còn trong trạng thái generating, và text hoàn toàn không thay đổi trong 7 giây
        if (hasStarted && isNewTurn && currentText.length > 20 && !isGenerating && (Date.now() - lastTextChangeTime > 7000)) {
          cleanupActiveTask();
          if (isGeminiErrorText(currentText)) {
            console.log(`❌ [Gemini Bridge] Watchdog phát hiện lỗi: "${currentText}"`);
            reportProgress(`❌ Gemini báo lỗi: ${currentText}`);
            reject(new Error(`Gemini Web Error: ${currentText}`));
            return;
          }
          reportProgress(`🎉 Gemini hoàn tất (Watchdog Text Invariant, ${currentText.length} ký tự)!`);
          resolve(currentText);
          return;
        }

        // 8. Timeout toàn cục
        if (Date.now() - startTime > timeoutMs) {
          cleanupActiveTask();
          if (isNewTurn && currentText.length > 0 && !isGeminiErrorText(currentText)) {
            reportProgress(`⚠️ Timeout nhưng có ${currentText.length} ký tự mới, trả về kết quả hiện tại.`);
            resolve(currentText);
          } else {
            const finalErr = isGeminiErrorText(currentText)
              ? `Gemini Web Error: ${currentText}`
              : `Timeout: Quá thời gian chờ phản hồi từ Gemini (${timeoutMs / 1000}s)`;
            reject(new Error(finalErr));
          }
        }
      }, 450);
    });
  }

  // Đóng các popup/modal nhắc đăng nhập hoặc gợi ý nếu xuất hiện
  function dismissModals() {
    try {
      const dismissBtns = Array.from(document.querySelectorAll('button')).filter(b => {
        const text = (b.innerText || '').trim().toLowerCase();
        const aria = (b.getAttribute('aria-label') || '').toLowerCase();
        return text === 'not now' || text === 'không phải bây giờ' || aria === 'not now' || aria === 'dismiss';
      });
      dismissBtns.forEach(b => b.click());
    } catch (_) {
      // Phớt lờ lỗi nếu modal DOM không thể truy cập
    }
  }

  // Xử lý yêu cầu ASK từ background
  async function handleGeminiAsk(request) {
    dismissModals();

    // 0. CHỐT CHẶN: Nếu Gemini đang bận suy nghĩ hoặc sinh câu trả lời trước đó, chờ đến khi rảnh hoàn toàn
    if (isGeminiGenerating()) {
      reportProgress('⏳ Tab Gemini đang suy nghĩ / sinh câu trả lời trước đó. Đang đợi tab hoàn tất...');
      const waitStart = Date.now();
      while (isGeminiGenerating() && (Date.now() - waitStart < 120000)) {
        await sleep(500);
      }
      if (isGeminiGenerating()) {
        throw new Error('Tab Gemini vẫn đang bận suy nghĩ / xử lý sau 120s. Vui lòng thử lại.');
      }
      await sleep(600); // Chờ DOM settle
    }

    const editor = queryAny(SELECTORS.editor);
    if (!editor) {
      throw new Error('Không tìm thấy ô nhập câu hỏi trên Google Gemini. Vui lòng kiểm tra tab gemini.google.com.');
    }

    // Chuyển Data URL (Base64) sang File object để nạp vào trang web
    function dataUrlToFile(dataUrl, defaultName = 'upload.png') {
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
        console.log('⚠️ [Gemini Bridge] Lỗi dataUrlToFile:', e.message);
        return null;
      }
    }

    // Quét tìm tất cả input[type="file"] trong cả DOM thường và các tầng Shadow DOM
    function findAllGeminiFileInputs() {
      const inputs = [];
      function walk(node) {
        if (!node) return;
        if (node.querySelectorAll) {
          try {
            const list = node.querySelectorAll('input[type="file"]');
            for (const item of list) inputs.push(item);
          } catch (e) {}
        }
        if (node.shadowRoot) {
          walk(node.shadowRoot);
        }
        const children = node.children || [];
        for (const child of children) {
          walk(child);
        }
      }
      walk(document.body || document.documentElement);
      return inputs;
    }

    // Kiểm tra xem Gemini đã hiển thị preview ảnh được tải lên chưa
    function hasGeminiUploadedPreview() {
      const selectors = [
        'uploader-preview-card',
        '[data-test-id*="preview"]',
        'div[class*="preview-card"]',
        'div[class*="attachment"]',
        'div[class*="file-preview"]',
        'img[src*="blob:"]',
        '.attachment-container'
      ];
      for (const sel of selectors) {
        try {
          const els = document.querySelectorAll(sel);
          if (els && els.length > 0) return true;
        } catch (e) {}
      }
      return false;
    }

    // Chờ hình ảnh upload xong trên Gemini
    async function waitForGeminiImageUpload(maxWaitMs = 15000) {
      const startTime = Date.now();
      reportProgress('⏳ Đang đợi hình ảnh tải lên máy chủ Google Gemini...');
      while (Date.now() - startTime < maxWaitMs) {
        if (hasGeminiUploadedPreview()) {
          await sleep(2000); // Đợi thanh progress bar của Gemini xử lý xong hoàn toàn
          reportProgress('✅ Hình ảnh đã tải lên Google Gemini thành công!');
          return true;
        }
        await sleep(350);
      }
      reportProgress('⚠️ Hết thời gian chờ preview ảnh Gemini, tiếp tục gửi câu hỏi...');
      return false;
    }

    // Nạp hình ảnh vào Gemini Web (Kết hợp 3 chiến lược: Paste Event, Drag & Drop, và File Input)
    async function uploadImagesToGemini(editor, images) {
      if (!Array.isArray(images) || images.length === 0) return;
      reportProgress(`🖼️ Đang nạp ${images.length} hình ảnh vào Google Gemini...`);

      const files = [];
      for (let i = 0; i < images.length; i++) {
        const f = dataUrlToFile(images[i], `gemini_image_${i + 1}.png`);
        if (f) files.push(f);
      }

      if (files.length === 0) {
        reportProgress('❌ Không thể phân giải file ảnh từ Data URL.');
        return;
      }

      const dt = new DataTransfer();
      files.forEach(f => dt.items.add(f));

      const targets = [
        editor,
        editor.closest('rich-textarea'),
        editor.parentElement,
        document.querySelector('rich-textarea'),
        document.querySelector('input-area')
      ].filter(Boolean);

      // CHIẾN LƯỢC 1: Ghi ảnh vào System Clipboard và kích hoạt Paste
      reportProgress('1. Ghi ảnh vào System Clipboard & kích hoạt Paste...');
      try {
        const firstImg = images[0];
        const res = await fetch(firstImg);
        const blob = await res.blob();
        let pngBlob = blob;
        if (blob.type !== 'image/png') {
          pngBlob = await new Promise((resolve) => {
            const img = new Image();
            img.onload = () => {
              const canvas = document.createElement('canvas');
              canvas.width = img.naturalWidth || img.width;
              canvas.height = img.naturalHeight || img.height;
              const ctx = canvas.getContext('2d');
              ctx.drawImage(img, 0, 0);
              canvas.toBlob(resolve, 'image/png');
            };
            img.onerror = () => resolve(blob);
            img.src = firstImg;
          });
        }
        if (navigator.clipboard && navigator.clipboard.write) {
          await navigator.clipboard.write([
            new ClipboardItem({ 'image/png': pngBlob })
          ]);
          reportProgress('📋 Đã nạp ảnh vào System Clipboard của OS!');
        }
      } catch (clipErr) {
        reportProgress(`⚠️ Ghi clipboard: ${clipErr.message}`);
      }

      // Kích hoạt Paste trên editor
      try {
        editor.focus();
        document.execCommand('paste');
      } catch (_) {}

      for (const t of targets) {
        try {
          t.focus();
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
          t.dispatchEvent(pasteEvt);
        } catch (e) {}
      }

      await sleep(800);
      if (hasGeminiUploadedPreview()) {
        await waitForGeminiImageUpload();
        return;
      }

      // CHIẾN LƯỢC 2: Drag & Drop Event (dragenter -> dragover -> drop)
      reportProgress('2. Thử gửi ảnh qua Drag & Drop Event...');
      for (const t of targets) {
        try {
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
        } catch (e) {}
      }

      await sleep(800);
      if (hasGeminiUploadedPreview()) {
        await waitForGeminiImageUpload();
        return;
      }

      // CHIẾN LƯỢC 3: Quét tìm input[type="file"] và các nút Upload trong DOM & Shadow DOM
      reportProgress('3. Quét input[type="file"] và nút đính kèm trong DOM & Shadow DOM...');
      let fileInputs = findAllGeminiFileInputs();

      // Log chẩn đoán các input hiện có trong document
      const allInputs = Array.from(document.querySelectorAll('input')).map(inp => `${inp.type || 'text'}[name="${inp.name || ''}", id="${inp.id || ''}"]`);
      reportProgress(`Các input hiện có: [${allInputs.slice(0, 10).join(', ')}]`);

      // Quét các nút bấm xung quanh ô nhập liệu
      const inputContainer = editor.closest('.input-area-container') || editor.closest('input-area') || editor.parentElement?.parentElement || document;
      const nearbyButtons = Array.from(inputContainer.querySelectorAll('button, [role="button"], gem-icon-button')).map(b => {
        const aria = b.getAttribute('aria-label') || '';
        const tip = b.getAttribute('mattooltip') || '';
        const txt = (b.innerText || '').trim();
        return `[aria="${aria}", tip="${tip}", text="${txt}"]`;
      });
      reportProgress(`Nút xung quanh ô nhập: ${nearbyButtons.slice(0, 8).join(', ')}`);

      if (fileInputs.length === 0) {
        // Tìm nút mở menu upload hoặc file picker
        const addBtn = inputContainer.querySelector('button[aria-label*="Add" i], button[aria-label*="Thêm" i], button[aria-label*="Upload" i], button[aria-label*="Tải" i], button[aria-label*="Tools" i], button[aria-label*="Công cụ" i], uploader-file-picker button, button[mattooltip*="Upload" i], button[mattooltip*="Thêm" i]') ||
                       document.querySelector('button[aria-label*="Add files" i], button[aria-label*="Thêm tệp" i], button[aria-label*="Upload" i], button[aria-label*="Tải tệp" i]');

        if (addBtn) {
          const btnLabel = addBtn.getAttribute('aria-label') || addBtn.getAttribute('mattooltip') || addBtn.innerText;
          reportProgress(`Bấm nút kích hoạt picker: "${btnLabel}"...`);
          addBtn.click();
          await sleep(600);

          // Quét menu item vừa bật lên
          const menuEls = Array.from(document.querySelectorAll('[role="menuitem"], .mat-mdc-menu-item, button, div.item')).filter(el => {
            const text = (el.innerText || el.textContent || '').trim().toLowerCase();
            return text.includes('upload') || text.includes('tải') || text.includes('computer') || text.includes('thiết bị') || text.includes('drive');
          });
          reportProgress(`Phát hiện menu items: [${menuEls.map(m => (m.innerText || '').trim()).slice(0, 5).join(' | ')}]`);

          const uploadOption = menuEls.find(el => {
            const text = (el.innerText || el.textContent || '').trim().toLowerCase();
            return text.includes('upload from computer') || text.includes('tải lên từ thiết bị') || text.includes('tải tệp lên') || text.includes('tải ảnh') || text.includes('upload file');
          });

          if (uploadOption) {
            reportProgress(`Bấm chọn: "${(uploadOption.innerText || '').trim()}"...`);
            uploadOption.click();
            await sleep(600);
          }

          fileInputs = findAllGeminiFileInputs();
        }
      }

      if (fileInputs.length > 0) {
        reportProgress(`🎯 Tìm thấy ${fileInputs.length} file input! Đang nạp files vào input...`);
        for (const input of fileInputs) {
          try {
            // Nạp qua prototype descriptor để vượt qua Angular/Lit setter override
            const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'files');
            if (descriptor && descriptor.set) {
              descriptor.set.call(input, dt.files);
            } else {
              input.files = dt.files;
            }

            input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
            input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
            reportProgress('Đã kích hoạt sự kiện change & input trên file input.');
          } catch (e) {
            reportProgress(`Lỗi nạp file vào input: ${e.message}`);
          }
        }
      } else {
        reportProgress('⚠️ Vẫn không tìm thấy file input nào sau khi kích hoạt picker.');
        try {
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
          await sleep(300);
          editor.focus();
        } catch (_) {}
      }

      await waitForGeminiImageUpload();
    }

    // Ghi nhận phản hồi trước đó để phân biệt câu trả lời mới
    const initialResponses = queryAllAny(SELECTORS.modelResponse);
    const initialCount = initialResponses.length;
    const initialLastText = initialCount > 0 ? extractGeminiMarkdown(initialResponses[initialCount - 1]) : '';

    // 0.1. Nếu có hình ảnh đính kèm, tải ảnh lên trước khi điền văn bản
    if (Array.isArray(request.images) && request.images.length > 0) {
      await uploadImagesToGemini(editor, request.images);
    }

    // 1. Nhập prompt
    await enterTextIntoGemini(editor, request.prompt);

    // 2. Kích hoạt gửi câu hỏi với cơ chế kiểm tra đa tầng isSent
    await triggerSendGemini(editor, initialCount);

    // 2.1. Báo cho Background biết đã gửi câu hỏi thành công để nhả Input Mutex (chuyển giao cho provider khác nhập liệu)
    safeSendMessage({ action: 'INPUT_SUBMITTED', id: request.id, provider: 'gemini' });

    // 3. Theo dõi câu trả lời
    return await monitorGeminiResponse(request, initialCount, initialLastText, request.timeout || 180000);
  }

  // Chuỗi xử lý tuần tự (FIFO Chain) bảo đảm không bao giờ gọi đè hoặc spam tác vụ trên tab
  let executionChain = Promise.resolve();

  // Lắng nghe Message từ Background Service Worker
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'PING' || request.action === 'CHECK_ACCOUNT') {
      reportGeminiAccount();
      sendResponse({ action: 'PONG', provider: 'gemini', version: '1.0' });
      return false;
    }

    // Nhận lệnh hủy từ server/background
    if (request.action === 'CANCEL_TASK') {
      if (activeTaskId === request.id) {
        console.log(`🛑 [Gemini Bridge] Đã nhận lệnh CANCEL_TASK cho id: ${request.id}`);
        reportProgress(`Đã hủy tác vụ ${request.id}`);
        if (typeof activeReject === 'function') {
          activeReject(new Error(`Tác vụ ${request.id} đã bị hủy bởi hệ thống.`));
        }
        cleanupActiveTask();
      }
      return false;
    }

    if (request.action === 'ASK') {
      console.log('📥 [Gemini Bridge] Tiếp nhận yêu cầu ASK:', request.prompt?.slice(0, 50) + '... (ID: ' + request.id + ')');

      // Chèn vào hàng đợi tuần tự để xử lý từng lượt một, đợi lượt trước hoàn tất 100%
      executionChain = executionChain.then(async () => {
        isExecuting = true;
        activeTaskId = request.id;
        try {
          const answer = await handleGeminiAsk(request);
          safeSendMessage({
            action: 'TASK_RESULT',
            id: request.id,
            status: 'success',
            answer
          });
          try {
            sendResponse({ id: request.id, status: 'success', answer });
          } catch (_) {
            // Kênh sendResponse có thể đã đóng
          }
        } catch (err) {
          console.log('❌ [Gemini Bridge] Lỗi task ' + request.id + ':', err.message);
          safeSendMessage({
            action: 'TASK_RESULT',
            id: request.id,
            status: 'error',
            error: err.message
          });
          try {
            sendResponse({ id: request.id, status: 'error', error: err.message });
          } catch (_) {
            // Kênh sendResponse có thể đã đóng
          }
        } finally {
          cleanupActiveTask();
        }
      });

      return true; // Giữ async channel
    }
  });

  // Floating Badge cho tab Gemini (Tuân thủ TrustedHTML)
  function injectGeminiBadge() {
    if (document.getElementById('gemini-bridge-floating-btn')) return;

    const btn = document.createElement('div');
    btn.id = 'gemini-bridge-floating-btn';
    btn.title = 'Bấm để mở Bridge Console (Ctrl+Shift+B)';
    
    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'display:flex;align-items:center;gap:6px;';
    
    const dot = document.createElement('span');
    dot.style.cssText = 'display:inline-block;width:8px;height:8px;border-radius:50%;background:#38bdf8;box-shadow:0 0 6px #38bdf8;';
    
    const label = document.createElement('span');
    label.style.fontWeight = '600';
    label.textContent = 'Gemini Bridge';

    wrapper.appendChild(dot);
    wrapper.appendChild(label);
    btn.appendChild(wrapper);
    btn.style.cssText = `
      position: fixed;
      bottom: 20px;
      right: 20px;
      z-index: 999999;
      background: #0f172a;
      color: #38bdf8;
      border: 1px solid #1e293b;
      border-radius: 20px;
      padding: 6px 14px;
      font-size: 12px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      cursor: pointer;
      box-shadow: 0 4px 14px rgba(0,0,0,0.45);
      display: flex;
      align-items: center;
      transition: all 0.2s ease;
      user-select: none;
    `;

    btn.onmouseenter = () => {
      try {
        btn.style.transform = 'translateY(-2px)';
        btn.style.borderColor = '#38bdf8';
        btn.style.boxShadow = '0 6px 20px rgba(56,189,248,0.25)';
      } catch (_) {
        // DOM hover animation safe fallback
      }
    };
    btn.onmouseleave = () => {
      try {
        btn.style.transform = 'translateY(0)';
        btn.style.borderColor = '#1e293b';
        btn.style.boxShadow = '0 4px 14px rgba(0,0,0,0.45)';
      } catch (_) {
        // DOM hover animation safe fallback
      }
    };

    btn.onclick = () => {
      if (!isExtensionValid()) {
        label.textContent = 'Extension Reloaded - F5 Trang';
        dot.style.background = '#ef4444';
        dot.style.boxShadow = '0 0 6px #ef4444';
        btn.style.borderColor = '#ef4444';
        btn.style.color = '#ef4444';
        setTimeout(() => {
          window.location.reload();
        }, 250);
        return;
      }
      safeSendMessage({ action: 'OPEN_SIDEPANEL' });
    };

    // Watchdog kiểm tra trạng thái Extension định kỳ
    const contextWatchdog = setInterval(() => {
      if (!isExtensionValid()) {
        clearInterval(contextWatchdog);
        console.log('ℹ️ [Gemini Bridge] Chrome Extension đã được tải lại. Bấm nút nổi để F5 trang.');
        if (label && dot) {
          label.textContent = 'Bridge cần F5';
          dot.style.background = '#f59e0b';
          dot.style.boxShadow = '0 0 6px #f59e0b';
          btn.style.borderColor = '#f59e0b';
          btn.style.color = '#f59e0b';
          btn.title = 'Extension vừa được nạp lại trong Chrome. Bấm vào đây để tải lại trang.';
        }
      }
    }, 2500);

    document.body.appendChild(btn);
  }

  // Nhận diện tài khoản Google đang đăng nhập trên Gemini Web
  function detectGeminiAccount() {
    try {
      const selectors = [
        'a[aria-label*="@"]',
        'button[aria-label*="@"]',
        'a[aria-label*="Google Account"]',
        'a[aria-label*="Tài khoản Google"]',
        'a[href*="accounts.google.com"]',
        'img[alt*="@"]'
      ];
      for (const sel of selectors) {
        const els = document.querySelectorAll(sel);
        for (const el of els) {
          const text = el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('alt') || '';
          if (text) {
            const emailMatch = text.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
            if (emailMatch) {
              const email = emailMatch[1];
              let name = '';
              const nameMatch = text.match(/(?:Google Account|Tài khoản Google):\s*([^\n(]+)/i);
              if (nameMatch) {
                name = nameMatch[1].trim();
              } else {
                name = text.split('(')[0].replace(/(Google Account|Tài khoản Google):?/i, '').trim();
              }
              return { name: name || email.split('@')[0], email };
            }
          }
        }
      }
    } catch (e) {}
    return null;
  }

  function reportGeminiAccount() {
    const acc = detectGeminiAccount();
    if (acc) {
      console.log(`👤 [Gemini Bridge] Nhận diện tài khoản Gemini: ${acc.name} (${acc.email})`);
      safeSendMessage({
        action: 'UPDATE_ACCOUNT_INFO',
        provider: 'gemini',
        user: acc
      });
      return true;
    }
    return false;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      injectGeminiBadge();
      setTimeout(reportGeminiAccount, 1200);
      setTimeout(reportGeminiAccount, 4000);
    });
  } else {
    injectGeminiBadge();
    setTimeout(reportGeminiAccount, 1200);
    setTimeout(reportGeminiAccount, 4000);
  }
})();
