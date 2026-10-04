/**
 * Multimodal Image Handler for ChatGPT & Gemini Web AI Bridge
 * @file server/image-handler.js
 */

'use strict';

/**
 * Trích xuất text từ message content (chuẩn OpenAI Chat Completions)
 * @param {string|Array|any} content
 * @returns {string}
 */
function extractMessageContent(content) {
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) {
    return content
      .map(part => (part && typeof part.text === 'string' ? part.text.trim() : ''))
      .filter(Boolean)
      .join('\n');
  }
  return content ? String(content).trim() : '';
}

/**
 * Trích xuất danh sách ảnh từ messages (chuẩn OpenAI Vision API)
 * @param {Array} messages
 * @returns {Array<string>}
 */
function extractMessageImages(messages) {
  const images = [];
  if (!Array.isArray(messages)) return images;

  for (const m of messages) {
    if (!m || !m.content) continue;
    if (Array.isArray(m.content)) {
      for (const part of m.content) {
        if (!part) continue;
        if (part.type === 'image_url' && part.image_url) {
          const url = typeof part.image_url === 'string' ? part.image_url : part.image_url.url;
          if (url && typeof url === 'string') images.push(url.trim());
        } else if (part.type === 'input_image' && part.image_url) {
          const url = typeof part.image_url === 'string' ? part.image_url : part.image_url.url;
          if (url && typeof url === 'string') images.push(url.trim());
        }
      }
    }
  }
  return images;
}

/**
 * Chuẩn hóa 1 ảnh sang Data URL Base64 (data:image/...;base64,...)
 * Nếu là URL http/https thì tải về và mã hóa Base64
 * @param {string} imgInput
 * @returns {Promise<string|null>}
 */
async function resolveImageToDataUrl(imgInput) {
  if (!imgInput || typeof imgInput !== 'string') return null;
  const str = imgInput.trim();

  // Đã là Data URL hợp lệ
  if (str.startsWith('data:image/')) {
    return str;
  }

  // Tải từ HTTP/HTTPS
  if (str.startsWith('http://') || str.startsWith('https://')) {
    try {
      const res = await fetch(str, { signal: AbortSignal.timeout(12000) });
      if (res.ok) {
        const mime = res.headers.get('content-type') || 'image/png';
        const buf = await res.arrayBuffer();
        const base64 = Buffer.from(buf).toString('base64');
        return `data:${mime};base64,${base64}`;
      }
    } catch (e) {
      console.error('⚠️ [Image Handler] Không thể tải ảnh từ URL:', str, e.message);
    }
  }

  // Chuỗi Base64 trần (chưa có prefix data:image/png;base64,)
  if (/^[A-Za-z0-9+/=]{50,}$/.test(str)) {
    return `data:image/png;base64,${str}`;
  }

  return null;
}

/**
 * Xử lý song song mảng ảnh
 * @param {Array<string>} images
 * @returns {Promise<Array<string>>}
 */
async function resolveImages(images) {
  if (!Array.isArray(images) || images.length === 0) return [];
  const results = await Promise.all(images.map(resolveImageToDataUrl));
  return results.filter(Boolean);
}

module.exports = {
  extractMessageContent,
  extractMessageImages,
  resolveImageToDataUrl,
  resolveImages
};
