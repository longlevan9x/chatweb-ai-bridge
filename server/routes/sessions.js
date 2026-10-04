/**
 * Session Lifecycle Management Router
 * @file server/routes/sessions.js
 */

const express = require('express');
const router = express.Router();
const sessionManager = require('../session-manager');

// 1. Lấy danh sách session đang active và trạng thái tổng quan
router.get('/sessions', (req, res) => {
  res.json({
    activeSessions: sessionManager.activeSessions,
    maxTurnsPerSession: sessionManager.maxTurnsPerSession,
    sessions: sessionManager.listSessions()
  });
});

// 2. Xóa thủ công một session cụ thể
router.delete('/sessions/:id', (req, res) => {
  const deleted = sessionManager.deleteSession(req.params.id);
  res.json({ success: deleted, sessionId: req.params.id });
});

// 3. Xóa toàn bộ sessions để giải phóng hoàn toàn bộ nhớ
router.delete('/sessions', (req, res) => {
  const count = sessionManager.clearAllSessions();
  res.json({ success: true, clearedCount: count });
});

module.exports = router;
