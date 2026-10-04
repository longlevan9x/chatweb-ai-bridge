/**
 * ChatGPT & Google Gemini Local Web Bridge - Shared Constants
 * @file extension/shared/bridge-constants.js
 * 
 * Hằng số định danh hệ thống, WebSocket Action, Provider ID dùng chung
 * cho cả Service Worker (background), Content Scripts và UI Pages.
 */

(() => {
  const DEFAULT_PORT = 9603;

  const BRIDGE_CONSTANTS = {
    SERVER: {
      DEFAULT_PORT,
      STATUS_PATH: '/status',
      getWsUrl(port = DEFAULT_PORT) {
        return `ws://localhost:${port}`;
      },
      getHttpUrl(port = DEFAULT_PORT) {
        return `http://localhost:${port}`;
      }
    },
    PROVIDERS: {
      CHATGPT: 'chatgpt',
      GEMINI: 'gemini'
    },
    ACTIONS: {
      PING: 'PING',
      ASK: 'ASK',
      STREAM_CHUNK: 'STREAM_CHUNK',
      TASK_RESULT: 'TASK_RESULT',
      TASK_ERROR: 'TASK_ERROR',
      INPUT_SUBMITTED: 'INPUT_SUBMITTED',
      UPDATE_ACCOUNT: 'UPDATE_ACCOUNT',
      GET_STATUS: 'GET_STATUS',
      SET_PORT: 'SET_PORT',
      CONNECT_NOW: 'CONNECT_NOW',
      OPEN_SIDEPANEL: 'OPEN_SIDEPANEL'
    },
    TIMEOUTS: {
      TEXT_INPUT_MUTEX_MS: 15000,
      VISION_INPUT_MUTEX_MS: 60000,
      RESPONSE_WAIT_MS: 180000
    }
  };

  // Hỗ trợ môi trường Node.js (CommonJS), Service Worker (self) và Window context
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = BRIDGE_CONSTANTS;
  }
  if (typeof self !== 'undefined') {
    self.__BRIDGE_CONSTANTS__ = BRIDGE_CONSTANTS;
  }
  if (typeof window !== 'undefined') {
    window.__BRIDGE_CONSTANTS__ = BRIDGE_CONSTANTS;
  }
})();
