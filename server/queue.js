/**
 * Task Queue Engine for ChatGPT & Gemini Local Web Bridge
 * @file server/queue.js
 * 
 * Enterprise-grade FIFO Task Queue ensuring single-concurrency execution per browser.
 * Features:
 * - EventEmitter lifecycle hooks (task_enqueued, task_started, task_completed, task_failed, task_cancelled)
 * - AbortSignal & client disconnect cancellation
 * - Immediate failover on WebSocket disconnection (no hanging timeouts)
 * - Fine-grained performance metrics (Queue wait time, execution latency, throughput)
 */

const EventEmitter = require('events');
const config = require('./config');
const sessionManager = require('./session-manager');
const { ACTIONS, QUEUE_EVENTS, TASK_STATUS, HTTP_STATUS, PROVIDERS } = require('./constants');
const { QueueOverloadError, TaskTimeoutError, TaskCancelledError, BridgeError } = require('./errors');

class TaskQueue extends EventEmitter {
  constructor(options = {}) {
    super();
    this.maxQueueSize = options.maxQueueSize || config.queue.maxSize;
    this.defaultTimeoutMs = options.defaultTimeoutMs || config.queue.defaultTimeoutMs;
    
    this.queue = [];
    /**
     * Quản lý cụm trình duyệt (Worker Pool):
     * Map<workerId, {
     *   id: string,
     *   name: string,
     *   ws: WebSocket,
     *   providers: string[],
     *   activeTasks: Map<string, Object>, // providerKey -> task
     *   stats: { completed: number, failed: number },
     *   connectedAt: number,
     *   lastActiveAt: number
     * }>
     */
    this.workers = new Map();

    this.metrics = {
      totalReceived: 0,
      totalCompleted: 0,
      totalFailed: 0,
      totalTimedOut: 0,
      totalCancelled: 0,
      avgWaitTimeMs: 0,
      avgExecutionTimeMs: 0,
      lastCompletedAt: null
    };

    this._executionTimes = [];
    this._waitTimes = [];
  }

  /**
   * Đăng ký một trình duyệt / worker vào pool
   * @param {string} workerId
   * @param {import('ws').WebSocket} ws
   * @param {Object} [info={}]
   */
  registerWorker(workerId, ws, info = {}) {
    const existing = this.workers.get(workerId);
    if (existing) {
      existing.ws = ws;
      existing.name = info.name || existing.name;
      existing.providers = info.providers || existing.providers;
      existing.accounts = info.accounts || existing.accounts || {};
      if (info.tabCounts) existing.tabCounts = info.tabCounts;
      existing.lastActiveAt = Date.now();
      console.log(`🔄 [Worker Pool] Cập nhật kết nối Worker: ${workerId} ("${existing.name}") | Tabs: ${JSON.stringify(existing.tabCounts || {})}`);
    } else {
      const worker = {
        id: workerId,
        name: info.name || `Browser #${workerId.slice(-4)}`,
        ws,
        providers: info.providers || [PROVIDERS.CHATGPT, PROVIDERS.GEMINI],
        accounts: info.accounts || {},
        tabCounts: info.tabCounts || null,
        activeTasks: new Map(),
        stats: { completed: 0, failed: 0, byProvider: { chatgpt: { completed: 0, failed: 0 }, gemini: { completed: 0, failed: 0 } } },
        connectedAt: Date.now(),
        lastActiveAt: Date.now()
      };
      this.workers.set(workerId, worker);
      console.log(`🌐 [Worker Pool] Đăng ký Worker mới: ${workerId} ("${worker.name}") | Tổng số worker: ${this.workers.size}`);
    }

    this.emit('worker_connected', { workerId });
    this.processNext();
  }

  /**
   * Hủy đăng ký worker khi trình duyệt ngắt kết nối (kèm cơ chế Auto-Failover)
   * @param {string} workerId
   * @param {string} [reason='Browser disconnected']
   */
  unregisterWorker(workerId, reason = 'Browser disconnected') {
    const worker = this.workers.get(workerId);
    if (!worker) return;

    console.log(`⚠️ [Worker Pool] Hủy Worker: ${workerId} ("${worker.name}"): ${reason}`);

    // Auto-Failover: Đưa các task đang chạy dở trên worker này trở lại đầu hàng đợi
    for (const [provider, task] of worker.activeTasks.entries()) {
      clearTimeout(task.timer);
      this._cleanupTaskListeners(task);

      if (task.signal && task.signal.aborted) {
        task.reject(new TaskCancelledError('Client aborted while worker disconnected'));
      } else {
        console.log(`🔄 [Worker Pool] Failover: Đưa task ${task.id} (${provider.toUpperCase()}) trở lại đầu queue do Worker ngắt kết nối.`);
        task.newChat = true; // Chuyển sang trình duyệt khác nên reset chat mới
        task.workerId = null;
        task.workerName = null;
        this.queue.unshift(task);
      }
    }
    worker.activeTasks.clear();

    this.workers.delete(workerId);
    this.emit('worker_disconnected', { workerId, reason });
    this.processNext();
  }

  /**
   * Tương thích ngược: Cập nhật socket mặc định
   * @param {import('ws').WebSocket|null} ws
   */
  setBridgeSocket(ws) {
    if (!ws) {
      if (this.workers.has('default_worker')) {
        this.unregisterWorker('default_worker');
      }
      return;
    }
    this.registerWorker('default_worker', ws, { name: 'Default Browser' });
  }

  /**
   * Kiểm tra xem có ít nhất một trình duyệt đang sẵn sàng nhận lệnh không
   * @returns {boolean}
   */
  isBridgeReady() {
    return Array.from(this.workers.values()).some(w => w.ws && w.ws.readyState === 1);
  }

  /**
   * Task đầu tiên đang thực thi (giữ để tương thích ngược 100%)
   */
  get currentTask() {
    for (const w of this.workers.values()) {
      const first = w.activeTasks.values().next().value;
      if (first) return first;
    }
    return null;
  }

  /**
   * Đưa tác vụ vào hàng đợi với hỗ trợ AbortSignal
   * @param {Object} taskParams
   * @param {string} [taskParams.id] - Request ID
   * @param {string} taskParams.prompt - Nội dung câu hỏi
   * @param {string} [taskParams.provider='chatgpt'] - chatgpt | gemini
   * @param {boolean} [taskParams.newChat=false] - Reset thread hay tiếp tục ngữ cảnh
   * @param {boolean} [taskParams.stream=false] - Bật streaming SSE
   * @param {number} [taskParams.timeout=180000] - Timeout tối đa (ms)
   * @param {Function} [taskParams.onChunk] - Callback nhận token streaming
   * @param {AbortSignal} [taskParams.signal] - Tín hiệu hủy khi client ngắt kết nối
   * @param {string} [taskParams.sessionId] - ID phiên gắn kết (Sticky Session)
   * @returns {Promise<any>}
   */
  enqueue({ id, prompt, images = [], provider = 'chatgpt', newChat = false, stream = false, timeout = 180000, onChunk = null, signal = null, sessionId = null }) {
    return new Promise((resolve, reject) => {
      if (this.queue.length >= this.maxQueueSize) {
        return reject(new QueueOverloadError(this.maxQueueSize));
      }

      if (signal && signal.aborted) {
        return reject(new TaskCancelledError('Request aborted by client before enqueue.'));
      }

      this.metrics.totalReceived++;
      const taskId = id || `req_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

      const task = {
        id: taskId,
        prompt,
        images: Array.isArray(images) ? images : [],
        provider: (provider || PROVIDERS.CHATGPT).toLowerCase(),
        newChat: Boolean(newChat),
        stream: Boolean(stream),
        timeout: Number(timeout) || this.defaultTimeoutMs,
        onChunk,
        resolve,
        reject,
        sessionId: sessionId ? String(sessionId).trim() : null,
        workerId: null,
        workerName: null,
        enqueuedAt: Date.now(),
        startedAt: null,
        timer: null,
        signal,
        abortListener: null
      };

      // Đăng ký listener hủy tác vụ khi client đóng kết nối HTTP
      if (signal) {
        task.abortListener = () => {
          this.cancel(taskId, 'Client closed HTTP connection');
        };
        signal.addEventListener('abort', task.abortListener, { once: true });
      }

      this.queue.push(task);
      this.emit(QUEUE_EVENTS.TASK_ENQUEUED, { id: taskId, provider: task.provider, queueLength: this.queue.length });
      this.processNext();
    });
  }

  /**
   * Hủy một tác vụ đang đợi trong queue hoặc đang thực thi
   * @param {string} taskId
   * @param {string} reason
   * @returns {boolean}
   */
  cancel(taskId, reason = 'Cancelled by caller') {
    // 1. Kiểm tra nếu task đang trong hàng đợi chờ
    const queueIndex = this.queue.findIndex(t => t.id === taskId);
    if (queueIndex !== -1) {
      const [removedTask] = this.queue.splice(queueIndex, 1);
      this._cleanupTaskListeners(removedTask);
      this.metrics.totalCancelled++;
      this.emit(QUEUE_EVENTS.TASK_CANCELLED, { id: taskId, reason, wasRunning: false });
      removedTask.reject(new TaskCancelledError(reason));
      return true;
    }

    // 2. Kiểm tra nếu task đang chạy trong bất kỳ worker nào
    for (const worker of this.workers.values()) {
      for (const [provider, runningTask] of worker.activeTasks.entries()) {
        if (runningTask.id === taskId) {
          clearTimeout(runningTask.timer);
          this._cleanupTaskListeners(runningTask);
          worker.activeTasks.delete(provider);
          this.metrics.totalCancelled++;
          this.emit(QUEUE_EVENTS.TASK_CANCELLED, { id: taskId, reason, wasRunning: true, workerId: worker.id });
          runningTask.reject(new TaskCancelledError(`Task cancelled while running: ${reason}`));

          // Gửi tín hiệu hủy tới trình duyệt cụ thể
          if (worker.ws && worker.ws.readyState === 1) {
            try {
              worker.ws.send(JSON.stringify({
                action: ACTIONS.CANCEL_TASK,
                id: taskId,
                reason
              }));
            } catch (_) {}
          }

          this.processNext();
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Xóa sạch toàn bộ hàng đợi chờ và hủy toàn bộ task đang chạy trên tất cả worker
   * @param {string} reason
   * @returns {{ cancelledCount: number, cancelledRunning: boolean }}
   */
  clearQueue(reason = 'Queue cleared by user') {
    let cancelledCount = 0;
    let cancelledRunning = false;

    // 1. Hủy toàn bộ task đang chờ trong queue
    while (this.queue.length > 0) {
      const task = this.queue.shift();
      this._cleanupTaskListeners(task);
      this.metrics.totalCancelled++;
      this.emit(QUEUE_EVENTS.TASK_CANCELLED, { id: task.id, reason, wasRunning: false });
      task.reject(new TaskCancelledError(reason));
      cancelledCount++;
    }

    // 2. Hủy toàn bộ task đang chạy trên mọi worker
    for (const worker of this.workers.values()) {
      for (const [provider, runningTask] of worker.activeTasks.entries()) {
        clearTimeout(runningTask.timer);
        this._cleanupTaskListeners(runningTask);
        this.metrics.totalCancelled++;
        this.emit(QUEUE_EVENTS.TASK_CANCELLED, { id: runningTask.id, reason, wasRunning: true, workerId: worker.id });
        runningTask.reject(new TaskCancelledError(`Task cancelled: ${reason}`));
        cancelledRunning = true;

        if (worker.ws && worker.ws.readyState === 1) {
          try {
            worker.ws.send(JSON.stringify({
              action: ACTIONS.CANCEL_TASK,
              id: runningTask.id,
              reason
            }));
          } catch (_) {}
        }
      }
      worker.activeTasks.clear();
    }

    return { cancelledCount, cancelledRunning };
  }

  /**
   * Bộ điều phối & Cân bằng tải đa trình duyệt (Load Balancer & Sticky Session Dispatcher)
   */
  processNext() {
    if (this.queue.length === 0 || !this.isBridgeReady()) {
      return;
    }

    const readyWorkers = Array.from(this.workers.values()).filter(w => w.ws && w.ws.readyState === 1);
    if (readyWorkers.length === 0) return;

    for (let i = 0; i < this.queue.length; i++) {
      const task = this.queue[i];
      const provider = task.provider;

      let chosenWorker = null;

      // 1. Kiểm tra Sticky Session: Nếu task thuộc về một session đã có worker quản lý
      if (task.sessionId) {
        const stickyWorkerId = sessionManager.getSessionWorker(task.sessionId);
        if (stickyWorkerId) {
          const stickyWorker = this.workers.get(stickyWorkerId);
          if (stickyWorker && stickyWorker.ws && stickyWorker.ws.readyState === 1) {
            // Worker cũ vẫn kết nối
            if (!stickyWorker.activeTasks.has(provider)) {
              chosenWorker = stickyWorker;
            } else {
              // Worker cũ đang bận provider này -> Chờ nó rảnh để không mất ngữ cảnh tab
              continue;
            }
          } else {
            // Worker cũ đã mất kết nối -> Phải chuyển sang worker mới (newChat: true)
            task.newChat = true;
          }
        }
      }

      // 2. Cân Bằng Tải (Least-Busy): Chọn worker rảnh slot provider đó và ít task nhất
      if (!chosenWorker) {
        const availableWorkers = readyWorkers.filter(w =>
          w.providers.includes(provider) && !w.activeTasks.has(provider)
        );

        if (availableWorkers.length === 0) {
          continue;
        }

        // Ưu tiên worker có ít task đang chạy nhất, sau đó đến tổng số task hoàn thành ít nhất
        availableWorkers.sort((a, b) => {
          if (a.activeTasks.size !== b.activeTasks.size) {
            return a.activeTasks.size - b.activeTasks.size;
          }
          return (a.stats.completed || 0) - (b.stats.completed || 0);
        });

        chosenWorker = availableWorkers[0];

        // Ghi nhớ Sticky Session kèm định danh tài khoản
        if (task.sessionId) {
          const accInfo = (chosenWorker.accounts && chosenWorker.accounts[provider]) || null;
          const accDisplay = accInfo ? (accInfo.email || accInfo.name) : null;
          sessionManager.setSessionWorker(task.sessionId, chosenWorker.id, chosenWorker.name, accDisplay);
        }
      }

      // 3. Phân bổ task cho chosenWorker
      this.queue.splice(i, 1);
      i--;

      task.startedAt = Date.now();
      task.workerId = chosenWorker.id;
      task.workerName = chosenWorker.name;
      chosenWorker.activeTasks.set(provider, task);
      chosenWorker.lastActiveAt = Date.now();

      const waitDuration = task.startedAt - task.enqueuedAt;
      this._recordWaitTime(waitDuration);

      this.emit(QUEUE_EVENTS.TASK_STARTED, {
        id: task.id,
        provider: task.provider,
        workerId: chosenWorker.id,
        workerName: chosenWorker.name,
        waitDuration
      });

      console.log(`🚀 [Load Balancer] Đẩy task ${task.id} (${provider.toUpperCase()}) sang [${chosenWorker.name}] (Đang chạy: ${chosenWorker.activeTasks.size}/2, Queue còn: ${this.queue.length})`);

      // Timeout phòng hộ cho task
      task.timer = setTimeout(() => {
        if (chosenWorker.activeTasks.get(task.provider)?.id === task.id) {
          this.metrics.totalTimedOut++;
          this.metrics.totalFailed++;
          chosenWorker.stats.failed = (chosenWorker.stats.failed || 0) + 1;
          chosenWorker.activeTasks.delete(task.provider);
          this._cleanupTaskListeners(task);
          this.emit(QUEUE_EVENTS.TASK_FAILED, { id: task.id, error: 'Timeout', provider: task.provider, workerId: chosenWorker.id });

          if (chosenWorker.ws && chosenWorker.ws.readyState === 1) {
            try {
              chosenWorker.ws.send(JSON.stringify({
                action: ACTIONS.CANCEL_TASK,
                id: task.id,
                reason: 'Timeout'
              }));
            } catch (_) {}
          }

          task.reject(new TaskTimeoutError(task.timeout));
          this.processNext();
        }
      }, task.timeout);

      // Gửi lệnh qua WebSocket của worker được chọn
      try {
        chosenWorker.ws.send(JSON.stringify({
          id: task.id,
          action: ACTIONS.ASK,
          prompt: task.prompt,
          images: task.images || [],
          provider: task.provider,
          newChat: task.newChat,
          stream: task.stream,
          timeout: task.timeout
        }));
      } catch (err) {
        clearTimeout(task.timer);
        this.metrics.totalFailed++;
        chosenWorker.stats.failed = (chosenWorker.stats.failed || 0) + 1;
        chosenWorker.activeTasks.delete(task.provider);
        this._cleanupTaskListeners(task);
        this.emit(QUEUE_EVENTS.TASK_FAILED, { id: task.id, error: err.message, provider: task.provider, workerId: chosenWorker.id });
        task.reject(new BridgeError(`WebSocket Send Error to ${chosenWorker.name}: ${err.message}`, 503, 'WS_SEND_FAILED'));
        this.processNext();
      }
    }
  }

  /**
   * Xử lý dữ liệu trả về từ Extension qua WebSocket
   * @param {Object} data
   * @param {string|null} [fromWorkerId=null]
   */
  handleIncomingMessage(data, fromWorkerId = null) {
    if (!data || !data.id) return;

    let task = null;
    let foundWorker = null;

    for (const worker of this.workers.values()) {
      for (const t of worker.activeTasks.values()) {
        if (t.id === data.id) {
          task = t;
          foundWorker = worker;
          break;
        }
      }
      if (task) break;
    }

    if (!task || !foundWorker) {
      return;
    }

    // Luồng streaming tokens
    if (data.action === 'STREAM_CHUNK') {
      if (typeof task.onChunk === 'function') {
        try {
          task.onChunk(data.chunk, data.fullText);
        } catch (cbErr) {
          console.warn('[Queue] onChunk callback error:', cbErr.message);
        }
      }
      return;
    }

    // Hoàn tất tác vụ (Success hoặc Error)
    clearTimeout(task.timer);
    foundWorker.activeTasks.delete(task.provider);
    foundWorker.lastActiveAt = Date.now();
    this._cleanupTaskListeners(task);

    const execDuration = Date.now() - task.startedAt;
    this._recordExecutionTime(execDuration);
    this.metrics.lastCompletedAt = new Date().toISOString();

    // Chốt chặn cấp Server: Nhận diện nếu câu trả lời thực chất là thông báo lỗi từ web UI
    if (data.status === TASK_STATUS.SUCCESS && this._isWebErrorMessage(data.answer)) {
      data.status = TASK_STATUS.FAILED;
      data.error = `${(task.provider || 'AI').toUpperCase()} Web Error: ${data.answer}`;
    }

    // Gắn thông tin worker vào kết quả trả về
    data.workerId = foundWorker.id;
    data.workerName = foundWorker.name;

    if (data.status === TASK_STATUS.SUCCESS) {
      this.metrics.totalCompleted++;
      foundWorker.stats.completed = (foundWorker.stats.completed || 0) + 1;
      this.emit(QUEUE_EVENTS.TASK_COMPLETED, {
        id: task.id,
        provider: task.provider,
        workerId: foundWorker.id,
        workerName: foundWorker.name,
        duration: execDuration,
        answerLength: data.answer?.length || 0
      });
      task.resolve(data);
    } else {
      this.metrics.totalFailed++;
      foundWorker.stats.failed = (foundWorker.stats.failed || 0) + 1;
      const errMsg = data.error || 'Unknown error from browser tab';
      this.emit(QUEUE_EVENTS.TASK_FAILED, { id: task.id, provider: task.provider, workerId: foundWorker.id, error: errMsg });
      task.reject(new BridgeError(errMsg, HTTP_STATUS.INTERNAL_SERVER_ERROR, 'BROWSER_TASK_FAILED'));
    }

    // Tiếp tục bốc tác vụ kế tiếp
    this.processNext();
  }

  /**
   * Ngắt toàn bộ kết nối WebSocket (khi shutdown server)
   */
  onBridgeDisconnect() {
    this.emit('bridge_disconnected');

    for (const worker of this.workers.values()) {
      for (const [provider, interrupted] of worker.activeTasks.entries()) {
        clearTimeout(interrupted.timer);
        this.metrics.totalFailed++;
        this._cleanupTaskListeners(interrupted);
        interrupted.reject(new BridgeError('Bridge Server disconnected while executing task.', HTTP_STATUS.SERVICE_UNAVAILABLE, 'BRIDGE_DISCONNECTED'));
      }
      worker.activeTasks.clear();
    }
    this.workers.clear();
  }

  /**
   * Phát hiện các thông báo lỗi đặc trưng từ giao diện ChatGPT / Gemini Web
   * @param {string} text
   * @returns {boolean}
   */
  _isWebErrorMessage(text) {
    if (!text || typeof text !== 'string') return false;
    const trimmed = text.trim();
    if (!trimmed || trimmed.length > 350) return false;
    const lower = trimmed.toLowerCase();

    const errorPhrases = [
      'sorry, something went wrong',
      'something went wrong. please try your request again',
      'something went wrong. please try again',
      'please try your request again',
      'an error occurred while processing',
      'rất tiếc, đã xảy ra lỗi',
      'đã xảy ra lỗi. vui lòng thử lại',
      'vui lòng thử lại yêu cầu'
    ];

    return errorPhrases.some(phrase => lower.startsWith(phrase) || lower.includes(phrase));
  }

  _cleanupTaskListeners(task) {
    if (task && task.signal && task.abortListener) {
      try {
        task.signal.removeEventListener('abort', task.abortListener);
      } catch (_) {
        // AbortSignal có thể đã bị GC'd sau khi request kết thúc — safe to ignore
      }
    }
  }

  _recordWaitTime(ms) {
    this._waitTimes.push(ms);
    if (this._waitTimes.length > 50) this._waitTimes.shift();
    const sum = this._waitTimes.reduce((a, b) => a + b, 0);
    this.metrics.avgWaitTimeMs = Math.round(sum / this._waitTimes.length);
  }

  _recordExecutionTime(ms) {
    this._executionTimes.push(ms);
    if (this._executionTimes.length > 50) this._executionTimes.shift();
    const sum = this._executionTimes.reduce((a, b) => a + b, 0);
    this.metrics.avgExecutionTimeMs = Math.round(sum / this._executionTimes.length);
  }

  /**
   * Lấy số liệu giám sát và trạng thái hàng đợi thời gian thực
   */
  getMetrics() {
    const workerList = Array.from(this.workers.values()).map(w => ({
      id: w.id,
      name: w.name,
      connected: Boolean(w.ws && w.ws.readyState === 1),
      connectedAt: new Date(w.connectedAt).toISOString(),
      uptimeSeconds: Math.floor((Date.now() - w.connectedAt) / 1000),
      providers: w.providers,
      accounts: w.accounts || {},
      busyProviders: Array.from(w.activeTasks.keys()),
      activeTasks: Array.from(w.activeTasks.values()).map(t => ({
        id: t.id,
        provider: t.provider,
        runningMs: t.startedAt ? Date.now() - t.startedAt : 0
      })),
      completed: w.stats.completed || 0,
      failed: w.stats.failed || 0
    }));

    // Danh sách Tài Khoản Đăng Nhập (Accounts Pool) tổng hợp từ tất cả các trình duyệt
    const accountList = [];
    for (const w of this.workers.values()) {
      const isConnected = Boolean(w.ws && w.ws.readyState === 1);
      const acc = w.accounts || {};

      // 1. Tài khoản ChatGPT trên worker này
      const chatGptTabCount = w.tabCounts ? (w.tabCounts.chatgpt || 0) : (w.providers.includes(PROVIDERS.CHATGPT) ? 1 : 0);
      const isChatGptTabOpen = chatGptTabCount > 0;
      const chatGptInfo = acc.chatgpt || null;
      const isChatGptBusy = w.activeTasks.has(PROVIDERS.CHATGPT);
      const chatGptTask = w.activeTasks.get(PROVIDERS.CHATGPT);
      const chatGptStats = (w.stats.byProvider && w.stats.byProvider[PROVIDERS.CHATGPT]) || { completed: 0, failed: 0 };

      let chatGptStatus = 'idle';
      if (!isConnected) {
        chatGptStatus = 'offline';
      } else if (!isChatGptTabOpen) {
        chatGptStatus = 'closed';
      } else if (isChatGptBusy) {
        chatGptStatus = 'generating';
      }

      accountList.push({
        id: `${w.id}_chatgpt`,
        provider: PROVIDERS.CHATGPT,
        providerTitle: 'ChatGPT Web',
        workerId: w.id,
        workerName: w.name,
        browser: acc.browser || 'Chrome',
        os: acc.os || 'win',
        accountName: chatGptInfo?.name || chatGptInfo?.email || 'ChatGPT Account',
        accountEmail: chatGptInfo?.email || null,
        hasDetectedAccount: Boolean(chatGptInfo),
        connected: isConnected,
        tabCount: chatGptTabCount,
        hasOpenTab: isChatGptTabOpen,
        status: chatGptStatus,
        currentTaskId: chatGptTask ? chatGptTask.id : null,
        runningMs: chatGptTask?.startedAt ? Date.now() - chatGptTask.startedAt : 0,
        completed: chatGptStats.completed || 0,
        failed: chatGptStats.failed || 0,
        activeSessionId: sessionManager.activeSessions.chatgpt,
        uptimeSeconds: Math.floor((Date.now() - w.connectedAt) / 1000)
      });

      // 2. Tài khoản Google Gemini trên worker này
      const geminiTabCount = w.tabCounts ? (w.tabCounts.gemini || 0) : (w.providers.includes(PROVIDERS.GEMINI) ? 1 : 0);
      const isGeminiTabOpen = geminiTabCount > 0;
      const geminiInfo = acc.gemini || null;
      const isGeminiBusy = w.activeTasks.has(PROVIDERS.GEMINI);
      const geminiTask = w.activeTasks.get(PROVIDERS.GEMINI);
      const geminiStats = (w.stats.byProvider && w.stats.byProvider[PROVIDERS.GEMINI]) || { completed: 0, failed: 0 };

      let geminiStatus = 'idle';
      if (!isConnected) {
        geminiStatus = 'offline';
      } else if (!isGeminiTabOpen) {
        geminiStatus = 'closed';
      } else if (isGeminiBusy) {
        geminiStatus = 'generating';
      }

      accountList.push({
        id: `${w.id}_gemini`,
        provider: PROVIDERS.GEMINI,
        providerTitle: 'Google Gemini',
        workerId: w.id,
        workerName: w.name,
        browser: acc.browser || 'Chrome',
        os: acc.os || 'win',
        accountName: geminiInfo?.name || geminiInfo?.email || 'Google Account',
        accountEmail: geminiInfo?.email || null,
        hasDetectedAccount: Boolean(geminiInfo),
        connected: isConnected,
        tabCount: geminiTabCount,
        hasOpenTab: isGeminiTabOpen,
        status: geminiStatus,
        currentTaskId: geminiTask ? geminiTask.id : null,
        runningMs: geminiTask?.startedAt ? Date.now() - geminiTask.startedAt : 0,
        completed: geminiStats.completed || 0,
        failed: geminiStats.failed || 0,
        activeSessionId: sessionManager.activeSessions.gemini,
        uptimeSeconds: Math.floor((Date.now() - w.connectedAt) / 1000)
      });
    }

    const allActiveTasks = Array.from(this.workers.values()).flatMap(w =>
      Array.from(w.activeTasks.values()).map(t => ({
        id: t.id,
        provider: t.provider,
        workerId: w.id,
        workerName: w.name,
        runningMs: t.startedAt ? Date.now() - t.startedAt : 0
      }))
    );

    const primaryActive = allActiveTasks[0] || null;

    return {
      connected: this.isBridgeReady(),
      workerCount: this.workers.size,
      accountCount: accountList.length,
      activeWorkerCount: workerList.filter(w => w.connected).length,
      accounts: accountList,
      workers: workerList,
      queueLength: this.queue.length,
      currentTaskId: primaryActive ? primaryActive.id : null,
      currentTaskProvider: primaryActive ? primaryActive.provider : null,
      currentTaskRunningMs: primaryActive ? primaryActive.runningMs : 0,
      activeTasks: allActiveTasks,
      stats: { ...this.metrics }
    };
  }
}

module.exports = new TaskQueue();
