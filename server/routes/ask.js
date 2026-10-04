/**
 * Core Ask & Streaming SSE API Router
 * @file server/routes/ask.js
 */

const express = require('express');
const router = express.Router();
const taskQueue = require('../queue');
const sessionManager = require('../session-manager');
const config = require('../config');
const { PROVIDERS, HTTP_STATUS } = require('../constants');
const { InvalidPromptError, BridgeNotConnectedError } = require('../errors');
const { resolveImages } = require('../image-handler');

// Helper: Phân tích provider từ request
function resolveProvider(providerParam, modelParam) {
  if (providerParam && typeof providerParam === 'string') {
    const p = providerParam.toLowerCase().trim();
    if (p === 'gemini' || p === 'google') return PROVIDERS.GEMINI;
    return PROVIDERS.CHATGPT;
  }
  if (modelParam && typeof modelParam === 'string' && modelParam.toLowerCase().includes('gemini')) {
    return PROVIDERS.GEMINI;
  }
  return PROVIDERS.CHATGPT;
}

// 1. API hỏi đơn lẻ / batch tuần tự kèm Session Manager & Provider Routing
router.post(['/ask', '/chat/conversations', '/conversations'], async (req, res) => {
  let prompt = req.body.prompt || req.body.message;
  if (!prompt && Array.isArray(req.body.messages) && req.body.messages.length > 0) {
    const lastUser = [...req.body.messages].reverse().find(m => m.role === 'user');
    prompt = lastUser ? lastUser.content : req.body.messages[req.body.messages.length - 1].content;
  }

  const { provider = null, model = null, sessionId = null, conversationId = null, conversation_id = null, newChat, maxTurns, timeout = config.queue.defaultTimeoutMs, images = null, image = null } = req.body;

  const rawImages = Array.isArray(images) ? images : (image ? [image] : []);
  const resolvedImages = await resolveImages(rawImages);

  if ((!prompt || typeof prompt !== 'string' || !prompt.trim()) && resolvedImages.length > 0) {
    prompt = 'Hãy mô tả hoặc phân tích hình ảnh đính kèm này giúp tôi.';
  }

  if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
    const err = new InvalidPromptError();
    return res.status(err.statusCode).json({ error: err.message, code: err.code });
  }

  if (!taskQueue.isBridgeReady()) {
    const err = new BridgeNotConnectedError();
    return res.status(err.statusCode).json({ error: err.message, code: err.code });
  }

  const targetProvider = resolveProvider(provider, model);
  const sid = sessionId || conversationId || conversation_id;
  const sessionResolution = sessionManager.resolveSession({
    sessionId: sid,
    provider: targetProvider,
    explicitNewChat: newChat,
    maxTurns
  });

  const requestId = 'req_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
  console.log(`\n📨 [Queue] Tiếp nhận: "${prompt.slice(0, 40)}..." (ID: ${requestId}, Provider: ${targetProvider.toUpperCase()}, Session: ${sessionResolution.sessionId || 'None'}, Turn: ${sessionResolution.turnCount}, newChat: ${sessionResolution.newChat})`);

  // Hỗ trợ AbortController khi client chủ động ngắt kết nối HTTP
  const abortController = new AbortController();
  req.on('aborted', () => {
    abortController.abort();
  });

  try {
    const result = await taskQueue.enqueue({
      id: requestId,
      sessionId: sessionResolution.sessionId,
      prompt: prompt.trim(),
      images: resolvedImages,
      provider: targetProvider,
      newChat: sessionResolution.newChat,
      timeout,
      signal: abortController.signal
    });

    sessionManager.recordUsage(sessionResolution.sessionId, sessionManager.estimateTokens(prompt) + sessionManager.estimateTokens(result.answer));

    if (result.workerId) {
      res.setHeader('X-Bridge-Worker-Id', result.workerId);
    }
    if (result.workerName) {
      res.setHeader('X-Bridge-Worker-Name', encodeURIComponent(result.workerName));
    }

    console.log(`✅ [Queue] Xử lý xong task ${requestId} (${targetProvider.toUpperCase()}) qua [${result.workerName || result.workerId || 'Worker'}]`);
    return res.json({
      ...result,
      provider: targetProvider,
      conversationId: sessionResolution.sessionId,
      conversation_id: sessionResolution.sessionId,
      session: {
        id: sessionResolution.sessionId,
        turn: sessionResolution.turnCount,
        recycled: sessionResolution.recycled,
        reason: sessionResolution.reason,
        workerId: result.workerId || null,
        workerName: result.workerName || null
      }
    });
  } catch (error) {
    if (abortController.signal.aborted) {
      console.log(`⚠️ [Queue] Client đã hủy kết nối cho task ${requestId}`);
      return;
    }
    console.error(`❌ [Queue] Thất bại task ${requestId}:`, error.message);
    return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: error.message });
  }
});

// 2. API Streaming Real-time qua Server-Sent Events (SSE)
router.post(['/ask/stream', '/chat/conversations/stream', '/conversations/stream'], async (req, res) => {
  let prompt = req.body.prompt || req.body.message;
  if (!prompt && Array.isArray(req.body.messages) && req.body.messages.length > 0) {
    const lastUser = [...req.body.messages].reverse().find(m => m.role === 'user');
    prompt = lastUser ? lastUser.content : req.body.messages[req.body.messages.length - 1].content;
  }

  const { provider = null, model = null, sessionId = null, conversationId = null, conversation_id = null, newChat, maxTurns, timeout = config.queue.defaultTimeoutMs, images = null, image = null } = req.body;

  const rawImages = Array.isArray(images) ? images : (image ? [image] : []);
  const resolvedImages = await resolveImages(rawImages);

  if ((!prompt || typeof prompt !== 'string' || !prompt.trim()) && resolvedImages.length > 0) {
    prompt = 'Hãy mô tả hoặc phân tích hình ảnh đính kèm này giúp tôi.';
  }

  if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
    const err = new InvalidPromptError();
    return res.status(err.statusCode).json({ error: err.message, code: err.code });
  }

  if (!taskQueue.isBridgeReady()) {
    const err = new BridgeNotConnectedError();
    return res.status(err.statusCode).json({ error: err.message, code: err.code });
  }

  const targetProvider = resolveProvider(provider, model);
  const sid = sessionId || conversationId || conversation_id;
  const sessionResolution = sessionManager.resolveSession({
    sessionId: sid,
    provider: targetProvider,
    explicitNewChat: newChat,
    maxTurns
  });

  // Thiết lập SSE Headers
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  // Bắn metadata phiên hội thoại đầu stream
  res.write(`data: ${JSON.stringify({
    status: 'session_init',
    provider: targetProvider,
    session: {
      id: sessionResolution.sessionId,
      turn: sessionResolution.turnCount,
      recycled: sessionResolution.recycled,
      reason: sessionResolution.reason
    }
  })}\n\n`);

  const requestId = 'req_stream_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);

  const abortController = new AbortController();
  req.on('aborted', () => {
    abortController.abort();
  });

  try {
    const result = await taskQueue.enqueue({
      id: requestId,
      sessionId: sessionResolution.sessionId,
      prompt: prompt.trim(),
      images: resolvedImages,
      provider: targetProvider,
      newChat: sessionResolution.newChat,
      stream: true,
      timeout,
      signal: abortController.signal,
      onChunk: (chunk, fullText) => {
        if (!res.writableEnded) {
          res.write(`data: ${JSON.stringify({ chunk, fullText })}\n\n`);
        }
      }
    });

    sessionManager.recordUsage(sessionResolution.sessionId, sessionManager.estimateTokens(prompt) + sessionManager.estimateTokens(result.answer));

    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify({
        status: 'done',
        answer: result.answer,
        provider: targetProvider,
        workerId: result.workerId || null,
        workerName: result.workerName || null,
        session: {
          id: sessionResolution.sessionId,
          turn: sessionResolution.turnCount,
          recycled: sessionResolution.recycled,
          workerId: result.workerId || null,
          workerName: result.workerName || null
        }
      })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    }
  } catch (err) {
    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify({ status: 'error', error: err.message })}\n\n`);
      res.end();
    }
  }
});

module.exports = { router, resolveProvider };
