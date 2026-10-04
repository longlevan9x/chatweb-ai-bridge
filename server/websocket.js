/**
 * WebSocket Connection Hub & Protocol Router
 * @file server/websocket.js
 * 
 * Manages WebSocket communication with the Chrome Extension:
 * - Connection lifecycle & heartbeats
 * - Browser log forwarding
 * - Bidirectional streaming and result dispatch via TaskQueue
 * - Clean teardown for graceful shutdown
 */

const { WebSocketServer } = require('ws');
const taskQueue = require('./queue');

let wssInstance = null;

function setupWebSocket(server) {
  const wss = new WebSocketServer({ server });
  wssInstance = wss;

  wss.on('error', (err) => {
    if (err.code !== 'EADDRINUSE') {
      console.error('❌ [WebSocket Hub] Server error:', err.message);
    }
  });

  wss.on('connection', (ws, req) => {
    let workerId = null;
    let workerName = null;
    try {
      const parsedUrl = new URL(req.url, 'http://localhost');
      workerId = parsedUrl.searchParams.get('workerId');
      workerName = parsedUrl.searchParams.get('workerName');
    } catch (_) {}

    workerId = workerId || ('worker_' + Math.random().toString(36).substring(2, 8));
    workerName = workerName || `Browser #${workerId.slice(-4)}`;

    console.log(`✅ [Bridge Server] Trình duyệt đã kết nối WebSocket (ID: ${workerId}, Tên: "${workerName}")`);
    taskQueue.registerWorker(workerId, ws, { name: workerName });

    ws.on('message', (raw) => {
      try {
        const data = JSON.parse(raw.toString());

        // 1. Đăng ký thông tin định danh Worker (Browser Profile)
        if (data.action === 'REGISTER_WORKER') {
          const registeredId = (data.workerId && String(data.workerId).trim()) || workerId;
          const registeredName = (data.workerName && String(data.workerName).trim()) || (data.name && String(data.name).trim()) || `Browser #${registeredId.slice(-4)}`;
          const providers = Array.isArray(data.providers) ? data.providers : ['chatgpt', 'gemini'];

          if (registeredId !== workerId) {
            taskQueue.unregisterWorker(workerId, 'Replaced by explicit registration');
            workerId = registeredId;
          }
          const accounts = data.accounts || {};
          const tabCounts = data.tabCounts || null;
          taskQueue.registerWorker(workerId, ws, { name: workerName, providers, accounts, tabCounts });
          console.log(`🏷️ [WebSocket Hub] Cập nhật Worker: "${workerName}" (${workerId}) | Hỗ trợ: [${providers.join(', ')}] | Tabs: ${JSON.stringify(tabCounts || {})}`);
          return;
        }

        // 2. Nhịp tim giữ kết nối
        if (data.action === 'HEARTBEAT') {
          return;
        }

        // 3. Log chuyển tiếp từ tab trình duyệt
        if (data.action === 'LOG') {
          console.log(`🖥️ [${workerName}] ${data.text}`);
          return;
        }

        // 4. Luồng dữ liệu (chunk streaming hoặc hoàn tất) qua TaskQueue
        taskQueue.handleIncomingMessage(data, workerId);
      } catch (e) {
        console.error(`❌ [WebSocket Hub] Lỗi xử lý message từ Worker [${workerName}]:`, e.message);
      }
    });

    ws.on('close', () => {
      console.log(`⚠️ [Bridge Server] Worker [${workerName}] (${workerId}) đã ngắt kết nối.`);
      taskQueue.unregisterWorker(workerId);
    });

    ws.on('error', (err) => {
      console.error(`❌ [WebSocket Hub] Worker socket error [${workerName}]:`, err.message);
    });
  });

  return wss;
}

function closeAllClients() {
  if (!wssInstance) return;
  wssInstance.clients.forEach((client) => {
    try {
      client.terminate();
    } catch (e) {}
  });
}

module.exports = {
  setupWebSocket,
  closeAllClients,
  getWss: () => wssInstance
};
