/**
 * ChatGPT & Google Gemini Local Web Bridge - Popup Script
 * @file extension/popup.js
 */

const BRIDGE_CONST = (typeof window !== 'undefined' && window.__BRIDGE_CONSTANTS__) || {};
const DEFAULT_PORT = BRIDGE_CONST.SERVER?.DEFAULT_PORT || 9603;

function updateUI() {
  const serverBadge = document.getElementById('server-badge');
  const serverLabel = document.getElementById('server-label');
  const chatgptBadge = document.getElementById('chatgpt-badge');
  const geminiBadge = document.getElementById('gemini-badge');

  chrome.runtime.sendMessage({ action: 'GET_STATUS' }, (res) => {
    const port = res?.serverPort || DEFAULT_PORT;
    if (serverLabel) {
      serverLabel.textContent = `Local Server (:${port})`;
    }

    if (chrome.runtime.lastError || !res) {
      if (serverBadge) {
        serverBadge.className = 'badge badge-err';
        serverBadge.innerHTML = `<span class="dot"></span> Chưa sẵn sàng (:${port})`;
      }
      return;
    }

    // 1. Server status
    if (serverBadge) {
      if (res.serverConnected) {
        serverBadge.className = 'badge badge-ok';
        serverBadge.innerHTML = '<span class="dot"></span> Đã kết nối';
      } else {
        serverBadge.className = 'badge badge-err';
        serverBadge.innerHTML = `<span class="dot"></span> Chưa bật (:${port})`;
      }
    }

    // 2. ChatGPT tab status
    if (chatgptBadge) {
      if (res.hasChatGPTTab) {
        chatgptBadge.className = 'badge badge-ok';
        chatgptBadge.innerHTML = `<span class="dot"></span> Sẵn sàng (${res.chatGptTabCount || 1})`;
      } else {
        chatgptBadge.className = 'badge badge-err';
        chatgptBadge.innerHTML = '<span class="dot"></span> Chưa mở';
      }
    }

    // 3. Gemini tab status
    if (geminiBadge) {
      if (res.hasGeminiTab) {
        geminiBadge.className = 'badge badge-ok';
        geminiBadge.innerHTML = `<span class="dot"></span> Sẵn sàng (${res.geminiTabCount || 1})`;
      } else {
        geminiBadge.className = 'badge badge-err';
        geminiBadge.innerHTML = '<span class="dot"></span> Chưa mở';
      }
    }
  });
}

document.addEventListener('DOMContentLoaded', () => {
  updateUI();

  const reconnectBtn = document.getElementById('btn-reconnect');
  if (reconnectBtn) {
    reconnectBtn.addEventListener('click', () => {
      chrome.runtime.sendMessage({ action: 'CONNECT_NOW' }, () => {
        setTimeout(updateUI, 400);
      });
    });
  }

  const sidepanelBtn = document.getElementById('btn-open-sidepanel');
  if (sidepanelBtn) {
    sidepanelBtn.addEventListener('click', () => {
      chrome.runtime.sendMessage({ action: 'OPEN_SIDEPANEL' });
      window.close();
    });
  }

  const clearQueueBtn = document.getElementById('btn-clear-queue');
  if (clearQueueBtn) {
    clearQueueBtn.addEventListener('click', async () => {
      try {
        clearQueueBtn.disabled = true;
        clearQueueBtn.innerText = 'Đang dọn...';
        chrome.runtime.sendMessage({ action: 'GET_STATUS' }, async (statusRes) => {
          const sUrl = statusRes?.serverUrl || `http://localhost:${DEFAULT_PORT}`;
          const res = await fetch(`${sUrl}/queue/clear`, { method: 'POST' });
          const data = await res.json();
          alert(data.message || 'Đã dọn sạch hàng đợi!');
          updateUI();
        });
      } catch (err) {
        alert('Lỗi: ' + err.message);
      } finally {
        clearQueueBtn.disabled = false;
        clearQueueBtn.innerText = '🗑️ Clear Queue';
      }
    });
  }

  // Cấu hình Server (Local / Online / VPS)
  const toggleSettingsBtn = document.getElementById('btn-toggle-settings');
  const settingsPanel = document.getElementById('settings-panel');
  const inputServerUrl = document.getElementById('input-server-url');
  const inputWorkerToken = document.getElementById('input-worker-token');
  const saveServerBtn = document.getElementById('btn-save-server');

  // Nạp cấu hình hiện tại vào form
  chrome.storage.local.get(['custom_server_url', 'custom_worker_token']).then((data) => {
    if (inputServerUrl) {
      inputServerUrl.value = data.custom_server_url || `http://localhost:${DEFAULT_PORT}`;
    }
    if (inputWorkerToken && data.custom_worker_token) {
      inputWorkerToken.value = data.custom_worker_token;
    }
  }).catch(() => {});

  if (toggleSettingsBtn && settingsPanel) {
    toggleSettingsBtn.addEventListener('click', () => {
      const isHidden = settingsPanel.style.display === 'none' || !settingsPanel.style.display;
      settingsPanel.style.display = isHidden ? 'flex' : 'none';
      toggleSettingsBtn.textContent = isHidden ? 'Đóng' : 'Sửa';
    });
  }

  if (saveServerBtn && inputServerUrl) {
    saveServerBtn.addEventListener('click', () => {
      const url = inputServerUrl.value.trim();
      const token = inputWorkerToken ? inputWorkerToken.value.trim() : '';
      if (!url) {
        alert('Vui lòng nhập Server URL hoặc Port!');
        return;
      }
      saveServerBtn.disabled = true;
      saveServerBtn.textContent = 'Đang lưu & kết nối...';
      chrome.runtime.sendMessage({
        action: 'SET_SERVER_CONFIG',
        serverUrl: url,
        workerToken: token
      }, (res) => {
        saveServerBtn.disabled = false;
        saveServerBtn.textContent = '💾 Lưu & Kết Nối';
        if (res && res.success) {
          if (settingsPanel) settingsPanel.style.display = 'none';
          if (toggleSettingsBtn) toggleSettingsBtn.textContent = 'Sửa';
          updateUI();
        } else {
          alert('Lỗi: ' + (res?.error || 'Không thể lưu cấu hình'));
        }
      });
    });
  }

  // Tự động kiểm tra trạng thái mỗi giây khi popup đang mở
  setInterval(updateUI, 1200);
});
