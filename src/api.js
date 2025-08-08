import axios from 'axios';
import * as mimic from '../config.security.mimic.js';
import * as firm from '../config.security.js';
import { calcProfit, generateSignature, hashString } from './tools.js';
import { Env } from '../config.js';
import { TradeEnv } from './enum.js';

const base_url = 'https://www.okx.com';
const MIMIC = Env === TradeEnv.MIMIC;
export async function marketCandles(instId, bar, after, before, limit) {
  const { data } = await axios.get(base_url + '/api/v5/market/candles', {
    params: {
      instId,
      bar,
      after,
      before,
      limit,
    },
    timeout: 10000, // 设置5秒超时
  });
  return data;
}

export async function marketCandlesHistory(instId, bar, after, before, limit) {
  const { data } = await axios.get(base_url + '/api/v5/market/history-candles', {
    params: {
      instId,
      bar,
      after,
      before,
      limit,
    },
    timeout: 10000, // 设置5秒超时
  });
  return data;
}

/**
 * 获取订单信息 - 实盘
 * @param {Object} params 查询参数
 * @param {String} params.instType 产品类型 SPOT/MARGIN/SWAP/FUTURES/OPTION
 * @param {String} [params.uly] 标的指数
 * @param {String} [params.instFamily] 交易品种
 * @param {String} [params.instId] 产品ID
 * @param {String} [params.ordType] 订单类型
 * @param {String} [params.state] 订单状态
 * @param {String} [params.category] 订单种类
 * @param {String} [params.after] 请求此ID之前的分页内容
 * @param {String} [params.before] 请求此ID之后的分页内容
 * @param {String} [params.begin] 开始时间戳
 * @param {String} [params.end] 结束时间戳
 * @param {String} [params.limit] 返回结果数量，默认100
 */
export async function getOrderHistory(params = {}) {
  const timestamp = new Date().toISOString();
  const method = 'GET';
  const requestPath = '/api/v5/trade/orders-history-archive';

  // 构建查询字符串
  const queryString = Object.entries(params)
    .filter(([_, value]) => value !== undefined)
    .map(([key, value]) => `${key}=${value}`)
    .join('&');

  const fullPath = queryString ? `${requestPath}?${queryString}` : requestPath;

  const sign = generateSignature(timestamp, method, fullPath, '', firm.api_secret);

  const headers = {
    'OK-ACCESS-KEY': firm.api_key,
    'OK-ACCESS-SIGN': sign,
    'OK-ACCESS-TIMESTAMP': timestamp,
    'OK-ACCESS-PASSPHRASE': firm.pass_phrase,
  };

  try {
    const { data } = await axios.get(base_url + fullPath, { headers });
    return data;
  } catch (error) {
    console.error('获取订单历史失败:', error.response?.data || error.message);
    throw error;
  }
}

// 批量订单交易
export async function batchOrders(orders) {
  // 为每个订单添加 clOrdId
  const ordersWithId = orders.map(order => ({
    ...order,
    clOrdId: order.clOrdId || hashString(`${Date.now()}${Math.random()}`),
  }));

  const security = MIMIC ? mimic : firm;
  // const security = mimic;

  const timestamp = new Date().toISOString();
  const method = 'POST';
  const requestPath = '/api/v5/trade/batch-orders';
  const body = JSON.stringify(ordersWithId);
  const sign = generateSignature(timestamp, method, requestPath, body, security.api_secret);

  const headers = {
    'Content-Type': 'application/json',
    'OK-ACCESS-KEY': security.api_key,
    'OK-ACCESS-SIGN': sign,
    'OK-ACCESS-TIMESTAMP': timestamp,
    'OK-ACCESS-PASSPHRASE': security.pass_phrase,
    // 'x-simulated-trading': 1,
  };

  if (MIMIC) {
    headers['x-simulated-trading'] = 1;
  }

  try {
    const { data } = await axios.post(base_url + requestPath, ordersWithId, { headers });
    // 将返回结果与原始订单关联
    const enrichedData =
      data.data?.map(result => {
        const originalOrder = ordersWithId.find(o => o.clOrdId === result.clOrdId);
        return {
          ...result,
          instId: originalOrder.instId,
          originalOrder,
        };
      }) || [];

    // 打印下单结果
    enrichedData.map(({ sCode, sMsg, originalOrder }) => {
      const { instId, side, sz } = originalOrder;
      sCode === '0'
        ? console.log(`- ${side} ${instId} ${sz} success`)
        : console.log(`- ${side} ${instId} ${sz} ${sMsg}`);
    });

    // 检查是否有下单失败的订单
    const failedOrders = enrichedData.filter(order => order.sCode !== '0');

    let result = {
      success: failedOrders.length === 0,
      data: enrichedData,
      failedOrders,
      cancelledOrders: [],
      reversedOrders: [],
    };

    if (failedOrders.length > 0) {
      // 准备撤销所有成功的订单
      const cancelOrders = enrichedData
        .filter(order => order.sCode === '0')
        .map(order => ({
          instId: order.instId,
          // ordId: order.ordId, // 如果传 orderId 会导致撤单结果不包含 clOrdId
          clOrdId: order.clOrdId,
        }));

      if (cancelOrders.length > 0) {
        console.error('部分订单下单失败，尝试撤销成功的订单...');
        // 尝试撤销所有成功的订单
        const cancelResult = await batchCancelOrders(cancelOrders);
        result.cancelledOrders = cancelResult.data?.map(cancelOrder => {
          const originalOrder = ordersWithId.find(o => o.clOrdId === cancelOrder.clOrdId);
          return {
            ...cancelOrder,
            originalOrder,
          };
        });

        const failedCancels = result.cancelledOrders.filter(order => order.sCode !== '0');
        result.cancelledOrders = result.cancelledOrders.filter(order => order.sCode == '0');

        // 如果有撤单失败的订单，为其创建反向订单
        if (failedCancels.length > 0) {
          console.error('撤单失败...');
          failedCancels.map(failedCancel => {
            const { instId, side, sz } = failedCancel.originalOrder;
            console.log(`- ${side} ${instId} ${sz} ${failedCancel.sMsg}`);
          });

          console.error('创建反向订单...');
          const reverseOrders = failedCancels.map(failedCancel => ({
            ...failedCancel.originalOrder,
            side: failedCancel.originalOrder.side === 'buy' ? 'sell' : 'buy',
            clOrdId: hashString(`${Date.now()}${Math.random()}`),
          }));

          // 执行反向订单
          const reverseResult = await batchOrders(reverseOrders);
          if (reverseResult.success) {
            console.log('反向订单执行成功\n\r');
            // 计算预计损失
            const successOrd = enrichedData
              .filter(order => order.sCode === '0')
              .map(o => ({ ...o, ...o.originalOrder }));
            const reverseOrd = [...reverseResult.data].map(o => ({ ...o, ...o.originalOrder }));
            // 分别查询successOrd和reverseOrd的订单详情，并补充到successOrd和reverseOrd中
            const ords4reverse = await Promise.all(
              [...successOrd, ...reverseOrd].map(async order => {
                const { data = [] } = await getOrderInfo(order.instId, order.ordId);
                return data[0];
              })
            );
            const estimatedLoss = calcProfit(ords4reverse);
            console.error(`- 损耗: ${estimatedLoss.toFixed(2)} USDT`);
          } else {
            console.error('反向订单执行失败');
            return {
              success: false,
              data: enrichedData,
              failedOrders,
              cancelledOrders: result.cancelledOrders,
              reversedOrders: reverseResult.data,
            };
          }
          result.reversedOrders = reverseResult.data;
        }
      }
    }

    return result;
  } catch (error) {
    console.error('批量下单错误:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * 批量撤单
 * @param {Array<{instId: string, ordId?: string, clOrdId?: string}>} orders 订单数组
 * @returns {Promise} 撤单结果
 */
export async function batchCancelOrders(orders) {
  if (
    !Array.isArray(orders) ||
    !orders.every(order => order.instId && (order.ordId || order.clOrdId))
  ) {
    console.error(orders);
    throw new Error('订单参数格式错误：每个订单必须包含 instId 和 ordId/clOrdId 中的至少一个');
  }
  const security = MIMIC ? mimic : firm;

  // const security = mimic;

  const timestamp = new Date().toISOString();
  const method = 'POST';
  const requestPath = '/api/v5/trade/cancel-batch-orders';
  const body = JSON.stringify(orders);
  const sign = generateSignature(timestamp, method, requestPath, body, security.api_secret);
  const headers = {
    'Content-Type': 'application/json',
    'OK-ACCESS-KEY': security.api_key,
    'OK-ACCESS-SIGN': sign,
    'OK-ACCESS-TIMESTAMP': timestamp,
    'OK-ACCESS-PASSPHRASE': security.pass_phrase,
    // 'x-simulated-trading': 1,
  };

  if (MIMIC) {
    headers['x-simulated-trading'] = 1;
  }

  const { data } = await axios.post(base_url + requestPath, orders, {
    headers,
  });
  return data;
}

export async function getOpenInterestHistory(instId, period, begin, end, limit = 100) {
  const security = MIMIC ? mimic : firm;

  const timestamp = new Date().toISOString();
  const method = 'GET';
  const requestPath = `/api/v5/rubik/stat/contracts/open-interest-history?instId=${instId}&period=${period}&begin=${begin}&end=${end}&limit=${limit}`;
  const sign = generateSignature(timestamp, method, requestPath, '', security.api_secret);

  const headers = {
    'OK-ACCESS-KEY': security.api_key,
    'OK-ACCESS-SIGN': sign,
    'OK-ACCESS-TIMESTAMP': timestamp,
    'OK-ACCESS-PASSPHRASE': security.pass_phrase,
    // 'x-simulated-trading': 1,
  };

  if (MIMIC) {
    headers['x-simulated-trading'] = 1;
  }

  try {
    const { data } = await axios.get(base_url + requestPath, { headers });
    if (data.code != 0) {
      throw new Error(data.msg);
    }
    // 确保返回的数据格式正确
    if (!data.data || !data.data.length) {
      console.warn(`未获取到获取交易品种持仓历史信息: ${instId}`);
      return { data: [] };
    }
    return data;
  } catch (error) {
    console.error('获取交易品种持仓历史信息失败:', error.response?.data || error.message);
    return { data: [] };
  }
}

/**
 * 获取持仓信息
 * @returns
 */
export async function getPositions(instId, instType, posId) {
  const security = MIMIC ? mimic : firm;

  const timestamp = new Date().toISOString();
  const method = 'GET';
  const params = {
    instId,
    instType,
    posId,
  };
  const queryString = Object.entries(params)
    .map(([key, value]) =>
      key && value ? `${encodeURIComponent(key)}=${encodeURIComponent(value)}` : undefined
    )
    .filter(it => it)
    .join('&');
  const requestPath = `/api/v5/account/positions?${queryString}`;
  const sign = generateSignature(timestamp, method, requestPath, '', security.api_secret);

  const headers = {
    'OK-ACCESS-KEY': security.api_key,
    'OK-ACCESS-SIGN': sign,
    'OK-ACCESS-TIMESTAMP': timestamp,
    'OK-ACCESS-PASSPHRASE': security.pass_phrase,
    // 'x-simulated-trading': 1,
  };

  if (MIMIC) {
    headers['x-simulated-trading'] = 1;
  }

  try {
    const { data } = await axios.get(base_url + requestPath, { headers });
    // 确保返回的数据格式正确
    if (data.code != 0) {
      throw new Error(data.msg);
    }
    if (!data.data || !data.data.length) {
      console.warn(`未获取到持仓信息: ${instId}`);
      return { data: [] };
    }
    return data;
  } catch (error) {
    console.error('获取交易品种个人持仓信息失败:', error.response?.data || error.message);
    return { data: [] };
  }
}

// 获取持仓量
export async function getOpenInterest(instType, instId, uly, instFamily) {
  const security = MIMIC ? mimic : firm;

  const timestamp = new Date().toISOString();
  const method = 'GET';
  const requestPath = `/api/v5/public/open-interest?instType=${instType}&instId=${instId}`;
  const sign = generateSignature(timestamp, method, requestPath, '', security.api_secret);

  const headers = {
    'OK-ACCESS-KEY': security.api_key,
    'OK-ACCESS-SIGN': sign,
    'OK-ACCESS-TIMESTAMP': timestamp,
    'OK-ACCESS-PASSPHRASE': security.pass_phrase,
    // 'x-simulated-trading': 1,
  };

  if (MIMIC) {
    headers['x-simulated-trading'] = 1;
  }

  try {
    const { data } = await axios.get(base_url + requestPath, { headers });
    // 确保返回的数据格式正确
    if (data.code != 0) {
      throw new Error(data.msg);
    }
    if (!data.data || !data.data.length) {
      console.warn(`未获取到交易品种市场持仓信息: ${instId} ${ordId}`);
      return { data: [] };
    }
    return data;
  } catch (error) {
    console.error('获取交易品种市场持仓信息失败:', error.response?.data || error.message);
    return { data: [] };
  }
}

// 获取交易品种信息
export async function getInstruments(instType, instId) {
  const security = MIMIC ? mimic : firm;

  const timestamp = new Date().toISOString();
  const method = 'GET';
  const requestPath = `/api/v5/public/instruments?instType=${instType}&instId=${instId}`;
  const sign = generateSignature(timestamp, method, requestPath, '', security.api_secret);

  const headers = {
    'OK-ACCESS-KEY': security.api_key,
    'OK-ACCESS-SIGN': sign,
    'OK-ACCESS-TIMESTAMP': timestamp,
    'OK-ACCESS-PASSPHRASE': security.pass_phrase,
    // 'x-simulated-trading': 1,
  };

  if (MIMIC) {
    headers['x-simulated-trading'] = 1;
  }

  try {
    const { data } = await axios.get(base_url + requestPath, { headers });
    if (data.code != 0) {
      throw new Error(data.msg);
    }
    // 确保返回的数据格式正确
    if (!data.data || !data.data.length) {
      console.warn(`未获取到交易品种基础信息: ${instId} ${ordId}`);
      return { data: [] };
    }
    return data;
  } catch (error) {
    console.error('获取交易品种基础信息失败:', error.response?.data || error.message);
    return { data: [] };
  }
}

// 获取订单信息
export async function getOrderInfo(instId, ordId) {
  // const security = firm;
  // const security = mimic;
  const security = MIMIC ? mimic : firm;

  const timestamp = new Date().toISOString();
  const method = 'GET';
  const requestPath = `/api/v5/trade/order?ordId=${ordId}&instId=${instId}`;
  const sign = generateSignature(timestamp, method, requestPath, '', security.api_secret);

  const headers = {
    'OK-ACCESS-KEY': security.api_key,
    'OK-ACCESS-SIGN': sign,
    'OK-ACCESS-TIMESTAMP': timestamp,
    'OK-ACCESS-PASSPHRASE': security.pass_phrase,
    // 'x-simulated-trading': 1,
  };

  if (MIMIC) {
    headers['x-simulated-trading'] = 1;
  }

  try {
    const { data } = await axios.get(base_url + requestPath, { headers });
    if (data.code != 0) {
      throw new Error(data.msg);
    }
    // 确保返回的数据格式正确
    if (!data.data || !data.data.length) {
      console.warn(`未获取到订单信息: ${instId} ${ordId}`);
      return { data: [] };
    }
    return data;
  } catch (error) {
    console.error('获取订单信息失败:', error.response?.data || error.message);
    return { data: [] };
  }
}

// 登录函数
export async function doLogin(ctx) {
  // 准备登录请求
  const timestamp = Math.round(Date.now() / 1000).toFixed(3);
  const method = 'GET';
  const requestPath = '/users/self/verify';
  const body = ''; // WebSocket登录请求没有body
  const sign = generateSignature(timestamp, method, requestPath, body, api_secret);
  await ctx.send(
    JSON.stringify({
      op: 'login',
      args: [
        {
          apiKey: api_key,
          passphrase: pass_phrase,
          timestamp,
          sign,
        },
      ],
    })
  );
}

export async function subscribeKlineChanel(ws, channel, instId) {
  ws.send(
    JSON.stringify({
      op: 'subscribe',
      args: [
        {
          channel: channel,
          instId: instId,
        },
      ],
    })
  );
}
