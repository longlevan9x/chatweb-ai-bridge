/**
 * ChatGPT & Google Gemini Local Web Bridge - Background Service Worker v2.1 (Manifest V3)
 * @file extension/background.js
 * 
 * Features:
 * - Multi-Provider Orchestrator: Dynamic routing for ChatGPT Web and Google Gemini Web
 * - Exponential Backoff & Jitter: Resilient reconnecting without hammering local server
 * - Result Buffer: Prevents result loss if socket temporarily drops during execution
 * - Multi-Tab Health Guard: Auto-discovery, auto-injection, clean newChat navigation
 * - Real-time Side Panel & Popup telemetry sync
 */

// Cấu hình các nền tảng AI được hỗ trợ (Multi-Provider Support)
const PROVIDERS = {
  chatgpt: {
    name: 'ChatGPT',
    urlPatterns: ['*://chatgpt.com/*', '*://*.chatgpt.com/*', '*://chat.openai.com/*'],
    homeUrl: 'https://chatgpt.com/',
    scriptFile: 'content.js',
    isThreadUrl: (url) => url.includes('/c/') || url.includes('/g/')
  },
  gemini: {
    name: 'Gemini',
    urlPatterns: ['*://gemini.google.com/*'],
    homeUrl: 'https://gemini.google.com/app',
    scriptFile: 'content-gemini.js',
    isThreadUrl: (url) => url.includes('/app/') && url.split('/app/')[1]?.length > 2
  }
};

try {
  importScripts('shared/bridge-constants.js');
} catch (_) {}

const BRIDGE_CONST = (typeof self !== 'undefined' && self.__BRIDGE_CONSTANTS__) || {};

let socket = null;
let currentPort = BRIDGE_CONST.SERVER?.DEFAULT_PORT || 9603;
let currentServerUrl = `http://localhost:${currentPort}`;
let currentWsUrl = `ws://localhost:${currentPort}`;
let currentWorkerToken = '';

function parseServerUrl(input) {
  if (!input) return null;
  let str = String(input).trim();
  // Nếu chỉ nhập số port (ví dụ: 9603) -> mặc định localhost
  if (/^\d+$/.test(str)) {
    const port = Number(str);
    return {
      serverUrl: `http://localhost:${port}`,
      wsUrl: `ws://localhost:${port}`,
      port
    };
  }

  // Thêm protocol nếu người dùng chỉ gõ domain:port hoặc IP:port
  if (!str.startsWith('http://') && !str.startsWith('https://') && !str.startsWith('ws://') && !str.startsWith('wss://')) {
    str = 'http://' + str;
  }

  try {
    const url = new URL(str);
    const isSecure = url.protocol === 'https:' || url.protocol === 'wss:';
    const httpProto = isSecure ? 'https:' : 'http:';
    const wsProto = isSecure ? 'wss:' : 'ws:';
    const host = url.host;

    return {
      serverUrl: `${httpProto}//${host}`,
      wsUrl: `${wsProto}//${host}`,
      port: url.port ? Number(url.port) : (isSecure ? 443 : 80)
    };
  } catch (_) {
    return null;
  }
}

function getServerPort() {
  return currentPort;
}

function getServerHttp() {
  return `${currentServerUrl}/status`;
}

function getServerWs() {
  return currentWsUrl;
}

// Nạp cấu hình Server (URL, Port, Worker Token) từ chrome.storage.local
chrome.storage.local.get(['custom_server_url', 'custom_server_port', 'custom_worker_token']).then((data) => {
  if (data.custom_server_url) {
    const parsed = parseServerUrl(data.custom_server_url);
    if (parsed) {
      currentServerUrl = parsed.serverUrl;
      currentWsUrl = parsed.wsUrl;
      currentPort = parsed.port;
    }
  } else if (data.custom_server_port && Number(data.custom_server_port)) {
    currentPort = Number(data.custom_server_port);
    currentServerUrl = `http://localhost:${currentPort}`;
    currentWsUrl = `ws://localhost:${currentPort}`;
  }
  if (data.custom_worker_token) {
    currentWorkerToken = String(data.custom_worker_token).trim();
  }
}).catch(() => {});

let isCheckingOrConnecting = false;
let retryAttempt = 0;

// Bộ nhớ đệm lưu kết quả chưa kịp gửi nếu socket rớt đúng lúc hoàn thành
const pendingResultsBuffer = [];

// Hệ thống lưu trữ và đồng bộ Log cho Side Panel Console
const MAX_LOGS = 200;
let logHistory = [];

chrome.storage.local.get(['bridge_logs']).then((data) => {
  if (data.bridge_logs && Array.isArray(data.bridge_logs)) {
    logHistory = data.bridge_logs;
  }
}).catch(() => {});

async function appendLog(level, message, meta = null) {
  const entry = {
    id: 'log_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
    time: new Date().toLocaleTimeString('vi-VN', { hour12: false }),
    timestamp: Date.now(),
    level, // 'info', 'step', 'prompt', 'stream', 'success', 'error'
    message,
    meta
  };
  logHistory.push(entry);
  if (logHistory.length > MAX_LOGS) {
    logHistory.shift();
  }
  try {
    await chrome.storage.local.set({ bridge_logs: logHistory });
  } catch (e) {}
  chrome.runtime.sendMessage({ action: 'NEW_LOG_ENTRY', entry }).catch(() => {});
}

// Cấu hình Side Panel mở tự động khi click icon trên toolbar
if (chrome.sidePanel && typeof chrome.sidePanel.setPanelBehavior === 'function') {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
}

chrome.action?.onClicked?.addListener(async (tab) => {
  if (chrome.sidePanel && chrome.sidePanel.open) {
    try {
      await chrome.sidePanel.open({ tabId: tab.id });
    } catch (e) {
      try {
        await chrome.sidePanel.open({ windowId: tab.windowId });
      } catch (e2) {}
    }
  }
});

// Hàm gửi dữ liệu an toàn với bộ đệm (Outbox Buffer)
function safeSend(data) {
  const payload = typeof data === 'string' ? data : JSON.stringify(data);
  if (socket && socket.readyState === WebSocket.OPEN) {
    try {
      socket.send(payload);
      return true;
    } catch (e) {
      console.log('⚠️ [Bridge BG] Lỗi gửi socket:', e.message);
    }
  }

  // Nếu là TASK_RESULT quan trọng mà socket chưa mở, lưu vào bộ đệm gửi bù sau
  if (data && data.action === 'TASK_RESULT') {
    console.log('[Bridge BG] Đã lưu TASK_RESULT vào bộ đệm gửi bù khi socket kết nối lại.');
    pendingResultsBuffer.push(payload);
    if (pendingResultsBuffer.length > 20) pendingResultsBuffer.shift();
  }
  return false;
}

function flushPendingBuffer() {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  while (pendingResultsBuffer.length > 0) {
    const item = pendingResultsBuffer.shift();
    try {
      socket.send(item);
      console.log('📬 [Bridge BG] Đã gửi bù thành công một kết quả từ bộ đệm.');
    } catch (e) {
      pendingResultsBuffer.unshift(item);
      break;
    }
  }
}

// 1. Kiểm tra êm dịu xem server đã chạy chưa trước khi mở WebSocket
async function isServerReady() {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 1200);
    const res = await fetch(getServerHttp(), {
      method: 'GET',
      cache: 'no-store',
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    return res.ok;
  } catch (e) {
    return false;
  }
}

async function checkAndConnect() {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
    return;
  }

  if (isCheckingOrConnecting) return;
  isCheckingOrConnecting = true;

  try {
    const ready = await isServerReady();
    if (!ready) {
      isCheckingOrConnecting = false;
      scheduleReconnect();
      return;
    }

    initWebSocket();
  } catch (e) {
    scheduleReconnect();
  } finally {
    isCheckingOrConnecting = false;
  }
}

function scheduleReconnect() {
  retryAttempt++;
  const backoff = Math.min(1000 * Math.pow(1.35, retryAttempt), 10000);
  const jitter = Math.random() * 500;
  const delay = Math.round(backoff + jitter);
  setTimeout(checkAndConnect, delay);
}

/**
 * Async Mutex điều phối độc quyền khâu Active Tab & Nhập Prompt (Focus/Input Mutex)
 * Đảm bảo 2 tab ChatGPT & Gemini không bao giờ tranh chấp active/focus bàn phím cùng 1 thời điểm.
 */
class AsyncInputMutex {
  constructor() {
    this._queue = [];
    this._locked = false;
    this._owner = null;
    this._activeReleasers = new Map(); // taskId -> releaseFn
  }

  acquire(ownerName = 'unknown', taskId = null) {
    if (!this._locked) {
      this._locked = true;
      this._owner = ownerName;
      return Promise.resolve(this._createReleaser(ownerName, taskId));
    }
    return new Promise((resolve) => {
      this._queue.push({
        ownerName,
        taskId,
        resolve: (releaseFn) => resolve(releaseFn)
      });
    });
  }

  _createReleaser(ownerName, taskId) {
    let released = false;
    const releaseFn = () => {
      if (released) return;
      released = true;
      if (taskId) {
        this._activeReleasers.delete(taskId);
      }
      if (this._queue.length > 0) {
        const next = this._queue.shift();
        this._owner = next.ownerName;
        next.resolve(this._createReleaser(next.ownerName, next.taskId));
      } else {
        this._locked = false;
        this._owner = null;
      }
    };

    if (taskId) {
      this._activeReleasers.set(taskId, releaseFn);
    }
    return releaseFn;
  }

  handleSubmitted(taskId, provider = '') {
    const releaseFn = this._activeReleasers.get(taskId);
    if (releaseFn) {
      console.log(`🔓 [Bridge BG] [${provider.toUpperCase() || 'AI'}] Nhận tín hiệu INPUT_SUBMITTED cho task ${taskId} -> Nhả sớm Input Mutex!`);
      releaseFn();
    }
  }
}
const inputMutex = new AsyncInputMutex();

// Bộ điều phối hàng đợi tác vụ độc lập cho từng Provider (FIFO Queue per Provider)
const providerQueues = {
  chatgpt: [],
  gemini: []
};
const providerBusy = {
  chatgpt: false,
  gemini: false
};

function enqueueProviderTask(providerKey, taskFn) {
  if (!providerQueues[providerKey]) {
    providerQueues[providerKey] = [];
  }
  providerQueues[providerKey].push(taskFn);
  processProviderQueue(providerKey);
}

async function processProviderQueue(providerKey) {
  if (providerBusy[providerKey] || !providerQueues[providerKey] || providerQueues[providerKey].length === 0) {
    return;
  }
  providerBusy[providerKey] = true;
  const taskFn = providerQueues[providerKey].shift();
  try {
    await taskFn();
  } catch (e) {
    console.log(`⚠️ [Bridge BG] Lỗi xử lý task tuần tự trên ${providerKey}:`, e.message);
  } finally {
    providerBusy[providerKey] = false;
    processProviderQueue(providerKey);
  }
}

let cachedWorkerIdentity = null;
const workerAccounts = {
  browser: 'Chrome',
  os: 'win',
  chromeProfileEmail: null,
  chatgpt: null,
  gemini: null
};

// Đọc thông tin accounts đã lưu trước đó
chrome.storage.local.get(['bridge_worker_accounts']).then((data) => {
  if (data.bridge_worker_accounts) {
    Object.assign(workerAccounts, data.bridge_worker_accounts);
  }
}).catch(() => {});

async function detectBrowserInfo() {
  let browser = 'Chrome';
  try {
    if (navigator.brave && typeof navigator.brave.isBrave === 'function' && await navigator.brave.isBrave()) {
      browser = 'Brave';
    } else if (navigator.userAgent.includes('Edg/')) {
      browser = 'Edge';
    } else if (navigator.userAgent.includes('CocCoc/')) {
      browser = 'Cốc Cốc';
    } else if (navigator.userAgent.includes('OPR/')) {
      browser = 'Opera';
    } else if (navigator.userAgent.includes('Vivaldi/')) {
      browser = 'Vivaldi';
    }
  } catch (e) {}

  let os = 'win';
  try {
    if (chrome.runtime && typeof chrome.runtime.getPlatformInfo === 'function') {
      const info = await chrome.runtime.getPlatformInfo();
      os = info.os || 'win';
    }
  } catch (e) {}

  let chromeProfileEmail = null;
  try {
    if (chrome.identity && typeof chrome.identity.getProfileUserInfo === 'function') {
      const userInfo = await chrome.identity.getProfileUserInfo({ accountStatus: 'ANY' });
      if (userInfo && userInfo.email) {
        chromeProfileEmail = userInfo.email;
      }
    }
  } catch (e) {}

  workerAccounts.browser = browser;
  workerAccounts.os = os;
  if (chromeProfileEmail) {
    workerAccounts.chromeProfileEmail = chromeProfileEmail;
  }

  return { browser, os, chromeProfileEmail };
}

function formatWorkerName(accounts, workerId) {
  const parts = [];
  const osLabel = accounts.os ? (accounts.os === 'win' ? 'Windows' : accounts.os === 'mac' ? 'macOS' : accounts.os) : '';
  const browserLabel = osLabel ? `${accounts.browser} (${osLabel})` : accounts.browser;
  parts.push(browserLabel);

  if (accounts.gemini && accounts.gemini.email) {
    parts.push(`Gemini: ${accounts.gemini.email}`);
  } else if (accounts.gemini && accounts.gemini.name) {
    parts.push(`Gemini: ${accounts.gemini.name}`);
  }

  if (accounts.chatgpt && accounts.chatgpt.name) {
    parts.push(`ChatGPT: ${accounts.chatgpt.name}`);
  } else if (accounts.chatgpt && accounts.chatgpt.email) {
    parts.push(`ChatGPT: ${accounts.chatgpt.email}`);
  }

  if (!accounts.gemini && !accounts.chatgpt && accounts.chromeProfileEmail) {
    parts.push(`Sync: ${accounts.chromeProfileEmail}`);
  }

  if (parts.length === 1) {
    parts.push(`#${workerId.slice(-4)}`);
  }

  return parts.join(' | ');
}

async function getOrCreateWorkerIdentity() {
  if (cachedWorkerIdentity) return cachedWorkerIdentity;
  try {
    await detectBrowserInfo();
    const data = await chrome.storage.local.get(['bridge_worker_id', 'bridge_worker_name']);
    let workerId = data.bridge_worker_id;

    if (!workerId) {
      workerId = 'worker_' + Math.random().toString(36).substring(2, 9);
      await chrome.storage.local.set({ bridge_worker_id: workerId });
    }

    let workerName = data.bridge_worker_name || formatWorkerName(workerAccounts, workerId);

    cachedWorkerIdentity = { workerId, workerName };
    return cachedWorkerIdentity;
  } catch (e) {
    const fallbackId = 'worker_' + Math.random().toString(36).substring(2, 8);
    return { workerId: fallbackId, workerName: `Browser #${fallbackId.slice(-4)}` };
  }
}

async function checkActiveProviderTabs() {
  try {
    const [chatgptTabs, geminiTabs] = await Promise.all([
      chrome.tabs.query({ url: PROVIDERS.chatgpt.urlPatterns }),
      chrome.tabs.query({ url: PROVIDERS.gemini.urlPatterns })
    ]);

    const activeProviders = [];
    if (chatgptTabs && chatgptTabs.length > 0) activeProviders.push('chatgpt');
    if (geminiTabs && geminiTabs.length > 0) activeProviders.push('gemini');

    return {
      activeProviders,
      tabCounts: {
        chatgpt: chatgptTabs ? chatgptTabs.length : 0,
        gemini: geminiTabs ? geminiTabs.length : 0
      }
    };
  } catch (e) {
    return {
      activeProviders: Object.keys(PROVIDERS),
      tabCounts: { chatgpt: 1, gemini: 1 }
    };
  }
}

async function queryAccountsFromActiveTabs() {
  try {
    const [chatgptTabs, geminiTabs] = await Promise.all([
      chrome.tabs.query({ url: PROVIDERS.chatgpt.urlPatterns }),
      chrome.tabs.query({ url: PROVIDERS.gemini.urlPatterns })
    ]);
    for (const t of (chatgptTabs || [])) {
      if (t.id) chrome.tabs.sendMessage(t.id, { action: 'CHECK_ACCOUNT' }, () => {
        if (chrome.runtime.lastError) {}
      });
    }
    for (const t of (geminiTabs || [])) {
      if (t.id) chrome.tabs.sendMessage(t.id, { action: 'CHECK_ACCOUNT' }, () => {
        if (chrome.runtime.lastError) {}
      });
    }
  } catch (e) {}
}

let syncTabsTimer = null;
function scheduleSyncTabsToServer() {
  clearTimeout(syncTabsTimer);
  syncTabsTimer = setTimeout(async () => {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    try {
      const { activeProviders, tabCounts } = await checkActiveProviderTabs();
      const identity = await getOrCreateWorkerIdentity();
      safeSend({
        action: 'REGISTER_WORKER',
        workerId: identity.workerId,
        workerName: identity.workerName,
        accounts: workerAccounts,
        providers: activeProviders,
        tabCounts: tabCounts
      });
      console.log(`📡 [Bridge BG] Đã đồng bộ trạng thái Tab: ChatGPT (${tabCounts.chatgpt} tab), Gemini (${tabCounts.gemini} tab)`);
      queryAccountsFromActiveTabs();
    } catch (e) {
      console.log('⚠️ [Bridge BG] Lỗi syncProviderTabsToServer:', e.message);
    }
  }, 350);
}

// Lắng nghe đóng, mở, hoặc đổi trang của các Tab để cập nhật thời gian thực
chrome.tabs.onRemoved.addListener(() => {
  scheduleSyncTabsToServer();
});
chrome.tabs.onCreated.addListener(() => {
  scheduleSyncTabsToServer();
});
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.url || changeInfo.status === 'complete') {
    scheduleSyncTabsToServer();
  }
});

async function initWebSocket() {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
    return;
  }

  try {
    const identity = await getOrCreateWorkerIdentity();
    let wsUrl = `${getServerWs()}?workerId=${encodeURIComponent(identity.workerId)}&workerName=${encodeURIComponent(identity.workerName)}`;
    if (currentWorkerToken) {
      wsUrl += `&token=${encodeURIComponent(currentWorkerToken)}`;
    }
    socket = new WebSocket(wsUrl);
  } catch (err) {
    scheduleReconnect();
    return;
  }

  socket.onopen = async () => {
    retryAttempt = 0;
    console.log('✅ [Bridge BG] Đã kết nối thành công với Local Server tại ' + getServerWs());
    appendLog('info', `Đã kết nối thành công với Local Server (${getServerWs()})`);

    // Gửi thông tin định danh Worker kèm tài khoản và số lượng tab đang mở tới server
    try {
      const [{ activeProviders, tabCounts }, identity] = await Promise.all([
        checkActiveProviderTabs(),
        getOrCreateWorkerIdentity()
      ]);
      safeSend({
        action: 'REGISTER_WORKER',
        workerId: identity.workerId,
        workerName: identity.workerName,
        accounts: workerAccounts,
        providers: activeProviders,
        tabCounts: tabCounts
      });
      console.log(`🏷️ [Bridge BG] Đăng ký Worker: "${identity.workerName}" (ID: ${identity.workerId}) | Tabs: ChatGPT=${tabCounts.chatgpt}, Gemini=${tabCounts.gemini}`);
      setTimeout(queryAccountsFromActiveTabs, 800);
    } catch (e) {
      console.log('⚠️ [Bridge BG] Lỗi gửi REGISTER_WORKER:', e.message);
    }

    flushPendingBuffer();
  };

  socket.onmessage = async (event) => {
    try {
      const msg = JSON.parse(event.data);

      if (msg.action === 'CANCEL_TASK') {
        console.log(`🛑 [Bridge BG] Nhận lệnh CANCEL_TASK cho id: ${msg.id}`);
        appendLog('step', `Hủy tác vụ ${msg.id}: ${msg.reason || 'Client/Queue abort'}`);
        // Chuyển tiếp tới tất cả tabs của ChatGPT và Gemini để dừng ngay
        for (const prov of Object.values(PROVIDERS)) {
          chrome.tabs.query({ url: prov.urlPatterns }).then((tabs) => {
            tabs.forEach((t) => chrome.tabs.sendMessage(t.id, msg).catch(() => {}));
          }).catch(() => {});
        }
        return;
      }

      if (msg.action === 'RELOAD_EXTENSION') {
        console.log('🔄 [Bridge BG] Nhận lệnh RELOAD_EXTENSION từ Server...');
        if (chrome.runtime && typeof chrome.runtime.reload === 'function') {
          chrome.runtime.reload();
        }
        return;
      }

      if (msg.action === 'ASK') {
        const providerKey = (msg.provider || (msg.model && msg.model.toLowerCase().includes('gemini') ? 'gemini' : 'chatgpt')).toLowerCase();
        const provider = PROVIDERS[providerKey] || PROVIDERS.chatgpt;

        // Xử lý tuần tự (FIFO Queue per Provider) trong Background Service Worker
        enqueueProviderTask(providerKey, async () => {
          appendLog('prompt', `[${provider.name}] "${(msg.prompt || '').slice(0, 70)}..."`, { id: msg.id, provider: providerKey });

          let tabs = await chrome.tabs.query({ url: provider.urlPatterns });

          // Tự phục hồi: Nếu chưa có tab nào mở, tự động mở tab mới
          if (!tabs || tabs.length === 0) {
            console.log(`[Bridge BG] Chưa có tab ${provider.name}, đang tự động mở tab mới...`);
            appendLog('step', `Chưa có tab ${provider.name}, tự động mở tab mới...`);
            try {
              const newTab = await chrome.tabs.create({ url: provider.homeUrl, active: true });
              await waitForTabComplete(newTab.id);
              tabs = [newTab];
            } catch (e) {
              appendLog('error', `Không thể tự động mở tab ${provider.name}: ` + e.message);
              safeSend({
                id: msg.id,
                status: 'error',
                error: `Không thể tự động mở tab ${provider.name}: ` + e.message
              });
              return;
            }
          }

          // Ưu tiên tab đang active
          let activeTab = tabs.find(t => t.active) || tabs[0];

          // 🔒 CHỜ & LẤY INPUT MUTEX TRƯỚC KHI ACTIVE TAB HOẶC ĐIỀN PROMPT
          console.log(`🔒 [Bridge BG] [${provider.name}] Chờ Input Mutex để điều khiển tab (Task: ${msg.id})...`);
          const releaseInputLock = await inputMutex.acquire(provider.name, msg.id);
          const hasImages = Array.isArray(msg.images) && msg.images.length > 0;
          const safetyTimeoutMs = hasImages ? 60000 : 30000;
          const safetyTimer = setTimeout(() => {
            console.log(`⚠️ [Bridge BG] [${provider.name}] Quá ${safetyTimeoutMs / 1000}s chưa nhận INPUT_SUBMITTED, tự động nhả Input Mutex an toàn.`);
            releaseInputLock();
          }, safetyTimeoutMs);

          try {
            // Nếu yêu cầu newChat: true và tab hiện tại đang ở trong 1 cuộc trò chuyện
            if (msg.newChat && activeTab.url && provider.isThreadUrl(activeTab.url)) {
              console.log(`[Bridge BG] Yêu cầu newChat ${provider.name}: Điều hướng về ${provider.homeUrl}...`);
              appendLog('step', `Tab đang ở hội thoại cũ, tự động chuyển về trang New Chat ${provider.name}...`);
              safeSend({
                action: 'LOG',
                id: msg.id,
                log: `Đang điều hướng về trang chủ ${provider.name} (New Chat sạch)...`
              });
              await chrome.tabs.update(activeTab.id, { url: provider.homeUrl });
              await waitForTabComplete(activeTab.id);
              await new Promise(r => setTimeout(r, 600));
            }

            // Kích hoạt tab ngầm trong cửa sổ chứa nó (không cướp focus cửa sổ hệ điều hành)
            try {
              await chrome.tabs.update(activeTab.id, { active: true });
              await new Promise(r => setTimeout(r, 200));
            } catch (e) {
              console.log('⚠️ [Bridge BG] Không thể kích hoạt tab ngầm:', e.message);
            }

            console.log(`[Bridge BG] Đang gửi lệnh tới tab ${provider.name} ID: ${activeTab.id}`);
            appendLog('step', `Đang kích hoạt và gửi tới tab ${provider.name} (ID: ${activeTab.id})...`);

            // Gửi lệnh tới Content Script tương ứng và đợi hoàn tất toàn bộ trước khi nhả khóa
            const response = await sendMessageWithAutoInject(activeTab.id, msg, provider.scriptFile);
            if (response) {
              safeSend(response);
            }
          } catch (err) {
            appendLog('error', `Lỗi giao tiếp với tab ${provider.name}: ` + err.message);
            safeSend({
              id: msg.id,
              status: 'error',
              error: `Lỗi giao tiếp với tab ${provider.name}: ` + err.message + `. Vui lòng kiểm tra tab trình duyệt.`
            });
          } finally {
            clearTimeout(safetyTimer);
            releaseInputLock();
          }
        });
      }
    } catch (err) {
      console.log('⚠️ [Bridge BG] Lỗi xử lý message:', err.message);
    }
  };

  socket.onclose = () => {
    socket = null;
    appendLog('error', `Mất kết nối với Local Server (${getServerWs()})`);
    scheduleReconnect();
  };

  socket.onerror = () => {
    if (socket) {
      try {
        socket.close();
      } catch (e) {}
    }
    socket = null;
  };
}

// Chờ tab tải xong hoàn toàn
function waitForTabComplete(tabId) {
  return new Promise((resolve) => {
    let resolved = false;
    const safeResolve = () => {
      if (!resolved) {
        resolved = true;
        chrome.tabs.onUpdated.removeListener(listener);
        clearTimeout(safetyTimer);
        resolve();
      }
    };

    const safetyTimer = setTimeout(safeResolve, 12000);

    const listener = (tid, changeInfo) => {
      if (tid === tabId && changeInfo.status === 'complete') {
        setTimeout(safeResolve, 1500);
      }
    };
    chrome.tabs.onUpdated.addListener(listener);

    chrome.tabs.get(tabId).then((t) => {
      if (t && t.status === 'complete') {
        setTimeout(safeResolve, 800);
      }
    }).catch(safeResolve);
  });
}

function pingTab(tabId) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), 500);
    chrome.tabs.sendMessage(tabId, { action: 'PING' }, (res) => {
      clearTimeout(timer);
      if (chrome.runtime.lastError || !res || res.action !== 'PONG') {
        resolve(false);
      } else {
        resolve(true);
      }
    });
  });
}

async function sendMessageWithAutoInject(tabId, msg, scriptFile = 'content.js') {
  try {
    const tabInfo = await chrome.tabs.get(tabId);
    if (tabInfo && tabInfo.status === 'loading') {
      console.log('[Bridge BG] Tab đang tải, đợi tải xong trước khi gửi lệnh...');
      await waitForTabComplete(tabId);
    }
  } catch (e) {}

  // Luôn chủ động inject shared utils & scriptFile để cập nhật version mới nhất nếu mã nguồn thay đổi
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['shared/bridge-constants.js', 'shared/bridge-utils.js', scriptFile]
    });
    await new Promise(r => setTimeout(r, 200));
  } catch (injectErr) {
    console.log(`ℹ️ [Bridge BG] Notice inject ${scriptFile}:`, injectErr.message);
  }

  let isAlive = await pingTab(tabId);
  if (!isAlive) {
    console.log(`[Bridge BG] Tab chưa sẵn sàng sau inject, tự động reload tab (ID: ${tabId})...`);
    await chrome.tabs.reload(tabId);
    await waitForTabComplete(tabId);
    await new Promise(r => setTimeout(r, 600));
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['shared/bridge-constants.js', 'shared/bridge-utils.js', scriptFile]
      });
      await new Promise(r => setTimeout(r, 300));
    } catch (_) {}
  }

  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, msg, (response) => {
      const err = chrome.runtime.lastError;
      if (err) {
        console.log(`ℹ️ [Bridge BG] sendMessage port notice (${scriptFile} trả kết quả qua TASK_RESULT):`, err.message);
      }
      resolve(response);
    });
  });
}

// Giữ nhịp tim qua Chrome Alarms
chrome.alarms.create('keepAliveAlarm', { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'keepAliveAlarm') {
    if (socket && socket.readyState === WebSocket.OPEN) {
      safeSend({ action: 'HEARTBEAT' });
    } else {
      checkAndConnect();
    }
  }
});

// Lắng nghe Message từ Content Scripts, Side Panel hoặc Popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'INPUT_SUBMITTED') {
    inputMutex.handleSubmitted(request.id, request.provider);
    return false;
  }

  if (request.action === 'LOG') {
    safeSend(request);
    appendLog('step', request.text || request.log, { id: request.id });
    return false;
  }

  if (request.action === 'TASK_RESULT') {
    safeSend(request);
    if (request.status === 'success') {
      appendLog('success', `Hoàn tất câu trả lời (${request.answer ? request.answer.length : 0} ký tự)`, { id: request.id });
    } else {
      appendLog('error', `Lỗi xử lý: ${request.error || 'Lỗi không xác định'}`, { id: request.id });
    }
    return false;
  }

  if (request.action === 'STREAM_CHUNK') {
    safeSend(request);
    return false;
  }

  if (request.action === 'OPEN_SIDEPANEL') {
    if (chrome.sidePanel && typeof chrome.sidePanel.open === 'function') {
      const tabId = sender.tab ? sender.tab.id : undefined;
      const windowId = sender.tab ? sender.tab.windowId : undefined;
      chrome.sidePanel.open({ tabId, windowId }).catch(() => {
        if (windowId) chrome.sidePanel.open({ windowId }).catch(() => {});
      });
    }
    return false;
  }

  // Tiếp nhận thông tin tài khoản vừa nhận diện từ Content Script của ChatGPT / Gemini
  if (request.action === 'UPDATE_ACCOUNT_INFO') {
    const { provider, user } = request;
    if (provider && user) {
      workerAccounts[provider] = user;
      chrome.storage.local.set({ bridge_worker_accounts: workerAccounts }).catch(() => {});

      getOrCreateWorkerIdentity().then(async (identity) => {
        // Chỉ đổi tên tự động nếu người dùng chưa tự đặt tên thủ công
        const data = await chrome.storage.local.get(['bridge_worker_name']);
        if (!data.bridge_worker_name) {
          identity.workerName = formatWorkerName(workerAccounts, identity.workerId);
        }
        const { activeProviders, tabCounts } = await checkActiveProviderTabs();
        safeSend({
          action: 'REGISTER_WORKER',
          workerId: identity.workerId,
          workerName: identity.workerName,
          accounts: workerAccounts,
          providers: activeProviders,
          tabCounts: tabCounts
        });
        console.log(`👤 [Bridge BG] Cập nhật tài khoản ${provider.toUpperCase()}: ${user.name || user.email} -> Worker: "${identity.workerName}"`);
      }).catch(() => {});
    }
    return false;
  }

  // Hỗ trợ cập nhật tên Worker từ giao diện người dùng
  if (request.action === 'SET_WORKER_NAME') {
    const newName = (request.name || '').trim();
    if (newName) {
      chrome.storage.local.set({ bridge_worker_name: newName }).then(async () => {
        if (cachedWorkerIdentity) cachedWorkerIdentity.workerName = newName;
        const identity = await getOrCreateWorkerIdentity();
        identity.workerName = newName;
        safeSend({
          action: 'REGISTER_WORKER',
          workerId: identity.workerId,
          workerName: newName,
          accounts: workerAccounts,
          providers: Object.keys(PROVIDERS)
        });
        sendResponse({ success: true, name: newName });
      }).catch(err => {
        sendResponse({ success: false, error: err.message });
      });
      return true;
    }
    sendResponse({ success: false, error: 'Tên không hợp lệ' });
    return false;
  }

  // Hỗ trợ truy vấn trạng thái cho cả ChatGPT và Gemini kèm định danh Worker
  // Cấu hình Server Online (Hỗ trợ cả URL, Port và Worker Token)
  if (request.action === 'SET_SERVER_CONFIG') {
    const rawUrl = request.serverUrl || request.url;
    const parsed = parseServerUrl(rawUrl);
    if (!parsed) {
      sendResponse({ success: false, error: 'Địa chỉ Server URL không hợp lệ' });
      return true;
    }

    currentServerUrl = parsed.serverUrl;
    currentWsUrl = parsed.wsUrl;
    currentPort = parsed.port;
    if (typeof request.workerToken === 'string') {
      currentWorkerToken = request.workerToken.trim();
    }

    chrome.storage.local.set({
      custom_server_url: currentServerUrl,
      custom_server_port: currentPort,
      custom_worker_token: currentWorkerToken
    }).catch(() => {});

    if (socket) {
      try { socket.close(); } catch (_) {}
      socket = null;
    }
    checkAndConnect();
    sendResponse({
      success: true,
      serverUrl: currentServerUrl,
      wsUrl: currentWsUrl,
      port: currentPort,
      hasWorkerToken: Boolean(currentWorkerToken)
    });
    return true;
  }

  if (request.action === 'SET_PORT') {
    const newPort = parseInt(request.port, 10);
    if (newPort && newPort > 0 && newPort < 65536) {
      currentPort = newPort;
      currentServerUrl = `http://localhost:${currentPort}`;
      currentWsUrl = `ws://localhost:${currentPort}`;
      chrome.storage.local.set({
        custom_server_port: newPort,
        custom_server_url: currentServerUrl
      }).catch(() => {});
      if (socket) {
        try { socket.close(); } catch (_) {}
        socket = null;
      }
      checkAndConnect();
      sendResponse({ success: true, port: currentPort, wsUrl: getServerWs(), serverUrl: currentServerUrl });
    } else {
      sendResponse({ success: false, error: 'Port không hợp lệ (1 - 65535)' });
    }
    return true;
  }

  if (request.action === 'GET_STATUS' || request.action === 'CONNECT_NOW') {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      checkAndConnect();
    }

    const isSocketOpen = socket && socket.readyState === WebSocket.OPEN;
    Promise.all([
      chrome.tabs.query({ url: PROVIDERS.chatgpt.urlPatterns }),
      chrome.tabs.query({ url: PROVIDERS.gemini.urlPatterns }),
      getOrCreateWorkerIdentity()
    ]).then(([chatGptTabs, geminiTabs, identity]) => {
      sendResponse({
        serverConnected: isSocketOpen,
        serverPort: currentPort,
        serverUrl: currentServerUrl,
        wsUrl: getServerWs(),
        hasWorkerToken: Boolean(currentWorkerToken),
        workerId: identity ? identity.workerId : null,
        workerName: identity ? identity.workerName : 'Browser Worker',
        accounts: workerAccounts,
        hasChatGPTTab: chatGptTabs.length > 0,
        chatGptTabCount: chatGptTabs.length,
        hasGeminiTab: geminiTabs.length > 0,
        geminiTabCount: geminiTabs.length,
        tabCount: chatGptTabs.length + geminiTabs.length
      });
    }).catch(() => {
      sendResponse({
        serverConnected: isSocketOpen,
        serverPort: currentPort,
        serverUrl: currentServerUrl,
        wsUrl: getServerWs(),
        hasWorkerToken: Boolean(currentWorkerToken),
        workerId: null,
        workerName: 'Browser Worker',
        hasChatGPTTab: false,
        hasGeminiTab: false,
        tabCount: 0
      });
    });

    return true; // Giữ async channel
  }
});

// Tự động làm mới cả tab ChatGPT và Gemini khi người dùng Reload Extension
chrome.runtime.onInstalled.addListener(async (details) => {
  console.log('🔄 [Bridge BG] Extension vừa được nạp / cập nhật (reason:', details.reason, ')');
  try {
    const allTabs = await chrome.tabs.query({});
    for (const tab of allTabs) {
      if (!tab.url) continue;
      const isChatGPT = tab.url.includes('chatgpt.com') || tab.url.includes('chat.openai.com');
      const isGemini = tab.url.includes('gemini.google.com');
      if (isChatGPT || isGemini) {
        console.log('🔄 [Bridge BG] Tự động tải lại tab AI ID:', tab.id, tab.url);
        chrome.tabs.reload(tab.id);
      }
    }
  } catch (e) {
    console.log('⚠️ [Bridge BG] Lỗi tự động reload tab:', e.message);
  }
  checkAndConnect();
});

chrome.runtime.onStartup.addListener(() => {
  checkAndConnect();
});

checkAndConnect();
