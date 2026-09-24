# 构建阶段
FROM node:18-alpine AS builder

# 安装构建依赖
RUN apk add --no-cache \
    build-base \
    python3 \
    make \
    g++

WORKDIR /app

# 复制 package 文件
COPY package.json package-lock.json ./

# 使用 npm 安装依赖
RUN npm ci --only=production

# 复制源代码
COPY . .

# 运行阶段
FROM node:18-alpine AS runtime

# 安装 PM2
RUN npm install -g pm2

WORKDIR /app

# 从构建阶段复制文件
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY --from=builder /app/src ./src
COPY --from=builder /app/config.js ./
COPY --from=builder /app/config.json ./
COPY --from=builder /app/config.security.js ./
COPY --from=builder /app/config.security.mimic.js ./
COPY --from=builder /app/public ./public

# 创建必要的目录并设置权限
RUN mkdir -p /app/records && \
    chmod -R 777 /app/records

EXPOSE 8080

CMD ["pm2-runtime", "start", "src/main.js", "--name", "okx-trading"]