# 构建阶段
FROM node:18-alpine AS builder

# 安装构建依赖
RUN apk add --no-cache \
    build-base \
    cairo-dev \
    pango-dev \
    jpeg-dev \
    giflib-dev \
    librsvg-dev \
    pixman-dev

# 全局安装 pnpm
RUN npm install -g pnpm

WORKDIR /app

# 复制 pnpm 相关文件
COPY package.json pnpm-lock.yaml ./

# 使用 pnpm 安装生产依赖
RUN pnpm install --prod --frozen-lockfile

# 复制源代码
COPY . .

# 运行阶段
FROM node:18-alpine AS runtime

# 安装运行时依赖
RUN apk add --no-cache \
    cairo \
    pango \
    jpeg \
    giflib \
    librsvg \
    pixman

# 安装 PM2
RUN npm install -g pm2

WORKDIR /app

# 从构建阶段复制必要文件
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY --from=builder /app/src ./src
COPY --from=builder /app/config.js ./
COPY --from=builder /app/transform.js ./

# 创建非 root 用户
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nextjs -u 1001

USER nextjs

EXPOSE 3000

CMD ["pm2-runtime", "start", "src/main.js", "--name", "okx-trading"]