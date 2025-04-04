import { marketCandles } from './api.js';
import crypto from 'crypto';

// 生成签名的函数
export function generateSignature(timestamp, method, requestPath, body, secretKey) {
  // sign=CryptoJS.enc.Base64.stringify(CryptoJS.HmacSHA256(timestamp +'GET'+ '/users/self/verify', secret))
  const message = `${timestamp}${method}${requestPath}${body}`;
  const hmac = crypto.createHmac('sha256', secretKey);
  hmac.update(message);
  return hmac.digest('base64');
}

// 生成hash
export function hashString(input, length = 8) {
  const hash = crypto.createHash('sha256');
  hash.update(input);
  const fullHash = hash.digest('hex');
  return fullHash.substring(0, length); // 截取前16位
}

export function safeParseFloat(str) {
  const num = parseFloat(str);
  if (isNaN(num)) {
    console.warn('Invalid input:', str);
    return null; // 或者返回默认值
  }
  return num;
}

export function toTrickTimeMark(data) {
  return data.map(it => formatTimestamp(it));
}

export function formatTimestamp(timestamp, bar = '1m') {
  const date = new Date(parseInt(timestamp));
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');

  const s = s => ('s' + '0' + s).slice(-2);

  switch (bar) {
    case '1m':
      return `${month}-${s(day)} ${s(hours)}:${s(minutes)}`; // 分钟级显示完整时间
    case '3m':
      return `${month}-${s(day)} ${s(hours)}:${s(minutes - (minutes % 3))}`; // 分钟级显示完整时间
    case '5m':
      return `${month}-${s(day)} ${s(hours)}:${s(minutes - (minutes % 5))}`; // 分钟级显示完整时间
    case '15m':
      return `${month}-${s(day)} ${s(hours)}:${s(minutes - (minutes % 15))}`; // 分钟级显示完整时间
    case '1H':
      return `${month}-${s(day)} ${s(hours)}:00`; // 小时级显示整点
    case '1D':
      return `${month}-${s(day)} 00:00`; // 日级仅显示日期
    default:
      return `${month}-${s(day)} ${s(hours)}:${s(minutes)}`; // 默认按分钟级处理
  }
}

/**
 *
 * @returns {Object} parsedData - An object containing the extracted order data fields.
 * @returns {string} parsedData.clOrdId -用户自定义订单ID
 * @returns {string} parsedData.orderId - 系统订单ID
 * @returns {string} parsedData.tag - A tag or label associated with the order.
 * @returns {number} parsedData.ts - The timestamp of the order event.
 * @returns {string} parsedData.sCode - 订单下单是否成功，0表示成功
 * @returns {string} parsedData.sMsg - The status message of the
 */
export function parseOrderData({ ordId, clOrdId, ts, sCode }) {
  return {
    ordId,
    clOrdId,
    ts,
    sCode,
  };
}
export function parseCandleData(data) {
  return {
    ts: data[0],
    open: data[1],
    high: data[2],
    low: data[3],
    close: data[4],
    vol: data[5],
    vol_ccy: data[6],
    val_ccy_quote: data[7],
    confirm: data[8],
  };
}

export async function getPrices(
  assetId,
  { to_when, from_when, bar_type, price_type, once_limit, candle_limit }
) {
  const limit = candle_limit,
    bar = bar_type,
    feild = price_type;
  try {
    let times = Math.trunc(limit / once_limit);
    let collections = [];
    let last_ts = from_when || Date.now();
    while (times-- > 0) {
      const { data } = await marketCandles(assetId, bar, last_ts, to_when, once_limit);
      console.log(assetId, formatTimestamp(last_ts), bar, data.length);
      if (!(data && data.length > 0)) break;
      last_ts = parseCandleData(data[data.length - 1])['ts'];
      collections = collections.concat(data);
    }
    return {
      id: assetId,
      prices: collections.map(it => safeParseFloat(parseCandleData(it)[feild])),
      ts: collections.map(it => parseCandleData(it)['ts']),
    };
  } catch (e) {
    console.error(e.message);
  }
}

export function getTsOfStartOfToday() {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return startOfDay.getTime();
}

export function throttleAsync(fn, delay) {
  let isRunning = false; // 是否正在执行
  let lastArgs = null; // 最新的参数
  let timeout = null; // 定时器

  async function invoke() {
    if (!lastArgs) return; // 没有待处理的调用，直接返回
    isRunning = true;
    await fn(...lastArgs); // 执行异步函数
    lastArgs = null; // 清空参数，避免重复执行
    timeout = setTimeout(() => {
      isRunning = false;
      if (lastArgs) invoke(); // 如果有新的调用请求，执行它
    }, delay);
  }

  return (...args) => {
    lastArgs = args; // 记录最新参数
    if (!isRunning) invoke(); // 仅当没有正在运行的任务时才调用
  };
}

/**
 * 计算最后一个完整的分钟的时间戳
 * @param {*} now
 * @param {*} m
 * @param {*} s
 * @returns
 */
export function getLastWholeMinute(now, m = 1, s = 30) {
  now.setMinutes(now.getMinutes() - m); // 减去 1 分钟
  now.setSeconds(now.getSeconds() - s); // 再减去 30 秒

  return now.getTime();
}

/**
 * 颜色合成
 * @param {*} color1
 * @param {*} color2
 * @returns
 */
export function blendColors(color1, color2, ratio = 0.5) {
  // 处理十六进制颜色字符串
  const parseHex = hex => {
    hex = hex.replace(/^#/, '');
    if (hex.length === 3) {
      hex = hex
        .split('')
        .map(c => c + c)
        .join('');
    }
    return hex.match(/.{2}/g).map(v => parseInt(v, 16));
  };

  // 确保颜色值有效
  const [r1, g1, b1] = parseHex(color1);
  const [r2, g2, b2] = parseHex(color2);

  // 混合计算（线性插值）
  const blend = (c1, c2) => Math.round(c1 * (1 - ratio) + c2 * ratio);

  // 生成新颜色
  const nr = blend(r1, r2);
  const ng = blend(g1, g2);
  const nb = blend(b1, b2);

  // 转回十六进制
  const toHex = n => n.toString(16).padStart(2, '0');
  return `#${toHex(nr)}${toHex(ng)}${toHex(nb)}`;
}

/**
 * 计算盈利
 * @param {*} orders
 * @returns
 */
export function calcProfit(orders) {
  let fee_usdt = 0,
    cost = 0,
    sell = 0;
  orders.map(order => {
    const {
      side, // 方向  sell buy
      sz, // 交易了多少金额
      accFillSz, // 交易了多少数量
      avgPx, // 交易的平均价格
      fee, // 平台收取的手续费，为负数 //卖的手续费为USTD, 买的为本币
      tgtCcy, //
      feeCcy,
      ordType,
    } = order;
    const unit_fee = feeCcy === 'USDT' ? true : false;
    if (ordType === 'limit') {
      if (side === 'buy') {
        cost += parseFloat(accFillSz * avgPx);
      }
      if (side === 'sell') {
        sell += parseFloat(accFillSz * avgPx);
      }
    } else {
      // 单位 false:本币; true:usdt
      const unit_fgt = tgtCcy === 'base_ccy' ? false : true;

      if (side === 'buy') {
        cost += unit_fgt ? parseFloat(sz) : parseFloat(sz * avgPx);
      }
      if (side === 'sell') {
        sell += unit_fgt ? parseFloat(sz) : parseFloat(sz * avgPx);
      }
    }
    fee_usdt += unit_fee ? parseFloat(fee) : parseFloat(fee * avgPx);
  });
  console.log(
    `计算盈利: 总买单${cost}, 总卖单${sell},总手续费${fee_usdt}, 利润${sell - cost + fee_usdt}`
  );
  return sell - cost + fee_usdt;
}

export function createMapFrom(arr1, arr2) {
  // 参数类型校验
  if (!Array.isArray(arr1) || !Array.isArray(arr2)) {
    throw new TypeError('Both arguments must be arrays');
  }

  // 数组长度校验
  if (arr1.length !== arr2.length) {
    throw new Error('Arrays must be of equal length');
  }

  // 参数校验逻辑同前...
  return arr1.reduce((obj, key, index) => {
    obj[key] = arr2[index];
    return obj;
  }, {});
}


export function calculateGridProfit(trades) {
  const groupedTrades = {};
  for (const trade of trades) {
    const instId = trade.instId;
    if (!groupedTrades[instId]) {
      groupedTrades[instId] = [];
    }
    groupedTrades[instId].push(trade);
  }

  const results = {};
  for (const [instId, symbolTrades] of Object.entries(groupedTrades)) {
    let position = 0;
    let totalProfit = 0;
    let totalFee = 0;
    let lastBuyOrder = null;

    for (const trade of symbolTrades) {
      const size = parseFloat(trade.accFillSz);
      const price = parseFloat(trade.avgPx);
      const side = trade.side;

      // 计算手续费
      const fee = Math.abs(parseFloat(trade.fee));
      const feeUsdt = trade.feeCcy !== 'USDT' ? fee * price : fee;
      totalFee += feeUsdt;

      if (side === 'buy') {
        lastBuyOrder = {
          size,
          price,
          fee: feeUsdt
        };
        position += size;
      } else { // sell
        if (lastBuyOrder) {
          // 只与最近的买单配对
          const matchSize = Math.min(size, lastBuyOrder.size);
          
          // 计算这部分的盈利
          const profit = matchSize * (price - lastBuyOrder.price);
          // 分摊买入手续费
          const buyFeePortion = lastBuyOrder.fee * (matchSize / lastBuyOrder.size);
          // 分摊卖出手续费
          const sellFeePortion = feeUsdt * (matchSize / size);

          totalProfit += profit - buyFeePortion - sellFeePortion;

          // 更新剩余买单数量
          if (matchSize === lastBuyOrder.size) {
            lastBuyOrder = null;
          } else {
            lastBuyOrder.size -= matchSize;
            lastBuyOrder.fee *= (lastBuyOrder.size / (lastBuyOrder.size + matchSize));
          }
        }
        position -= size;
      }
    }

    // 计算未平仓均价
    const avgCost = lastBuyOrder ? lastBuyOrder.price : 0;

    results[instId] = {
      realizedProfit: Number(totalProfit.toFixed(4)),
      totalFee: Number(totalFee.toFixed(4)),
      netProfit: Number((totalProfit - totalFee).toFixed(4)),
      openPosition: Number(position.toFixed(4)),
      avgCost: position > 0 ? Number(avgCost.toFixed(4)) : 0
    };
  }

  return results;
}