# 构建阶段
FROM node:18-alpine as builder

WORKDIR /app
COPY package*.json ./

# 安装编译依赖
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    cairo-dev \
    jpeg-dev \
    pango-dev \
    giflib-dev

RUN npm install --production

# 运行阶段
FROM node:18-alpine

# 安装运行时依赖
RUN apk add --no-cache \
    cairo \
    jpeg \
    pango \
    giflib

WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY . .

CMD ["node", "main.js"]