/**
 * ChatGPT & Google Gemini Local Web Bridge - Shared Utilities
 * @file extension/shared/bridge-utils.js
 * 
 * Module tiện ích dùng chung giữa các Content Scripts (ChatGPT & Google Gemini).
 * Đóng gói an toàn trong window.__BRIDGE_UTILS__ để tái sử dụng tối đa mã nguồn,
 * tuân thủ chuẩn DRY, Trusted Types và không dùng console.warn.
 */

(() => {
  // Phòng vệ nạp đè
  if (typeof window !== 'undefined' && window.__BRIDGE_UTILS__) {
    return;
  }

  /**
   * Kiểm tra Extension Context còn hợp lệ hay đã bị reload/invalidated
   * @returns {boolean}
   */
  function isExtensionValid() {
    try {
      return Boolean(typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id);
    } catch (_) {
      return false;
    }
  }

  /**
   * Gửi message an toàn tới Chrome Runtime, triệt tiêu hoàn toàn Uncaught Error
   * @param {Object} message - Nội dung message
   * @returns {Promise<any>}
   */
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
    } catch (_) {
      return Promise.resolve(null);
    }
  }

  /**
   * Delay thực thi theo milliseconds
   * @param {number} ms 
   * @returns {Promise<void>}
   */
  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Thử lần lượt danh sách selectors và trả về element đầu tiên tìm thấy
   * @param {string[]} selectors 
   * @param {Element|Document} root 
   * @returns {Element|null}
   */
  function queryAny(selectors, root = document) {
    if (!selectors || !Array.isArray(selectors)) return null;
    for (const sel of selectors) {
      try {
        const el = root.querySelector(sel);
        if (el) return el;
      } catch (_) {}
    }
    return null;
  }

  /**
   * Thu thập toàn bộ elements khớp với danh sách selectors
   * @param {string[]} selectors 
   * @param {Element|Document} root 
   * @returns {Element[]}
   */
  function queryAllAny(selectors, root = document) {
    if (!selectors || !Array.isArray(selectors)) return [];
    for (const sel of selectors) {
      try {
        const list = root.querySelectorAll(sel);
        if (list && list.length > 0) return Array.from(list);
      } catch (_) {}
    }
    return [];
  }

  /**
   * Kiểm tra element có hiển thị trên màn hình không (visible, layout box hợp lệ)
   * @param {Element} el 
   * @returns {boolean}
   */
  function isElementVisible(el) {
    if (!el) return false;
    try {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        style.visibility !== 'hidden' &&
        style.display !== 'none' &&
        style.opacity !== '0'
      );
    } catch (_) {
      return false;
    }
  }

  /**
   * Chuyển đổi chuỗi Data URL (Base64) sang đối tượng File
   * @param {string} dataUrl 
   * @param {string} defaultName 
   * @returns {File|null}
   */
  function dataUrlToFile(dataUrl, defaultName = 'upload.png') {
    if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) {
      return null;
    }
    try {
      const parts = dataUrl.split(',');
      const mimeMatch = parts[0].match(/:(.*?);/);
      const mime = mimeMatch ? mimeMatch[1] : 'image/png';
      const bstr = atob(parts[1]);
      let n = bstr.length;
      const u8arr = new Uint8Array(n);
      while (n--) {
        u8arr[n] = bstr.charCodeAt(n);
      }
      return new File([u8arr], defaultName, { type: mime });
    } catch (e) {
      console.log('ℹ️ [Bridge Shared] Lỗi parse dataUrlToFile:', e.message);
      return null;
    }
  }

  /**
   * Ghi hình ảnh (File hoặc Data URL) trực tiếp vào OS System Clipboard dưới dạng PNG Blob
   * Vượt rào cản Chromium synthetic clipboard rejection (event.isTrusted: false)
   * @param {File|string} fileOrDataUrl 
   * @returns {Promise<boolean>}
   */
  async function writeImageToClipboard(fileOrDataUrl) {
    try {
      const file = typeof fileOrDataUrl === 'string' ? dataUrlToFile(fileOrDataUrl) : fileOrDataUrl;
      if (!file) return false;

      let blob = file;
      if (file.type !== 'image/png') {
        const img = new Image();
        img.src = URL.createObjectURL(file);
        await new Promise((res, rej) => {
          img.onload = res;
          img.onerror = rej;
        });
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth || img.width;
        canvas.height = img.naturalHeight || img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
        URL.revokeObjectURL(img.src);
      }

      await navigator.clipboard.write([
        new ClipboardItem({ 'image/png': blob })
      ]);
      return true;
    } catch (err) {
      console.log('ℹ️ [Bridge Shared] Clipboard write notice:', err.message);
      return false;
    }
  }

  /**
   * Gán mảng File vào HTMLInputElement file, bypass state của Lit/Angular và React
   * @param {HTMLInputElement} inputEl 
   * @param {File[]} files 
   * @returns {boolean}
   */
  function setInputFiles(inputEl, files) {
    if (!inputEl || !files || files.length === 0) return false;
    try {
      const dt = new DataTransfer();
      for (const f of files) {
        if (f) dt.items.add(f);
      }
      const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'files');
      if (descriptor && descriptor.set) {
        descriptor.set.call(inputEl, dt.files);
      } else {
        inputEl.files = dt.files;
      }
      inputEl.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
      inputEl.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
      return true;
    } catch (err) {
      console.log('ℹ️ [Bridge Shared] setInputFiles notice:', err.message);
      return false;
    }
  }

  /**
   * Tạo Floating Status Badge ở góc phải dưới màn hình (tuân thủ 100% Google Trusted Types)
   * @param {Object} options
   * @param {string} options.id - DOM element ID (ví dụ: 'chatgpt-bridge-floating-btn')
   * @param {string} options.labelText - Tên hiển thị (ví dụ: 'Bridge Logs', 'Gemini Bridge')
   * @param {string} options.dotColor - Mã màu chấm trạng thái (ví dụ: '#10b981', '#38bdf8')
   * @param {string} options.badgeTitle - Tooltip khi hover
   * @param {string} options.logPrefix - Tiền tố console log (ví dụ: '[ChatGPT Bridge]')
   */
  function injectFloatingBadge(options = {}) {
    const {
      id = 'ai-bridge-floating-btn',
      labelText = 'Bridge Logs',
      dotColor = '#10b981',
      badgeTitle = 'Bấm để mở Bridge Console (Ctrl+Shift+B)',
      logPrefix = '[Bridge]'
    } = options;

    if (document.getElementById(id)) return;

    const btn = document.createElement('div');
    btn.id = id;
    btn.title = badgeTitle;

    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'display:flex;align-items:center;gap:6px;';

    const dot = document.createElement('span');
    dot.style.cssText = `display:inline-block;width:8px;height:8px;border-radius:50%;background:${dotColor};box-shadow:0 0 6px ${dotColor};`;

    const label = document.createElement('span');
    label.style.fontWeight = '600';
    label.textContent = labelText;

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
      border: 1px solid #334155;
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
      } catch (_) {}
    };

    btn.onmouseleave = () => {
      try {
        btn.style.transform = 'translateY(0)';
        btn.style.borderColor = '#334155';
        btn.style.boxShadow = '0 4px 14px rgba(0,0,0,0.45)';
      } catch (_) {}
    };

    btn.onclick = () => {
      if (!isExtensionValid()) {
        label.textContent = 'Extension Reloaded - F5 Trang';
        dot.style.background = '#f59e0b';
        dot.style.boxShadow = '0 0 6px #f59e0b';
        btn.style.borderColor = '#f59e0b';
        btn.style.color = '#f59e0b';
        setTimeout(() => {
          window.location.reload();
        }, 250);
        return;
      }
      safeSendMessage({ action: 'OPEN_SIDEPANEL' });
    };

    // Watchdog kiểm tra trạng thái Extension định kỳ để cập nhật UI tự phục hồi
    const contextWatchdog = setInterval(() => {
      if (!isExtensionValid()) {
        clearInterval(contextWatchdog);
        console.log(`ℹ️ ${logPrefix} Chrome Extension đã được tải lại. Bấm nút nổi để F5 trang.`);
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

  // Đóng gói vào namespace toàn cục
  window.__BRIDGE_UTILS__ = {
    isExtensionValid,
    safeSendMessage,
    sleep,
    queryAny,
    queryAllAny,
    isElementVisible,
    dataUrlToFile,
    writeImageToClipboard,
    setInputFiles,
    injectFloatingBadge
  };
})();
