/**
 * ChatGPT & Google Gemini Local Web Bridge Server v2.1
 * @file server/server.js
 * 
 * Enterprise-grade local AI proxy bridging browsers to standard AI client interfaces.
 * Modular Senior Architecture:
 * - /routes/ask.js             : REST /ask and SSE /ask/stream
 * - /routes/chat-completions.js  : /v1/chat/completions and /v1/models (Universal Unified AI Protocol)
 * - /routes/sessions.js          : Multi-turn session lifecycle management
 * - /routes/dashboard.js         : Web UI Dashboard & Health Metrics
 * - /websocket.js                : Browser WebSocket Hub & Protocol Router
 * - /views/dashboard.html        : Decoupled UI presentation layer
 */

const express = require('express');
const http = require('http');
const config = require('./config');
const { setupWebSocket, closeAllClients } = require('./websocket');
const { router: askRouter } = require('./routes/ask');
const chatCompletionsRouter = require('./routes/chat-completions');
const sessionRouter = require('./routes/sessions');
const dashboardRouter = require('./routes/dashboard');

const app = express();
app.use(express.json({ limit: config.server.bodyLimit }));

// 1. CORS Headers cho mọi công cụ bên thứ ba (Cursor, Cline, LangChain, Web UI)
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, X-Session-Id');
  res.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// 2. Bảo mật API Key cho môi trường Online (tự động kích hoạt khi có API_KEY)
function apiKeyAuthMiddleware(req, res, next) {
  if (!config.auth?.apiKey) {
    return next(); // Dev mode (không cấu hình API_KEY): cho phép truy cập tự do
  }

  const authHeader = req.headers.authorization;
  let token = null;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.slice(7).trim();
  } else if (req.query && req.query.key) {
    token = req.query.key;
  }

  if (!token || token !== config.auth.apiKey) {
    return res.status(401).json({
      error: {
        message: 'Invalid or missing API key. Please provide valid Bearer token in Authorization header.',
        type: 'invalid_request_error',
        code: 'invalid_api_key'
      }
    });
  }

  next();
}

// 3. Đăng ký các tầng Route Module (Dashboard công khai, API bảo vệ bởi Auth)
app.use(dashboardRouter);
app.use(apiKeyAuthMiddleware);
app.use(askRouter);
app.use('/v1', chatCompletionsRouter);
app.use(chatCompletionsRouter); // Hỗ trợ cả /chat/completions không cần tiền tố /v1
app.use(sessionRouter);

// 3. Global Error Handler Middleware
app.use((err, req, res, next) => {
  console.error('❌ [Server Error]:', err.stack || err.message);
  const statusCode = err.statusCode || 500;
  res.status(statusCode).json({
    error: {
      message: err.message || 'Internal Server Error',
      code: err.code || 'INTERNAL_ERROR'
    }
  });
});

// 4. Khởi tạo HTTP Server & WebSocket Hub
const server = http.createServer(app);
setupWebSocket(server);

// 5. Cơ chế tắt ứng dụng an toàn (Graceful Shutdown)
let isShuttingDown = false;

function gracefulShutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`\n🛑 Nhận tín hiệu ${signal}. Đang đóng các kết nối Bridge Server an toàn...`);

  closeAllClients();

  server.close(() => {
    console.log('✅ Server đã đóng toàn bộ kết nối và thoát an toàn.');
    process.exit(0);
  });

  setTimeout(() => {
    console.error('⚠️ Đóng server quá thời gian cho phép, cưỡng bức dừng.');
    process.exit(1);
  }, 4000).unref();
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// 6. Lắng nghe Port & Xử lý lỗi EADDRINUSE
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : config.server.port;

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n❌ CỔNG ${PORT} ĐÃ BỊ CHIẾM DỤNG (EADDRINUSE)!`);
    console.error(`👉 Hiện tại cổng ${PORT} đang được sử dụng bởi một ứng dụng khác.`);
    console.error(`👉 Bạn có thể giải phóng cổng hoặc đổi sang cổng khác bằng:`);
    console.error(`   PORT=3001 npm start`);
    process.exit(1);
  } else {
    console.error('❌ Lỗi Server:', err.message);
  }
});

server.listen(PORT, () => {
  console.log(`========================================================================`);
  console.log(`🚀 ChatGPT & Gemini Local Web Bridge v2.1 đang chạy: http://localhost:${PORT}`);
  console.log(`📊 Web Dashboard & Live Test: http://localhost:${PORT}/`);
  console.log(`------------------------------------------------------------------------`);
  console.log(`🎯 ENDPOINTS CHUẨN CHUNG (Tự động định tuyến ChatGPT & Google Gemini):`);
  console.log(`   1. POST http://localhost:${PORT}/v1/chat/completions (hoặc /chat/completions)`);
  console.log(`      👉 Body: { "model": "chatgpt" | "gemini", "messages": [...] }`);
  console.log(`   2. POST http://localhost:${PORT}/ask (và /chat/conversations)`);
  console.log(`      👉 Body: { "prompt": "...", "provider": "chatgpt" | "gemini" }`);
  console.log(`========================================================================`);
});

module.exports = { app, server };
