import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';
import { VisualEngine } from '../TradeEngine/VisualEngine.js';
import { TradeEngine } from '../TradeEngine/TradeEngine.js';

if (!isMainThread) {
  // Worker 线程中的代码
  class WorkerVisualEngine {
    static _data_cache = {};
    static _last_update = 0;
    static _painting_interval = 5000;
    static _timer = null;
    
    static init(config) {
      // 初始化 VisualEngine 配置
      VisualEngine.setMetaInfo(config);
      this.start();
    }
    
    static updateData(data) {
      // 更新缓存的数据
      this._data_cache = data;
      this._last_update = Date.now();
    }
    
    static start() {
      this._timer = setInterval(() => {
        this.draw();
      }, this._painting_interval);
    }
    
    static stop() {
      if (this._timer) {
        clearInterval(this._timer);
        this._timer = null;
      }
    }
    
    static draw() {
      try {
        // 模拟 TradeEngine 的静态数据访问
        this._mockTradeEngineData();
        
        // 执行绘图
        VisualEngine.modules.forEach(module => {
          module.draw();
        });
        
        // 通知主线程绘图完成
        parentPort.postMessage({
          type: 'draw_complete',
          timestamp: Date.now()
        });
      } catch (error) {
        parentPort.postMessage({
          type: 'error',
          error: error.message,
          stack: error.stack
        });
      }
    }
    
    static _mockTradeEngineData() {
      // 使用缓存的数据模拟 TradeEngine 的静态方法
      const data = this._data_cache;
      
      TradeEngine.getMarketData = (assetId, bar) => data.marketData?.[assetId] || {};
      TradeEngine.getCandleData = (assetId, bar_type) => data.candleData?.[assetId]?.[bar_type] || [];
      TradeEngine.getRealtimePrice = (assetId) => data.realtimePrices?.[assetId] || 0;
      TradeEngine.getRealtimePrices = () => data.realtimePrices || {};
      TradeEngine.getMainAssetLabels = () => data.mainAssetLabels || [];
      TradeEngine.getOrderHistory = (params) => data.orderHistory || [];
      TradeEngine.getRealtimeProfits = () => data.realtimeProfits || {};
      TradeEngine.checkEngine = () => 2; // 始终返回运行状态
      TradeEngine._asset_names = data.assetNames || [];
      TradeEngine._beta_map = data.betaMap || {};
      TradeEngine._bar_type = data.barType || '1m';
      TradeEngine.processors = data.processors || [];
    }
  }
  
  // 监听主线程消息
  parentPort.on('message', (message) => {
    const { type, data, config } = message;
    
    switch (type) {
      case 'init':
        WorkerVisualEngine.init(config);
        break;
      case 'update_data':
        WorkerVisualEngine.updateData(data);
        break;
      case 'start':
        WorkerVisualEngine.start();
        break;
      case 'stop':
        WorkerVisualEngine.stop();
        break;
    }
  });
}