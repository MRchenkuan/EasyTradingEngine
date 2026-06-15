import { parentPort } from 'worker_threads';
import { VisualEngine } from '../TradeEngine/VisualEngine.js';
import { TradeEngine } from '../TradeEngine/TradeEngine.js';

// Worker 线程：独立运行 VisualEngine，不阻塞主线程
class WorkerVisualEngine {
  static _data_cache = {};
  static _painting_interval = 10000;
  static _timer = null;

  static init(config) {
    VisualEngine.setMetaInfo(config);
    this._painting_interval = config.painting_interval || 10000;
  }

  static updateData(data) {
    this._data_cache = data;
    this._applyTradeEngineData();
  }

  static start() {
    this.stop();
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
      // 请求主线程同步最新数据，收到后再绘制
      parentPort.postMessage({ type: 'request_data' });
    } catch (error) {
      parentPort.postMessage({
        type: 'error',
        error: error.message,
        stack: error.stack,
      });
    }
  }

  static doDraw() {
    try {
      this._applyTradeEngineData();
      const status = TradeEngine.checkEngine();
      if (status == 2) {
        VisualEngine.modules.forEach(it => {
          it.draw();
        });
      }
      parentPort.postMessage({
        type: 'draw_complete',
        timestamp: Date.now(),
      });
    } catch (error) {
      parentPort.postMessage({
        type: 'error',
        error: error.message,
        stack: error.stack,
      });
    }
  }

  static _applyTradeEngineData() {
    const data = this._data_cache;
    if (!data || !data.assetNames) return;

    // Mock TradeEngine 静态属性
    TradeEngine._asset_names = data.assetNames || [];
    TradeEngine._beta_map = data.betaMap || {};
    TradeEngine._bar_type = data.barType || '1m';
    TradeEngine.processors = (data.processors || []).map(p => ({
      ...p,
      display: () => {}, // display() 在 GridTradingSlice 中调用但为空实现
    }));

    // Mock TradeEngine 静态方法
    TradeEngine.checkEngine = () => 2;
    TradeEngine.getMarketData = assetId => data.marketData?.[assetId] || {};
    TradeEngine.getAllMarketData = () => data.marketData || {};
    TradeEngine.getCandleData = assetId => data.candleData?.[assetId] || [];
    TradeEngine.getRealtimePrice = assetId => data.realtimePrices?.[assetId] || 0;
    TradeEngine.getRealtimePrices = () => data.realtimePrices || {};
    TradeEngine.getMainAsset = () => data.mainAsset || null;
    TradeEngine.getMainAssetLabels = () => data.mainAssetLabels || [];
    TradeEngine.getAllScaledPrices = () => data.scaledPrices || {};
    TradeEngine.getOrderHistory = params => data.orderHistory?.[params.instId] || [];
    TradeEngine.getRealtimeProfits = () => data.realtimeProfits || {};
    TradeEngine.getAllHistoryProfits = () => data.historyProfits || {};
    TradeEngine.getChipDistribution = assetId => data.chipDistribution?.[assetId] || {};
    TradeEngine.getPositionCost = instId => data.positionCost?.[instId] || {};
    TradeEngine.getPositionList = instId => data.positionList?.[instId] || {};
    TradeEngine._calcPriceGapProfit = (a, b, n) => {
      if (!n || n === 0) return 0;
      return (a - b) / n;
    };
  }
}

// 监听主线程消息
parentPort.on('message', message => {
  const { type, data, config } = message;

  switch (type) {
    case 'init':
      WorkerVisualEngine.init(config);
      break;
    case 'update_data':
      WorkerVisualEngine.updateData(data);
      WorkerVisualEngine.doDraw();
      break;
    case 'start':
      WorkerVisualEngine.start();
      break;
    case 'stop':
      WorkerVisualEngine.stop();
      break;
  }
});
