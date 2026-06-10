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
    this.wss = null;
    this.clients = new Set();
    this.assetData = {};
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
    // API token 验证中间件
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

    // API 路由需要 token 验证
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

    this.wss = new WebSocketServer({
      server: this.server,
      verifyClient: (info, callback) => {
        // 从 URL 参数中获取 token
        const url = new URL(info.req.url, `http://${info.req.headers.host}`);
        const token = url.searchParams.get('token');

        if (token !== this.currentToken) {
          return callback(false, 403, '禁止访问');
        }
        callback(true);
      },
    });

    this.wss.on('connection', ws => {
      this.originalConsole.log(
        `[${new Date().toLocaleString('zh-CN', { hour12: false })}] 新的 WebSocket 连接`
      );
      this.clients.add(ws);

      // 发送当前资产列表
      this.sendAssets();

      ws.on('message', message => {
        this.originalConsole.log('收到消息:', message.toString());
      });

      ws.on('close', () => {
        this.originalConsole.log(
          `[${new Date().toLocaleString('zh-CN', { hour12: false })}] WebSocket 连接已关闭`
        );
        this.clients.delete(ws);
      });

      ws.on('error', error => {
        this.originalConsole.error('WebSocket 错误:', error);
        this.clients.delete(ws);
      });
    });
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
    this.sendAssets();
  }

  addLog(message, level = 'info') {
    const log = {
      timestamp: new Date().toLocaleString('zh-CN'),
      message: message,
      level: level,
    };
    this.logs.push(log);

    // 保持日志数量在合理范围内
    if (this.logs.length > 100) {
      this.logs = this.logs.slice(-100);
    }

    this.sendLogs();
  }

  sendAssets() {
    const data = {
      type: 'assets',
      payload: this.assetData, // 发送完整的资产数据
    };
    this.broadcast(JSON.stringify(data));
  }

  sendLogs() {
    const data = {
      type: 'logs',
      payload: this.logs[this.logs.length - 1],
    };
    this.broadcast(JSON.stringify(data));
  }

  broadcast(message) {
    this.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  }

  stop() {
    this.isStarted = false;

    // 恢复 console
    console.log = this.originalConsole.log;
    console.error = this.originalConsole.error;
    console.warn = this.originalConsole.warn;

    if (this.wss) {
      this.wss.close();
    }
    if (this.server) {
      this.server.close();
    }
    this.originalConsole.log('监控服务器已停止');
  }
}

// 创建单例
const monitorServer = new MonitorServer(8080);
export { monitorServer };
