/**
 * Web Dashboard & System Diagnostics Router
 * @file server/routes/dashboard.js
 */

const express = require('express');
const path = require('path');
const fs = require('fs');
const router = express.Router();
const taskQueue = require('../queue');
const sessionManager = require('../session-manager');

const DASHBOARD_HTML_PATH = path.join(__dirname, '../views/dashboard.html');

function getDashboardHtml() {
  return fs.readFileSync(DASHBOARD_HTML_PATH, 'utf8');
}

// 1. Health check & Diagnostics metrics endpoint
function buildDiagnosticsPayload() {
  return {
    status: 'ok',
    ...taskQueue.getMetrics(),
    activeSessions: sessionManager.activeSessions,
    totalActiveSessions: sessionManager.sessions.size,
    sessionList: sessionManager.listSessions(),
    timestamp: new Date().toISOString()
  };
}

router.get('/status', (req, res) => {
  res.json(buildDiagnosticsPayload());
});

// Alias for metrics
router.get('/metrics', (req, res) => {
  res.json(buildDiagnosticsPayload());
});

// Session list endpoint
router.get(['/sessions', '/api/sessions'], (req, res) => {
  res.json({
    status: 'ok',
    total: sessionManager.sessions.size,
    sessions: sessionManager.listSessions()
  });
});

// Delete specific session
router.delete(['/sessions/:id', '/api/sessions/:id'], (req, res) => {
  const success = sessionManager.deleteSession(req.params.id);
  res.json({ status: success ? 'ok' : 'not_found', deleted: success, id: req.params.id });
});

// Clear all sessions
router.post(['/sessions/clear', '/api/sessions/clear'], (req, res) => {
  const count = sessionManager.clearAllSessions();
  res.json({ status: 'ok', clearedCount: count });
});

// 2. Clear Queue API
router.post(['/queue/clear', '/api/queue/clear'], (req, res) => {
  const result = taskQueue.clearQueue(req.body?.reason || 'Cleared via Dashboard UI');
  res.json({
    status: 'ok',
    message: `Đã dọn sạch hàng đợi. Hủy ${result.cancelledCount} task chờ và ${result.cancelledRunning ? 1 : 0} task đang chạy.`,
    ...result
  });
});

// 3. Web Dashboard UI
router.get(['/', '/dashboard'], (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.send(getDashboardHtml());
});

module.exports = router;
