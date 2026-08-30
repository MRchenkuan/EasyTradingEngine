sudo docker rm -f okx-trading || true
# 确保 host 端 config.json 存在，避免 Docker 创建空目录
test -f config.json || echo '{}' > config.json
sudo docker load < okx-trading.tar
sudo docker run -d --name okx-trading \
  -p 8080:8080 \
  -v $(pwd)/config.json:/app/config.json \
  -v $(pwd)/chart:/app/chart \
  -v $(pwd)/records:/app/records \
  -v $(pwd)/kline_data:/app/kline_data \
  -e TZ=Asia/Shanghai \
  --ulimit core=0 \
  --restart unless-stopped \
  okx-trading