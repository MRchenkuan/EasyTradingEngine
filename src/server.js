import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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
  }

  start() {
    if (this.isStarted) return;
    this.isStarted = true;

    this.setupExpress();
    this.setupWebSocket();
    this.redirectConsole();
  }

  setupExpress() {
    this.app.use(express.static(path.join(__dirname, '../public')));

    this.app.get('/', (req, res) => {
      res.sendFile(path.join(__dirname, '../public/index.html'));
    });

    this.app.get('/api/assets', (req, res) => {
      res.json({ success: true, data: Object.keys(this.assetData) });
    });

    this.app.get('/api/assets/:name', (req, res) => {
      const name = req.params.name;
      if (this.assetData[name]) {
        res.json({ success: true, data: this.assetData[name] });
      } else {
        res.status(404).json({ success: false, message: 'Asset not found' });
      }
    });

    this.app.get('/api/logs', (req, res) => {
      res.json({ success: true, data: this.logs.slice(-50) });
    });
  }

  setupWebSocket() {
    this.server = this.app.listen(this.port, () => {
      this.originalConsole.log(`监控服务器已启动，访问 http://localhost:${this.port}`);
    });

    this.wss = new WebSocketServer({ server: this.server });

    this.wss.on('connection', ws => {
      this.originalConsole.log('新的 WebSocket 连接');
      this.clients.add(ws);

      // 发送当前资产列表
      this.sendAssets();

      ws.on('message', message => {
        this.originalConsole.log('收到消息:', message.toString());
      });

      ws.on('close', () => {
        this.originalConsole.log('WebSocket 连接已关闭');
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
      this.originalConsole.log(...args);
    };

    console.error = (...args) => {
      const message = args
        .map(arg => (typeof arg === 'object' ? JSON.stringify(arg) : String(arg)))
        .join(' ');
      addToMonitor(message, 'error');
      this.originalConsole.error(...args);
    };

    console.warn = (...args) => {
      const message = args
        .map(arg => (typeof arg === 'object' ? JSON.stringify(arg) : String(arg)))
        .join(' ');
      addToMonitor(message, 'warn');
      this.originalConsole.warn(...args);
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
