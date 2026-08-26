import { getClosingTransaction, getOpeningTransaction } from '../recordTools.js';

/**
 * 利润率计算工具集（纯函数，不持有引擎状态）
 * 从 TradeEngine 抽出，TradeEngine 通过静态门面委托调用。
 */

/**
 * 计算预期开仓利润率
 * @param {number} a - 资产 A 价格
 * @param {number} b - 资产 B 价格
 * @param {number} n - 参考价（通常为两者均值）
 * @returns {number}
 */
export function calcPriceGapProfit(a, b, n) {
  return (((n - b) / b - (n - a) / a) / 2) * (a > b ? 1 : -1);
}

/**
 * 计算实际平仓利润率
 * @param {string} tradeId - 交易 ID
 * @returns {number}
 */
export function calcClosingProfitRate(tradeId) {
  const { orders: order_o } = getOpeningTransaction(tradeId);
  const { orders: order_c } = getClosingTransaction(tradeId);
  const beta_map = Object.fromEntries(order_o.map(o => [o.instId, o.beta]));
  let [a, b] = order_o
    .sort((a, b) => a.instId.localeCompare(b.instId))
    .map(it => parseFloat(beta_map[it.instId][0] * it.avgPx + beta_map[it.instId][1]));
  let [a2, b2] = order_c
    .sort((a, b) => a.instId.localeCompare(b.instId))
    .map(it => parseFloat(beta_map[it.instId][0] * it.avgPx + beta_map[it.instId][1]));
  return (((b2 - b) / b - (a2 - a) / a) / 2) * (a > b ? 1 : -1);
}

/**
 * 根据实时价格计算订单实时净利润
 * @param {Array} orders - 订单列表
 * @param {Object} realtime_price_map - { instId: price } 实时价格映射
 * @param {number} trade_fee_rate - 手续费率
 * @returns {number}
 */
export function calcRealtimeProfit(orders, realtime_price_map, trade_fee_rate) {
  let fee_usdt = 0,
    cost = 0,
    sell = 0;

  orders.map(({ instId, side, sz, tgtCcy, avgPx, accFillSz, fee, feeCcy }) => {
    const realtime_price = realtime_price_map[instId];
    if (!realtime_price) {
      return 0;
    }
    // 单位 false:本币; true:usdt
    const unit_fgt = tgtCcy === 'base_ccy' ? false : true;
    const unit_fee = feeCcy === 'USDT' ? true : false;

    if (side === 'buy') {
      cost += unit_fgt ? parseFloat(sz) : parseFloat(sz * avgPx);
      // 实时估算
      sell += realtime_price * accFillSz;
      fee_usdt -= realtime_price * accFillSz * trade_fee_rate;
    }

    if (side === 'sell') {
      sell += unit_fgt ? parseFloat(sz) : parseFloat(sz * avgPx);
      // 实时估算
      cost += realtime_price * accFillSz;
      fee_usdt -= realtime_price * accFillSz * trade_fee_rate;
    }
    fee_usdt += unit_fee ? parseFloat(fee) : parseFloat(fee * avgPx);
  });
  const profit = sell - cost + fee_usdt;
  return profit;
}

/**
 * 获取各资产对组合的实时利润
 * @param {Array} scaled_prices - getAllScaledPrices() 的结果
 * @returns {Object} { 'assetId1:assetId2': profit }
 */
export function calcRealtimeProfits(scaled_prices) {
  const profit = {};
  for (let i = 0; i < scaled_prices.length - 1; i++) {
    for (let j = i + 1; j < scaled_prices.length; j++) {
      const assetId1 = scaled_prices[i].id;
      const assetId2 = scaled_prices[j].id;

      const prices1 = scaled_prices[i].prices;
      const prices2 = scaled_prices[j].prices;
      profit[`${assetId1}:${assetId2}`] = calcPriceGapProfit(
        prices1.at(-1),
        prices2.at(-1),
        (prices1.at(-1) + prices2.at(-1)) / 2
      );
    }
  }
  return profit;
}

/**
 * 获取各资产对组合的历史利润序列
 * @param {Array} scaled_prices - getAllScaledPrices() 的结果
 * @returns {Object} { 'assetId1:assetId2': number[] }
 */
export function calcAllHistoryProfits(scaled_prices) {
  const profit = {};
  for (let i = 0; i < scaled_prices.length - 1; i++) {
    for (let j = i + 1; j < scaled_prices.length; j++) {
      const assetId1 = scaled_prices[i].id;
      const assetId2 = scaled_prices[j].id;
      const prices1 = scaled_prices[i].prices;
      const prices2 = scaled_prices[j].prices;

      profit[`${assetId1}:${assetId2}`] = prices1.map((p1, id) => {
        const p2 = prices2[id];
        return calcPriceGapProfit(p1, p2, (p1 + p2) / 2);
      });
    }
  }
  return profit;
}
