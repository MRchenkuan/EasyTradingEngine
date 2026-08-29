import { monitorServer } from './server.js';
// 立即启动监控服务器，在任何日志输出之前
monitorServer.start();

// ---------------------------------------------------------------------------
// 调试开关：云端排查时设置环境变量 DEBUG=okx 开启
// ---------------------------------------------------------------------------
const _DEBUG = process.env.DEBUG?.includes('okx');
const dbg = (...args) => _DEBUG && console.log('[DEBUG]', ...args);

import WebSocket from 'ws';
import {
  getPrices,
  parseCandleData,
  getLastWholeMinute,
  getHistoryPrices,
  getHistoryOpenInterest,
} from './tools.js';
import { base_url } from '../config.security.js';
import { subscribeKlineChanel, getMarketCallCount } from './api.js';
import { TradeEngine } from './TradeEngine/TradeEngine.js';
import { VisualEngine } from './TradeEngine/VisualEngine.js';
import { startAutoFlush, stopAutoFlush } from './TradeEngine/KlineLogger.js';
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
// 注入引擎状态 getter，让日志行首带上 [IDLE]/[BOOT]/[RUN]/[ERR]
monitorServer.setEngineStatusGetter(() => TradeEngine.getStatusLabel());

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
VisualEngine.setTradeEngine(TradeEngine);
VisualEngine.setMetaInfo({
  assets,
  show_order_his: MainGraph.order_his_show,
}).start();

const assetIds = assets.map(it => it.id);

// ---------------------------------------------------------------------------
// WS 重连状态（必须在 initBusinessWebSocket 之前声明）
// ---------------------------------------------------------------------------
let reconnectAttempts = 0;
let isReconnecting = false; // 防止并发重连
const MAX_RECONNECT_ATTEMPTS = 10; // 最大重连尝试次数
const BACKOFF_BASE = 5000; // 基础重试间隔（毫秒）
const BACKOFF_MULTIPLIER = 1.5; // 指数退避乘数
const MAX_BACKOFF = 60000; // 最大重试间隔（毫秒）

// 添加重试逻辑
const getKlinesWithRetry = async (assetIds, params, maxRetries = 5) => {
  const results = [];
  let globalRetries = 0; // 全局重试次数
  const overallStart = Date.now();
  dbg(`[KLINE] 开始加载 ${assetIds.length} 个资产，重试上限 ${maxRetries}`);

  for (const id of assetIds) {
    let success = false;
    const assetStart = Date.now();
    let pageCount = 0;

    while (globalRetries < maxRetries && !success) {
      try {
        const t0 = Date.now();
        const data_realtime = await getPrices(id, params);
        dbg(`[KLINE] ${id} realtime OK，耗时 ${Date.now() - t0}ms`);
        pageCount++;

        const t1 = Date.now();
        const data_history = await getHistoryPrices(id, params);
        dbg(`[KLINE] ${id} history OK，耗时 ${Date.now() - t1}ms`);
        pageCount++;

        const t2 = Date.now();
        const data_open_interest = await getHistoryOpenInterest(id, {
          to_when: params.to_when,
          from_when: params.from_when,
          bar_type: params.bar_type,
          once_limit: 100,
          total_limit: open_inerest_limit || params.candle_limit,
        });
        dbg(`[KLINE] ${id} openInterest OK，耗时 ${Date.now() - t2}ms`);
        pageCount++;
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
          dbg(
            `[KLINE] ${id} ✅ 加载完成，${data.prices.length} 根K线，${pageCount} 次REST调用，总耗时 ${Date.now() - assetStart}ms`
          );
        } else {
          throw new Error('Invalid data received');
        }
      } catch (error) {
        globalRetries++;
        console.error(`获取 ${id} 数据失败 (${globalRetries}/${maxRetries}):`, error.message);
        dbg(`[KLINE] ${id} ❌ 失败，${pageCount} 次REST后崩溃: ${error.message}`);

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
  dbg(
    `[KLINE] 全部 ${assetIds.length} 个资产加载完成，总耗时 ${Date.now() - overallStart}ms，累计REST调用 ${getMarketCallCount()} 次`
  );
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

// 启动 WebSocket 连接
initBusinessWebSocket();

// 启动 K 线数据自动刷盘
startAutoFlush();

// 进程退出时确保数据刷盘
process.on('SIGINT', () => {
  stopAutoFlush();
  process.exit(0);
});
process.on('SIGTERM', () => {
  stopAutoFlush();
  process.exit(0);
});

// ---------------------------------------------------------------------------
// 进程级崩溃保护：捕获所有未处理异常，输出到日志避免静默退出
// ---------------------------------------------------------------------------
process.on('uncaughtException', (err, origin) => {
  console.error(`[🚨 uncaughtException] origin=${origin} error=${err?.message}\n${err?.stack}`);
});
process.on('unhandledRejection', (reason, promise) => {
  console.error(
    `[🚨 unhandledRejection] reason=${reason?.message ?? reason}\n${reason?.stack ?? ''}`
  );
});

// 消息超时检测：如果长时间没有收到任何消息（包括 OKX 服务端 ping 或 K 线推送），
// 认为连接已死（TCP 层可能活着但服务端已丢弃会话）
let lastMessageTime = Date.now();
const MESSAGE_TIMEOUT = 90000; // 90秒：OKX 服务端每 20-25s 会发一次应用层 "ping"，90s 没收到 = 连接真死了
let heartbeatTimer = null;

// 运行期"活着"日志：
// - 每 60s 心跳循环打印一条 WS alive
// - 每个资产第一根 K 线到达时打印
// - 之后每 100 根 K 线打印汇总
let wsAliveLogCounter = 0;
const klineFirstAck = new Set();
let klineTickCounter = 0;
let _wsOpenTime = 0;

function startHeartbeatMonitor() {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  heartbeatTimer = setInterval(() => {
    const ws = ws_connection_pool['ws_business'];
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    // 仅发送 TCP 协议层 ping（ws.ping()），保持底层连接活跃。
    // 注意：OKX Business WS 不回复客户端主动发的应用层 "ping" 文本，
    // 它只会**自己主动**每 20-25s 给客户端发一次 "ping"，要求客户端回复 "pong"。
    // 我们已经在 message handler 里回复 OKX 的 ping 了，不需要再主动发。
    ws.ping();

    const elapsed = Date.now() - lastMessageTime;
    if (elapsed > MESSAGE_TIMEOUT) {
      console.warn(
        `[心跳检测] 超过 ${Math.round(elapsed / 1000)} 秒未收到消息（含 OKX 服务端 ping），主动断开连接以触发重连`
      );
      ws.terminate(); // 强制断开，触发 close 事件
    } else {
      // 每 60s 打印一次 WS 存活状态（避免用户以为卡住了）
      wsAliveLogCounter++;
      if (wsAliveLogCounter % 2 === 0) {
        // 30s × 2 = 60s
        const assetsOn = assets.length;
        console.log(
          `[WS] ✅ 心跳正常 · 距上次消息 ${Math.round(elapsed / 1000)}s · 订阅 ${assetsOn} 资产 · 连接存活 ${Math.round((Date.now() - _wsOpenTime) / 1000)}s`
        );
      }
    }
  }, 30000); // 30秒：跟 OKX 服务端 ping 节奏对齐，稍微多一点也行
}

function initBusinessWebSocket() {
  dbg(`[WS] 初始化连接（reconnect=${reconnectAttempts}）`);
  // 主动关闭旧连接，释放 OKX 连接数配额（每 IP 限 3 个）
  // PM2/SIGTERM 可能导致旧连接未被正常 close，OKX 服务端清理需要 60-90s
  const oldWs = ws_connection_pool['ws_business'];
  if (oldWs && oldWs.readyState !== WebSocket.CLOSED) {
    dbg(`[WS] 旧连接状态 readyState=${oldWs.readyState}，主动关闭释放配额`);
    console.log('[WS] 关闭旧连接以释放配额');
    try {
      oldWs.close();
    } catch (e) {}
    try {
      oldWs.terminate();
    } catch (e) {}
  }

  const ws = new WebSocket(base_url + '/ws/v5/business');
  storeConnection('ws_business', ws);

  // subscribe 超时保护：10秒内未收到任何消息（ACK/error/K线推送），
  // 说明 OKX 可能静默丢弃了订阅请求（REST 限流后 WS 订阅被风控），主动重连
  let subscribeTimeout = null;
  let subscribeAcks = 0;
  const expectedAcks = assets.length;

  ws.on('open', () => {
    dbg(`[WS] TCP连接成功，准备订阅 ${expectedAcks} 个资产`);
    // 重置运行期状态
    _wsOpenTime = Date.now();
    wsAliveLogCounter = 0;
    klineFirstAck.clear();
    klineTickCounter = 0;
    console.log('ws_business已连接到服务器');
    console.log(
      `监控服务器已启动，访问 http://154.9.24.206:${monitorServer.port}/${monitorServer.currentToken}`
    );
    // 批量订阅（OKX 推荐一条消息带多个 args，避免订阅速率限制）
    const instIds = assets.map(it => it.id);
    subscribeKlineChanel(ws, 'candle' + bar_type, instIds);
    console.log(`K线频道订阅完成: ${instIds.length}/${instIds.length}`);
    lastMessageTime = Date.now();
    startHeartbeatMonitor();

    // 10 秒 subscribe 超时
    subscribeTimeout = setTimeout(() => {
      dbg(
        `[WS] subscribe 超时触发！已收到 ${subscribeAcks}/${expectedAcks} ACK，无任何响应=静默丢弃`
      );
      console.warn(
        `[WS] 10秒内未收到订阅响应（已收 ${subscribeAcks}/${expectedAcks}），主动断开重连`
      );
      ws.terminate();
    }, 10000);
  });

  ws.on('message', message => {
    lastMessageTime = Date.now();

    // 收到任何消息（包括心跳 pong）都清除 subscribe 超时
    if (subscribeTimeout) {
      clearTimeout(subscribeTimeout);
      subscribeTimeout = null;
      dbg(`[WS] 首次收到消息，取消 subscribe 超时（累计 ${subscribeAcks} 条 ACK）`);
    }

    const raw = message.toString();

    // OKX 应用层心跳：服务器发送纯文本 "ping"，客户端必须回复纯文本 "pong"
    // 否则 OKX 30秒后关闭连接（关闭码 4004: No data received in 30s）
    if (raw === 'ping') {
      try {
        ws.send('pong');
      } catch (e) {
        // 忽略发送失败
      }
      return;
    }

    // OKX 心跳响应（兼容两种格式）：纯文本 "pong" 或 JSON {"event":"pong"}
    if (raw === 'pong' || raw === '{"event":"pong"}') return;

    // 订阅确认消息：{"event":"subscribe","arg":{"channel":"candle5m","instId":"BTC-USDT-SWAP"}}
    if (raw.includes('"event":"subscribe"')) {
      subscribeAcks++;
      const match = raw.match(/"instId":"([^"]+)"/);
      dbg(`[WS] ACK ${subscribeAcks}/${expectedAcks} ${match?.[1] ?? ''}`);
      console.log(`订阅成功: ${raw}`);
      if (subscribeAcks === expectedAcks) {
        console.log(`[WS] ✅ 全部 ${expectedAcks} 资产订阅完成，等待 K 线数据推送...`);
      }
      return;
    }
    // 订阅错误消息：{"event":"error","code":...,"msg":...}
    if (raw.includes('"event":"error"')) {
      dbg(`[WS] ❌ 订阅错误: ${raw}`);
      console.error(`订阅错误: ${raw}`);
      return;
    }

    const { arg = {}, data } = JSON.parse(raw);
    const { channel, instId } = arg;
    if (channel.indexOf('candle') === 0) {
      if (data) {
        const { open, close, ts } = parseCandleData(data[0]);
        TradeEngine.updateCandleData(instId, bar_type, data[0]);
        TradeEngine.updatePrice(instId, close, ts, bar_type);

        // 实时跑 processor tick()：让交易信号计算和 indicators/tick/chart 三通道推送走秒级 cadence
        if (TradeEngine._status === 2) {
          TradeEngine.runAllProcessors();
        }

        // 运行期活着日志：每资产首条 K 线 + 每 100 条汇总
        if (!klineFirstAck.has(instId)) {
          klineFirstAck.add(instId);
          console.log(
            `[KLINE] 📊 ${instId} 已收到首根 K 线推送 (close=${close}) · ${klineFirstAck.size}/${assets.length} 资产活跃`
          );
          if (klineFirstAck.size === assets.length) {
            console.log(`[KLINE] 🎉 全部 ${assets.length} 资产 K 线通道活跃！`);
          }
        }
        klineTickCounter++;
        if (klineTickCounter % 100 === 0) {
          console.log(
            `[KLINE] 📈 累计 ${klineTickCounter} 条 K 线推送 · ${klineFirstAck.size} 资产活跃 · WS存活 ${Math.round((Date.now() - _wsOpenTime) / 1000)}s`
          );
        }
      }
    }
  });

  ws.on('error', error => {
    dbg(`[WS] error 事件: ${error.message}`);
    console.error('ws_business WebSocket 错误:', error.message);
    // error 事件后通常会紧跟 close 事件，不需要手动触发重连
    // 避免与 close 事件重复触发 handleWebSocketClose
  });

  ws.on('close', (code, reason) => {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    if (subscribeTimeout) {
      clearTimeout(subscribeTimeout);
      subscribeTimeout = null;
    }
    dbg(
      `[WS] close code=${code} reason=${reason || '(empty)'} subscribeAcks=${subscribeAcks}/${expectedAcks}`
    );
    handleWebSocketClose(code, reason);
  });
}

async function handleWebSocketClose(code, reason) {
  if (isReconnecting) {
    dbg(`[WS] handleWebSocketClose 被跳过（isReconnecting=true，防止并发重连）`);
    return; // 防止并发重连
  }
  isReconnecting = true;

  dbg(
    `[WS] handleWebSocketClose code=${code} reason=${reason || '(empty)'} reconnectAttempts=${reconnectAttempts}`
  );
  console.log(`ws_business连接已关闭, 关闭码: ${code}, 原因: ${reason}`);

  // 停止引擎
  TradeEngine.stop();
  VisualEngine.stop();

  reconnectAttempts++;

  // 计算重试间隔（指数退避）
  const backoffTime = Math.min(
    BACKOFF_BASE * Math.pow(BACKOFF_MULTIPLIER, reconnectAttempts - 1),
    MAX_BACKOFF
  );
  dbg(`[WS] 重连尝试 #${reconnectAttempts}，backoff=${backoffTime}ms`);

  if (reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
    console.warn(`达到最大重连尝试次数 (${MAX_RECONNECT_ATTEMPTS})，进入长期等待模式...`);
    console.warn(`将每 ${MAX_BACKOFF / 1000} 秒尝试一次重新连接`);
  }

  // 等待后重新初始化
  await new Promise(resolve => setTimeout(resolve, backoffTime));

  const attemptInfo =
    reconnectAttempts > MAX_RECONNECT_ATTEMPTS
      ? `(持续重连中，累计 ${reconnectAttempts} 次)`
      : `(第 ${reconnectAttempts} 次尝试)`;
  console.log(`正在尝试重新连接... ${attemptInfo}`);

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
      isReconnecting = false;
      // 重新建立连接
      initBusinessWebSocket();
    } else {
      throw new Error('获取K线数据失败');
    }
  } catch (error) {
    console.error('重连失败:', error.message);
    isReconnecting = false;
    // 递归重试
    handleWebSocketClose(code, reason);
  }
}

// 保存一个ws链接
function storeConnection(conn_id, ws) {
  ws_connection_pool[conn_id] = ws;
}
