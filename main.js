import WebSocket from 'ws';
import { getPrices, parseCandleData, getLastWholeMinute } from './src/tools.js';
import { base_url } from './src/config.security.js';
import { subscribeKlineChanel } from './src/api.js';
import { TradeEngine } from './src/TradeEngine/TradeEngine.js';
import { VisualEngine } from './src/TradeEngine/VisualEngine.js';

const ws_connection_pool = {};

const bar_type = '15m';
const price_type = 'close';
const once_limit = 300;
const candle_limit = 2000;
const assets = [
  { id: 'BTC-USDT', theme: '#f0b27a' },
  { id: 'SOL-USDT', theme: '#ad85e9' },
  { id: 'ETH-USDT', theme: '#85c1e9' },
  { id: 'TRUMP-USDT', theme: '#90a4ae' },
  { id: 'XRP-USDT', theme: '#ffafde' },
  // { id: 'OKB-USDT', theme: '#52be80' },
  { id: 'ADA-USDT', theme: '#85dfe9' },
];
const params = {
  bar_type,
  price_type,
  once_limit,
  candle_limit,
  // from_when: new Date(2025,2,7,0,0,0).getTime(), // 指定结束时间
  // to_when:new Date(2025,2,15,0,0,0).getTime(), // 指定起始时间
  from_when: getLastWholeMinute(new Date()), // 最近时间
  to_when: new Date(Date.now() - 12 * 24 * 60 * 60 * 1000).getTime(), // 12天前
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
TradeEngine.createHedge(['BTC-USDT', 'ETH-USDT'], 200, 0.02);
TradeEngine.createHedge(['OKB-USDT', 'ETH-USDT'], 200, 0.02);
TradeEngine.createHedge(['OKB-USDT', 'BTC-USDT'], 200, 0.02);
TradeEngine.createHedge(['SOL-USDT', 'BTC-USDT'], 200, 0.02);
TradeEngine.createHedge(['XRP-USDT', 'BTC-USDT'], 2000, 0.01);

/**
 * 启动网格交易
 */
TradeEngine.createGridTrading('SOL-USDT', {
  _grid_width: 0.005,
  _max_drawdown: 0.005,
  _max_bounce: 0.005,
  _trade_amount: 0.8,
  _max_position: 20,
  _start_position: 0,
  _min_price: 50,
  _max_price: 250,
});

TradeEngine.createGridTrading('XRP-USDT', {
  _grid_width: 0.005,
  _max_drawdown: 0.005,
  _max_bounce: 0.005,
  _trade_amount: 50,
  _max_position: 2000,
  _min_price: 1,
  _max_price: 4,
});

TradeEngine.createGridTrading('ETH-USDT', {
  _grid_width: 0.005,
  _max_drawdown: 0.005,
  _max_bounce: 0.005,
  _trade_amount: 0.06,
  _max_position: 1,
  _min_price: 1500,
  _max_price: 2800,
});

TradeEngine.createGridTrading('BTC-USDT', {
  _grid_width: 0.005,
  _max_drawdown: 0.005,
  _max_bounce: 0.005,
  _trade_amount: 0.002,
  _max_position: 0.05,
  _min_price: 60000,
  _max_price: 100000,
});

/**
 * 启动图像引擎
 */
VisualEngine.setMetaInfo({
  assets,
  show_order_his: [
    'BTC-USDT',
    'ETH-USDT',
    'XRP-USDT',
    'SOL-USDT',
    'TRUMP-USDT',
    'ADA-USDT',
    // 'OKB-USDT',
  ],
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
        const data = await getPrices(id, params);
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
    klines.forEach(({ id, prices, ts }) => {
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
      TradeEngine.updatePrice(instId, close, ts, bar_type);
    }
  }
});

ws_business.on('close', (code, reason) => {
  TradeEngine.stop();
  VisualEngine.stop();
  console.log(`ws_business连接已关闭, 关闭码: ${code}, 原因: ${reason}`);
});

// 保存一个ws链接
function storeConnection(conn_id, ws) {
  ws_connection_pool[conn_id] = ws;
}
