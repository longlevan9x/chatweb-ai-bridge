/**
 * ChatGPT & Google Gemini Local Web Bridge - Popup Script
 * @file extension/popup.js
 */

function updateUI() {
  const serverBadge = document.getElementById('server-badge');
  const chatgptBadge = document.getElementById('chatgpt-badge');
  const geminiBadge = document.getElementById('gemini-badge');

  chrome.runtime.sendMessage({ action: 'GET_STATUS' }, (res) => {
    if (chrome.runtime.lastError || !res) {
      if (serverBadge) {
        serverBadge.className = 'badge badge-err';
        serverBadge.innerHTML = '<span class="dot"></span> Chưa sẵn sàng';
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
        serverBadge.innerHTML = '<span class="dot"></span> Chưa bật (:9603)';
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
        const res = await fetch('http://localhost:9603/queue/clear', { method: 'POST' });
        const data = await res.json();
        alert(data.message || 'Đã dọn sạch hàng đợi!');
        updateUI();
      } catch (err) {
        alert('Lỗi: ' + err.message);
      } finally {
        clearQueueBtn.disabled = false;
        clearQueueBtn.innerText = '🗑️ Clear Queue';
      }
    });
  }

  // Tự động kiểm tra trạng thái mỗi giây khi popup đang mở
  setInterval(updateUI, 1200);
});
