# =========================================================================
# Production Dockerfile for ChatGPT & Gemini Local Web Bridge Server
# =========================================================================

FROM node:20-alpine AS base

# Cài đặt curl để hỗ trợ container HEALTHCHECK
RUN apk add --no-cache curl

WORKDIR /app

# 1. Cài đặt dependencies (bỏ qua devDependencies để tối ưu dung lượng)
COPY package*.json ./
RUN npm ci --omit=dev

# 2. Sao chép toàn bộ mã nguồn server
COPY . .

# 3. Chạy với user node không có quyền root (Bảo mật tối đa)
USER node

# 4. Cổng mặc định
EXPOSE 9603

# 5. Thiết lập biến môi trường mặc định
ENV NODE_ENV=production \
    PORT=9603 \
    HOST=0.0.0.0

# 6. Healthcheck định kỳ kiểm tra trạng thái /status
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:${PORT}/status || exit 1

# 7. Khởi động máy chủ điều phối
CMD ["node", "server.js"]
