/**
 * Universal Chat Completions Router (/v1/chat/completions)
 * @file server/routes/chat-completions.js
 * 
 * Implements standard OpenAI Chat Completions & Models specification for all providers (ChatGPT, Google Gemini):
 * - GET  /models and /v1/models
 * - POST /chat/completions and /v1/chat/completions (supports streaming SSE & non-streaming)
 */

'use strict';

const express = require('express');
const router = express.Router();
const taskQueue = require('../queue');
const sessionManager = require('../session-manager');
const { resolveProvider } = require('./ask');
const config = require('../config');
const { OPENAI, HTTP_STATUS } = require('../constants');
const { extractMessageContent, extractMessageImages, resolveImages } = require('../image-handler');

// 1. Danh sách Models — sinh động từ config.providers (nguồn chân lý duy nhất)
router.get('/models', (req, res) => {
  const now = Math.floor(Date.now() / 1000);
  const data = Object.values(config.providers).flatMap(p =>
    p.models.map(id => ({
      id,
      object: OPENAI.OBJECT_MODEL,
      created: now,
      owned_by: `${p.id}-web-bridge`
    }))
  );
  res.json({ object: OPENAI.OBJECT_LIST, data });
});

// 2. Chat Completions (OpenAI Compatible Protocol)
router.post('/chat/completions', async (req, res) => {
  const { messages, model = OPENAI.DEFAULT_MODEL, provider = null, stream = false, sessionId = null, user = null, newChat, maxTurns, images: customImages } = req.body;

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(HTTP_STATUS.BAD_REQUEST).json({
      error: { message: 'Tham số messages là bắt buộc và phải là mảng.', type: 'invalid_request_error' }
    });
  }

  if (!taskQueue.isBridgeReady()) {
    return res.status(HTTP_STATUS.SERVICE_UNAVAILABLE).json({
      error: { message: 'ChatGPT/Gemini Web Bridge chưa kết nối trình duyệt.', type: 'server_error' }
    });
  }

  const targetProvider = resolveProvider(provider, model);
  const sid = sessionId || user || req.headers['x-session-id'] || null;
  const sessionResolution = sessionManager.resolveSession({
    sessionId: sid,
    provider: targetProvider,
    explicitNewChat: newChat,
    maxTurns
  });

  // Trích xuất hình ảnh từ messages và body
  const rawImages = extractMessageImages(messages);
  if (Array.isArray(customImages)) {
    rawImages.push(...customImages);
  }
  const resolvedImages = await resolveImages(rawImages);

  // Tổng hợp nội dung prompt thuần (không gắn tiền tố [User], [System])
  let prompt = '';
  if (sessionResolution.newChat) {
    prompt = messages
      .map(m => extractMessageContent(m.content))
      .filter(Boolean)
      .join('\n\n');
  } else {
    const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
    prompt = extractMessageContent(lastUserMsg ? lastUserMsg.content : messages[messages.length - 1].content);
  }

  // Nếu người dùng chỉ gửi ảnh mà không gõ text, đặt prompt mặc định hợp lý
  if (!prompt && resolvedImages.length > 0) {
    prompt = 'Hãy mô tả hoặc phân tích hình ảnh đính kèm này giúp tôi.';
  }

  if (!prompt) {
    return res.status(HTTP_STATUS.BAD_REQUEST).json({
      error: { message: 'Nội dung tin nhắn (prompt) hoặc hình ảnh không được để trống.', type: 'invalid_request_error' }
    });
  }

  const completionId = `chatcmpl-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
  const createdTimestamp = Math.floor(Date.now() / 1000);

  const abortController = new AbortController();
  req.on('aborted', () => {
    abortController.abort();
  });

  if (stream) {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    // Chunk mở đầu
    const rolePayload = {
      id: completionId,
      object: OPENAI.OBJECT_CHAT_CHUNK,
      created: createdTimestamp,
      model,
      choices: [{ index: 0, delta: { role: OPENAI.ROLE_ASSISTANT, content: '' }, finish_reason: null }]
    };
    res.write(`data: ${JSON.stringify(rolePayload)}\n\n`);

    try {
      const result = await taskQueue.enqueue({
        id: completionId,
        sessionId: sessionResolution.sessionId,
        prompt,
        images: resolvedImages,
        provider: targetProvider,
        newChat: sessionResolution.newChat,
        stream: true,
        signal: abortController.signal,
        onChunk: (chunk) => {
          if (!res.writableEnded) {
            const chunkPayload = {
              id: completionId,
              object: OPENAI.OBJECT_CHAT_CHUNK,
              created: createdTimestamp,
              model,
              choices: [{ index: 0, delta: { content: chunk }, finish_reason: null }]
            };
            res.write(`data: ${JSON.stringify(chunkPayload)}\n\n`);
          }
        }
      });

      sessionManager.recordUsage(sessionResolution.sessionId, sessionManager.estimateTokens(prompt) + sessionManager.estimateTokens(result.answer));

      if (!res.writableEnded) {
        const finishPayload = {
          id: completionId,
          object: OPENAI.OBJECT_CHAT_CHUNK,
          created: createdTimestamp,
          model,
          choices: [{ index: 0, delta: {}, finish_reason: OPENAI.FINISH_REASON_STOP }],
          worker: {
            id: result.workerId || null,
            name: result.workerName || null
          }
        };
        res.write(`data: ${JSON.stringify(finishPayload)}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
      }
    } catch (err) {
      if (!res.writableEnded) {
        res.write(`data: ${JSON.stringify({ error: { message: err.message } })}\n\n`);
        res.end();
      }
    }
  } else {
    // Non-streaming response
    try {
      const result = await taskQueue.enqueue({
        id: completionId,
        sessionId: sessionResolution.sessionId,
        prompt,
        images: resolvedImages,
        provider: targetProvider,
        newChat: sessionResolution.newChat,
        stream: false,
        signal: abortController.signal
      });

      sessionManager.recordUsage(sessionResolution.sessionId, sessionManager.estimateTokens(prompt) + sessionManager.estimateTokens(result.answer));

      if (result.workerId) {
        res.setHeader('X-Bridge-Worker-Id', result.workerId);
      }
      if (result.workerName) {
        res.setHeader('X-Bridge-Worker-Name', encodeURIComponent(result.workerName));
      }

      res.json({
        id: completionId,
        object: OPENAI.OBJECT_CHAT_COMPLETION,
        created: createdTimestamp,
        model,
        choices: [{
          index: 0,
          message: {
            role: OPENAI.ROLE_ASSISTANT,
            content: result.answer
          },
          finish_reason: OPENAI.FINISH_REASON_STOP
        }],
        usage: {
          prompt_tokens: sessionManager.estimateTokens(prompt),
          completion_tokens: sessionManager.estimateTokens(result.answer),
          total_tokens: sessionManager.estimateTokens(prompt) + sessionManager.estimateTokens(result.answer)
        },
        session: {
          id: sessionResolution.sessionId,
          provider: targetProvider,
          turn: sessionResolution.turnCount,
          recycled: sessionResolution.recycled,
          workerId: result.workerId || null,
          workerName: result.workerName || null
        }
      });
    } catch (err) {
      if (abortController.signal.aborted) return;
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        error: { message: err.message, type: 'api_error' }
      });
    }
  }
});

module.exports = router;
