import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import os from 'os';
import { config } from 'dotenv';
import { formatTimestamp } from './tools.js';

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
    // 引擎状态 getter，由 main.js 在 TradeEngine 导入后注入
    this._engineStatusGetter = () => '';
    // TradeEngine getter（实时拉取K线数据），由 main.js 注入
    this._tradeEngineGetter = null;
    // VisualEngine getter（实时拉取布林带数据），由 main.js 注入
    this._visualEngineGetter = null;
    // tick debounce 定时器：同一事件循环的多次调用合并为一次
    this._tickDebounceTimer = null;
    // chart debounce 定时器 + 每资产最后一次发送的 K 线时间戳（用于判断是否有新 K 线才推 chart）
    this._chartDebounceTimer = null;
    this._lastChartCandleTs = new Map();
    // indicators debounce 定时器：runAllProcessors 里多个 processor 各触发一次 sendIndicators，合并为一次
    this._indicatorsDebounceTimer = null;
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
    this.accountBalance = null; // 账户余额数据（含 totalEq 总权益，回撤控制口径）
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
    tomorrow.setDate(tomorrow.getDate() + 7);
    tomorrow.setHours(0, 0, 0, 0);

    const timeUntilTomorrow = tomorrow - now;

    setTimeout(() => {
      this.currentToken = this._generateToken();
      this.originalConsole.log(`访问Token已更新: ${this.currentToken}`);
      this.originalConsole.log(
        `新的访问地址: http://154.9.24.206:${this.port}/${this.currentToken}`
      );
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
      this.indicatorClients.add(ws);
      ws.send(
        JSON.stringify({
          type: 'indicators',
          payload: this._extractIndicators(),
        })
      );
      // 连接建立时立即推送最新账户总权益（若已缓存），避免刷新页面后需等待下一次定时刷新
      if (this.accountBalance) {
        ws.send(
          JSON.stringify({
            type: 'accountBalance',
            payload: this.accountBalance,
          })
        );
      }
      ws.on('close', () => this.indicatorClients.delete(ws));
      ws.on('error', () => this.indicatorClients.delete(ws));
    });

    // chart WebSocket：完整K线数据（连接时 + 新K线产生时才推送）
    this.wssChart = new WebSocketServer({ noServer: true, verifyClient });
    this.wssChart.on('connection', ws => {
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

  // 提取完整图表数据：candles/labels/boll 实时拉取 TradeEngine，其余（chip/orders/gridParams）从 assetData 快照取
  _extractChartData() {
    const result = {};
    const TradeEngine = this._tradeEngineGetter?.();
    const VisualEngine = this._visualEngineGetter?.();
    const MAX_CANDLE = 800;

    // 合并两个来源的资产名（启动早期 assetData 可能尚未填充）
    const engineAssetNames = TradeEngine?.processors?.map(p => p.asset_name) || [];
    const allAssetNames = new Set([...Object.keys(this.assetData), ...engineAssetNames]);

    for (const name of allAssetNames) {
      const snapshotChart = this.assetData[name]?.chartData;
      const chartData = {};

      if (TradeEngine) {
        // 实时：candleData
        const candles = TradeEngine.getCandleData(name);
        if (candles && candles.length > 0) {
          chartData.candleData = candles.slice(-MAX_CANDLE).map(it => ({
            open: parseFloat(it.open),
            close: parseFloat(it.close),
            low: parseFloat(it.low),
            high: parseFloat(it.high),
            vol: parseFloat(it.vol),
            ts: parseInt(it.ts),
          }));
          // 实时：labels
          chartData.labels = chartData.candleData.map(c =>
            formatTimestamp(c.ts, TradeEngine._bar_type)
          );
        } else if (snapshotChart?.candleData) {
          chartData.candleData = snapshotChart.candleData;
          chartData.labels = snapshotChart.labels;
        }

        // 实时：boll
        if (VisualEngine) {
          try {
            const boll = VisualEngine.getBOLL(name);
            if (boll) {
              chartData.boll = {
                upper: boll.upperArray.slice(-MAX_CANDLE),
                middle: boll.middleArray.slice(-MAX_CANDLE),
                lower: boll.lowerArray.slice(-MAX_CANDLE),
              };
            }
          } catch (_) {
            /* ignore */
          }
        }
      }

      // 以下字段变化频率低，继续用 assetData 快照
      if (snapshotChart) {
        for (const key of [
          'chipDistribution',
          'chipMaxVolume',
          'chipStep',
          'orders',
          'position',
          'gridParams',
        ]) {
          if (snapshotChart[key] != null) chartData[key] = snapshotChart[key];
        }
      }

      // 至少有 candleData 才输出
      if (chartData.candleData) {
        result[name] = { chartData };
      }
    }
    return result;
  }

  // 提取最后一根K线的 tick 数据（优先实时拉取 TradeEngine/VisualEngine，fallback 到 assetData 快照）
  _extractTick() {
    const result = {};
    const TradeEngine = this._tradeEngineGetter?.();
    const VisualEngine = this._visualEngineGetter?.();

    // 优先使用 TradeEngine 已知资产列表（覆盖启动早期 assetData 尚未填充的场景）
    const engineAssetNames = TradeEngine?.processors?.map(p => p.asset_name) || [];
    const allAssetNames = new Set([...Object.keys(this.assetData), ...engineAssetNames]);

    for (const name of allAssetNames) {
      let lastCandle = null;
      let lastLabel = null;
      let lastBoll = null;

      if (TradeEngine) {
        // 实时拉取：K 线
        const candles = TradeEngine.getCandleData(name);
        if (candles && candles.length > 0) {
          const raw = candles[candles.length - 1];
          lastCandle = {
            open: parseFloat(raw.open),
            close: parseFloat(raw.close),
            low: parseFloat(raw.low),
            high: parseFloat(raw.high),
            vol: parseFloat(raw.vol),
            ts: parseInt(raw.ts),
          };
          // 实时拉取：label（格式化时间戳）
          lastLabel = formatTimestamp(lastCandle.ts, TradeEngine._bar_type);
        }
        // 实时拉取：BOLL
        if (VisualEngine) {
          try {
            const boll = VisualEngine.getBOLL(name);
            if (boll) {
              lastBoll = {};
              for (const band of ['upperArray', 'middleArray', 'lowerArray']) {
                const arr = boll[band];
                const key = band.replace('Array', '');
                if (arr && arr.length > 0) {
                  lastBoll[key] = arr[arr.length - 1];
                }
              }
            }
          } catch (_) {
            /* BOLL 可能尚未就绪，忽略 */
          }
        }
      } else {
        // Fallback：早期 getter 未注入时，使用 assetData 快照
        const chart = this.assetData[name]?.chartData;
        if (chart && chart.candleData && chart.candleData.length > 0) {
          lastCandle = chart.candleData[chart.candleData.length - 1];
          lastLabel = chart.labels ? chart.labels[chart.labels.length - 1] : null;
          if (chart.boll) {
            lastBoll = {};
            for (const band of ['upper', 'middle', 'lower']) {
              if (chart.boll[band] && chart.boll[band].length > 0) {
                lastBoll[band] = chart.boll[band][chart.boll[band].length - 1];
              }
            }
          }
        }
      }

      if (lastCandle) {
        result[name] = { candle: lastCandle, label: lastLabel };
        if (lastBoll) result[name].boll = lastBoll;
      }
    }
    return result;
  }

  /**
   * Debounced tick 推送：将同一事件循环内的多次调用合并为一次。
   * 解决 5 个 processor 各触发一次导致前端收到 5 条重复 tick 的问题。
   */
  _scheduleSendTick() {
    if (this._tickDebounceTimer) return; // 已在排队
    this._tickDebounceTimer = setTimeout(() => {
      this._tickDebounceTimer = null;
      this.sendTick();
    }, 200);
  }

  /** 公开的 tick 推送触发入口：供外部（如 main.js WS 消息处理）调用 */
  notifyTickUpdate() {
    this._scheduleSendTick();
  }

  /**
   * Debounced chart 推送：300ms 窗口合并 + 新 K 线 ts 门控。
   * chart payload 较大（~1MB/资产），只有 K 线时间戳真正变化时才推送，避免每 5s tick 都推送。
   */
  _scheduleSendChart() {
    if (this._chartDebounceTimer) return;
    this._chartDebounceTimer = setTimeout(() => {
      this._chartDebounceTimer = null;
      // 门控：至少有一个资产的最新 K 线 ts 比上次推送的更新，才发送 chart
      const TradeEngine = this._tradeEngineGetter?.();
      let anyNew = false;
      if (TradeEngine) {
        for (const p of TradeEngine.processors) {
          const candles = TradeEngine.getCandleData(p.asset_name);
          const lastTs = candles?.at(-1)?.ts;
          if (lastTs && lastTs !== this._lastChartCandleTs.get(p.asset_name)) {
            anyNew = true;
            this._lastChartCandleTs.set(p.asset_name, lastTs);
          }
        }
      } else {
        // Fallback：getter 未注入时，走原有 candleCount 门控
        for (const [name, data] of Object.entries(this.assetData)) {
          const count = data.chartData?.candleData?.length || 0;
          if (count !== this.lastCandleCount[name]) {
            this.lastCandleCount[name] = count;
            anyNew = true;
          }
        }
      }
      if (anyNew) {
        this.sendChart();
      }
    }, 300);
  }

  /** 公开的 chart 推送触发入口：供外部（如 main.js WS 收到新 K 线时）调用 */
  notifyChartUpdate() {
    this._scheduleSendChart();
  }

  redirectConsole() {
    const addToMonitor = (message, level = 'info') => {
      this.addLog(message, level);
    };

    const buildPrefix = () => {
      const time = `[${new Date().toLocaleString('zh-CN', { hour12: false })}]`;
      const status = this._engineStatusGetter();
      return status ? `${time}[${status}]` : time;
    };

    console.log = (...args) => {
      const message = args
        .map(arg => (typeof arg === 'object' ? JSON.stringify(arg) : String(arg)))
        .join(' ');
      addToMonitor(message, 'info');
      this.originalConsole.log(buildPrefix(), ...args);
    };

    console.error = (...args) => {
      const message = args
        .map(arg => (typeof arg === 'object' ? JSON.stringify(arg) : String(arg)))
        .join(' ');
      addToMonitor(message, 'error');
      this.originalConsole.error(buildPrefix(), ...args);
    };

    console.warn = (...args) => {
      const message = args
        .map(arg => (typeof arg === 'object' ? JSON.stringify(arg) : String(arg)))
        .join(' ');
      addToMonitor(message, 'warn');
      this.originalConsole.warn(buildPrefix(), ...args);
    };
  }

  /** 注入引擎状态 getter，TradeEngine 导入后在 main.js 中调用 */
  setEngineStatusGetter(fn) {
    this._engineStatusGetter = fn;
  }

  /** 注入 TradeEngine getter（避免循环依赖），用于实时拉取 K 线数据 */
  setTradeEngineGetter(fn) {
    this._tradeEngineGetter = fn;
  }

  /** 注入 VisualEngine getter（避免循环依赖），用于实时拉取 BOLL 数据 */
  setVisualEngineGetter(fn) {
    this._visualEngineGetter = fn;
  }

  updateAsset(name, data) {
    this.assetData[name] = data;

    // 判断是否有新K线产生（K线数量变化）
    const candleCount = data.chartData?.candleData?.length || 0;
    const prevCount = this.lastCandleCount[name] || 0;
    const hasNewCandle = candleCount !== prevCount;
    this.lastCandleCount[name] = candleCount;

    this._scheduleSendIndicators();

    // 只有新K线产生时才发送完整 chart 数据（走 debounce，合并多资产调用）
    if (hasNewCandle) {
      this._scheduleSendChart();
    }

    // 每次都发送 tick（最后一根K线更新）—— 经过 debounce，同一批次多次调用合并为一次
    this._scheduleSendTick();
  }

  updateAccountBalance(balance) {
    this.accountBalance = balance;
    // 通过 indicators 通道推送账户总权益
    this.sendAccountBalance();
  }

  sendAccountBalance() {
    if (!this.accountBalance) return;
    const data = JSON.stringify({
      type: 'accountBalance',
      payload: this.accountBalance,
    });
    this.indicatorClients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    });
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

  /** Debounced indicators 推送：合并同一批次 runAllProcessors 里多个 processor 的多次调用 */
  _scheduleSendIndicators() {
    if (this._indicatorsDebounceTimer) return;
    this._indicatorsDebounceTimer = setTimeout(() => {
      this._indicatorsDebounceTimer = null;
      this.sendIndicators();
    }, 200);
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
