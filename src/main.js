import './utils/logger.js';
import WebSocket from 'ws';
import {
  getPrices,
  parseCandleData,
  getLastWholeMinute,
  getHistoryPrices,
  getHistoryOpenInterest,
} from './tools.js';
import { base_url } from '../config.security.js';
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
const open_inerest_limit = KLine.open_inerest_limit;
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
          total_limit: open_inerest_limit || params.candle_limit,
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
async function initializeData() {
  try {
    const klines = await getKlinesWithRetry(assetIds, params);
    if (klines && klines.length > 0) {
      klines.forEach(it => {
        const { id, prices, ts, orign_data } = it;
        TradeEngine.updateCandleDates(id, bar_type, orign_data);
        TradeEngine.updatePrices(id, prices, ts, bar_type);
      });
      console.log('数据初始化成功');
      return true;
    } else {
      console.error('获取K线数据失败，将重试');
      return false;
    }
  } catch (error) {
    console.error('初始化数据失败:', error.message);
    return false;
  }
}

// 持续尝试初始化数据
async function tryInitializeData() {
  let success = false;
  let attempts = 0;
  const maxAttempts = 10;

  while (!success && attempts < maxAttempts) {
    attempts++;
    console.log(`尝试初始化数据 (${attempts}/${maxAttempts})...`);
    success = await initializeData();
    if (!success) {
      console.log('初始化失败，5秒后重试...');
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }

  if (!success) {
    console.error('达到最大初始化尝试次数，服务将在后台继续尝试');
    // 不退出服务，而是继续运行，后台会定期尝试
  }
}

// 启动数据初始化
tryInitializeData();

// 启动 WebSocket 连接
initBusinessWebSocket();

function initBusinessWebSocket() {
  const ws = new WebSocket(base_url + '/ws/v5/business');
  storeConnection('ws_business', ws);

  ws.on('open', () => {
    console.log('ws_business已连接到服务器');
    assets.map(async it => {
      await subscribeKlineChanel(ws, 'candle' + bar_type, it.id);
    });
  });

  ws.on('message', message => {
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

  ws.on('error', error => {
    console.error('ws_business WebSocket 错误:', error.message);
    // 触发关闭事件，进入重连逻辑
    handleWebSocketClose(1011, error.message); // 使用一个自定义的错误码，例如 1011
  });

  ws.on('close', handleWebSocketClose);
}

// 全局重连尝试计数器
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 50; // 增加最大重连尝试次数
const RECONNECT_DELAY = 5000; // 重连延迟时间

async function handleWebSocketClose(code, reason) {
  console.log(`ws_business连接已关闭, 关闭码: ${code}, 原因: ${reason}`);

  // 停止引擎
  TradeEngine.stop();
  VisualEngine.stop();

  reconnectAttempts++;
  if (reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
    console.error(`达到最大重连尝试次数 (${MAX_RECONNECT_ATTEMPTS})，将在1分钟后再次尝试。`);
    // 不退出程序，而是等待一段时间后重新尝试
    await new Promise(resolve => setTimeout(resolve, 60000));
    reconnectAttempts = 0;
  }

  // 等待重连延迟后重新初始化
  await new Promise(resolve => setTimeout(resolve, RECONNECT_DELAY));
  console.log(`正在尝试重新连接... (第 ${reconnectAttempts} 次尝试)`);

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

      // 重置重连尝试计数器
      reconnectAttempts = 0;
      // 重新建立连接
      initBusinessWebSocket();
    } else {
      console.error('获取K线数据失败，将再次尝试');
      // 继续重试
      handleWebSocketClose(code, reason);
    }
  } catch (error) {
    console.error('重连失败:', error.message);
    // 继续重试，不退出
    handleWebSocketClose(code, reason);
  }
}

// 全局错误处理
process.on('uncaughtException', error => {
  console.error('未捕获的异常:', error);
  console.error('服务将继续运行，尝试自动恢复...');
  // 不退出进程，让服务继续运行
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('未处理的Promise拒绝:', reason);
  console.error('服务将继续运行，尝试自动恢复...');
  // 不退出进程，让服务继续运行
});

// 信号处理，确保在用户按下ctrl+c时能够正确关闭应用
function handleShutdown() {
  console.log('\n收到关闭信号，正在关闭服务...');

  // 停止交易引擎
  TradeEngine.stop();

  // 停止可视化引擎
  VisualEngine.stop();

  // 关闭WebSocket连接
  Object.values(ws_connection_pool).forEach(ws => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.close();
    }
  });

  // 清除所有定时器
  Object.values(TradeEngine._timer).forEach(timer => {
    clearTimeout(timer);
  });

  Object.values(TradeEngine._instrument_timers).forEach(timer => {
    clearTimeout(timer);
  });

  Object.values(TradeEngine._position_timers).forEach(timer => {
    clearTimeout(timer);
  });

  console.log('服务已关闭');
  process.exit(0);
}

// 处理ctrl+c信号
process.on('SIGINT', handleShutdown);

// 处理终止信号
process.on('SIGTERM', handleShutdown);

// 保存一个ws链接
function storeConnection(conn_id, ws) {
  ws_connection_pool[conn_id] = ws;
}
