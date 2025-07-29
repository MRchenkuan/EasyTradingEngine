import './utils/logger.js';
import WebSocket from 'ws';
import { getPrices, parseCandleData, getLastWholeMinute, getHistoryPrices, getHistoryOpenInterest } from './tools.js';
import { base_url } from './config.security.js';
import { subscribeKlineChanel } from './api.js';
import { TradeEngine } from './TradeEngine/TradeEngine.js';
import { VisualEngine } from './TradeEngine/VisualEngine.js';
import { KLine, MainGraph, Strategies } from '../config.js';

const ws_connection_pool = {};

const bar_type = KLine.bar_type;
const duration = KLine.max_days;
const price_type = 'close';
const once_limit = 300;
const candle_limit = KLine.candle_limit;
const assets = MainGraph.assets;
const params = {
  bar_type,
  price_type,
  once_limit,
  candle_limit,
  // from_when: new Date(2025,2,7,0,0,0).getTime(), // 指定结束时间
  // to_when:new Date(2025,2,15,0,0,0).getTime(), // 指定起始时间
  from_when: getLastWholeMinute(new Date()), // 最近时间
  to_when: new Date(Date.now() - duration * 24 * 60 * 60 * 1000).getTime(),
};

/**
 * 启动交易引擎
 */
TradeEngine.setMetaInfo({
  main_asset: assets[0].id,
  bar_type,
  once_limit,
  candle_limit,
  assets,
}).start();

/**
 * 创建对冲交易
 */
// TradeEngine.createHedge(['BTC-USDT', 'ETH-USDT'], 200, 0.02);
// TradeEngine.createHedge(['OKB-USDT', 'ETH-USDT'], 200, 0.02);
// TradeEngine.createHedge(['OKB-USDT', 'BTC-USDT'], 200, 0.02);
// TradeEngine.createHedge(['SOL-USDT', 'BTC-USDT'], 200, 0.02);
// TradeEngine.createHedge(['XRP-USDT', 'BTC-USDT'], 2000, 0.01);

/**
 * 启动网格交易
 */

Strategies.forEach(strategy => {
  TradeEngine.createGridTrading(strategy.params.assetId, strategy.params);
});

/**
 * 启动图像引擎
 */
VisualEngine.setMetaInfo({
  assets,
  show_order_his: MainGraph.order_his_show,
}).start();

const assetIds = assets.map(it => it.id);

// 添加重试逻辑
const getKlinesWithRetry = async (assetIds, params, maxRetries = 5) => {
  const results = [];
  let globalRetries = 0; // 全局重试次数

  for (const id of assetIds) {
    let success = false;

    while (globalRetries < maxRetries && !success) {
      try {
        const data_realtime = await getPrices(id, params);
        const data_history = await getHistoryPrices(id, params);
        const data_open_interest = await getHistoryOpenInterest(id, {
          to_when: params.to_when,
          from_when: params.from_when,
          bar_type: params.bar_type,
          once_limit: 100,
          total_limit: params.candle_limit,
        });
        TradeEngine.setOpenInterest(id, params.bar_type, data_open_interest);

        const data = {
          id,
          prices: data_realtime.prices.concat(data_history.prices),
          ts: data_realtime.ts.concat(data_history.ts),
          orign_data: data_realtime.orign_data.concat(data_history.orign_data),
        };

        if (data && data.prices && data.ts) {
          results.push(data);
          success = true;
          globalRetries = 0; // 成功后重置重试次数
        } else {
          throw new Error('Invalid data received');
        }
      } catch (error) {
        globalRetries++;
        console.error(`获取 ${id} 数据失败 (${globalRetries}/${maxRetries}):`, error.message);

        if (globalRetries === maxRetries) {
          console.error(`无法获取 ${id} 数据，已达到最大重试次数`);
          throw new Error(`Failed to fetch data for ${id} after ${maxRetries} retries`);
        }

        // 指数退避重试
        const delay = Math.min((1000 * globalRetries) / 2, 1000);
        console.log(`等待 ${delay / 1000} 秒后重试...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  return results;
};

// 修改数据获取逻辑的错误处理
try {
  const klines = await getKlinesWithRetry(assetIds, params);
  if (klines && klines.length > 0) {
    klines.forEach(it => {
      const { id, prices, ts, orign_data } = it;
      TradeEngine.updateCandleDates(id, bar_type, orign_data);
      TradeEngine.updatePrices(id, prices, ts, bar_type);
    });
  } else {
    throw new Error('获取K线数据失败');
  }
} catch (error) {
  console.error('初始化数据失败:', error.message);
  process.exit(1);
}

const ws_business = new WebSocket(base_url + '/ws/v5/business');
storeConnection('ws_business', ws_business);

ws_business.on('open', () => {
  console.log('ws_business已连接到服务器');
  assets.map(async it => {
    await subscribeKlineChanel(ws_business, 'candle' + bar_type, it.id);
  });
});

ws_business.on('message', message => {
  const { arg = {}, data } = JSON.parse(message.toString());
  const { channel, instId } = arg;
  if (channel.indexOf('candle') === 0) {
    if (data) {
      const { open, close, ts } = parseCandleData(data[0]);
      TradeEngine.updateCandleData(instId, bar_type, data[0]);
      TradeEngine.updatePrice(instId, close, ts, bar_type);
    }
  }
});

ws_business.on('close', async (code, reason) => {
  console.log(`ws_business连接已关闭, 关闭码: ${code}, 原因: ${reason}`);

  // 停止引擎
  TradeEngine.stop();
  VisualEngine.stop();

  // 等待5秒后重新初始化
  await new Promise(resolve => setTimeout(resolve, 5000));
  console.log('正在尝试重新连接...');

  try {
    // 重新获取数据
    const klines = await getKlinesWithRetry(assetIds, {
      ...params,
      from_when: getLastWholeMinute(new Date()),
      to_when: new Date(Date.now() - 12 * 24 * 60 * 60 * 1000).getTime(),
    });

    if (klines && klines.length > 0) {
      // 更新数据
      klines.forEach(it => {
        const { id, prices, ts, orign_data } = it;
        TradeEngine.updateCandleDates(id, bar_type, orign_data);
        TradeEngine.updatePrices(id, prices, ts, bar_type);
      });

      // 重新启动引擎
      TradeEngine.start();
      VisualEngine.start();

      // 重新建立WebSocket连接
      const new_ws = new WebSocket(base_url + '/ws/v5/business');
      storeConnection('ws_business', new_ws);

      // 重新绑定事件处理
      new_ws.on('open', () => {
        console.log('ws_business重新连接成功');
        assets.map(async it => {
          await subscribeKlineChanel(new_ws, 'candle' + bar_type, it.id);
        });
      });

      new_ws.on('message', message => {
        const { arg = {}, data } = JSON.parse(message.toString());
        const { channel, instId } = arg;
        if (channel.indexOf('candle') === 0 && data) {
          const { open, close, ts } = parseCandleData(data[0]);
          TradeEngine.updateCandleData(instId, bar_type, data[0]);
          TradeEngine.updatePrice(instId, close, ts, bar_type);
        }
      });

      // 递归绑定close事件
      new_ws.on('close', ws_business.listeners('close')[0]);
    } else {
      throw new Error('获取K线数据失败');
    }
  } catch (error) {
    console.error('重连失败:', error.message);
    // 递归重试
    setTimeout(() => ws_business.emit('close', code, reason), 5000);
  }
});

// 保存一个ws链接
function storeConnection(conn_id, ws) {
  ws_connection_pool[conn_id] = ws;
}
