window.TradingApp = window.TradingApp || {};
window.TradingApp.WebSocket = {
  wsIndicators: null,
  wsChart: null,
  wsTick: null,
  getToken: function () {
    const pathParts = window.location.pathname.split('/').filter(Boolean);
    return pathParts[0] || '';
  },
  connect: function (onIndicatorsUpdate, onChartUpdate, onTickUpdate, onLogReceived) {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.hostname || 'localhost';
    const port = window.location.port || 8080;
    const token = this.getToken();

    if (!token) {
      console.error('无法获取 token，WebSocket 连接失败');
      return;
    }

    const self = this;

    // indicators WebSocket：轻量指标数据
    this.wsIndicators = new WebSocket(`${protocol}//${host}:${port}/?token=${token}`);
    this.wsIndicators.onopen = function () {
      document.getElementById('statusIndicator').classList.add('connected');
    };
    this.wsIndicators.onmessage = function (event) {
      const data = JSON.parse(event.data);
      if (data.type === 'indicators') {
        onIndicatorsUpdate(data.payload);
      } else if (data.type === 'logs') {
        onLogReceived(data.payload);
      }
    };
    this.wsIndicators.onclose = function () {
      document.getElementById('statusIndicator').classList.remove('connected');
      setTimeout(() => {
        self.connect(onIndicatorsUpdate, onChartUpdate, onTickUpdate, onLogReceived);
      }, 3000);
    };
    this.wsIndicators.onerror = function () {};

    // chart WebSocket：完整K线数据（低频，新K线产生时才推送）
    this.wsChart = new WebSocket(`${protocol}//${host}:${port}/chart?token=${token}`);
    this.wsChart.onmessage = function (event) {
      const data = JSON.parse(event.data);
      if (data.type === 'chart') {
        onChartUpdate(data.payload);
      }
    };
    this.wsChart.onclose = function () {
      setTimeout(() => {
        self.connect(onIndicatorsUpdate, onChartUpdate, onTickUpdate, onLogReceived);
      }, 3000);
    };
    this.wsChart.onerror = function () {};

    // tick WebSocket：最后一根K线更新（高频）
    this.wsTick = new WebSocket(`${protocol}//${host}:${port}/tick?token=${token}`);
    this.wsTick.onmessage = function (event) {
      const data = JSON.parse(event.data);
      if (data.type === 'tick') {
        onTickUpdate(data.payload);
      }
    };
    this.wsTick.onclose = function () {
      setTimeout(() => {
        self.connect(onIndicatorsUpdate, onChartUpdate, onTickUpdate, onLogReceived);
      }, 3000);
    };
    this.wsTick.onerror = function () {};
  },
};
