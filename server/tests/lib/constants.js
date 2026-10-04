/**
 * Shared constants for the Test Runner CLI
 * @file server/tests/lib/constants.js
 */

'use strict';

const BASE_URL = process.env.BRIDGE_URL || 'http://localhost:9603';

/** Bảng màu ANSI */
const C = {
  reset:   '\x1b[0m',
  bold:    '\x1b[1m',
  dim:     '\x1b[2m',
  cyan:    '\x1b[36m',
  green:   '\x1b[32m',
  yellow:  '\x1b[33m',
  blue:    '\x1b[34m',
  magenta: '\x1b[35m',
  red:     '\x1b[31m',
  gray:    '\x1b[90m',
};

/** Danh mục lệnh hỗ trợ */
const COMMANDS = [
  {
    name: 'all', alias: ['full', 'run-all'],
    desc: 'Chạy chuỗi kiểm thử toàn diện 7 kịch bản tự động (hỗ trợ "all" hoặc "all gemini")',
    target: 'Đánh giá độ ổn định tổng thể của toàn bộ hệ thống Bridge (ChatGPT hoặc Google Gemini)',
    mechanism: 'Chạy tự động liên hoàn: Single Ask ➡️ Stream SSE ➡️ Context Memory ➡️ Hybrid Session ➡️ Native API/Web ➡️ Queue Stress ➡️ OpenAI Compat và tổng kết tỷ lệ đạt (%).',
    useCase: 'Chạy nghiệm thu toàn bộ tính năng. Hỗ trợ: "npm test all" (ChatGPT) hoặc "npm test all gemini" (Gemini).',
    passCriteria: 'Đạt 7/7 bài kiểm tra, không có lỗi timeout hay disconnect.'
  },
  {
    name: 'single', alias: ['ask', 'once', 'perf'],
    desc: 'Hỏi 1 câu đơn lẻ & đo hiệu năng (Latency & Speed)',
    target: 'Kiểm tra tốc độ kết nối và năng lực sinh chữ của ChatGPT',
    mechanism: 'Gửi 1 câu hỏi với newChat: true qua POST /ask ➡️ Extension nhập vào chatbox ➡️ Nhận toàn bộ kết quả.',
    useCase: 'Kiểm tra kết nối cơ bản, đo độ trễ mạng (latency) và tốc độ sinh chữ (chars/giây).',
    passCriteria: 'Nhận câu trả lời hoàn chỉnh trong < 30s, tốc độ > 15 chars/s.'
  },
  {
    name: 'stream', alias: ['sse', 'live'],
    desc: 'Phản hồi real-time từng từ (SSE Typewriter)',
    target: 'Kiểm tra luồng truyền dữ liệu Server-Sent Events tức thời',
    mechanism: 'ChatGPT sinh chữ đến đâu, Extension bắt token đến đó ➡️ WebSocket ➡️ Server SSE ➡️ In ra terminal theo thời gian thực.',
    useCase: 'Dùng cho giao diện web/chat UI cần hiệu ứng gõ chữ mượt mà, giảm cảm giác phải chờ đợi.',
    passCriteria: 'Token đầu tiên (TTFT) xuất hiện dưới 3s, text hiển thị liên tục không ngắt quãng.'
  },
  {
    name: 'context', alias: ['multi', 'memory', 'thread'],
    desc: 'Kiểm tra bộ nhớ ngữ cảnh nhiều lượt (Multi-turn)',
    target: 'Xác minh AI có duy trì ngữ cảnh khi newChat = false không',
    mechanism: 'Lượt 1: Cung cấp mã bí mật "X-999" (newChat: true) ➡️ Lượt 2: Hỏi lại mã đó trong cùng tab hội thoại (newChat: false).',
    useCase: 'Dành cho các tác vụ hỏi đáp hội thoại dài, trao đổi làm rõ vấn đề, coding nhiều bước.',
    passCriteria: 'Câu trả lời ở lượt 2 bắt buộc phải nhận diện và nhắc đúng mã "X-999".'
  },
  {
    name: 'stress', alias: ['queue', 'batch', 'concurrent'],
    desc: 'Bắn đồng thời 3 câu hỏi kiểm tra Task Queue',
    target: 'Kiểm tra khả năng chịu tải và chống xung đột trên tab trình duyệt',
    mechanism: 'Bắn 3 requests cùng 1 mili-giây. Task Queue tự động xếp hàng và xử lý tuần tự (FIFO, concurrency: 1).',
    useCase: 'Bảo vệ hệ thống khi nhiều ứng dụng hoặc luồng cùng gọi vào server cùng lúc.',
    passCriteria: 'Cả 3 tasks đều thành công 100%, không bị xung đột DOM, không bị timeout.'
  },
  {
    name: 'openai', alias: ['v1', 'compat', 'completion'],
    desc: 'Kiểm thử chuẩn OpenAI API (/v1/chat/completions)',
    target: 'Kiểm tra khả năng tương thích với chuẩn OpenAI API quốc tế',
    mechanism: 'Gửi request định dạng { model, messages: [...] } kèm Bearer Token ➡️ Server chuyển đổi và đóng gói chuẩn OpenAI JSON.',
    useCase: 'Tích hợp trực tiếp Bridge vào Cursor AI, Cline, Continue.dev, LangChain, AutoGen...',
    passCriteria: 'HTTP 200, phản hồi có choices[0].message.content đúng chuẩn OpenAI.'
  },
  {
    name: 'session', alias: ['turn', 'recycle', 'hybrid'],
    desc: 'Kiểm thử Hybrid Session & Tự Động Làm Mới (Auto-Recycle)',
    target: 'Kiểm tra cơ chế ghi nhớ theo Session ID, cách ly phiên và chống phình to DOM',
    mechanism: 'Gửi request kèm sessionId và maxTurns: 2. Lượt 1 (khởi tạo) ➡️ Lượt 2 (tiếp nối nhớ ngữ cảnh) ➡️ Lượt 3 (tự động recycle).',
    useCase: 'Dành cho các ứng dụng thực tế vừa muốn lưu mạch hội thoại, vừa bảo vệ tab trình duyệt không bao giờ bị đơ/lag.',
    passCriteria: 'Lượt 2 giữ được ngữ cảnh, Lượt 3 tự động kích hoạt recycle ({ recycled: true }).'
  },
  {
    name: 'gemini', alias: ['google', 'gemini-web'],
    desc: 'Kiểm thử Google Gemini Web hoặc chạy trọn bộ (hỗ trợ "gemini all" hoặc prompt)',
    target: 'Kiểm tra khả năng điều khiển tab Google Gemini Web và trích xuất câu trả lời',
    mechanism: 'Gửi request với provider: "gemini" ➡️ Extension tự động tìm/mở tab gemini.google.com ➡️ Bơm prompt vào Quill editor ➡️ Bấm Send ➡️ Thu nhận câu trả lời.',
    useCase: 'Chạy lẻ 1 câu hỏi ("npm test gemini [câu hỏi]") hoặc chạy toàn bộ 7 test cho Gemini ("npm test gemini all").',
    passCriteria: 'Nhận câu trả lời hoàn chỉnh từ Google Gemini trong < 30s.'
  },
  {
    name: 'chat', alias: ['cli', 'repl', 'talk'],
    desc: 'Trò chuyện tương tác trực tiếp với ChatGPT từ Terminal',
    target: 'Sử dụng ChatGPT như một ứng dụng CLI độc lập ngay trong CMD/Terminal',
    mechanism: 'Mở phiên hội thoại 2 chiều liên tục (newChat: false) trong terminal cho đến khi gõ "exit".',
    useCase: 'Hỏi đáp nhanh các lỗi code, thuật toán, dịch thuật ngay khi đang làm việc trong terminal.',
    passCriteria: 'Gửi và nhận tin nhắn trơn tru, lưu giữ mạch trao đổi xuyên suốt.'
  },
  {
    name: 'health', alias: ['status', 'check', 'ping'],
    desc: 'Kiểm tra trạng thái kết nối Server & Extension',
    target: 'Kiểm tra sức khỏe hệ thống mạng WebSocket và hàng đợi',
    mechanism: 'Truy vấn endpoint /status để kiểm tra kết nối WebSocket giữa Server và Extension, đếm số task chờ.',
    useCase: 'Dùng để chẩn đoán khi thấy request không chạy hoặc Extension chưa kích hoạt.',
    passCriteria: 'Server báo connected: true, queueLength = 0.'
  },
  {
    name: 'preset', alias: ['sample', 'fixtures', 'data'],
    desc: 'Chạy kiểm thử với các bộ dữ liệu mẫu theo chủ đề có sẵn',
    target: 'Test nhanh các câu hỏi chuẩn hóa (Coding, Logic, Tóm tắt, Dịch thuật, Sáng tạo)',
    mechanism: 'Chọn một prompt từ danh mục dữ liệu mẫu ➡️ Gửi tới ChatGPT hoặc Gemini ➡️ Nhận kết quả và đo tốc độ.',
    useCase: 'Kiểm tra nhanh năng lực AI mà không cần tự nghĩ câu hỏi.',
    passCriteria: 'Nhận câu trả lời hoàn chỉnh theo từng chủ đề dữ liệu mẫu.'
  },
  {
    name: 'compare', alias: ['versus', 'vs', 'dual'],
    desc: 'So sánh đối đầu trực tiếp ChatGPT vs Google Gemini cùng 1 câu hỏi',
    target: 'Đo lường sự khác biệt về chất lượng, độ trễ và tốc độ sinh chữ giữa 2 AI',
    mechanism: 'Gửi cùng 1 câu hỏi tới ChatGPT và Gemini ➡️ In kết quả song song kèm bảng so sánh hiệu năng.',
    useCase: 'Giúp người dùng chọn AI tối ưu cho từng loại tác vụ cụ thể.',
    passCriteria: 'Cả 2 AI đều hoàn thành câu trả lời thành công.'
  },
  {
    name: 'help', alias: ['?', 'man'],
    desc: 'Hiển thị danh sách câu lệnh và hướng dẫn chi tiết',
    target: 'Xem tài liệu và hướng dẫn sử dụng công cụ',
    mechanism: 'In ra danh sách lệnh, phím tắt và giải thích chi tiết mục đích từng bài test.',
    useCase: 'Tra cứu khi quên cú pháp hoặc muốn hiểu rõ cơ chế từng kịch bản test.',
    passCriteria: 'Hiển thị đầy đủ bảng hướng dẫn.'
  },
  {
    name: 'clear-queue', alias: ['clearqueue', 'cq', 'reset-queue'],
    desc: 'Dọn sạch toàn bộ hàng đợi Server và hủy task đang chạy',
    target: 'Giải phóng hàng đợi Server và tab trình duyệt ngay lập tức',
    mechanism: 'Gọi POST /queue/clear để huỷ mọi task đang chờ và phát tín hiệu CANCEL_TASK tới Extension.',
    useCase: 'Sử dụng khi tab bị kẹt, hoặc lỡ gửi quá nhiều request muốn huỷ ngay lập tức.',
    passCriteria: 'Hàng đợi được làm trống (queueLength = 0).'
  },
  {
    name: 'clear', alias: ['cls'],
    desc: 'Xóa sạch màn hình terminal',
    target: 'Làm sạch giao diện dòng lệnh',
    mechanism: 'Xóa toàn bộ màn hình console để dễ theo dõi các lượt test mới.',
    useCase: 'Giúp màn hình gọn gàng sau nhiều lần chạy test.',
    passCriteria: 'Màn hình được làm mới.'
  },
  {
    name: 'exit', alias: ['quit', 'q'],
    desc: 'Thoát công cụ kiểm thử',
    target: 'Đóng chương trình Test Runner',
    mechanism: 'Dừng tiến trình terminal và quay trở lại shell hệ thống.',
    useCase: 'Thoát khỏi chế độ tương tác.',
    passCriteria: 'Tiến trình kết thúc êm đẹp.'
  }
];

module.exports = { BASE_URL, C, COMMANDS };
