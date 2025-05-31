FROM node:18

# 安装 canvas 所需的系统依赖
RUN apt-get update && apt-get install -y \
    build-essential \
    libcairo2-dev \
    libpango1.0-dev \
    libjpeg-dev \
    libgif-dev \
    librsvg2-dev \
    pkg-config \
    python3 \
    fonts-wqy-microhei \  
    fonts-noto-cjk \     
    fonts-arphic-ukai \ 
    fonts-arphic-uming \ 
    fontconfig \
    && rm -rf /var/lib/apt/lists/*

# 全局安装 PM2
RUN npm install -g pm2

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

# 确保数据目录存在并设置权限
RUN mkdir -p /app/chart /app/records && \
    chmod -R 777 /app/chart /app/records


# 创建启动脚本
COPY docker-entrypoint.sh /
RUN chmod +x /docker-entrypoint.sh

# 使用启动脚本
ENTRYPOINT ["/docker-entrypoint.sh"]

# 使用 PM2 运行时启动应用
CMD ["pm2-runtime", "start", "pm2.start.config.cjs"]