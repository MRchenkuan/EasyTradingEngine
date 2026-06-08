window.TradingApp = window.TradingApp || {};
window.TradingApp.WebSocket = {
  ws: null,
  getToken: function () {
    // 从 URL 路径中获取 token (格式: /token)
    const pathParts = window.location.pathname.split('/').filter(Boolean);
    return pathParts[0] || '';
  },
  connect: function (onAssetsUpdate, onLogReceived) {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.hostname || 'localhost';
    const port = window.location.port || 8080;
    const token = this.getToken();

    if (!token) {
      console.error('无法获取 token，WebSocket 连接失败');
      return;
    }

    this.ws = new WebSocket(`${protocol}//${host}:${port}/?token=${token}`);

    this.ws.onopen = function () {
      document.getElementById('statusIndicator').classList.add('connected');
      console.log('WebSocket 连接已建立');
    };

    this.ws.onmessage = function (event) {
      const data = JSON.parse(event.data);

      if (data.type === 'assets') {
        onAssetsUpdate(data.payload);
      } else if (data.type === 'logs') {
        onLogReceived(data.payload);
      }
    };

    this.ws.onclose = function () {
      document.getElementById('statusIndicator').classList.remove('connected');
      console.log('WebSocket 连接已关闭，正在重连...');
      setTimeout(() => window.TradingApp.WebSocket.connect(onAssetsUpdate, onLogReceived), 3000);
    };

    this.ws.onerror = function (error) {
      console.error('WebSocket 错误:', error);
    };
  },
};
