import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import os from 'os';
import { config } from 'dotenv';

config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TOKEN_SALT = process.env.TOKEN_SALT;

function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

export class MonitorServer {
  constructor(port = 8080) {
    this.port = port;
    this.app = express();
    this.server = null;
    // 三个 WebSocket 通道：
    // indicators - 轻量指标（position, gridParams, shouldTrade 等）
    // chart - 完整K线数据（连接时 + 新K线产生时）
    // tick - 最后一根K线更新（高频）
    this.wssIndicators = null;
    this.wssChart = null;
    this.wssTick = null;
    this.indicatorClients = new Set();
    this.chartClients = new Set();
    this.tickClients = new Set();
    this.assetData = {};
    this.lastCandleCount = {}; // 记录每个资产上次发送的K线数量，用于判断是否有新K线
    this.logs = [];
    this.originalConsole = {
      log: console.log.bind(console),
      error: console.error.bind(console),
      warn: console.warn.bind(console),
    };
    this.isStarted = false;
    this.currentToken = this._generateToken();
    this.localIP = getLocalIP();
    this._scheduleDailyTokenUpdate();
  }

  _generateToken() {
    const dateStr = new Date().toISOString().split('T')[0];
    const input = `${dateStr}-${TOKEN_SALT}`;
    const hash = crypto.createHash('md5').update(input).digest('hex');
    return hash.substring(0, 8);
  }

  _scheduleDailyTokenUpdate() {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);

    const timeUntilTomorrow = tomorrow - now;

    setTimeout(() => {
      this.currentToken = this._generateToken();
      this.originalConsole.log(`访问Token已更新: ${this.currentToken}`);
      this.originalConsole.log(`新的访问地址: http://localhost:${this.port}/${this.currentToken}`);
      this._scheduleDailyTokenUpdate();
    }, timeUntilTomorrow);
  }

  start() {
    if (this.isStarted) return;
    this.isStarted = true;

    this.setupExpress();
    this.redirectConsole();
    this.setupWebSocket();
  }

  setupExpress() {
    const validateToken = (req, res, next) => {
      const token = req.query.token || req.headers['x-auth-token'];
      if (token !== this.currentToken) {
        return res.status(403).json({ success: false, message: '禁止访问' });
      }
      next();
    };

    this.app.get('/', (_req, res) => {
      res.status(403).send('禁止访问');
    });

    this.app.get('/:token', (req, res, next) => {
      const token = req.params.token;
      const excludedPaths = ['api', 'js', 'css', 'images', 'assets'];
      if (excludedPaths.includes(token)) {
        return next();
      }
      if (token !== this.currentToken) {
        return res.status(403).send('禁止访问');
      }
      res.sendFile(path.join(__dirname, '../public/index.html'));
    });

    this.app.use(express.static(path.join(__dirname, '../public')));

    this.app.get('/api/assets', validateToken, (_req, res) => {
      res.json({ success: true, data: Object.keys(this.assetData) });
    });

    this.app.get('/api/assets/:name', validateToken, (req, res) => {
      const name = req.params.name;
      if (this.assetData[name]) {
        res.json({ success: true, data: this.assetData[name] });
      } else {
        res.status(404).json({ success: false, message: 'Asset not found' });
      }
    });

    this.app.get('/api/logs', validateToken, (_req, res) => {
      res.json({ success: true, data: this.logs.slice(-50) });
    });
  }

  setupWebSocket() {
    this.server = this.app.listen(this.port, () => {
      console.log(
        `监控服务器已启动，访问 http://${this.localIP}:${this.port}/${this.currentToken}`
      );
    });

    const verifyClient = (info, callback) => {
      const url = new URL(info.req.url, `http://${info.req.headers.host}`);
      const token = url.searchParams.get('token');
      if (token !== this.currentToken) {
        return callback(false, 403, '禁止访问');
      }
      callback(true);
    };

    // indicators WebSocket：轻量数据
    this.wssIndicators = new WebSocketServer({ noServer: true, verifyClient });
    this.wssIndicators.on('connection', ws => {
      this.originalConsole.log(
        `[${new Date().toLocaleString('zh-CN', { hour12: false })}] 新的 indicators WebSocket 连接`
      );
      this.indicatorClients.add(ws);
      ws.send(
        JSON.stringify({
          type: 'indicators',
          payload: this._extractIndicators(),
        })
      );
      ws.on('close', () => this.indicatorClients.delete(ws));
      ws.on('error', () => this.indicatorClients.delete(ws));
    });

    // chart WebSocket：完整K线数据（连接时 + 新K线产生时才推送）
    this.wssChart = new WebSocketServer({ noServer: true, verifyClient });
    this.wssChart.on('connection', ws => {
      this.originalConsole.log(
        `[${new Date().toLocaleString('zh-CN', { hour12: false })}] 新的 chart WebSocket 连接`
      );
      this.chartClients.add(ws);
      ws.send(
        JSON.stringify({
          type: 'chart',
          payload: this._extractChartData(),
        })
      );
      ws.on('close', () => this.chartClients.delete(ws));
      ws.on('error', () => this.chartClients.delete(ws));
    });

    // tick WebSocket：最后一根K线更新（高频）
    this.wssTick = new WebSocketServer({ noServer: true, verifyClient });
    this.wssTick.on('connection', ws => {
      this.originalConsole.log(
        `[${new Date().toLocaleString('zh-CN', { hour12: false })}] 新的 tick WebSocket 连接`
      );
      this.tickClients.add(ws);
      // 连接时发送当前最后一根K线
      ws.send(
        JSON.stringify({
          type: 'tick',
          payload: this._extractTick(),
        })
      );
      ws.on('close', () => this.tickClients.delete(ws));
      ws.on('error', () => this.tickClients.delete(ws));
    });

    // 根据 URL 路径分发
    this.server.on('upgrade', (request, socket, head) => {
      const url = new URL(request.url, `http://${request.headers.host}`);
      const pathname = url.pathname;

      if (pathname === '/chart') {
        this.wssChart.handleUpgrade(request, socket, head, ws => {
          this.wssChart.emit('connection', ws, request);
        });
      } else if (pathname === '/tick') {
        this.wssTick.handleUpgrade(request, socket, head, ws => {
          this.wssTick.emit('connection', ws, request);
        });
      } else {
        this.wssIndicators.handleUpgrade(request, socket, head, ws => {
          this.wssIndicators.emit('connection', ws, request);
        });
      }
    });
  }

  // 提取指标数据（轻量，不含 chartData）
  _extractIndicators() {
    const result = {};
    for (const [name, data] of Object.entries(this.assetData)) {
      const { chartData, ...indicators } = data;
      result[name] = indicators;
    }
    return result;
  }

  // 提取完整图表数据
  _extractChartData() {
    const result = {};
    for (const [name, data] of Object.entries(this.assetData)) {
      if (data.chartData) {
        result[name] = { chartData: data.chartData };
      }
    }
    return result;
  }

  // 提取最后一根K线的 tick 数据
  _extractTick() {
    const result = {};
    for (const [name, data] of Object.entries(this.assetData)) {
      const chart = data.chartData;
      if (chart && chart.candleData && chart.candleData.length > 0) {
        const lastCandle = chart.candleData[chart.candleData.length - 1];
        const lastLabel = chart.labels ? chart.labels[chart.labels.length - 1] : null;
        const tick = { candle: lastCandle, label: lastLabel };
        // boll 最后一组值
        if (chart.boll) {
          tick.boll = {};
          for (const band of ['upper', 'middle', 'lower']) {
            if (chart.boll[band] && chart.boll[band].length > 0) {
              tick.boll[band] = chart.boll[band][chart.boll[band].length - 1];
            }
          }
        }
        result[name] = tick;
      }
    }
    return result;
  }

  redirectConsole() {
    const addToMonitor = (message, level = 'info') => {
      this.addLog(message, level);
    };

    console.log = (...args) => {
      const message = args
        .map(arg => (typeof arg === 'object' ? JSON.stringify(arg) : String(arg)))
        .join(' ');
      addToMonitor(message, 'info');
      this.originalConsole.log(
        `[${new Date().toLocaleString('zh-CN', { hour12: false })}]`,
        ...args
      );
    };

    console.error = (...args) => {
      const message = args
        .map(arg => (typeof arg === 'object' ? JSON.stringify(arg) : String(arg)))
        .join(' ');
      addToMonitor(message, 'error');
      this.originalConsole.error(
        `[${new Date().toLocaleString('zh-CN', { hour12: false })}]`,
        ...args
      );
    };

    console.warn = (...args) => {
      const message = args
        .map(arg => (typeof arg === 'object' ? JSON.stringify(arg) : String(arg)))
        .join(' ');
      addToMonitor(message, 'warn');
      this.originalConsole.warn(
        `[${new Date().toLocaleString('zh-CN', { hour12: false })}]`,
        ...args
      );
    };
  }

  updateAsset(name, data) {
    this.assetData[name] = data;

    // 判断是否有新K线产生（K线数量变化）
    const candleCount = data.chartData?.candleData?.length || 0;
    const prevCount = this.lastCandleCount[name] || 0;
    const hasNewCandle = candleCount !== prevCount;
    this.lastCandleCount[name] = candleCount;

    this.sendIndicators();

    // 只有新K线产生时才发送完整 chart 数据
    if (hasNewCandle) {
      this.sendChart();
    }

    // 每次都发送 tick（最后一根K线更新）
    this.sendTick();
  }

  addLog(message, level = 'info') {
    const log = {
      timestamp: new Date().toLocaleString('zh-CN'),
      message: message,
      level: level,
    };
    this.logs.push(log);

    if (this.logs.length > 100) {
      this.logs = this.logs.slice(-100);
    }

    this.sendLogs();
  }

  sendIndicators() {
    const data = JSON.stringify({
      type: 'indicators',
      payload: this._extractIndicators(),
    });
    this.indicatorClients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    });
  }

  sendChart() {
    const data = JSON.stringify({
      type: 'chart',
      payload: this._extractChartData(),
    });
    this.chartClients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    });
  }

  sendTick() {
    const data = JSON.stringify({
      type: 'tick',
      payload: this._extractTick(),
    });
    this.tickClients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    });
  }

  sendLogs() {
    const data = JSON.stringify({
      type: 'logs',
      payload: this.logs[this.logs.length - 1],
    });
    this.indicatorClients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    });
  }

  stop() {
    this.isStarted = false;

    console.log = this.originalConsole.log;
    console.error = this.originalConsole.error;
    console.warn = this.originalConsole.warn;

    if (this.wssIndicators) this.wssIndicators.close();
    if (this.wssChart) this.wssChart.close();
    if (this.wssTick) this.wssTick.close();
    if (this.server) this.server.close();

    this.originalConsole.log('监控服务器已停止');
  }
}

const monitorServer = new MonitorServer(8080);
export { monitorServer };
