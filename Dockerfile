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

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

CMD ["npm", "start"]