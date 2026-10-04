/**
 * CLI utility functions: fuzzy matching, autocomplete, banner, help
 * @file server/tests/lib/utils.js
 */

'use strict';

const { C, COMMANDS } = require('./constants');

// ============================================================================
// LEVENSHTEIN FUZZY MATCHING
// ============================================================================
function levenshtein(a, b) {
  const matrix = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) matrix[i][0] = i;
  for (let j = 0; j <= b.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }
  return matrix[a.length][b.length];
}

/**
 * Tra cứu lệnh theo exact → prefix → fuzzy Levenshtein
 * @param {string} input
 * @returns {string|null}
 */
function suggestCommand(input) {
  if (!input) return null;
  const raw = input.toLowerCase().replace(/^-+/, '').trim();
  if (!raw) return null;

  // 1. Exact / alias
  const exact = COMMANDS.find(c => c.name === raw || c.alias?.includes(raw));
  if (exact) return exact.name;

  // 2. Prefix
  const prefix = COMMANDS.find(c => c.name.startsWith(raw) || c.alias?.some(a => a.startsWith(raw)));
  if (prefix) return prefix.name;

  // 3. Fuzzy Levenshtein (dung sai 2 ký tự)
  let best = null;
  let minDist = 3;
  for (const cmd of COMMANDS) {
    const d = levenshtein(raw, cmd.name);
    if (d < minDist) { minDist = d; best = cmd.name; }
  }
  return best;
}

/** Tab autocomplete callback cho readline */
function completer(line) {
  const trimmed = line.trimStart();
  const hits = COMMANDS.map(c => c.name).filter(c => c.startsWith(trimmed));
  return [hits.length ? hits : COMMANDS.map(c => c.name), trimmed];
}

// ============================================================================
// UI: BANNER & HELP
// ============================================================================
function showBanner() {
  console.log(`\n${C.bold}${C.cyan}╔══════════════════════════════════════════════════════════════════╗${C.reset}`);
  console.log(`${C.bold}${C.cyan}║         ⚡ CHATGPT BRIDGE TEST RUNNER & DIAGNOSTICS             ║${C.reset}`);
  console.log(`${C.bold}${C.cyan}╚══════════════════════════════════════════════════════════════════╝${C.reset}`);
}

function showHelp() {
  console.log(`\n${C.bold}📘 GIẢI THÍCH CHI TIẾT CÁC BÀI KIỂM THỬ (TEST SUITE):${C.reset}`);
  console.log(`${C.gray}════════════════════════════════════════════════════════════════════════════════${C.reset}`);

  // Nhóm 1: Kịch bản test tự động
  console.log(`\n${C.bold}${C.magenta}【 NHÓM 1: CÁC KỊCH BẢN TEST TỰ ĐỘNG 】${C.reset}`);
  ['single', 'stream', 'context', 'session', 'gemini', 'stress', 'openai', 'all'].forEach(name => {
    const cmd = COMMANDS.find(c => c.name === name);
    if (!cmd) return;
    console.log(`\n${C.bold}${C.green}▶ Lệnh: ${cmd.name.toUpperCase()}${C.reset} ${cmd.alias?.length ? C.gray + `(alias: ${cmd.alias.join(', ')})` + C.reset : ''}`);
    console.log(`  ${C.cyan}Mô tả:${C.reset}         ${cmd.desc}`);
    console.log(`  ${C.yellow}🎯 Mục đích:${C.reset}    ${cmd.target}`);
    console.log(`  ${C.dim}⚙️ Cơ chế:${C.reset}      ${cmd.mechanism}`);
    if (cmd.useCase)      console.log(`  ${C.blue}💡 Ứng dụng:${C.reset}    ${cmd.useCase}`);
    if (cmd.passCriteria) console.log(`  ${C.green}🔍 Tiêu chí ĐẠT:${C.reset} ${cmd.passCriteria}`);
  });

  // Nhóm 2: Dữ liệu mẫu & So sánh AI
  console.log(`\n${C.bold}${C.magenta}【 NHÓM 2: DỮ LIỆU MẪU CÓ SẴN (PRESETS) & SO SÁNH AI 】${C.reset}`);
  ['preset', 'compare'].forEach(name => {
    const cmd = COMMANDS.find(c => c.name === name);
    if (!cmd) return;
    console.log(`\n${C.bold}${C.yellow}▶ Lệnh: ${cmd.name.toUpperCase()}${C.reset} ${cmd.alias?.length ? C.gray + `(alias: ${cmd.alias.join(', ')})` + C.reset : ''}`);
    console.log(`  ${C.cyan}Mô tả:${C.reset}         ${cmd.desc}`);
    console.log(`  ${C.yellow}🎯 Mục đích:${C.reset}    ${cmd.target}`);
    console.log(`  ${C.dim}⚙️ Cơ chế:${C.reset}      ${cmd.mechanism}`);
    if (cmd.useCase) console.log(`  ${C.blue}💡 Ứng dụng:${C.reset}    ${cmd.useCase}`);
  });

  // Nhóm 3: Công cụ tương tác
  console.log(`\n${C.bold}${C.magenta}【 NHÓM 3: CÔNG CỤ TƯƠNG TÁC & CHẨN ĐOÁN 】${C.reset}`);
  ['chat', 'health', 'clear', 'help', 'exit'].forEach(name => {
    const cmd = COMMANDS.find(c => c.name === name);
    if (!cmd) return;
    console.log(`\n${C.bold}${C.cyan}▶ Lệnh: ${cmd.name.toUpperCase()}${C.reset} ${cmd.alias?.length ? C.gray + `(alias: ${cmd.alias.join(', ')})` + C.reset : ''}`);
    console.log(`  ${C.dim}Mô tả:${C.reset}         ${cmd.desc}`);
    if (cmd.target) console.log(`  ${C.yellow}Mục đích:${C.reset}    ${cmd.target}`);
  });

  console.log(`\n${C.gray}════════════════════════════════════════════════════════════════════════════════${C.reset}`);
  console.log(`${C.bold}Cách sử dụng linh hoạt:${C.reset}`);
  console.log(`  • Chạy trực tiếp từ CMD:   ${C.cyan}npm test single${C.reset}, ${C.cyan}npm test stream${C.reset}, ${C.cyan}npm test openai${C.reset}, ${C.cyan}npm test all${C.reset}`);
  console.log(`  • Chế độ tương tác:        Chạy ${C.cyan}npm test${C.reset} rồi nhấn phím ${C.bold}TAB${C.reset} để tự động điền lệnh.`);
  console.log(`  • Gõ tắt có sửa lỗi:       ${C.cyan}npm test strm${C.reset} ➡️ Tự động gợi ý và chạy ${C.bold}stream${C.reset}.\n`);
}

module.exports = { levenshtein, suggestCommand, completer, showBanner, showHelp };
