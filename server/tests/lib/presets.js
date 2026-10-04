/**
 * Preset test fixtures and compare runner
 * @file server/tests/lib/presets.js
 */

'use strict';

const readline = require('readline');
const { BASE_URL, C } = require('./constants');

/** Bộ dữ liệu mẫu chuẩn hóa theo chủ đề */
const PRESETS = [
  {
    id: '1', key: 'coding',
    category: 'Lập trình & Thuật toán',
    title: 'TypeScript Debounce Fn',
    prompt: 'Viết một hàm TypeScript debounce tối ưu có hỗ trợ cancel và immediate invocation, giải thích ngắn gọn 2 câu.'
  },
  {
    id: '2', key: 'logic',
    category: 'Tư duy Logic & Đố vui',
    title: 'Bài toán chở đồ qua sông',
    prompt: 'Một người nông dân cần mang một con sói, một con dê và một bắp cải qua sông bằng một thuyền nhỏ (chở tối đa người và 1 thứ). Sói ăn dê nếu vắng người, dê ăn bắp cải nếu vắng người. Trình bày ngắn gọn các bước qua sông an toàn.'
  },
  {
    id: '3', key: 'summary',
    category: 'Tóm tắt & Kiến trúc',
    title: 'So sánh Event-Driven vs REST',
    prompt: 'So sánh ngắn gọn 3 ưu điểm và 3 nhược điểm lớn nhất của kiến trúc Event-Driven so với REST API theo dạng gạch đầu dòng.'
  },
  {
    id: '4', key: 'translate',
    category: 'Dịch thuật kỹ thuật số',
    title: 'Technical Translation (Vi -> En)',
    prompt: 'Dịch câu sau sang tiếng Anh tự nhiên theo văn phong chuyên gia phần mềm: "Hệ thống tự động điều phối hàng đợi và phân tán tải trọng giữa các tiến trình worker nhằm ngăn ngừa tắc nghẽn bộ nhớ."'
  },
  {
    id: '5', key: 'creative',
    category: 'Soạn thảo & Email công việc',
    title: 'Báo cáo nghiệm thu dự án',
    prompt: 'Viết một đoạn email chuyên nghiệp ngắn gửi Giám đốc Kỹ thuật (CTO) thông báo đã hoàn tất kiểm thử tải và tích hợp thành công cầu nối AI Bridge kép giữa ChatGPT và Google Gemini.'
  }
];

function _findPreset(key) {
  const k = String(key).toLowerCase();
  return PRESETS.find(p => p.id === k || p.key === k || p.key.includes(k));
}

function showPresetMenu() {
  console.log(`\n${C.bold}${C.cyan}╔══════════════════════════════════════════════════════════════════╗${C.reset}`);
  console.log(`${C.bold}${C.cyan}║             📦 DANH MỤC DỮ LIỆU KIỂM THỬ MẪU TẠO SẴN             ║${C.reset}`);
  console.log(`${C.bold}${C.cyan}╚══════════════════════════════════════════════════════════════════╝${C.reset}`);
  PRESETS.forEach(p => {
    console.log(`  ${C.bold}${C.green}[${p.id}]${C.reset} ${C.yellow}${p.title.padEnd(30)}${C.reset} ${C.dim}(${p.category})${C.reset}`);
    console.log(`      ${C.gray}Prompt:${C.reset} "${p.prompt.slice(0, 75)}..."`);
  });
  console.log(`\n${C.bold}💡 Cú pháp chạy nhanh:${C.reset}`);
  console.log(`  - Chạy theo số:           ${C.cyan}npm test preset 1${C.reset} (hoặc ${C.cyan}npm test preset 1 gemini${C.reset})`);
  console.log(`  - Chạy theo từ khóa:      ${C.cyan}npm test preset coding${C.reset} | ${C.cyan}npm test preset logic${C.reset}`);
  console.log(`  - So sánh trực tiếp 2 AI: ${C.cyan}npm test compare 1${C.reset} (ChatGPT vs Gemini)\n`);
}

/**
 * Chạy một preset với provider cụ thể
 * @param {string|null} presetArg  - ID hoặc keyword
 * @param {string}      providerArg - 'chatgpt' | 'gemini'
 */
async function runPresetTest(presetArg = null, providerArg = 'chatgpt') {
  if (!presetArg) { showPresetMenu(); return; }

  const selected = _findPreset(presetArg);
  if (!selected) {
    console.log(`\n${C.red}❌ Không tìm thấy bộ dữ liệu mẫu nào khớp với "${presetArg}".${C.reset}`);
    showPresetMenu();
    return;
  }

  const provider = (providerArg?.toLowerCase() === 'gemini' || providerArg?.toLowerCase() === 'google') ? 'gemini' : 'chatgpt';
  console.log(`\n${C.bold}${C.cyan}▶ [Preset #${selected.id}: ${selected.title}]${C.reset} ➡️ Provider: ${provider === 'gemini' ? C.cyan : C.green}${provider.toUpperCase()}${C.reset}`);
  console.log(`  ${C.dim}Chủ đề:${C.reset} ${selected.category}`);
  console.log(`  ${C.dim}Prompt:${C.reset} "${selected.prompt}"\n`);

  const t0 = Date.now();
  process.stdout.write(`${C.yellow}⏳ Đang gửi request tới ${provider.toUpperCase()}...${C.reset}`);

  try {
    const res = await fetch(`${BASE_URL}/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: selected.prompt, provider, newChat: false, timeout: 90000 })
    });
    const elapsed = ((Date.now() - t0) / 1000).toFixed(2);
    readline.clearLine(process.stdout, 0);
    readline.cursorTo(process.stdout, 0);

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Server error');

    const speed = (data.answer.length / (parseFloat(elapsed) || 1)).toFixed(1);
    console.log(`${C.green}✅ Nhận câu trả lời hoàn tất sau ${elapsed}s (${speed} ký tự/s):${C.reset}`);
    console.log(`${C.gray}------------------------------------------------------------${C.reset}`);
    console.log(data.answer);
    console.log(`${C.gray}------------------------------------------------------------${C.reset}`);
    console.log(`${C.dim}📊 Thống kê: Provider: ${data.provider?.toUpperCase()} | Độ dài: ${data.answer.length} ký tự${C.reset}\n`);
    return true;
  } catch (err) {
    readline.clearLine(process.stdout, 0);
    readline.cursorTo(process.stdout, 0);
    console.log(`${C.red}❌ Lỗi: ${err.message}${C.reset}\n`);
    return false;
  }
}

/**
 * So sánh cùng một câu hỏi giữa ChatGPT và Google Gemini
 * @param {string|null} inputArg - preset ID/key hoặc câu hỏi tự do
 */
async function runCompareTest(inputArg = null) {
  let promptToUse;
  let title = 'Tự do';

  const preset = inputArg ? _findPreset(inputArg) : PRESETS[0];
  if (preset) {
    promptToUse = preset.prompt;
    title = preset.title;
  } else {
    promptToUse = inputArg || PRESETS[0].prompt;
  }

  console.log(`\n${C.bold}${C.magenta}╔══════════════════════════════════════════════════════════════════╗${C.reset}`);
  console.log(`${C.bold}${C.magenta}║       ⚔️ SO SÁNH ĐỐI ĐẦU TRỰC TIẾP: CHATGPT VS GOOGLE GEMINI     ║${C.reset}`);
  console.log(`${C.bold}${C.magenta}╚══════════════════════════════════════════════════════════════════╝${C.reset}`);
  console.log(`  ${C.yellow}📌 Chủ đề:${C.reset} ${title}`);
  console.log(`  ${C.dim}📤 Prompt:${C.reset} "${promptToUse}"\n`);

  const results = {};

  // 1. ChatGPT
  console.log(`${C.bold}${C.green}1. Đang gửi tới ChatGPT Web...${C.reset}`);
  const t1 = Date.now();
  try {
    const res1 = await fetch(`${BASE_URL}/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: promptToUse, provider: 'chatgpt', newChat: false, timeout: 90000 })
    });
    const d1 = await res1.json();
    const e1 = ((Date.now() - t1) / 1000).toFixed(2);
    results.chatgpt = { success: res1.ok, elapsed: e1, length: d1.answer?.length || 0, answer: d1.answer };
    console.log(`   ${C.green}✓ ChatGPT hoàn thành sau ${e1}s (${results.chatgpt.length} ký tự)${C.reset}`);
  } catch (err) {
    results.chatgpt = { success: false, error: err.message };
    console.log(`   ${C.red}✗ ChatGPT lỗi: ${err.message}${C.reset}`);
  }

  // 2. Gemini
  console.log(`\n${C.bold}${C.cyan}2. Đang gửi tới Google Gemini Web...${C.reset}`);
  const t2 = Date.now();
  try {
    const res2 = await fetch(`${BASE_URL}/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: promptToUse, provider: 'gemini', newChat: false, timeout: 90000 })
    });
    const d2 = await res2.json();
    const e2 = ((Date.now() - t2) / 1000).toFixed(2);
    results.gemini = { success: res2.ok, elapsed: e2, length: d2.answer?.length || 0, answer: d2.answer };
    console.log(`   ${C.cyan}✓ Google Gemini hoàn thành sau ${e2}s (${results.gemini.length} ký tự)${C.reset}`);
  } catch (err) {
    results.gemini = { success: false, error: err.message };
    console.log(`   ${C.red}✗ Google Gemini lỗi: ${err.message}${C.reset}`);
  }

  // 3. Bảng so sánh
  console.log(`\n${C.bold}════════════════════ BẢNG KẾT QUẢ SO SÁNH ════════════════════${C.reset}`);
  if (results.chatgpt?.success) {
    console.log(`\n${C.green}${C.bold}[CHATGPT WEB] (Thời gian: ${results.chatgpt.elapsed}s | ${results.chatgpt.length} ký tự):${C.reset}`);
    console.log(results.chatgpt.answer.slice(0, 400) + (results.chatgpt.length > 400 ? '...\n[Xem tiếp trong tab ChatGPT]' : ''));
  }
  if (results.gemini?.success) {
    console.log(`\n${C.cyan}${C.bold}[GOOGLE GEMINI WEB] (Thời gian: ${results.gemini.elapsed}s | ${results.gemini.length} ký tự):${C.reset}`);
    console.log(results.gemini.answer.slice(0, 400) + (results.gemini.length > 400 ? '...\n[Xem tiếp trong tab Gemini]' : ''));
  }
  console.log(`\n${C.bold}══════════════════════════════════════════════════════════════════${C.reset}\n`);
}

module.exports = { PRESETS, showPresetMenu, runPresetTest, runCompareTest };
