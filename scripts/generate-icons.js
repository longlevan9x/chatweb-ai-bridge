const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// Tạo PNG chuẩn 100% không cần thư viện ngoài (sử dụng zlib tích hợp trong Node.js)
function createPng(size, r, g, b) {
  const width = size;
  const height = size;
  
  // Mỗi pixel 4 byte RGBA, mỗi dòng thêm 1 byte filter (0x00 = None)
  const rowSize = 1 + width * 4;
  const rawData = Buffer.alloc(rowSize * height);

  const radius = size / 2;
  const center = size / 2;

  for (let y = 0; y < height; y++) {
    const rowOffset = y * rowSize;
    rawData[rowOffset] = 0; // Filter type: None

    for (let x = 0; x < width; x++) {
      const pxOffset = rowOffset + 1 + x * 4;
      const dx = x - center + 0.5;
      const dy = y - center + 0.5;
      const dist = Math.sqrt(dx * dx + dy * dy);

      // Bo góc tròn hiện đại
      if (dist <= radius) {
        // Icon AI/robot gradient nhẹ
        const factor = 1 - (dist / radius) * 0.3;
        rawData[pxOffset] = Math.min(255, Math.floor(r * factor));     // R
        rawData[pxOffset + 1] = Math.min(255, Math.floor(g * factor)); // G
        rawData[pxOffset + 2] = Math.min(255, Math.floor(b * factor)); // B
        rawData[pxOffset + 3] = 255;                                   // Alpha
      } else {
        rawData[pxOffset] = 0;
        rawData[pxOffset + 1] = 0;
        rawData[pxOffset + 2] = 0;
        rawData[pxOffset + 3] = 0; // Trong suốt
      }
    }
  }

  const compressedData = zlib.deflateSync(rawData);

  // CRC32 table
  const crcTable = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    crcTable[i] = c;
  }

  function crc32(buf) {
    let crc = 0xffffffff;
    for (let i = 0; i < buf.length; i++) {
      crc = crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  function makeChunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);

    const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(typeAndData), 0);

    return Buffer.concat([len, typeAndData, crc]);
  }

  // PNG Signature
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  // IHDR
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8; // Bit depth: 8
  ihdrData[9] = 6; // Color type: RGBA (6)
  ihdrData[10] = 0; // Compression method: Deflate
  ihdrData[11] = 0; // Filter method: Standard
  ihdrData[12] = 0; // Interlace: None
  const ihdrChunk = makeChunk('IHDR', ihdrData);

  // IDAT
  const idatChunk = makeChunk('IDAT', compressedData);

  // IEND
  const iendChunk = makeChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

const iconsDir = path.join(__dirname, '..', 'extension', 'icons');
if (!fs.existsSync(iconsDir)) {
  fs.mkdirSync(iconsDir, { recursive: true });
}

// Màu xanh ngọc lục bảo (Emerald Green - #10b981) phong cách OpenAI / modern tech
const sizes = [16, 48, 128];
sizes.forEach(size => {
  const pngBuffer = createPng(size, 16, 185, 129);
  const filePath = path.join(iconsDir, `icon-${size}.png`);
  fs.writeFileSync(filePath, pngBuffer);
  console.log(`✅ Đã tạo icon: ${filePath} (${size}x${size})`);
});
