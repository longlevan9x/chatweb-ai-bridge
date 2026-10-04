/**
 * Test Multimodal Vision - Phân tích & trích xuất dữ liệu từ hình ảnh
 * @file server/tests/test-vision.js
 * 
 * Cách chạy:
 *   node tests/test-vision.js gemini
 *   node tests/test-vision.js chatgpt
 *   node tests/test-vision.js gemini --stream
 */

'use strict';

const fs = require('fs');
const path = require('path');
const config = require('../config');

const PORT = config.server.port;
const BASE_URL = `http://localhost:${PORT}`;

// Đọc tham số dòng lệnh
const args = process.argv.slice(2);
const model = args.find(a => !a.startsWith('--')) || 'gemini';
const isStream = args.includes('--stream');

const imagePath = path.join(__dirname, 'fixtures', 'sample-invoice.jpg');

async function runVisionTest() {
  console.log('========================================================================');
  console.log(`🖼️  BẮT ĐẦU TEST MULTIMODAL VISION QUA CẦU NỐI AI (${model.toUpperCase()})`);
  console.log(`🎯 Server Target: ${BASE_URL}`);
  console.log(`📁 File ảnh mẫu : ${imagePath}`);
  console.log(`📡 Chế độ       : ${isStream ? 'Streaming SSE' : 'Non-Streaming (Đồng bộ)'}`);
  console.log('========================================================================\n');

  if (!fs.existsSync(imagePath)) {
    throw new Error(`Không tìm thấy file ảnh tại: ${imagePath}`);
  }

  // 1. Kiểm tra trạng thái Bridge Server & Extension kết nối
  console.log('1. Kiểm tra trạng thái kết nối của Worker Pool...');
  const statusRes = await fetch(`${BASE_URL}/status`);
  if (!statusRes.ok) {
    throw new Error(`Server không phản hồi HTTP 200 (Status: ${statusRes.status}). Vui lòng đảm bảo server đang chạy.`);
  }
  const status = await statusRes.json();
  console.log(`📊 Tổng Worker kết nối: ${status.workerCount}, Tổng Accounts: ${status.accountCount}`);

  const activeWorker = status.accounts?.find(a => a.provider === model && a.connected && a.hasOpenTab);
  if (!activeWorker) {
    console.log(`⚠️  Cảnh báo: Hiện chưa có tab ${model.toUpperCase()} nào đang mở sẵn trong trình duyệt.`);
    console.log(`👉 Hệ thống sẽ tự động bật hoặc chuyển hướng tab nếu Extension đang kết nối.`);
  } else {
    console.log(`🟢 Sẵn sàng phục vụ bởi: [${activeWorker.accountName || activeWorker.accountEmail}] trên [${activeWorker.workerName}]`);
  }

  // 2. Đọc file ảnh và chuyển sang Base64 Data URL
  console.log('\n2. Mã hóa hình ảnh sang Base64 Data URL...');
  const imageBuffer = fs.readFileSync(imagePath);
  const base64Data = imageBuffer.toString('base64');
  const dataUrl = `data:image/jpeg;base64,${base64Data}`;
  console.log(`✅ Đã chuẩn bị ảnh (${(imageBuffer.length / 1024).toFixed(1)} KB)`);

  // 3. Chuẩn bị payload chuẩn OpenAI Chat Completions với hình ảnh
  const promptText = `Bạn hãy đọc kỹ hình ảnh hóa đơn đính kèm và trích xuất các thông tin sau dưới dạng JSON:
- invoice_number (Số hóa đơn)
- customer_name (Tên khách hàng)
- item_name (Tên sản phẩm/dịch vụ)
- total_amount (Tổng số tiền)
- payment_status (Trạng thái thanh toán)

Chỉ trả về duy nhất khối mã JSON hợp lệ, không cần giải thích thêm.`;

  const payload = {
    model: model,
    stream: isStream,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: promptText },
          {
            type: 'image_url',
            image_url: {
              url: dataUrl
            }
          }
        ]
      }
    ]
  };

  console.log(`\n3. Gửi yêu cầu Vision tới POST ${BASE_URL}/v1/chat/completions...`);
  const startTime = Date.now();

  if (isStream) {
    // STREAMING MODE
    const res = await fetch(`${BASE_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Lỗi API (${res.status}): ${errText}`);
    }

    console.log('📡 Đang nhận luồng dữ liệu SSE từ AI:\n----------------------------------------');
    let fullText = '';
    const reader = res.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split('\n');

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const raw = line.slice(6).trim();
          if (raw === '[DONE]') break;
          try {
            const parsed = JSON.parse(raw);
            const delta = parsed.choices?.[0]?.delta?.content;
            if (delta) {
              process.stdout.write(delta);
              fullText += delta;
            }
          } catch (_) {}
        }
      }
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log('\n----------------------------------------');
    console.log(`⏱️ Thời gian xử lý & nhận kết quả: ${elapsed} giây.`);
    verifyExtraction(fullText);
  } else {
    // NON-STREAMING MODE
    const res = await fetch(`${BASE_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Lỗi API (${res.status}): ${errText}`);
    }

    const data = await res.json();
    const answer = data.choices?.[0]?.message?.content || '';

    console.log('\n💬 KẾT QUẢ PHẢN HỒI TỪ AI:\n----------------------------------------');
    console.log(answer);
    console.log('----------------------------------------');
    console.log(`⏱️ Thời gian xử lý: ${elapsed} giây.`);
    verifyExtraction(answer);
  }
}

function verifyExtraction(text) {
  console.log('\n4. Đánh giá tính chính xác của dữ liệu trích xuất:');
  const checks = [
    { label: 'Số hóa đơn (#9603)', pass: text.includes('9603') },
    { label: 'Khách hàng (Tech Corp)', pass: /Tech\s*Corp/i.test(text) },
    { label: 'Dịch vụ (AI Web Bridge License)', pass: /AI\s*Web\s*Bridge/i.test(text) || /License/i.test(text) },
    { label: 'Tổng tiền ($1,250.00)', pass: text.includes('1,250') || text.includes('1250') },
    { label: 'Trạng thái (PAID in full)', pass: /PAID/i.test(text) }
  ];

  let allPassed = true;
  for (const c of checks) {
    if (c.pass) {
      console.log(`  ✅ ${c.label}: Khớp chính xác!`);
    } else {
      console.log(`  ⚠️  ${c.label}: Chưa tìm thấy chuỗi mong muốn.`);
      allPassed = false;
    }
  }

  if (allPassed) {
    console.log('\n🎉 XÁC THỰC HOÀN TOÀN: AI đã phân tích và trích xuất đúng 100% nội dung hình ảnh!');
  } else {
    console.log('\nℹ️ AI đã phản hồi, vui lòng kiểm tra nội dung chi tiết phía trên.');
  }
}

runVisionTest().catch(err => {
  console.error('\n❌ Thất bại:', err.message);
  process.exit(1);
});
