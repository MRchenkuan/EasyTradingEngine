import { Worker } from 'worker_threads';
import { TradeEngine } from '../TradeEngine/TradeEngine.js';

// 将 LocalVariable (Proxy) 转为普通对象，以便 postMessage 序列化
function toPlainObject(obj) {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== 'object') return obj;
  try {
    return JSON.parse(JSON.stringify(obj));
  } catch {
    return {};
  }
}

class VisualWorkerManager {
  static _worker = null;

  static init(config) {
    this._worker = new Worker(new URL('./VisualWorker.js', import.meta.url));

    this._worker.on('message', msg => {
      if (msg.type === 'error') {
        console.error('[VisualWorker] 渲染错误:', msg.error);
      } else if (msg.type === 'request_data') {
        this._syncData();
      }
    });

    this._worker.postMessage({
      type: 'init',
      config,
    });
  }

  static start() {
    this._syncData();
    this._worker?.postMessage({ type: 'start' });
  }

  static stop() {
    this._worker?.postMessage({ type: 'stop' });
  }

  static _syncData() {
    const worker = this._worker;
    if (!worker) return;

    const assetNames = TradeEngine._asset_names;
    const marketData = {};
    const candleData = {};
    const realtimePrices = {};
    const orderHistory = {};
    const chipDistribution = {};
    const positionCost = {};
    const positionList = {};

    assetNames.forEach(id => {
      marketData[id] = toPlainObject(TradeEngine.getMarketData(id));
      candleData[id] = toPlainObject(TradeEngine.getCandleData(id));
      realtimePrices[id] = TradeEngine.getRealtimePrice(id);
      orderHistory[id] = toPlainObject(
        TradeEngine.getOrderHistory({ instType: 'SPOT', instId: id, state: 'filled', limit: '100' })
      );
      chipDistribution[id] = toPlainObject(TradeEngine.getChipDistribution(id));
      positionCost[id] = toPlainObject(TradeEngine.getPositionCost(id));
      positionList[id] = toPlainObject(TradeEngine.getPositionList(id));
    });

    worker.postMessage({
      type: 'update_data',
      data: {
        assetNames,
        betaMap: toPlainObject(TradeEngine._beta_map),
        barType: TradeEngine._bar_type,
        marketData,
        candleData,
        realtimePrices,
        mainAsset: toPlainObject(TradeEngine.getMainAsset()),
        mainAssetLabels: TradeEngine.getMainAssetLabels(),
        scaledPrices: toPlainObject(TradeEngine.getAllScaledPrices()),
        orderHistory,
        realtimeProfits: toPlainObject(TradeEngine.getRealtimeProfits()),
        historyProfits: toPlainObject(TradeEngine.getAllHistoryProfits()),
        chipDistribution,
        positionCost,
        positionList,
        processors: TradeEngine.processors.map(p => ({
          type: p.type,
          asset_name: p.asset_name,
          _position_risk_level: p._position_risk_level,
        })),
      },
    });
  }
}

export { VisualWorkerManager };
