/**
 * File: extension/sidepanel.js
 * Logic cho Side Panel Console của ChatGPT Bridge
 */

const logList = document.getElementById('log-list');
const terminalContainer = document.getElementById('terminal-container');
const badgeServer = document.getElementById('badge-server');
const badgeTabChatGPT = document.getElementById('badge-tab-chatgpt');
const badgeTabGemini = document.getElementById('badge-tab-gemini');
const serverDetail = document.getElementById('server-detail');
const tabDetailChatGPT = document.getElementById('tab-detail-chatgpt');
const tabDetailGemini = document.getElementById('tab-detail-gemini');
const btnClearLogs = document.getElementById('btn-clear-logs');
const btnReconnect = document.getElementById('btn-reconnect');
const btnOpenChatGPT = document.getElementById('btn-open-chatgpt');
const btnOpenGemini = document.getElementById('btn-open-gemini');
const btnTestPrompt = document.getElementById('btn-test-prompt');
const chkAutoscroll = document.getElementById('chk-autoscroll');
const filterBtns = document.querySelectorAll('.filter-btn');
const statTotal = document.getElementById('stat-total');
const statSuccess = document.getElementById('stat-success');
const statFailed = document.getElementById('stat-failed');
const testProviderSelect = document.getElementById('test-provider-select');

let currentFilter = 'all';
let allLogs = [];
let stats = { total: 0, success: 0, failed: 0 };

// 1. Tải log đã lưu từ chrome.storage.local
async function loadStoredLogs() {
  try {
    const data = await chrome.storage.local.get(['bridge_logs', 'bridge_stats']);
    if (data.bridge_logs && Array.isArray(data.bridge_logs)) {
      allLogs = data.bridge_logs;
      renderLogs();
    }
    if (data.bridge_stats) {
      stats = data.bridge_stats;
      updateStatsUI();
    }
  } catch (e) {
    console.log('⚠️ [SidePanel] Lỗi đọc storage:', e.message);
  }
}

// 2. Render danh sách log
function renderLogs() {
  logList.innerHTML = '';
  const filtered = currentFilter === 'all' 
    ? allLogs 
    : allLogs.filter(item => item.level === currentFilter);

  if (filtered.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'log-entry log-info';
    empty.style.color = '#64748b';
    empty.textContent = 'Chưa có nhật ký nào cho bộ lọc này.';
    logList.appendChild(empty);
    return;
  }

  filtered.forEach(entry => appendLogToDOM(entry, false));

  if (chkAutoscroll.checked) {
    terminalContainer.scrollTop = terminalContainer.scrollHeight;
  }
}

// 3. Thêm 1 dòng log mới vào DOM
function appendLogToDOM(entry, autoScroll = true) {
  const el = document.createElement('div');
  el.className = `log-entry log-${entry.level || 'info'}`;
  el.dataset.level = entry.level || 'info';

  const timeSpan = document.createElement('span');
  timeSpan.className = 'log-time';
  timeSpan.textContent = `[${entry.time || '--:--:--'}]`;

  const tagSpan = document.createElement('span');
  tagSpan.className = `log-tag tag-${entry.level || 'info'}`;
  tagSpan.textContent = (entry.level || 'info').toUpperCase();

  const msgSpan = document.createElement('span');
  msgSpan.className = 'log-msg';
  msgSpan.textContent = entry.message || '';

  el.appendChild(timeSpan);
  el.appendChild(tagSpan);
  el.appendChild(msgSpan);

  logList.appendChild(el);

  if (autoScroll && chkAutoscroll.checked) {
    terminalContainer.scrollTop = terminalContainer.scrollHeight;
  }
}

// 4. Cập nhật giao diện trạng thái
function updateStatusUI(data) {
  if (!data) return;

  // Trạng thái Server
  if (data.serverConnected) {
    badgeServer.className = 'badge badge-ok';
    badgeServer.innerHTML = '<span class="dot"></span> <span class="badge-text">Đã kết nối</span>';
    serverDetail.textContent = 'ws://localhost:9603 (Open)';
  } else {
    badgeServer.className = 'badge badge-err';
    badgeServer.innerHTML = '<span class="dot"></span> <span class="badge-text">Mất kết nối</span>';
    serverDetail.textContent = 'Chưa mở node server.js';
  }

  // Trạng thái ChatGPT Tab
  if (badgeTabChatGPT && tabDetailChatGPT) {
    if (data.hasChatGPTTab) {
      badgeTabChatGPT.className = 'badge badge-ok';
      badgeTabChatGPT.innerHTML = `<span class="dot"></span> <span class="badge-text">${data.chatGptTabCount || 1} tab mở</span>`;
      tabDetailChatGPT.textContent = 'ChatGPT Web Sẵn Sàng';
    } else {
      badgeTabChatGPT.className = 'badge badge-err';
      badgeTabChatGPT.innerHTML = '<span class="dot"></span> <span class="badge-text">Chưa mở</span>';
      tabDetailChatGPT.textContent = 'Bấm "ChatGPT" bên dưới';
    }
  }

  // Trạng thái Gemini Tab
  if (badgeTabGemini && tabDetailGemini) {
    if (data.hasGeminiTab) {
      badgeTabGemini.className = 'badge badge-ok';
      badgeTabGemini.innerHTML = `<span class="dot"></span> <span class="badge-text">${data.geminiTabCount || 1} tab mở</span>`;
      tabDetailGemini.textContent = 'Gemini Web Sẵn Sàng';
    } else {
      badgeTabGemini.className = 'badge badge-err';
      badgeTabGemini.innerHTML = '<span class="dot"></span> <span class="badge-text">Chưa mở</span>';
      tabDetailGemini.textContent = 'Bấm "Gemini" bên dưới';
    }
  }
}

function updateStatsUI() {
  statTotal.textContent = stats.total || 0;
  statSuccess.textContent = stats.success || 0;
  statFailed.textContent = stats.failed || 0;
}

// 5. Thăm dò trạng thái từ Background
function pollStatus() {
  chrome.runtime.sendMessage({ action: 'GET_STATUS' }, (res) => {
    if (!chrome.runtime.lastError && res) {
      updateStatusUI(res);
    }
  });
}

// 6. Lắng nghe tin nhắn broadcast từ Background
chrome.runtime.onMessage.addListener((req) => {
  if (req.action === 'NEW_LOG_ENTRY' && req.entry) {
    allLogs.push(req.entry);
    if (allLogs.length > 200) allLogs.shift();

    if (currentFilter === 'all' || req.entry.level === currentFilter) {
      appendLogToDOM(req.entry, true);
    }

    if (req.entry.level === 'prompt') stats.total = (stats.total || 0) + 1;
    if (req.entry.level === 'success') stats.success = (stats.success || 0) + 1;
    if (req.entry.level === 'error') stats.failed = (stats.failed || 0) + 1;
    updateStatsUI();
  }

  if (req.action === 'STATUS_UPDATE' && req.status) {
    updateStatusUI(req.status);
  }
});

// 7. Bộ lọc danh mục log
filterBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    filterBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentFilter = btn.dataset.filter;
    renderLogs();
  });
});

// 8. Các nút hành động
btnClearLogs.addEventListener('click', () => {
  allLogs = [];
  stats = { total: 0, success: 0, failed: 0 };
  chrome.storage.local.set({ bridge_logs: [], bridge_stats: stats });
  renderLogs();
  updateStatsUI();
});

btnReconnect.addEventListener('click', () => {
  badgeServer.className = 'badge badge-loading';
  badgeServer.innerHTML = '<span class="dot"></span> <span class="badge-text">Đang thử...</span>';
  chrome.runtime.sendMessage({ action: 'CONNECT_NOW' }, () => {
    setTimeout(pollStatus, 800);
  });
});

btnOpenChatGPT.addEventListener('click', () => {
  chrome.tabs.create({ url: 'https://chatgpt.com/' });
});

if (btnOpenGemini) {
  btnOpenGemini.addEventListener('click', () => {
    chrome.tabs.create({ url: 'https://gemini.google.com/app' });
  });
}

btnTestPrompt.addEventListener('click', () => {
  const provider = testProviderSelect ? testProviderSelect.value : 'chatgpt';
  runCustomTest(`Xin chào ${provider.toUpperCase()}, trả lời ngắn gọn 1 dòng: Side Panel Bridge đã hoạt động tốt!`, true, provider);
});

// Xử lý Hộp Test Tương Tác & Preset Chips
const testCustomPrompt = document.getElementById('test-custom-prompt');
const btnRunCustomTest = document.getElementById('btn-run-custom-test');
const chips = document.querySelectorAll('.chip');
let nextTestNewChat = true;

chips.forEach(chip => {
  chip.addEventListener('click', () => {
    if (testCustomPrompt) {
      testCustomPrompt.value = chip.dataset.prompt;
    }
    nextTestNewChat = chip.dataset.newchat === 'true';
    const provider = testProviderSelect ? testProviderSelect.value : 'chatgpt';
    runCustomTest(chip.dataset.prompt, nextTestNewChat, provider);
  });
});

async function runCustomTest(promptText, newChat = true, provider = null) {
  if (!promptText || !promptText.trim()) return;

  const targetProvider = provider || (testProviderSelect ? testProviderSelect.value : 'chatgpt');

  if (btnRunCustomTest) {
    btnRunCustomTest.disabled = true;
    btnRunCustomTest.textContent = 'Đang gửi...';
  }
  if (btnTestPrompt) {
    btnTestPrompt.disabled = true;
  }

  try {
    await fetch('http://localhost:9603/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: promptText.trim(),
        provider: targetProvider,
        newChat
      })
    });
  } catch (err) {
    console.error('[SidePanel Custom Test] Lỗi:', err.message);
  } finally {
    if (btnRunCustomTest) {
      btnRunCustomTest.disabled = false;
      btnRunCustomTest.textContent = 'Gửi';
    }
    if (btnTestPrompt) {
      btnTestPrompt.disabled = false;
    }
  }
}

if (btnRunCustomTest) {
  btnRunCustomTest.addEventListener('click', () => {
    runCustomTest(testCustomPrompt ? testCustomPrompt.value : '', nextTestNewChat);
  });
}

if (testCustomPrompt) {
  testCustomPrompt.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      runCustomTest(testCustomPrompt.value, nextTestNewChat);
    }
  });
}

// Khởi chạy khi mở panel
loadStoredLogs();
pollStatus();
setInterval(pollStatus, 3000);
