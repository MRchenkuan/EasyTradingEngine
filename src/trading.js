import { batchOrders, getOrderInfo } from './api.js';
import { LocalVariable } from './LocalVariable.js';
import {
  readOpeningTransactions,
  recordClosingTransactions,
  recordMarketMakerTransactions,
  recordOpeningTransactions,
  updateTransaction,
} from './recordTools.js';
import { calcProfit, hashString } from './tools.js';
import { TradeEngine } from './TradeEngine/TradeEngine.js';
import { generateCounterBasedId } from './uuid.js';

function getBetaMap() {
  const beta_map = new LocalVariable('TradeEngine');
  return Reflect.getOwnPropertyDescriptor(beta_map, '_beta_map').value;
}

// 订单执行器（通用下单逻辑）
// 修改 executeOrders 函数的返回结构
export async function executeOrders(orderList) {
  const {
    data = [],
    success,
    failedOrders,
    cancelledOrders,
    reversedOrders,
  } = await batchOrders(orderList);
  if (!success) {
    let msg = '';
    if (failedOrders.length > 0) {
      msg += `失败的订单:\n\r`;
      failedOrders.map(failedOrder => {
        const { instId, side, sz } = failedOrder.originalOrder;
        msg += `- ${side} ${instId} ${sz}, ${failedOrder.sMsg};\n\r`;
      });
    }
    if (cancelledOrders.length > 0) {
      msg += `已撤销的订单:\n\r`;
      cancelledOrders.map(cancelledOrder => {
        const { instId, side, sz } = cancelledOrder.originalOrder;
        msg += `- ${side} ${instId} ${sz}, ${cancelledOrder.sMsg};\n\r`;
      });
    }
    if (reversedOrders.length > 0) {
      msg += `已执行反向订单:\n\r`;
      reversedOrders.map(reversedOrder => {
        const { instId, side, sz } = reversedOrder.originalOrder;
        msg += `- ${side} ${instId} ${sz}, ${reversedOrder.sMsg};\n\r`;
      });
    }
    return { success: false, msg };
  }

  let result = mergeOrder2Result([...orderList, ...data]);
  let orderDetails = await Promise.all(
    result.map(async order => {
      const { data = [] } = await getOrderInfo(order.instId, order.ordId);
      return data[0];
    })
  );
  orderDetails = processOrderDetail(orderDetails);
  console.log('下单完成..', orderDetails);
  return {
    success: true,
    data: mergeOrder2Result([...result, ...orderDetails]),
  };
}

// 修改 open_positions 函数
export async function open_positions(short, long, size) {
  console.log('开仓...', short, long, size);
  const tradeId = hashString(generateCounterBasedId());

  const short_price = TradeEngine.getRealtimePrice(short);
  const short_size = size / short_price;
  const long_size = size;

  const order_long = createOrder_market(long, long_size, 1);
  const order_short = createOrder_market(short, short_size, 0, true);

  const execResult = await executeOrders([order_long, order_short]);
  if (!execResult.success) {
    return { tradeId, success: false, msg: execResult.msg };
  }

  const beta_map = getBetaMap();
  execResult.data.forEach(order => {
    order.beta = beta_map[order.instId];
  });

  recordOpeningTransactions(tradeId, execResult.data);
  return { tradeId, success: true, data: execResult.data };
}

// 修改 close_position 函数
export async function close_position(tradeId) {
  const openingRecord = readOpeningTransactions(tradeId);
  if (!openingRecord) {
    return { success: false, msg: '平仓头寸不存在' };
  }
  if (openingRecord.closed) {
    return { success: false, msg: '不能重复对订单平仓' };
  }

  const { orders: opening_orders } = openingRecord;
  const orders_info = opening_orders.map(opening_order => {
    const { instId, side, avgPx: price, accFillSz: count } = opening_order;
    return createOrder_market(instId, count, side === 'sell' ? 1 : 0, true);
  });

  console.log('平仓...', orders_info);
  const execResult = await executeOrders(orders_info);
  if (!execResult.success) {
    return { success: false, msg: execResult.msg };
  }

  const beta_map = getBetaMap();
  execResult.data.forEach(order => {
    order.beta = beta_map[order.instId];
  });

  const profit = calcProfit([...opening_orders, ...execResult.data]);
  updateTransaction(tradeId, 'opening', { closed: true, profit: profit });
  updateTransaction(tradeId, 'closing', { profit: profit });
  recordClosingTransactions(tradeId, profit, execResult.data);

  return { success: true, profit, data: execResult.data };
}

export function createOrder_limit(instId, price, size, side) {
  const clOrdId = hashString(`${instId}${side}${price}${size}${Date.now()}`);
  return {
    instId,
    tdMode: side > 0 ? 'cash' : 'cash',
    side: side > 0 ? 'buy' : 'sell',
    ordType: 'limit',
    px: price + '',
    sz: size + '',
    clOrdId,
  };
}

export function createOrder_market(instId, size, side, is_base_ccy) {
  return {
    instId,
    // "tdMode":"cross", // isolated
    tdMode: side > 0 ? 'cash' : 'cash', // isolated 逐仓 cross 全仓 cash 现金非保证金
    side: side > 0 ? 'buy' : 'sell',
    ordType: 'market',
    clOrdId: hashString(`${instId}${side}${size}${Date.now()}`),
    sz: size + '',
    tgtCcy: is_base_ccy ? 'base_ccy' : 'quote_ccy', //base_ccy: 交易货币 ；quote_ccy：计价货币, 买单默认quote_ccy， 卖单默认base_ccy
  };
}

// 合并订单结果
export function mergeOrder2Result(arr) {
  const map = {};
  arr.map(it => {
    map[it.clOrdId] = { ...(map[it.clOrdId] || {}), ...it };
  });
  return Object.values(map);
}

// 标准化订单参数
function processOrderDetail(orderDetail) {
  return orderDetail.map(order => {
    const { instId, clOrdId, avgPx, px, ordId, sz, accFillSz, fee, feeCcy, tgtCcy, state } = order;
    return {
      instId,
      clOrdId,
      px, // 委托均价
      avgPx, // 成交均价
      ordId,
      sz, // 委托份数
      accFillSz, // 成交份数
      fee, // 费用
      feeCcy,
      tgtCcy,
      state, // canceled：撤单成功 live：等待成交 partially_filled：部分成交 filled：完全成交 mmp_canceled：做市商保护机制导致的自动撤单
    };
  });
}

// 做市商策略
// 修改 marketMaker 函数中的相关调用
export async function marketMaker(assetId, price, size, dir) {
  const tradeId = hashString(generateCounterBasedId());
  let p1 = 0,
    p2 = 0;
  if (dir > 0) {
    p2 = price * 1.005;
    p1 = price * 1;
  }
  if (dir < 0) {
    p2 = price * 1;
    p1 = price * 0.995;
  }

  if (dir == 0) {
    p2 = price * 1.005;
    p1 = price * 0.995;
  }

  const order_short = createOrder_limit(assetId, p2, size / p2, 0);
  const order_long = createOrder_limit(assetId, p1, size / p1, 1);

  const execResult = await executeOrders([order_long, order_short]);
  if (!execResult.success) {
    return { success: false, msg: execResult.msg };
  }

  let result = mergeOrder2Result([order_short, order_long, ...execResult.data]);
  recordMarketMakerTransactions(tradeId, result);

  let order_details = await fetchOrders(result);
  order_details = mergeOrder2Result([...result, ...order_details]);
  recordMarketMakerTransactions(tradeId, order_details);

  const profit = calcProfit(order_details);
  return { success: true, profit, data: order_details };
}

// 持续查询订单
// async function fetchOrders(orders){
//   let orderDetails = await Promise.all(orders.map(async order=>{
//     const {data=[]} = await getOrderInfo(order.instId, order.ordId)
//     return data[0];
//   }));
//   if(orderDetails.every(order=>order.state ==='filled')){
//     return orderDetails;
//   } else {
//     await new Promise(resove=>setTimeout(resove, 3000));
//     return await fetchOrders(orders);
//   }
// }
async function fetchOrders(orders, initialDelay = 3000, maxRetries = 5) {
  let retryCount = 0;
  let currentDelay = initialDelay;
  const completedOrders = new Map();

  while (retryCount < maxRetries) {
    const pendingOrders = orders.filter(order => !completedOrders.has(order.ordId));

    try {
      const details = await Promise.all(
        pendingOrders.map(async order => {
          const { data = [] } = await getOrderInfo(order.instId, order.ordId);
          return { ordId: order.ordId, detail: data[0] };
        })
      );

      details.forEach(({ ordId, detail }) => {
        if (detail.state === 'filled') {
          completedOrders.set(ordId, detail);
        }
      });

      if (completedOrders.size === orders.length) {
        return orders.map(order => completedOrders.get(order.ordId));
      }

      retryCount++;
      currentDelay *= 1.5; // 指数退避
      await new Promise(resolve => setTimeout(resolve, currentDelay));
    } catch (error) {
      retryCount++;
      await new Promise(resolve => setTimeout(resolve, currentDelay));
    }
  }

  // 超过最大重试次数，返回当前已完成的订单
  return orders.map(order => completedOrders.get(order.ordId) || order);
}
