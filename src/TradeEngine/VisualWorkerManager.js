import { Worker } from 'worker_threads';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class VisualWorkerManager {
  static worker = null;
  static _data_sync_interval = 2000; // 数据同步间隔
  static _sync_timer = null;
  static _config = null;
  
  static init(config) {
    this._config = config;
    this._createWorker();
  }
  
  static _createWorker() {
    const workerPath = path.join(__dirname, '../workers/VisualWorker.js');
    
    this.worker = new Worker(workerPath, {
      type: 'module'
    });
    
    // 监听 Worker 消息
    this.worker.on('message', (message) => {
      const { type, error, timestamp } = message;
      
      switch (type) {
        case 'draw_complete':
          console.log(`图表绘制完成: ${new Date(timestamp).toLocaleTimeString()}`);
          break;
        case 'error':
          console.error('VisualWorker 错误:', error);
          this._restartWorker();
          break;
      }
    });
    
    // 监听 Worker 错误
    this.worker.on('error', (error) => {
      console.error('Worker 线程错误:', error);
      this._restartWorker();
    });
    
    // 监听 Worker 退出
    this.worker.on('exit', (code) => {
      if (code !== 0) {
        console.error(`Worker 异常退出，代码: ${code}`);
        this._restartWorker();
      }
    });
    
    // 初始化 Worker
    this.worker.postMessage({
      type: 'init',
      config: this._config
    });
  }
  
  static start() {
    // 启动数据同步
    this._sync_timer = setInterval(() => {
      this._syncData();
    }, this._data_sync_interval);
    
    // 启动 Worker 绘图
    this.worker?.postMessage({ type: 'start' });
  }
  
  static stop() {
    if (this._sync_timer) {
      clearInterval(this._sync_timer);
      this._sync_timer = null;
    }
    
    this.worker?.postMessage({ type: 'stop' });
    this.worker?.terminate();
    this.worker = null;
  }
  
  static _syncData() {
    try {
      // 收集 TradeEngine 的数据
      const data = this._collectTradeEngineData();
      
      // 发送数据到 Worker
      this.worker?.postMessage({
        type: 'update_data',
        data
      });
    } catch (error) {
      console.error('数据同步失败:', error);
    }
  }
  
  static async _collectTradeEngineData() {
    const { TradeEngine } = await import('./TradeEngine.js');
    
    return {
      marketData: TradeEngine.getAllMarketData(),
      candleData: TradeEngine.market_candle,
      realtimePrices: TradeEngine.getRealtimePrices(),
      mainAssetLabels: TradeEngine.getMainAssetLabels(),
      orderHistory: TradeEngine._show_order_his.map(assetName => 
        TradeEngine.getOrderHistory({
          instType: 'SPOT',
          instId: assetName,
          state: 'filled',
          limit: '100'
        })
      ),
      realtimeProfits: TradeEngine.getRealtimeProfits(),
      assetNames: TradeEngine._asset_names,
      betaMap: TradeEngine._beta_map.value,
      barType: TradeEngine._bar_type,
      processors: TradeEngine.processors.map(p => ({
        type: p.type,
        asset_names: p.asset_names,
        // 只传递必要的数据，避免循环引用
      }))
    };
  }
  
  static _restartWorker() {
    console.log('重启 VisualWorker...');
    this.stop();
    setTimeout(() => {
      this._createWorker();
      this.start();
    }, 1000);
  }
}