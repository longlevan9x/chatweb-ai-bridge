/**
 * Centralized Configuration Module
 * @file server/config.js
 * 
 * Extracts all magic numbers, timeouts, and environmental variables into a single source of truth.
 */

const path = require('path');

const config = {
  server: {
    port: parseInt(process.env.PORT, 10) || 9603,
    host: process.env.HOST || '0.0.0.0',
    bodyLimit: process.env.BODY_LIMIT || '50mb'
  },
  queue: {
    maxSize: parseInt(process.env.MAX_QUEUE_SIZE, 10) || 200,
    defaultTimeoutMs: parseInt(process.env.DEFAULT_TIMEOUT_MS, 10) || 60000, // 60s phòng ngừa treo tab lâu
    concurrency: 1
  },
  session: {
    maxTurnsPerSession: parseInt(process.env.MAX_TURNS_PER_SESSION, 10) || 15,
    ttlMs: parseInt(process.env.SESSION_TTL_MS, 10) || 30 * 60 * 1000, // 30 phút
    maxSessions: parseInt(process.env.MAX_SESSIONS, 10) || 2000,
    cleanupIntervalMs: 5 * 60 * 1000
  },
  providers: {
    chatgpt: {
      id: 'chatgpt',
      name: 'ChatGPT Web',
      defaultModel: 'chatgpt',
      models: ['chatgpt', 'gpt-4o', 'gpt-4o-mini', 'o1', 'o3-mini']
    },
    gemini: {
      id: 'gemini',
      name: 'Google Gemini',
      defaultModel: 'gemini',
      models: ['gemini', 'gemini-2.0-flash', 'gemini-1.5-pro', 'gemini-1.5-flash']
    }
  }
};

module.exports = config;
