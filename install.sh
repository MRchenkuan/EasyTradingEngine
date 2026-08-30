sudo docker rm -f okx-trading || true
sudo docker load < okx-trading.tar
sudo docker run -d --name okx-trading \
  -p 8080:8080 \
  -v $(pwd)/chart:/app/chart \
  -v $(pwd)/records:/app/records \
  -v $(pwd)/kline_data:/app/kline_data \
  -e TZ=Asia/Shanghai \
  --ulimit core=0 \
  --restart unless-stopped \
  okx-trading