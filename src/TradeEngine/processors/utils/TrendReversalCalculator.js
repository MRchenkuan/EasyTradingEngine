import { calculateATR } from '../../../indicators/ATR.js';
import { calculateBOLLLast } from '../../../indicators/BOLL.js';
import { calculateIV } from '../../../indicators/IV.js';
import { calculateMA } from '../../../indicators/MA.js';
import { calculateRSI } from '../../../indicators/RSI.js';

function situations({
  price_distance_count,
  price_grid_count,
  candles,
  price,
  tendency,
  rsi_fast,
  rsi_slow,
  grid_ceil_line,
  grid_floor_line,
}) {
  // 1. 布林带突破
  // 价格突破上下轨，且形成周期内峰值，缩减阈值
  // 价格经过中轨时，如果是属于回撤，则认为趋势将持续，此时缩减阈值锁定利润，如果是属于相同的趋势，则不处理
  let boll_factor = 1;
  let boll_msg = '♻️ 价格在正常区间，🚧🔹 阈值不变';
  const { middle, upper, lower, bandwidth, ts } = calculateBOLLLast(candles, 20, 2, 0);
  // 动态调整阈值
  const middle_offset = price - middle;
  const half_band_width = price > middle ? upper - middle : middle - lower;
  const band_deviation = (middle_offset / half_band_width) * 50; // 价格在布林带中的位置
  const band_deviation_abs = Math.abs(band_deviation);

  if (band_deviation_abs <= 10) {
    boll_factor = 0.8;
    boll_msg = '🪜 价格接近中轨，趋势大概率延续，减少门限。';
  } else if (band_deviation_abs <= 39) {
    boll_factor = 1;
    boll_msg = '♻️ 价格在正常区间，🚧🔹 阈值不变';
  } else if (band_deviation_abs <= 49) {
    boll_factor = 0.7;
    boll_msg = middle_offset > 0 ? '📈价格正在 触及上轨' : '📉价格正在 触及下轨';
  } else if (band_deviation_abs <= 59) {
    boll_factor = 0.4;
    boll_msg = middle_offset > 0 ? '📈价格突破上轨' : '📉价格突破下轨';
  }
  if (band_deviation_abs > 59) {
    boll_factor = 0.3;
    boll_msg = middle_offset > 0 ? '📈价格显著突破上轨' : '📉价格显著突破下轨';
  }
  if (band_deviation_abs > 69) {
    boll_factor = 0.2;
    boll_msg = middle_offset > 0 ? '📈价格极速突破上轨' : '📉价格极速突破下轨';
  }
  if (band_deviation_abs > 89) {
    boll_factor = 0.1;
    boll_msg = middle_offset > 0 ? '📈价格猛烈突破上轨' : '📉价格猛烈突破下轨';
  }

  // 2. 价格距离突破
  // 价距突破每n个网格线后，如果回撤距离正好为1/5 格，且当前价距仍然在n格以上，则立刻调整阈值为1/6，锁定网格利润，
  // 但如果没捕捉到导致下降了一格，则重新判断,此逻辑 n 必须大于2
  let grid_factor = 1;
  let grid_msg = '♻️ 价格在正常区间，🚧🔹 阈值不变';

  const remain_distance = tendency < 0 ? grid_ceil_line - price : price - grid_floor_line;
  const cell_width = Math.abs(grid_ceil_line - grid_floor_line);
  const over_grid_distance = remain_distance / cell_width;
  if (price_grid_count >= 1) {
    grid_msg = `只超过${price_distance_count.toFixed(2)}格，越过格子${over_grid_distance.toFixed(2)}格，🚧🔹 阈值不变`;
    grid_factor = 1;
    if (over_grid_distance <= 0.2) {
      grid_msg = `价格${price_distance_count.toFixed(2)}格，刚超过${over_grid_distance.toFixed(2)}格，🚧🔹 阈值不变`;
      grid_factor = 1;
    }
  }

  if (price_grid_count >= 2) {
    grid_msg = `超过${price_distance_count.toFixed(2)}格，🚧🔹 逐步放宽阈值`;
    grid_factor = 1;
    if (over_grid_distance <= 0.2) {
      grid_msg = `价格${price_distance_count.toFixed(2)}格，刚超过${over_grid_distance.toFixed(2)}格，🚧🔻 锁定利润`;
      grid_factor = 0.2;
    }
  }
  if (price_grid_count >= 3) {
    grid_msg = `超过${price_distance_count.toFixed(2)}格，🚧🔺 允许更大回撤`;
    grid_factor = 1.25;
    if (over_grid_distance <= 0.2) {
      grid_msg = `价格${price_distance_count.toFixed(2)}格，刚超过${over_grid_distance.toFixed(2)}格，🚧🔻 锁定利润`;
      grid_factor = 0.2;
    }
  }
  if (price_grid_count >= 4) {
    grid_msg = `超过${price_distance_count.toFixed(2)}格，🚧🔺 许更大回撤`;
    grid_factor = 1.5;
    if (over_grid_distance <= 0.2) {
      grid_msg = `价格${price_distance_count.toFixed(2)}格，刚超过${over_grid_distance.toFixed(2)}格，🚧🔻 锁定利润`;
      grid_factor = 0.2;
    }
  }

  // 3. 动量突破
  // 上行趋势，如果超买，显著减少阈值，超买增强时，锁定利润，在超卖减弱时减少阈值
  // 下行趋势，如果超卖，显著减少阈值，超卖增强时，锁定利润，在超买减弱时减少阈
  let rsi_msg = '⌛价格收集中...';
  let rsi_factor = 1;
  if (!(rsi_fast >= 0 && rsi_slow >= 0)) {
    rsi_factor = 1;
    rsi_msg = '⌛价格收集中...';
  } else {
    rsi_msg = '♻️ 价格平稳';
    rsi_factor = 1;
    // 结合布林带位置判断
    const isTrendUp = tendency > 0;
    const isTrendDown = tendency < 0;
    const is_over_buy = rsi_fast > 70;
    const is_over_sell = rsi_fast < 30;

    // 超买卖强度
    const strength = Math.abs(rsi_fast - rsi_slow) / 40;

    if (isTrendUp && is_over_buy) {
      rsi_factor = 0.2;
      rsi_msg = '🚀📈 超买，降低阈值锁定利润🔻';
      if (rsi_fast < rsi_slow) {
        rsi_factor = 0.5;
        rsi_msg = '🚀📈 超买减弱，轻微降低阈值锁定利润🔻';
      } else {
        rsi_factor = 0.2;
        rsi_msg = '🚀📈 超买加强，显著降低阈值快速锁定利润🔻🔻';
      }
    }

    if (isTrendDown && is_over_sell) {
      rsi_factor = 0.2;
      rsi_msg = '🚀📉 超卖，降低阈值锁定利润🔻';
      if (rsi_fast > rsi_slow) {
        rsi_factor = 0.5;
        rsi_msg = '🚀📉 超卖减弱，轻微降低阈值锁定利润🔻';
      } else {
        rsi_factor = 0.2;
        rsi_msg = '🚀📉 超卖加强，显著降低阈值快速锁定利润🔻🔻';
      }
    }

    if (isTrendDown && is_over_buy) {
      rsi_factor = 1;
      rsi_msg = '🚀📈 反向超买，利润缩小，继续等待，🐢';
      if (rsi_fast < rsi_slow) {
        rsi_factor = 1;
        rsi_msg = '🚀📈 反向超买减弱，乐观信号，保持等待🐢';
      } else {
        rsi_factor = 0.2;
        rsi_msg = '🚀📈 反向超买加强，悲观信号，显著降低阈值快速减少损失🔻🔻';
      }
    }

    if (isTrendUp && is_over_sell) {
      rsi_factor = 1;
      rsi_msg = '🚀📉 反向超卖，利润缩小，继续等待，🐢';

      if (rsi_fast > rsi_slow) {
        rsi_factor = 1;
        rsi_msg = '🚀📉 反向超卖减弱，乐观信号，保持等待🐢';
      } else {
        rsi_factor = 0.2;
        rsi_msg = '🚀📉 反向超卖加强，悲观信号，显著降低阈值快速减少损失🔻🔻';
      }
    }
  }

  // 5. 背离信号、量价
  // 价格创新高，RSI未创新高，则锁定利润，
  // 价格创新低，RSI未创新低，则锁定利润，

  return {
    boll: {
      factor: boll_factor,
      msg: boll_msg,
    },
    grid: {
      factor: grid_factor,
      msg: grid_msg,
    },
    rsi: {
      factor: rsi_factor,
      msg: rsi_msg,
    },
  };
}

/**
 * 计算ATR（平均真实范围）指标
 * @param {Array<Object>} candles K线数据数组
 * @param {number} [p=10] 计算周期
 * @returns {number} ATR值
 */
function getATR(candles, p = 10) {
  return calculateATR(candles, p);
}

/**
 * 计算价格波动率
 * @param {Array<number>} prices 价格数组
 * @param {number} [p=14] 计算周期
 * @returns {number} 波动率值（百分比）
 */
function getVolatility(prices, p = 14) {
  return calculateIV(prices.slice(-p));
}

/**
 * 获取交易量数据
 * @param {Array<Object>} candles K线数据数组
 * @param {boolean} [acc=false] 是否累计成交量
 * @returns {number} 成交量值或累计成交量
 */
function getVolume(candles, acc = false) {
  if (acc) {
    return candles.map(candle => candle.vol).reduce((a, b) => a + b, 0);
  }
  return parseFloat(candles.map(candle => candle.vol).at(-1));
}

/**
 * 计算快速RSI指标
 * @param {Array<number>} prices 价格数组
 * @param {number} [p=10] 计算周期
 * @returns {number} RSI值
 */
function getFastRSI(prices, p = 10) {
  return calculateRSI(prices, p);
}

/**
 * 计算慢速RSI指标
 * @param {Array<Object>} candles K线数据数组
 * @param {number} [p=10] 计算周期
 * @returns {number} RSI值
 */
function getSlowRSI(candles, p = 10) {
  const prices = candles.map(candle => candle.close);
  return calculateRSI(prices, p);
}

/**
 * 计算布林带指标
 * @param {Array<Object>} candles K线数据数组
 * @param {number} [p=20] 计算周期
 * @returns {Object} 布林带数据对象，包含上轨、中轨、下轨和带宽
 */
function getBOLL(candles, p = 20) {
  return calculateBOLLLast(candles, p);
}

/**
 * 计算成交量标准化指标
 * @param {Array<Object>} candles K线数据数组
 * @param {number} [slow_window=30] 慢速移动平均周期
 * @param {number} [fast_window=3] 快速移动平均周期
 * @returns {Object} 成交量分析结果，包含当前成交量、慢速均值、快速均值和已过时间
 */
function getVolumeStandard(candles, slow_window = 30, fast_window = 3) {
  const volumeArray = candles
    // .filter(candle => candle.confirm > 0)
    .map(candle => parseFloat(candle.vol));

  // 获取最后n根K线数据
  const { vol: lastVol, ts } = candles.at(-1); // 最新的K线

  const movingAverages = calculateMA(volumeArray, slow_window);
  const movingAverages_fast = calculateMA(volumeArray, fast_window);
  const lastMovingAverage = movingAverages.at(-1) || 0;
  const lastMovingAverage_fast = movingAverages_fast.at(-1) || 0;

  // 计算当前分钟已经过去的时间（秒）
  const currentTime = Math.floor(Date.now() / 1000);
  const elapsedSeconds = Math.max(1, currentTime - ts / 1000); // 防止除零

  return {
    vol: parseFloat(lastVol), // 当前分钟已成交量
    vol_avg_slow: lastMovingAverage, // 移动平均成交量
    vol_avg_fast: lastMovingAverage_fast, // 移动平均成交量
    second: elapsedSeconds, // 已经过去的秒数
  };
}

/**
 * 动态计算趋势翻转的阈值
 * @param {Array<Object>} candles K线数据数组
 * @param {Array<number>} recent_prices 最近的价格数组
 * @param {number} price 当前价格
 * @param {number} threshold 初始阈值
 * @param {number} price_distance_count 价格距离上次交易的绝对格数
 * @param {number} price_grid_count 价格距离上次交易的整数格数
 * @param {number} time_passed_seconds 距离上次交易的时间（秒）
 * @param {number} diff_rate 当前回撤比例
 * @param {number} direction 当前方向（1=上涨，-1=下跌）
 * @param {number} tendency 趋势方向（1=上涨，-1=下跌，0=盘整）
 * @returns {number} 计算后的动态阈值
 */
export function trendReversalThreshold(
  candles,
  recent_prices,
  price,
  threshold,
  price_distance_count,
  price_grid_count,
  time_passed_seconds,
  diff_rate,
  tendency,
  grid_box
) {
  // 基础阈值（初始回撤/反弹容忍度）
  const min_threshold = 0.001; // 最小阈值，避免阈值过小
  const max_threshold = 0.012; // 最大阈值，避免阈值过大

  // 获取指标数据
  const volatility = getVolatility(recent_prices, 30); // 30秒瞬时波动率（百分比）
  const atr_6 = getATR(candles, 6); // 10分钟ATR（绝对值）
  const atr_22 = getATR(candles, 25); // 10分钟ATR（绝对值）
  const atr_120 = getATR(candles, 120); // 10分钟ATR（绝对值）
  const rsi_fast = getFastRSI(recent_prices, 60); // 快速RSI(10)
  const rsi_slow = getFastRSI(recent_prices, 300); // 快速RSI(10)
  // const rsi_slow = getSlowRSI(10); // 慢速RSI(30)
  const { vol_avg_fast, vol_avg_slow } = getVolumeStandard(candles);
  const boll = getBOLL(candles, 20); // 20分钟BOLL(20)
  const vol_power = vol_avg_fast / vol_avg_slow; // 量能
  const { ceil: grid_ceil_line, floor: grid_floor_line } = grid_box; // 网格线

  // 默认两倍atr作为阈值
  console.log(`=========指标数据========`);
  console.log(`- 💵价格:${price.toFixed(3)}`);
  // --- 因子计算（新增price_distance_count和price_grid_count的差异化处理）---
  console.log(`- 📏价距格数:${price_distance_count.toFixed(2)}`);

  // 2. 网格跨越因子（price_grid_count）：离散格数强化趋势强度
  console.log(`- 🔲价差格数:${price_grid_count}`);

  // 3. 波动率因子：波动率>2%时放大阈值
  console.log(`- 🌪️ 瞬时波动:${(100 * volatility).toFixed(2)}%`);

  // 3. 波动率因子：波动率>2%时放大阈值
  console.log(`- 🌡️ ATR(6):${(100 * atr_6).toFixed(2)}%`);
  console.log(`- 🌡️ ATR(22):${(100 * atr_22).toFixed(2)}%`);
  console.log(`- 🌡️ ATR(120):${(100 * atr_120).toFixed(2)}%`);
  console.log(`- 🎢布林带宽: ${(100 * boll.bandwidth).toFixed(2)}%`);
  console.log(`- 🌊量能因子: ${(100 * vol_power).toFixed(2)}%`);
  // 输出清晰的日志信息

  // 初始化阈值
  threshold = Math.min(atr_120 * Math.sqrt(5), threshold);

  // 确保阈值在合理范围内
  threshold = Math.max(min_threshold, Math.min(threshold, max_threshold));
  console.log(`- 🚀动量因子(RSI): ${rsi_fast.toFixed(0)} / ${rsi_slow.toFixed(0)}`);
  console.log(`- 🚧初始阈值: ${(threshold * 100).toFixed(2)}%`);
  console.log(`-------------------`);

  const {
    boll: { factor: boll_factor, msg: boll_msg },
    grid: { factor: grid_factor, msg: grid_msg },
    rsi: { factor: rsi_factor, msg: rsi_msg },
  } = situations({
    price_distance_count,
    price_grid_count,
    candles,
    price,
    tendency,
    rsi_fast,
    rsi_slow,
    grid_ceil_line,
    grid_floor_line,
  });

  const timeFactor = 1 - Math.min(Math.log1p(time_passed_seconds / 3600 / 24), 0.5);
  console.log(` * boll 因子: ${boll_factor} ,${boll_msg}`);
  console.log(` * grid 因子: ${grid_factor} ,${grid_msg}`);
  console.log(` * rsi  因子: ${rsi_factor} ,${rsi_msg}`);
  console.log(
    ` * time 因子: ${timeFactor.toFixed(2)} ,${(time_passed_seconds / 60).toFixed(2)}分钟`
  );
  threshold *= timeFactor;
  threshold *= (boll_factor + rsi_factor) * 0.5;
  threshold *= grid_factor;

  console.log(` * 🎯调整阈值至：🚧 ${(threshold * 100).toFixed(2)}%`);
  console.log(` * ↩️ 当前回撤：🚧 ${(100 * diff_rate).toFixed(2)}%`);
  console.log(`-------------------`);

  // --- 合成动态阈值 ---

  // 硬性限制：阈值范围0.2%~5%
  return Math.min(Math.max(threshold, min_threshold), max_threshold);
}
