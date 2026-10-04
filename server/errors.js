/**
 * Custom Domain Error Classes
 * @file server/errors.js
 * 
 * Provides typed, structured error classes with HTTP status codes and error codes
 * for predictable error handling across the entire stack.
 */

class BridgeError extends Error {
  constructor(message, statusCode = 500, code = 'BRIDGE_ERROR') {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

class BridgeNotConnectedError extends BridgeError {
  constructor(message = 'Chrome Extension chưa kết nối WebSocket với Server. Vui lòng mở Chrome.') {
    super(message, 503, 'BRIDGE_NOT_CONNECTED');
  }
}

class TaskTimeoutError extends BridgeError {
  constructor(timeoutMs = 180000) {
    super(`Quá thời gian chờ phản hồi từ trình duyệt (${timeoutMs / 1000}s).`, 504, 'TASK_TIMEOUT');
  }
}

class QueueOverloadError extends BridgeError {
  constructor(maxSize = 200) {
    super(`Hàng đợi đã đầy (${maxSize} tác vụ). Vui lòng thử lại sau.`, 429, 'QUEUE_OVERLOAD');
  }
}

class InvalidPromptError extends BridgeError {
  constructor(message = 'Tham số prompt không hợp lệ hoặc bị rỗng.') {
    super(message, 400, 'INVALID_PROMPT');
  }
}

class TaskCancelledError extends BridgeError {
  constructor(reason = 'Tác vụ đã bị hủy bởi client.') {
    super(reason, 499, 'TASK_CANCELLED');
  }
}

module.exports = {
  BridgeError,
  BridgeNotConnectedError,
  TaskTimeoutError,
  QueueOverloadError,
  InvalidPromptError,
  TaskCancelledError
};
