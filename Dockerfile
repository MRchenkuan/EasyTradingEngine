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
    pixman-dev \
    python3 \
    make \
    g++

WORKDIR /app

# 复制 package 文件
COPY package.json package-lock.json ./

# 使用 npm 安装依赖
RUN npm ci --only=production

# 重新编译原生模块
RUN npm rebuild canvas

# 复制源代码
COPY . .

# 运行阶段
FROM node:18-alpine AS runtime

# 安装运行时依赖和中文字体
RUN apk add --no-cache \
    cairo \
    pango \
    jpeg \
    giflib \
    librsvg \
    pixman \
    fontconfig \
    ttf-dejavu \
    wqy-zenhei

# 安装 PM2
RUN npm install -g pm2

WORKDIR /app

# 从构建阶段复制文件
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY --from=builder /app/src ./src
COPY --from=builder /app/config.js ./
COPY --from=builder /app/config.security.js ./
COPY --from=builder /app/config.security.mimic.js ./
COPY --from=builder /app/transform.js ./

# 创建必要的目录并设置权限
RUN mkdir -p /app/records /app/chart/grid && \
    chmod -R 777 /app/records /app/chart

# 更新字体缓存
RUN fc-cache -fv

EXPOSE 3000

CMD ["pm2-runtime", "start", "src/main.js", "--name", "okx-trading"]