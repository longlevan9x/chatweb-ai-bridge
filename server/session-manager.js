/**
 * Multi-Provider Session & Conversation Manager
 * @file server/session-manager.js
 * 
 * Manages hybrid multi-turn conversation memory, provider-specific session isolation,
 * and automatic DOM recycle (preventing browser memory leaks & tab lag).
 * 
 * Key Principles:
 * - Provider Isolation: ChatGPT and Gemini have independent active session tracking.
 * - LRU Session Eviction: Limits memory footprint to maxSessions with TTL cleanup.
 * - Auto-Recycle: Resets thread every N turns (default: 15) to maintain tab responsiveness.
 */

const config = require('./config');

class SessionManager {
  constructor(options = {}) {
    this.maxTurnsPerSession = options.maxTurns || config.session.maxTurnsPerSession;
    this.sessionTtlMs = options.ttl || config.session.ttlMs;
    this.maxSessions = options.maxSessions || config.session.maxSessions;

    /** @type {Map<string, Object>} */
    this.sessions = new Map();

    /**
     * Theo dõi session đang active trên từng nền tảng AI riêng biệt
     * @type {Object<string, string|null>}
     */
    this.activeSessions = {
      chatgpt: null,
      gemini: null
    };

    // Định kỳ dọn dẹp session hết hạn mỗi 5 phút
    this._cleanupInterval = setInterval(() => this.cleanupExpiredSessions(), config.session.cleanupIntervalMs);
    if (this._cleanupInterval.unref) {
      this._cleanupInterval.unref();
    }
  }

  /**
   * Quyết định trạng thái newChat (true/false) dựa trên provider, sessionId và số lượt trao đổi (turn)
   * @param {Object} params
   * @param {string} [params.sessionId] - ID phiên hội thoại (tùy chọn)
   * @param {string} [params.provider='chatgpt'] - Nền tảng AI ('chatgpt' | 'gemini')
   * @param {boolean} [params.explicitNewChat] - Lệnh ép tạo mới từ client (nếu có)
   * @param {number} [params.maxTurns] - Giới hạn số lượt tối đa trước khi tự làm mới
   * @returns {{ sessionId: string|null, provider: string, newChat: boolean, turnCount: number, recycled: boolean, reason?: string }}
   */
  resolveSession({ sessionId = null, provider = 'chatgpt', explicitNewChat = undefined, maxTurns = null }) {
    const turnLimit = Number(maxTurns) || this.maxTurnsPerSession;
    const currentProvider = (provider || 'chatgpt').toLowerCase();

    // Đảm bảo provider có slot theo dõi
    if (!this.activeSessions[currentProvider]) {
      this.activeSessions[currentProvider] = null;
    }

    // 1. Trường hợp không truyền sessionId:
    // Mặc định tạo mới (newChat: true) để giữ DOM sạch và tránh nhiễm chéo ngữ cảnh,
    // trừ khi client chủ động truyền explicitNewChat: false.
    if (!sessionId) {
      const isNewChat = explicitNewChat !== undefined ? explicitNewChat : true;
      if (isNewChat) {
        this.activeSessions[currentProvider] = null;
      }
      return {
        sessionId: null,
        provider: currentProvider,
        newChat: isNewChat,
        turnCount: 1,
        recycled: false,
        reason: isNewChat ? 'no_session_default_new' : 'explicit_reuse'
      };
    }

    const sid = String(sessionId).trim();
    let session = this.sessions.get(sid);
    const now = Date.now();

    // 2. Trường hợp Session chưa tồn tại (Lượt đầu tiên của Session)
    if (!session) {
      this._enforceSessionLimit();

      session = {
        id: sid,
        provider: currentProvider,
        createdAt: now,
        lastActiveAt: now,
        turnCount: 1,
        totalTokens: 0,
        recycleCount: 0,
        workerId: null,
        workerName: null
      };
      this.sessions.set(sid, session);
      this.activeSessions[currentProvider] = sid;

      return {
        sessionId: sid,
        provider: currentProvider,
        newChat: true,
        turnCount: 1,
        recycled: false,
        reason: 'new_session_init'
      };
    }

    // Cập nhật thời điểm tương tác gần nhất
    session.lastActiveAt = now;

    // 3. Trường hợp Session đã tồn tại nhưng có sự đổi chéo giữa các Session TRÊN CÙNG PROVIDER
    // Nếu tab của provider đang ở session A mà có request từ session B -> bắt buộc newChat: true để cách ly!
    const isSwitchedSession = this.activeSessions[currentProvider] !== null && this.activeSessions[currentProvider] !== sid;

    // 4. Client chủ động ép tạo mới hội thoại cho session này
    if (explicitNewChat === true) {
      session.turnCount = 1;
      session.provider = currentProvider;
      this.activeSessions[currentProvider] = sid;
      return {
        sessionId: sid,
        provider: currentProvider,
        newChat: true,
        turnCount: 1,
        recycled: false,
        reason: 'explicit_reset'
      };
    }

    // 5. Kiểm tra cơ chế Tự Động Làm Mới (Auto-Recycle) khi đạt ngưỡng turnLimit
    if (session.turnCount >= turnLimit) {
      session.recycleCount++;
      session.turnCount = 1;
      session.provider = currentProvider;
      this.activeSessions[currentProvider] = sid;

      return {
        sessionId: sid,
        provider: currentProvider,
        newChat: true,
        turnCount: 1,
        recycled: true,
        reason: `auto_recycle_turn_limit_reached (${turnLimit})`
      };
    }

    // 6. Nếu đổi session chéo trên cùng provider: Reset tab mới và bắt đầu đếm lượt lại
    if (isSwitchedSession) {
      session.turnCount = 1;
      session.provider = currentProvider;
      this.activeSessions[currentProvider] = sid;

      return {
        sessionId: sid,
        provider: currentProvider,
        newChat: true,
        turnCount: 1,
        recycled: false,
        reason: 'cross_session_isolation_reset'
      };
    }

    // 7. Tiếp nối ngữ cảnh bình thường (newChat: false)
    session.turnCount++;
    session.provider = currentProvider;
    this.activeSessions[currentProvider] = sid;

    return {
      sessionId: sid,
      provider: currentProvider,
      newChat: false,
      turnCount: session.turnCount,
      recycled: false,
      reason: 'continue_context'
    };
  }

  /**
   * Cập nhật ước lượng số token sử dụng của session
   * @param {string} sessionId
   * @param {number} estimatedTokens
   */
  recordUsage(sessionId, estimatedTokens = 0) {
    if (!sessionId) return;
    const session = this.sessions.get(String(sessionId).trim());
    if (session) {
      session.totalTokens = (session.totalTokens || 0) + estimatedTokens;
      session.lastActiveAt = Date.now();
    }
  }

  /**
   * Lấy thông tin chi tiết một session
   * @param {string} sessionId
   */
  getSession(sessionId) {
    if (!sessionId) return null;
    return this.sessions.get(String(sessionId).trim()) || null;
  }

  /**
   * Gán một worker (trình duyệt) & tài khoản chịu trách nhiệm phục vụ session này
   * @param {string} sessionId
   * @param {string} workerId
   * @param {string|null} [workerName=null]
   * @param {string|null} [account=null]
   */
  setSessionWorker(sessionId, workerId, workerName = null, account = null) {
    if (!sessionId) return;
    const session = this.sessions.get(String(sessionId).trim());
    if (session) {
      session.workerId = workerId;
      if (workerName) session.workerName = workerName;
      if (account) session.account = account;
      session.lastActiveAt = Date.now();
    }
  }

  /**
   * Lấy ID worker đang quản lý session này
   * @param {string} sessionId
   * @returns {string|null}
   */
  getSessionWorker(sessionId) {
    if (!sessionId) return null;
    const session = this.sessions.get(String(sessionId).trim());
    return session ? session.workerId || null : null;
  }

  /**
   * Lấy danh sách toàn bộ các session hiện có kèm định danh worker và tài khoản quản lý
   */
  listSessions() {
    const list = [];
    for (const [id, s] of this.sessions.entries()) {
      list.push({
        id,
        provider: s.provider || 'chatgpt',
        workerId: s.workerId || null,
        workerName: s.workerName || null,
        account: s.account || null,
        turnCount: s.turnCount,
        recycleCount: s.recycleCount,
        totalTokens: s.totalTokens,
        createdAt: new Date(s.createdAt).toISOString(),
        lastActiveAt: new Date(s.lastActiveAt).toISOString(),
        isActiveChatGPT: this.activeSessions.chatgpt === id,
        isActiveGemini: this.activeSessions.gemini === id
      });
    }
    return list;
  }

  /**
   * Xóa một session cụ thể
   * @param {string} sessionId
   */
  deleteSession(sessionId) {
    if (!sessionId) return false;
    const sid = String(sessionId).trim();
    if (this.activeSessions.chatgpt === sid) this.activeSessions.chatgpt = null;
    if (this.activeSessions.gemini === sid) this.activeSessions.gemini = null;
    return this.sessions.delete(sid);
  }

  /**
   * Xóa toàn bộ sessions
   */
  clearAllSessions() {
    const count = this.sessions.size;
    this.sessions.clear();
    this.activeSessions = { chatgpt: null, gemini: null };
    return count;
  }

  /**
   * Giới hạn kích thước bộ nhớ (LRU eviction)
   */
  _enforceSessionLimit() {
    if (this.sessions.size >= this.maxSessions) {
      // Tìm session có lastActiveAt cũ nhất để xóa
      let oldestKey = null;
      let oldestTime = Infinity;

      for (const [id, s] of this.sessions.entries()) {
        if (s.lastActiveAt < oldestTime) {
          oldestTime = s.lastActiveAt;
          oldestKey = id;
        }
      }

      if (oldestKey) {
        this.deleteSession(oldestKey);
      }
    }
  }

  /**
   * Tự động dọn dẹp các session không hoạt động quá TTL
   */
  cleanupExpiredSessions() {
    const now = Date.now();
    let cleaned = 0;

    for (const [id, session] of this.sessions.entries()) {
      if (now - session.lastActiveAt > this.sessionTtlMs) {
        this.deleteSession(id);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      console.log(`🧹 [SessionManager] Đã dọn dẹp ${cleaned} session hết hạn.`);
    }
  }

  /**
   * Getter tương thích ngược cho activeSessionId
   */
  get activeSessionId() {
    return this.activeSessions.chatgpt || this.activeSessions.gemini || null;
  }

  /**
   * Ước tính số token từ độ dài văn bản (quy tắc 4 chars ~ 1 token)
   * @param {string} text
   * @returns {number}
   */
  estimateTokens(text = '') {
    return Math.ceil(String(text || '').length / 4);
  }
}

module.exports = new SessionManager();
