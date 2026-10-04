/**
 * Universal Test Runner & Interactive CLI – Entry Point
 * @file server/tests/test-runner.js
 *
 * Kiến trúc module:
 *   lib/constants.js  – C (màu ANSI), COMMANDS, BASE_URL
 *   lib/utils.js      – levenshtein, suggestCommand, completer, showBanner, showHelp
 *   lib/presets.js    – PRESETS, showPresetMenu, runPresetTest, runCompareTest
 *   lib/tests.js      – runSingleTest … runAllTests, runInteractiveChat, checkBridgeHealth
 */

'use strict';

const readline = require('readline');
const { C, COMMANDS } = require('./lib/constants');
const { suggestCommand, completer, showBanner, showHelp } = require('./lib/utils');
const { runPresetTest, runCompareTest } = require('./lib/presets');
const {
  checkBridgeHealth,
  clearServerQueue,
  runSingleTest, runStreamTest, runContextTest,
  runStressTest, runOpenAITest, runSessionTest,
  runGeminiTest, runAllTests, runInteractiveChat
} = require('./lib/tests');

// ============================================================================
// DISPATCHER: Ánh xạ tên lệnh → hàm thực thi
// ============================================================================
async function executeCommand(cmdName, extraArgs = []) {
  const isGeminiRequested = extraArgs.some(a => ['gemini', 'google'].includes(a.toLowerCase()));
  const targetProvider = isGeminiRequested ? 'gemini' : 'chatgpt';

  switch (cmdName) {
    case 'all':         return runAllTests(targetProvider);
    case 'single':      return runSingleTest(targetProvider);
    case 'stream':      return runStreamTest(targetProvider);
    case 'context':     return runContextTest(targetProvider);
    case 'session':     return runSessionTest(targetProvider);
    case 'stress':      return runStressTest(targetProvider);
    case 'openai':      return runOpenAITest(isGeminiRequested ? 'gemini' : 'chatgpt');
    case 'health':      return checkBridgeHealth();
    case 'clear-queue':
    case 'clearqueue':
    case 'cq':
    case 'reset-queue': return clearServerQueue();
    case 'help':        return showHelp();
    case 'clear':       console.clear(); return showBanner();
    case 'exit':        return process.exit(0);

    case 'gemini': {
      const firstArg = extraArgs[0]?.toLowerCase();
      if (firstArg === 'all') {
        return runAllTests('gemini');
      }
      if (['single', 'stream', 'context', 'session', 'stress', 'openai'].includes(firstArg)) {
        return executeCommand(firstArg, ['gemini', ...extraArgs.slice(1)]);
      }
      return runGeminiTest(extraArgs.length > 0 ? extraArgs.join(' ').trim() : null);
    }

    case 'preset':
      return runPresetTest(extraArgs[0], extraArgs[1]);

    case 'compare':
      return runCompareTest(extraArgs.join(' ') || null);

    case 'chat': {
      const p = extraArgs[0]?.toLowerCase();
      return runInteractiveChat((p === 'gemini' || p === 'google') ? 'gemini' : 'chatgpt');
    }

    default: {
      const suggestion = suggestCommand(cmdName);
      console.log(`\n${C.red}❌ Không tìm thấy lệnh "${cmdName}".${C.reset}`);
      if (suggestion) {
        console.log(`💡 ${C.yellow}Có phải bạn muốn chạy lệnh: ${C.bold}"${suggestion}"${C.reset}${C.yellow}?${C.reset}`);
      }
      console.log(`${C.dim}Gõ "help" hoặc nhấn TAB để xem danh sách gợi ý các lệnh có sẵn.${C.reset}\n`);
    }
  }
}

// ============================================================================
// INTERACTIVE REPL (khi không có args)
// ============================================================================
function startInteractiveRepl() {
  showBanner();
  console.log(`${C.dim}Nhập lệnh hoặc nhấn ${C.bold}TAB${C.reset}${C.dim} để tự động gợi ý. Gõ "help" để xem menu, "exit" để thoát.${C.reset}\n`);

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, completer });

  const promptNext = () => {
    rl.question(`${C.bold}${C.cyan}bridge-test> ${C.reset}`, async (line) => {
      const parts = line.trim().split(/\s+/);
      const [input, ...extra] = parts;
      if (input) {
        const matched = suggestCommand(input) || input.toLowerCase();
        await executeCommand(matched, extra);
      }
      promptNext();
    });
  };

  promptNext();
}

// ============================================================================
// MAIN ENTRY
// ============================================================================
const args = process.argv.slice(2);
if (args.length > 0) {
  const [rawArg, ...extraArgs] = args;

  const matched = suggestCommand(rawArg);
  if (matched) {
    executeCommand(matched, extraArgs);
  } else {
    showBanner();
    console.log(`\n${C.red}❌ Lệnh không hợp lệ: "${rawArg}"${C.reset}`);
    const hint = suggestCommand(rawArg);
    if (hint) console.log(`💡 ${C.yellow}Gợi ý: Có phải bạn muốn chạy: "npm test ${hint}"?${C.reset}`);
    showHelp();
  }
} else {
  startInteractiveRepl();
}
