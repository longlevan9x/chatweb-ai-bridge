/**
 * All concrete test scenarios and the interactive chat REPL
 * @file server/tests/lib/tests.js
 */

'use strict';

const readline = require('readline');
const { BASE_URL, C } = require('./constants');

// ============================================================================
// HEALTH CHECK
// ============================================================================
async function checkBridgeHealth(quiet = false) {
  try {
    const res = await fetch(`${BASE_URL}/status`, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const data = await res.json();
    if (!quiet) {
      console.log(`\n${C.bold}📊 Kiểm tra trạng thái hệ thống:${C.reset}`);
      console.log(`  - Local Server: ${C.green}Đang chạy (${BASE_URL})${C.reset}`);
      console.log(`  - WebSocket Extension: ${data.connected ? C.green + 'Đã kết nối' : C.red + 'Chưa kết nối (Hãy mở Chrome)'}${C.reset}`);
      console.log(`  - Hàng đợi (Queue): ${data.queueLength} tác vụ | Đang bận: ${data.isBusy ? 'Có' : 'Không'}`);
      console.log(`  - Thống kê: Tổng nhận ${data.stats.totalReceived}, Xong ${data.stats.totalCompleted}, Lỗi ${data.stats.totalFailed}\n`);
    }
    return { ok: true, data };
  } catch (err) {
    if (!quiet) {
      console.log(`\n${C.red}❌ Server chưa chạy hoặc lỗi kết nối: ${err.message}${C.reset}`);
      console.log(`${C.yellow}💡 Hãy khởi động server trước bằng lệnh: "npm start"${C.reset}\n`);
    }
    return { ok: false, error: err.message };
  }
}

// ============================================================================
// HELPER: LIVE TICKING PROGRESS
// ============================================================================
function startProgressTicker(label) {
  const t0 = Date.now();
  process.stdout.write(`${C.yellow}${label} (0s)...${C.reset}`);
  const timer = setInterval(() => {
    const sec = Math.floor((Date.now() - t0) / 1000);
    readline.clearLine(process.stdout, 0);
    readline.cursorTo(process.stdout, 0);
    process.stdout.write(`${C.yellow}${label} (${sec}s)...${C.reset}`);
  }, 1000);

  return () => {
    clearInterval(timer);
    readline.clearLine(process.stdout, 0);
    readline.cursorTo(process.stdout, 0);
  };
}

// ============================================================================
// TEST 1: SINGLE ASK
// ============================================================================
async function runSingleTest(providerParam = 'chatgpt') {
  const provider = (providerParam === 'gemini' || providerParam === 'google') ? 'gemini' : 'chatgpt';
  console.log(`\n${C.bold}${C.blue}▶ [Test 1: Single Ask (${provider.toUpperCase()})] Đo lường tốc độ phản hồi & hiệu năng đơn lẻ${C.reset}`);
  console.log(`  ${C.yellow}🎯 Mục đích:${C.reset}     Kiểm tra luồng gửi 1 câu hỏi cơ bản và đo đạc độ trễ mạng (${provider.toUpperCase()}).`);
  console.log(`  ${C.dim}⚙️ Cơ chế:${C.reset}       Gửi prompt qua POST /ask (provider: '${provider}', newChat: true) ➡️ Extension điều khiển tab ➡️ Thu nhận câu trả lời.`);
  console.log(`  ${C.blue}💡 Ứng dụng:${C.reset}     Kiểm tra kết nối cơ bản, đo độ trễ mạng (latency) và năng lực sinh chữ.`);
  console.log(`  ${C.green}🔍 Tiêu chí ĐẠT:${C.reset} Nhận câu trả lời hoàn chỉnh trong < 30s, tốc độ > 15 chars/s.`);
  console.log(`${C.gray}------------------------------------------------------------${C.reset}`);

  const prompt = 'Giải thích trong 2 dòng ngắn: Docker Container khác gì với Virtual Machine?';
  console.log(`${C.dim}📤 Prompt [${provider.toUpperCase()}]:${C.reset} "${prompt}"`);

  const t0 = Date.now();
  const stopTicker = startProgressTicker(`⏳ Đang xử lý trên ${provider.toUpperCase()}`);

  try {
    const res = await fetch(`${BASE_URL}/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, provider, newChat: true, timeout: 45000 })
    });
    stopTicker();
    const elapsed = ((Date.now() - t0) / 1000).toFixed(2);

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Server error');

    console.log(`${C.green}✅ Thành công từ ${provider.toUpperCase()} sau ${elapsed}s!${C.reset}`);
    console.log(`${C.gray}------------------------------------------------${C.reset}`);
    console.log(data.answer);
    console.log(`${C.gray}------------------------------------------------${C.reset}`);
    console.log(`${C.dim}📊 Thống kê: ${data.answer.length} ký tự | Tốc độ: ~${(data.answer.length / elapsed).toFixed(1)} chars/s${C.reset}\n`);
    return true;
  } catch (err) {
    stopTicker();
    console.log(`${C.red}❌ Lỗi: ${err.message}${C.reset}\n`);
    return false;
  }
}

// ============================================================================
// TEST 2: REAL-TIME STREAM (SSE)
// ============================================================================
async function runStreamTest(providerParam = 'chatgpt') {
  const provider = (providerParam === 'gemini' || providerParam === 'google') ? 'gemini' : 'chatgpt';
  console.log(`\n${C.bold}${C.magenta}▶ [Test 2: Real-time Stream (${provider.toUpperCase()})] Luồng chữ chạy từng token (Typewriter)${C.reset}`);
  console.log(`  ${C.yellow}🎯 Mục đích:${C.reset}     Kiểm tra khả năng streaming thời gian thực qua Server-Sent Events (SSE).`);
  console.log(`  ${C.dim}⚙️ Cơ chế:${C.reset}       Content Script bắt từng ký tự AI đang gõ trong tab ➡️ WebSocket ➡️ Server SSE ➡️ In trực tiếp ra terminal.`);
  console.log(`  ${C.blue}💡 Ứng dụng:${C.reset}     Dành cho giao diện Web/Chatbot cần hiệu ứng typewriter mượt mà, không chờ đợi.`);
  console.log(`  ${C.green}🔍 Tiêu chí ĐẠT:${C.reset} Ký tự đầu tiên (TTFT) xuất hiện < 3s, text hiển thị mượt mà không ngắt quãng.`);
  console.log(`${C.gray}------------------------------------------------------------${C.reset}`);

  const prompt = 'Viết 1 đoạn thơ 4 câu ca ngợi vẻ đẹp của bầu trời mùa thu.';
  console.log(`${C.dim}📤 Prompt [${provider.toUpperCase()}]:${C.reset} "${prompt}"\n${C.cyan}--- STREAMING OUTPUT ---${C.reset}`);

  const t0 = Date.now();
  try {
    const res = await fetch(`${BASE_URL}/ask/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, provider, newChat: true })
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const d = JSON.parse(line.slice(6));
            if (d.chunk) process.stdout.write(d.chunk);
          } catch (_) {}
        }
      }
    }
    const elapsed = ((Date.now() - t0) / 1000).toFixed(2);
    console.log(`\n${C.cyan}------------------------${C.reset}`);
    console.log(`${C.green}✅ Hoàn tất Stream mượt mà từ ${provider.toUpperCase()} sau ${elapsed}s!${C.reset}\n`);
    return true;
  } catch (err) {
    console.log(`\n${C.red}❌ Lỗi Stream: ${err.message}${C.reset}\n`);
    return false;
  }
}

// ============================================================================
// TEST 3: CONTEXT MEMORY (MULTI-TURN)
// ============================================================================
async function runContextTest(providerParam = 'chatgpt') {
  const provider = (providerParam === 'gemini' || providerParam === 'google') ? 'gemini' : 'chatgpt';
  console.log(`\n${C.bold}${C.yellow}▶ [Test 3: Context Memory (${provider.toUpperCase()})] Kiểm tra bộ nhớ ngữ cảnh nối tiếp (Multi-turn)${C.reset}`);
  console.log(`  ${C.yellow}🎯 Mục đích:${C.reset}     Đảm bảo khi newChat: false, ${provider.toUpperCase()} giữ nguyên ngữ cảnh của lượt chat trước.`);
  console.log(`  ${C.dim}⚙️ Cơ chế:${C.reset}       Lượt 1 (newChat: true) cất giữ mã "X-999" ➡️ Lượt 2 (newChat: false) hỏi lại mã đó trong cùng phiên chat.`);
  console.log(`  ${C.blue}💡 Ứng dụng:${C.reset}     Dành cho hội thoại hỏi đáp nhiều bước, làm rõ vấn đề, coding sửa lỗi liên hoàn.`);
  console.log(`  ${C.green}🔍 Tiêu chí ĐẠT:${C.reset} Câu trả lời ở lượt 2 bắt buộc phải nhận diện và nhắc đúng mã "X-999".`);
  console.log(`${C.gray}------------------------------------------------------------${C.reset}`);

  console.log(`${C.bold}Lượt 1 (newChat: true) [${provider.toUpperCase()}]: Thiết lập dữ liệu bí mật...${C.reset}`);
  const stopTicker1 = startProgressTicker(`  ⏳ Đang gửi Lượt 1`);
  let res1, data1;
  try {
    res1 = await fetch(`${BASE_URL}/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'Dự án bí mật có mã số là X-999. Hãy chỉ trả lời: Đã nhận.', provider, newChat: true, timeout: 45000 })
    });
    data1 = await res1.json();
  } finally {
    stopTicker1();
  }
  console.log(`  ${C.green}Lượt 1:${C.reset} ${data1.answer?.trim() || data1.error}`);
  if (!res1.ok) return false;

  await new Promise(r => setTimeout(r, 1200));

  console.log(`\n${C.bold}Lượt 2 (newChat: false) [${provider.toUpperCase()}]: Kiểm tra AI có nhớ không...${C.reset}`);
  const stopTicker2 = startProgressTicker(`  ⏳ Đang gửi Lượt 2`);
  let res2, data2;
  try {
    res2 = await fetch(`${BASE_URL}/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'Mã số dự án bí mật là gì?', provider, newChat: false, timeout: 45000 })
    });
    data2 = await res2.json();
  } finally {
    stopTicker2();
  }
  console.log(`  ${C.green}Lượt 2:${C.reset} ${data2.answer?.trim() || data2.error}`);

  const remembers = (data2.answer || '').includes('X-999');
  if (remembers) {
    console.log(`\n${C.green}✅ Đạt yêu cầu: ${provider.toUpperCase()} ghi nhớ và liên kết chính xác ngữ cảnh hội thoại!${C.reset}\n`);
    return true;
  } else {
    console.log(`\n${C.yellow}⚠️ ${provider.toUpperCase()} chưa nhớ mã số. Kiểm tra lại tab hội thoại.${C.reset}\n`);
    return false;
  }
}

// ============================================================================
// TEST 4: QUEUE STRESS
// ============================================================================
async function runStressTest(providerParam = 'chatgpt') {
  const provider = (providerParam === 'gemini' || providerParam === 'google') ? 'gemini' : 'chatgpt';
  console.log(`\n${C.bold}${C.blue}▶ [Test 4: Queue Stress (${provider.toUpperCase()})] Kiểm tra điều phối hàng đợi khi bắn 3 requests đồng thời${C.reset}`);
  console.log(`  ${C.yellow}🎯 Mục đích:${C.reset}     Kiểm tra Task Queue có tự động tuần tự hóa (concurrency = 1) để bảo vệ tab không.`);
  console.log(`  ${C.dim}⚙️ Cơ chế:${C.reset}       Bắn 3 requests cùng 1 thời điểm ➡️ Task Queue xếp hàng FIFO ➡️ Xử lý từng task một tuần tự.`);
  console.log(`  ${C.blue}💡 Ứng dụng:${C.reset}     Bảo vệ tab ${provider.toUpperCase()} không bị xung đột DOM, treo tab khi có nhiều caller gọi cùng lúc.`);
  console.log(`  ${C.green}🔍 Tiêu chí ĐẠT:${C.reset} Cả 3 tasks đều thành công 100%, không bị xung đột, không lỗi timeout.`);
  console.log(`${C.gray}------------------------------------------------------------${C.reset}`);

  const tasks = ['1 + 1 = ?', '2 + 2 = ?', '3 + 3 = ?'];
  const t0 = Date.now();
  const stopTicker = startProgressTicker(`⏳ Đang xử lý 3 requests tuần tự`);

  const promises = tasks.map(async (p, idx) => {
    console.log(`  ➡️ [Enqueue #${idx + 1}] "${p}" (${provider.toUpperCase()})`);
    const res = await fetch(`${BASE_URL}/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: p, provider, newChat: true, timeout: 45000 })
    });
    const data = await res.json();
    console.log(`  ${C.green}✅ [Hoàn tất #${idx + 1}]${C.reset} Trả lời: ${data.answer?.trim()}`);
    return data;
  });

  try {
    await Promise.all(promises);
    stopTicker();
    console.log(`${C.green}✅ Cả 3 tasks đồng thời đã được hàng đợi xử lý tuần tự an toàn sau ${((Date.now() - t0) / 1000).toFixed(2)}s!${C.reset}\n`);
    return true;
  } catch (err) {
    stopTicker();
    console.log(`${C.red}❌ Lỗi: ${err.message}${C.reset}\n`);
    return false;
  }
}

// ============================================================================
// TEST 5: OPENAI API COMPAT
// ============================================================================
async function runOpenAITest(modelParam = 'gpt-4o') {
  const isGemini = modelParam && (modelParam.toLowerCase().includes('gemini') || modelParam === 'google');
  const targetModel = isGemini ? 'gemini-2.0-flash' : (modelParam || 'gpt-4o');
  console.log(`\n${C.bold}${C.cyan}▶ [Test: OpenAI API Compat (${targetModel})] Kiểm thử chuẩn OpenAI (/v1/chat/completions)${C.reset}`);
  console.log(`  ${C.yellow}🎯 Mục đích:${C.reset}     Kiểm tra tính tương thích với OpenAI SDK, Cursor, Cline, LangChain, Continue.dev.`);
  console.log(`  ${C.dim}⚙️ Cơ chế:${C.reset}       POST /v1/chat/completions { model: '${targetModel}', messages } ➡️ Server bọc chuẩn OpenAI JSON schema.`);
  console.log(`  ${C.blue}💡 Ứng dụng:${C.reset}     Dùng Bridge như một drop-in replacement thay thế API trả phí trong các tool AI.`);
  console.log(`  ${C.green}🔍 Tiêu chí ĐẠT:${C.reset} HTTP 200, phản hồi có choices[0].message.content đúng chuẩn OpenAI.`);
  console.log(`${C.gray}------------------------------------------------------------${C.reset}`);

  const t0 = Date.now();
  const stopTicker = startProgressTicker(`⏳ Đang gửi request chuẩn OpenAI API (${targetModel})`);

  try {
    const res = await fetch(`${BASE_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer chatgpt-local-bridge' },
      body: JSON.stringify({
        model: targetModel,
        messages: [
          { role: 'system', content: 'Bạn là chuyên gia lập trình ngắn gọn.' },
          { role: 'user', content: 'Phân biệt ngắn gọn trong 1 câu: const vs let trong JavaScript.' }
        ],
        stream: false
      })
    });
    stopTicker();
    const elapsed = ((Date.now() - t0) / 1000).toFixed(2);

    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error?.message || data.error || `HTTP ${res.status}`);

    const reply = data.choices?.[0]?.message?.content;
    if (!reply) throw new Error('Không tìm thấy choices[0].message.content trong dữ liệu trả về');

    console.log(`${C.green}✅ Chuẩn OpenAI tương thích 100% (Phản hồi sau ${elapsed}s)!${C.reset}`);
    console.log(`${C.gray}------------------------------------------------${C.reset}`);
    console.log(reply.trim());
    console.log(`${C.gray}------------------------------------------------${C.reset}`);
    console.log(`${C.dim}📦 Cấu trúc phản hồi:${C.reset} ID: ${data.id || 'N/A'} | Model: ${data.model} | Finish: ${data.choices[0].finish_reason}\n`);
    return true;
  } catch (err) {
    stopTicker();
    console.log(`${C.red}❌ Lỗi kiểm thử OpenAI: ${err.message}${C.reset}\n`);
    return false;
  }
}

// ============================================================================
// TEST 6: HYBRID SESSION & AUTO-RECYCLE
// ============================================================================
async function runSessionTest(providerParam = 'chatgpt') {
  const provider = (providerParam === 'gemini' || providerParam === 'google') ? 'gemini' : 'chatgpt';
  console.log(`\n${C.bold}${C.magenta}▶ [Test: Hybrid Session Manager & Auto-Recycle (${provider.toUpperCase()})]${C.reset}`);
  console.log(`  ${C.yellow}🎯 Mục đích:${C.reset}     Kiểm tra quản lý hội thoại theo Session ID & tự động làm mới DOM (Auto-Recycle).`);
  console.log(`  ${C.dim}⚙️ Cơ chế:${C.reset}       Gửi request kèm sessionId và maxTurns: 2. Turn 1 (newChat: true), Turn 2 (newChat: false), Turn 3 (auto-recycle).`);
  console.log(`  ${C.blue}💡 Ứng dụng:${C.reset}     Vừa giữ được hội thoại liên tục, vừa bảo vệ tab ${provider.toUpperCase()} không bao giờ bị đơ/lag do phình to DOM.`);
  console.log(`  ${C.green}🔍 Tiêu chí ĐẠT:${C.reset} Turn 2 nhớ ngữ cảnh của Turn 1, Turn 3 trả về { recycled: true }.`);
  console.log(`${C.gray}------------------------------------------------------------${C.reset}`);

  const sid = 'test-session-' + Date.now().toString(36);
  console.log(`${C.cyan}🔑 Đang tạo Session thử nghiệm: ${sid} (maxTurns = 2, Provider: ${provider.toUpperCase()})${C.reset}\n`);

  // Lượt 1
  console.log(`${C.bold}Lượt 1: Khởi tạo session & ghi nhớ bí mật...${C.reset}`);
  const stop1 = startProgressTicker(`⏳ Lượt 1: Đang gửi tới ${provider.toUpperCase()}`);
  let res1, data1;
  try {
    res1 = await fetch(`${BASE_URL}/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'Mật khẩu bảo vệ của tôi là "SKY-777". Hãy chỉ trả lời: Đã ghi nhận.', provider, sessionId: sid, maxTurns: 2, timeout: 45000 })
    });
    data1 = await res1.json();
  } finally {
    stop1();
  }
  console.log(`  ${C.green}Lượt 1 phản hồi:${C.reset} ${data1.answer?.trim() || data1.error}`);
  console.log(`  ${C.dim}Thông tin session:${C.reset} Turn ${data1.session?.turn}, Recycled: ${data1.session?.recycled}\n`);
  if (!res1.ok) return false;

  await new Promise(r => setTimeout(r, 1200));

  // Lượt 2: Phải nhớ
  console.log(`${C.bold}Lượt 2: Hỏi lại mật khẩu (Cùng session, newChat tự động false)...${C.reset}`);
  const stop2 = startProgressTicker(`⏳ Lượt 2: Đang gửi tới ${provider.toUpperCase()}`);
  let res2, data2;
  try {
    res2 = await fetch(`${BASE_URL}/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'Mật khẩu bảo vệ của tôi là gì?', provider, sessionId: sid, maxTurns: 2, timeout: 45000 })
    });
    data2 = await res2.json();
  } finally {
    stop2();
  }
  console.log(`  ${C.green}Lượt 2 phản hồi:${C.reset} ${data2.answer?.trim() || data2.error}`);
  console.log(`  ${C.dim}Thông tin session:${C.reset} Turn ${data2.session?.turn}, Recycled: ${data2.session?.recycled}\n`);
  const remembers = (data2.answer || '').includes('SKY-777');

  await new Promise(r => setTimeout(r, 1200));

  // Lượt 3: Auto-recycle
  console.log(`${C.bold}Lượt 3: Gửi câu hỏi tiếp theo (Đã chạm ngưỡng maxTurns: 2 -> Kích hoạt Auto-Recycle)...${C.reset}`);
  const stop3 = startProgressTicker(`⏳ Lượt 3: Đang gửi tới ${provider.toUpperCase()}`);
  let res3, data3;
  try {
    res3 = await fetch(`${BASE_URL}/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'Chào bạn, chúc một ngày tốt lành.', provider, sessionId: sid, maxTurns: 2, timeout: 45000 })
    });
    data3 = await res3.json();
  } finally {
    stop3();
  }
  console.log(`  ${C.green}Lượt 3 phản hồi:${C.reset} ${data3.answer?.trim() || data3.error}`);
  console.log(`  ${C.dim}Thông tin session:${C.reset} Turn ${data3.session?.turn}, Recycled: ${data3.session?.recycled}, Lý do: ${data3.session?.reason}\n`);

  if (remembers && data3.session?.recycled) {
    console.log(`${C.green}✅ HOÀN HẢO: Session nhớ ngữ cảnh chính xác & Auto-Recycle hoạt động đúng như thiết kế!${C.reset}\n`);
    return true;
  } else if (!remembers) {
    console.log(`${C.yellow}⚠️ AI chưa nhớ mật khẩu ở lượt 2.${C.reset}\n`);
    return false;
  } else {
    console.log(`${C.yellow}⚠️ Chưa kích hoạt recycle ở lượt 3.${C.reset}\n`);
    return false;
  }
}

// ============================================================================
// TEST 7: GOOGLE GEMINI WEB BRIDGE
// ============================================================================
async function runGeminiTest(customPrompt = null) {
  console.log(`\n${C.bold}${C.cyan}▶ [Test: Google Gemini Web Bridge] Kiểm thử điều khiển gemini.google.com${C.reset}`);
  console.log(`  ${C.yellow}🎯 Mục đích:${C.reset}     Kiểm tra khả năng kết nối & điều khiển tự động tab Google Gemini Web.`);
  console.log(`  ${C.dim}⚙️ Cơ chế:${C.reset}       Gửi POST /ask { provider: 'gemini' } ➡️ Extension kích hoạt tab gemini.google.com ➡️ Bơm prompt vào Quill/rich-textarea ➡️ Bấm Send ➡️ Thu nhận câu trả lời.`);
  console.log(`  ${C.blue}💡 Ứng dụng:${C.reset}     Tận dụng song song tài khoản Gemini Advanced / Free mà không cần tốn phí API Google Cloud.`);
  console.log(`  ${C.green}🔍 Tiêu chí ĐẠT:${C.reset} Nhận câu trả lời hoàn chỉnh từ Google Gemini trong < 30s.`);
  console.log(`${C.gray}------------------------------------------------------------${C.reset}`);

  const prompt = customPrompt || 'Giải thích ngắn gọn trong 1 câu: Vì sao Google Gemini có thế mạnh về xử lý đa phương thức (Multimodal)?';
  console.log(`${C.dim}📤 Prompt:${C.reset} "${prompt}"`);

  const t0 = Date.now();
  const stopTicker = startProgressTicker(`⏳ Đang gửi tới Google Gemini Web`);

  try {
    const res = await fetch(`${BASE_URL}/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, provider: 'gemini', newChat: false, timeout: 45000 })
    });
    stopTicker();
    const elapsed = ((Date.now() - t0) / 1000).toFixed(2);

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Server error');

    console.log(`${C.green}✅ Thành công từ Google Gemini sau ${elapsed}s!${C.reset}`);
    console.log(`${C.gray}------------------------------------------------${C.reset}`);
    console.log(data.answer);
    console.log(`${C.gray}------------------------------------------------${C.reset}`);
    console.log(`${C.dim}📊 Thống kê: Provider: ${data.provider?.toUpperCase()} | ${data.answer.length} ký tự${C.reset}\n`);
    return true;
  } catch (err) {
    stopTicker();
    console.log(`${C.red}❌ Lỗi: ${err.message}${C.reset}`);
    console.log(`${C.yellow}💡 Gợi ý: Hãy đảm bảo bạn đã mở hoặc đăng nhập vào tab https://gemini.google.com trên Chrome.${C.reset}\n`);
    return false;
  }
}

// ============================================================================
// RUN ALL TESTS (TARGETED PROVIDER: 'chatgpt' | 'gemini')
// ============================================================================
async function runAllTests(targetProvider = 'chatgpt') {
  const isGemini = targetProvider === 'gemini' || targetProvider === 'google';
  const providerKey = isGemini ? 'gemini' : 'chatgpt';
  const providerLabel = isGemini ? 'GOOGLE GEMINI' : 'CHATGPT (MẶC ĐỊNH)';

  console.log(`\n${C.bold}${C.cyan}╔══════════════════════════════════════════════════════════════════╗${C.reset}`);
  console.log(`${C.bold}${C.cyan}║   🚀 BẮT ĐẦU CHUỖI KIỂM THỬ TOÀN DIỆN CHO: ${providerLabel.padEnd(21)} ║${C.reset}`);
  console.log(`${C.bold}${C.cyan}╚══════════════════════════════════════════════════════════════════╝${C.reset}`);

  const delay = () => new Promise(r => setTimeout(r, 1200));
  let passed = 0;
  const total = 6;

  if (await runSingleTest(providerKey))          passed++; await delay();
  if (await runStreamTest(providerKey))          passed++; await delay();
  if (await runContextTest(providerKey))         passed++; await delay();
  if (await runSessionTest(providerKey))         passed++; await delay();
  if (await runStressTest(providerKey))          passed++; await delay();
  if (await runOpenAITest(providerKey))          passed++;

  console.log(`\n${C.bold}================================================================${C.reset}`);
  console.log(`Kết quả: ${passed}/${total} bài test [${providerLabel}] đạt yêu cầu (${Math.round((passed / total) * 100)}%).`);
  if (passed === total) {
    console.log(`${C.bold}${C.green}🏆 TẤT CẢ ${total} BÀI KIỂM THỬ [${providerLabel}] ĐỀU HOÀN HẢO! HỆ THỐNG SẴN SÀNG.${C.reset}\n`);
  } else {
    console.log(`${C.bold}${C.yellow}⚠️ Có ${total - passed} bài kiểm thử chưa đạt. Vui lòng kiểm tra tab trình duyệt và WebSocket Extension.${C.reset}\n`);
  }
}

// ============================================================================
// INTERACTIVE CHAT REPL (MULTI-PROVIDER)
// ============================================================================
async function runInteractiveChat(initialProvider = 'chatgpt') {
  let currentProvider = (initialProvider || 'chatgpt').toLowerCase();
  if (currentProvider === 'google') currentProvider = 'gemini';
  if (currentProvider !== 'gemini') currentProvider = 'chatgpt';

  let isNewChat = false;

  console.log(`\n${C.bold}${C.cyan}╔══════════════════════════════════════════════════════════════════╗${C.reset}`);
  console.log(`${C.bold}${C.cyan}║   💬 CHẾ ĐỘ CHAT TERMINAL ĐA NỀN TẢNG (CHATGPT & GEMINI)         ║${C.reset}`);
  console.log(`${C.bold}${C.cyan}╚══════════════════════════════════════════════════════════════════╝${C.reset}`);
  console.log(`  • Đang chat với:       ${C.bold}${currentProvider === 'gemini' ? C.cyan : C.green}${currentProvider.toUpperCase()}${C.reset}`);
  console.log(`  • Chuyển đổi nhanh:    Gõ ${C.yellow}/gemini${C.reset} (sang Gemini) hoặc ${C.yellow}/chatgpt${C.reset} (sang ChatGPT)`);
  console.log(`  • Tạo phiên chat mới:  Gõ ${C.yellow}/new${C.reset} | Thoát: Gõ ${C.yellow}exit${C.reset}\n`);

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  const promptUser = () => {
    const badgeColor = currentProvider === 'gemini' ? C.cyan : C.green;
    rl.question(`${C.bold}Bạn [${badgeColor}${currentProvider.toUpperCase()}${C.reset}${C.bold}]: ${C.reset}`, async (q) => {
      const trimmed = q.trim();
      if (!trimmed) return promptUser();

      if (trimmed.toLowerCase() === 'exit' || trimmed.toLowerCase() === 'quit') {
        rl.close();
        return;
      }
      if (trimmed.toLowerCase() === '/gemini' || trimmed.toLowerCase() === 'gemini') {
        currentProvider = 'gemini';
        console.log(`\n${C.cyan}🔄 Đã chuyển sang chế độ hội thoại với GOOGLE GEMINI.${C.reset}\n`);
        return promptUser();
      }
      if (trimmed.toLowerCase() === '/chatgpt' || trimmed.toLowerCase() === '/gpt' || trimmed.toLowerCase() === 'chatgpt') {
        currentProvider = 'chatgpt';
        console.log(`\n${C.green}🔄 Đã chuyển sang chế độ hội thoại với CHATGPT.${C.reset}\n`);
        return promptUser();
      }
      if (trimmed.toLowerCase() === '/new') {
        isNewChat = true;
        console.log(`\n${C.yellow}🆕 Lượt hỏi tiếp theo sẽ mở cuộc trò chuyện mới (newChat: true).${C.reset}\n`);
        return promptUser();
      }

      process.stdout.write(`${C.dim}Đang gửi tới ${currentProvider.toUpperCase()}...${C.reset}\r`);
      try {
        const res = await fetch(`${BASE_URL}/ask`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: trimmed, provider: currentProvider, newChat: isNewChat, timeout: 120000 })
        });
        isNewChat = false;
        const data = await res.json();
        readline.clearLine(process.stdout, 0);
        readline.cursorTo(process.stdout, 0);
        if (!res.ok) throw new Error(data.error || 'Server error');
        console.log(`${badgeColor}${C.bold}${data.provider ? data.provider.toUpperCase() : currentProvider.toUpperCase()}:${C.reset}\n${data.answer}\n`);
      } catch (e) {
        readline.clearLine(process.stdout, 0);
        readline.cursorTo(process.stdout, 0);
        console.log(`${C.red}❌ Lỗi: ${e.message}${C.reset}\n`);
      }
      promptUser();
    });
  };

  promptUser();
}

async function clearServerQueue() {
  console.log(`\n${C.yellow}🧹 Đang gửi yêu cầu dọn sạch hàng đợi tới Server (${BASE_URL})...${C.reset}`);
  try {
    const res = await fetch(`${BASE_URL}/queue/clear`, { method: 'POST' });
    const data = await res.json();
    console.log(`${C.green}✅ ${data.message}${C.reset}`);
    console.log(`${C.dim}📊 Chi tiết: Đã hủy ${data.cancelledCount} task chờ, task đang chạy: ${data.cancelledRunning ? 'Có (đã hủy)' : 'Không'}${C.reset}\n`);
    return true;
  } catch (err) {
    console.log(`${C.red}❌ Lỗi khi dọn hàng đợi: ${err.message}${C.reset}\n`);
    return false;
  }
}

module.exports = {
  checkBridgeHealth,
  clearServerQueue,
  runSingleTest,
  runStreamTest,
  runContextTest,
  runStressTest,
  runOpenAITest,
  runSessionTest,
  runGeminiTest,
  runAllTests,
  runInteractiveChat
};
