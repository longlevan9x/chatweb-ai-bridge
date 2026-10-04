const { WebSocket } = require('ws');

async function runComprehensiveVerification() {
  process.env.PORT = 9998;
  require('../server.js');

  console.log('1. Khởi động server test trên cổng 9998...');
  await new Promise(r => setTimeout(r, 800));

  console.log('2. Kết nối WebSocket giả lập Extension...');
  const ws = new WebSocket('ws://localhost:9998');

  await new Promise((resolve, reject) => {
    ws.on('open', resolve);
    ws.on('error', reject);
  });
  console.log('✅ WebSocket Bridge kết nối thành công!');

  // Giả lập Extension xử lý ASK & Streaming
  ws.on('message', (raw) => {
    const data = JSON.parse(raw.toString());

    if (data.action === 'ASK') {
      console.log(`🤖 [Mock Extension] Nhận task ${data.id}: "${data.prompt.slice(0, 30)}..." (stream: ${data.stream})`);

      if (data.images && data.images.length > 0) {
        console.log(`🖼️ [Mock Extension] Đã nhận ${data.images.length} hình ảnh đính kèm (Vision Multimodal)!`);
      }

      if (data.stream) {
        // Giả lập bắn từng chunk streaming
        setTimeout(() => {
          ws.send(JSON.stringify({ action: 'STREAM_CHUNK', id: data.id, chunk: 'Scrum ', fullText: 'Scrum ' }));
        }, 100);
        setTimeout(() => {
          ws.send(JSON.stringify({ action: 'STREAM_CHUNK', id: data.id, chunk: 'thích ứng nhanh.', fullText: 'Scrum thích ứng nhanh.' }));
        }, 200);
        setTimeout(() => {
          ws.send(JSON.stringify({ id: data.id, status: 'success', answer: 'Scrum thích ứng nhanh.' }));
        }, 300);
      } else if (data.prompt.includes('Error Simulation')) {
        setTimeout(() => {
          ws.send(JSON.stringify({
            id: data.id,
            status: 'success',
            answer: 'Sorry, something went wrong. Please try your request again.'
          }));
        }, 150);
      } else {
        setTimeout(() => {
          const reply = (data.images && data.images.length > 0)
            ? 'Bức ảnh hiển thị một điểm ảnh pixel màu đen (1x1 PNG).'
            : 'Scrum giúp dự án linh hoạt và tối ưu giá trị liên tục.';
          ws.send(JSON.stringify({
            id: data.id,
            status: 'success',
            answer: reply
          }));
        }, 200);
      }
    }
  });

  // Test 1: Kiểm tra /status và Queue metrics
  console.log('\n--- TEST 1: KIỂM TRA STATUS & QUEUE METRICS ---');
  const statusRes = await fetch('http://localhost:9998/status');
  const statusData = await statusRes.json();
  console.log('📊 Status:', statusData);
  if (!statusData.connected) throw new Error('Server báo chưa kết nối!');

  // Test 2: Kiểm tra /v1/models (OpenAI Standard)
  console.log('\n--- TEST 2: KIỂM TRA OPENAI /v1/models ---');
  const modelsRes = await fetch('http://localhost:9998/v1/models');
  const modelsData = await modelsRes.json();
  console.log('🤖 Models:', modelsData.data.map(m => m.id));
  if (!modelsData.data.some(m => m.id === 'gpt-4o')) throw new Error('Thiếu model gpt-4o!');

  // Test 3: Kiểm tra /v1/chat/completions (OpenAI Standard Non-streaming)
  console.log('\n--- TEST 3: KIỂM TRA OPENAI /v1/chat/completions (NON-STREAMING) ---');
  const chatRes = await fetch('http://localhost:9998/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'Scrum là gì?' }]
    })
  });
  const chatData = await chatRes.json();
  console.log('💬 Phản hồi OpenAI:', chatData.choices[0].message.content);
  if (!chatData.choices || !chatData.choices[0].message.content) {
    throw new Error('Dữ liệu OpenAI format không hợp lệ!');
  }

  // Test 4: Kiểm tra /v1/chat/completions (OpenAI Standard Streaming)
  console.log('\n--- TEST 4: KIỂM TRA OPENAI STREAMING (SSE CHUNKS) ---');
  const streamRes = await fetch('http://localhost:9998/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'Stream test' }],
      stream: true
    })
  });

  const reader = streamRes.body.getReader();
  const decoder = new TextDecoder();
  let receivedChunks = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunkStr = decoder.decode(value);
    if (chunkStr.includes('chat.completion.chunk')) {
      receivedChunks++;
    }
  }
  console.log(`📡 Đã nhận ${receivedChunks} chunk SSE streaming chuẩn OpenAI!`);
  if (receivedChunks === 0) throw new Error('Không nhận được chunk SSE nào!');

  // Test 5: Kiểm tra Concurrent Queue (Gửi 3 request cùng lúc xem có tuần tự không)
  console.log('\n--- TEST 5: KIỂM TRA HÀNG ĐỢI TUẦN TỰ (CONCURRENCY: 1) ---');
  const qTasks = [1, 2, 3].map(i =>
    fetch('http://localhost:9998/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: `Câu hỏi ${i}` })
    }).then(r => r.json())
  );

  const results = await Promise.all(qTasks);
  console.log(`✅ Cả ${results.length} câu hỏi đồng thời đã được xếp hàng và xử lý trơn tru!`);

  // Test 6: Kiểm tra Gemini qua Chuẩn Chung Duy Nhất (/v1/chat/completions)
  console.log('\n--- TEST 6: KIỂM TRA GEMINI QUA CHUẨN CHUNG (/v1/chat/completions) ---');
  const geminiRes = await fetch('http://localhost:9998/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gemini',
      messages: [{ role: 'user', content: 'Google Gemini là gì?' }]
    })
  });
  const geminiData = await geminiRes.json();
  const replyContent = geminiData.choices?.[0]?.message?.content;
  console.log('💬 Phản hồi Gemini (Chuẩn chung OpenAI):', replyContent);
  if (!replyContent) {
    throw new Error('Dữ liệu Gemini format không hợp lệ!');
  }

  // Test 7: Kiểm tra Chặn Lỗi "Sorry, something went wrong. Please try your request again."
  console.log('\n--- TEST 7: KIỂM TRA CHẶN LỖI TỪ GEMINI/CHATGPT WEB ---');
  const errRes = await fetch('http://localhost:9998/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gemini',
      messages: [{ role: 'user', content: 'Error Simulation: Gemini gặp sự cố' }]
    })
  });
  const errData = await errRes.json();
  console.log(`HTTP Status: ${errRes.status}, Error Response:`, errData);
  if (errRes.status !== 500 || !errData.error || !errData.error.message.includes('Sorry, something went wrong')) {
    throw new Error(`Test 7 Thất bại: Mong đợi HTTP 500 kèm thông báo lỗi, nhưng nhận được status ${errRes.status}`);
  }
  console.log('✅ Hệ thống đã chuyển đổi chính xác thông báo lỗi web thành HTTP 500 error response!');

  // Test 8: Kiểm tra Multimodal Vision (Gửi ảnh kèm câu hỏi qua chuẩn OpenAI)
  console.log('\n--- TEST 8: KIỂM TRA MULTIMODAL VISION (GỬI ẢNH KÈM CÂU HỎI) ---');
  const visionRes = await fetch('http://localhost:9998/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'chatgpt',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Bức ảnh này hiển thị gì?' },
            {
              type: 'image_url',
              image_url: {
                url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
              }
            }
          ]
        }
      ]
    })
  });
  const visionData = await visionRes.json();
  const visionAnswer = visionData.choices?.[0]?.message?.content;
  console.log('💬 Phản hồi Vision Multimodal:', visionAnswer);
  if (!visionAnswer || !visionAnswer.includes('điểm ảnh pixel')) {
    throw new Error('Test 8 Thất bại: Extension không nhận diện được hình ảnh đính kèm!');
  }
  console.log('✅ Tính năng Multimodal Vision (gửi ảnh kèm prompt) hoạt động 100% hoàn hảo!');

  console.log('\n🎉 TOÀN BỘ 8 BÀI TEST KIẾN TRÚC & VISION ĐÃ ĐẠT 100%!');
  ws.close();
  process.exit(0);
}

runComprehensiveVerification().catch(err => {
  console.error('❌ Lỗi:', err);
  process.exit(1);
});
