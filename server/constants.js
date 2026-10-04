/**
 * Centralized Application Constants
 * @file server/constants.js
 * 
 * Standardizes all action types, providers, event names, HTTP statuses, and protocol formats.
 */

'use strict';

const PROVIDERS = Object.freeze({
  CHATGPT: 'chatgpt',
  GEMINI: 'gemini'
});

const ACTIONS = Object.freeze({
  ASK: 'ASK',
  CANCEL_TASK: 'CANCEL_TASK',
  PING: 'PING',
  PONG: 'PONG',
  TASK_RESULT: 'TASK_RESULT',
  STREAM_CHUNK: 'STREAM_CHUNK',
  LOG: 'LOG'
});

const TASK_STATUS = Object.freeze({
  SUCCESS: 'success',
  ERROR: 'error',
  TIMEOUT: 'timeout',
  CANCELLED: 'cancelled'
});

const QUEUE_EVENTS = Object.freeze({
  TASK_ENQUEUED: 'task_enqueued',
  TASK_STARTED: 'task_started',
  TASK_COMPLETED: 'task_completed',
  TASK_FAILED: 'task_failed',
  TASK_CANCELLED: 'task_cancelled'
});

const HTTP_STATUS = Object.freeze({
  OK: 200,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  NOT_FOUND: 404,
  INTERNAL_SERVER_ERROR: 500,
  SERVICE_UNAVAILABLE: 503
});

const OPENAI = Object.freeze({
  DEFAULT_MODEL: 'gpt-4o',
  OBJECT_CHAT_COMPLETION: 'chat.completion',
  OBJECT_CHAT_CHUNK: 'chat.completion.chunk',
  OBJECT_MODEL: 'model',
  OBJECT_LIST: 'list',
  FINISH_REASON_STOP: 'stop',
  ROLE_USER: 'user',
  ROLE_ASSISTANT: 'assistant',
  ROLE_SYSTEM: 'system'
});

const GEMINI = Object.freeze({
  DEFAULT_MODEL: 'gemini-2.0-flash',
  FINISH_REASON_STOP: 'STOP',
  ROLE_USER: 'user',
  ROLE_MODEL: 'model'
});

module.exports = {
  PROVIDERS,
  ACTIONS,
  TASK_STATUS,
  QUEUE_EVENTS,
  HTTP_STATUS,
  OPENAI,
  GEMINI
};
