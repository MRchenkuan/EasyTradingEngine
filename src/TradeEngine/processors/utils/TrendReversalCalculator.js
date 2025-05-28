import { calculateATR } from '../../../indicators/ATR.js';
import { calculateBOLLLast } from '../../../indicators/BOLL.js';
import { calculateIV } from '../../../indicators/IV.js';
import { calculateMA } from '../../../indicators/MA.js';
import { calculateRSI } from '../../../indicators/RSI.js';

function isBoolBreakRetracement(prices) {
  const { middle, upper, lower, bandwidth, ts } = getBOLL(prices, 20);
  // 方向向下
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

function getRSIFactor(rsi_fast, rsi_slow, bandDeviation, tendency, is_retrace) {
  const rsiDivergence = Math.abs(rsi_fast - rsi_slow);
  let rsi_msg = '⌛价格收集中...';
  let rsi_factor = 1;
  if (rsi_fast >= 0 && rsi_slow >= 0) {
    rsi_msg = '♻️ 价格平稳';

    // 结合布林带位置判断
    const isNearUpper = bandDeviation > 40;
    const isNearLower = bandDeviation < -40;
    const isTrendUp = tendency > 0;
    const isTrendDown = tendency < 0;
    const is_approaching_lower = isTrendDown && isNearLower;
    const is_approaching_upper = isTrendUp && isNearUpper;

    const ranges = {
      turbo: 0.5,
      fit: 0.75,
      little: 0.85,
      expand: 1.25,
    };

    if (rsi_fast > 70) {
      // 超买区域
      if (rsi_fast > rsi_slow) {
        // 超买加强
        if (is_approaching_upper) {
          // 上升趋势且接近上轨，超买加强，显著降低阈值快速锁定利润
          rsi_factor = Math.max(ranges.turbo, 1 - rsiDivergence / 15);
          rsi_msg = '🚀📈 趋势向上+超买加强+接近上轨，极速锁定利润🔻🔻';
        } else if (is_approaching_lower) {
          // 下降趋势但在下轨超买，可能是强力反转，轻微降低阈值
          rsi_factor = Math.max(ranges.fit, 1 - rsiDivergence / 40);
          rsi_msg = '🔄 趋势向下+超买+接近下轨，反转信号，适度降低阈值🔻';
        } else {
          rsi_factor = 1;
          rsi_msg = '🐢📈 超买加强，但未满足变化条件（未靠近同向轨道）🔹';
        }
      } else {
        // 超买减弱
        if (is_approaching_upper) {
          // 上升趋势且接近上轨，超买开始减弱，快速降低阈值锁定利润
          rsi_factor = Math.max(ranges.fit, 1 - rsiDivergence / 25);
          rsi_msg = '🐢📈 趋势向上+超买减弱+接近上轨，快速锁定利润🔻';
        } else {
          rsi_factor = 1;
          rsi_msg = '🐢📈 超买减弱，但未满足变化条件（未靠近同向轨道）🔹';
        }
      }
    } else if (rsi_fast < 30) {
      // 超卖区域
      if (rsi_fast < rsi_slow) {
        // 超卖加强
        if (is_approaching_lower) {
          // 下降趋势且接近下轨，超卖加强，显著降低阈值快速锁定利润
          rsi_factor = Math.max(ranges.turbo, 1 - rsiDivergence / 15);
          rsi_msg = '🚀📉 趋势向下+超卖加强+接近下轨，极速锁定利润🔻🔻';
        } else if (is_approaching_upper) {
          // 上升趋势但在上轨超卖，可能是强力反转，轻微降低阈值
          rsi_factor = Math.max(ranges.fit, 1 - rsiDivergence / 40);
          rsi_msg = '🔄📉 趋势向上+超卖+接近上轨，反转信号，适度降低阈值🔻';
        } else {
          rsi_factor = 1;
          rsi_msg = '🚀📉 超卖加强，但未满足变化条件（未靠近同向轨道）🔹';
        }
      } else {
        // 超卖减弱
        if (is_approaching_lower) {
          // 下降趋势且接近下轨，超卖开始减弱，快速降低阈值锁定利润
          rsi_factor = Math.max(ranges.fit, 1 - rsiDivergence / 25);
          rsi_msg = '🐢📉 趋势向下+超卖减弱+接近下轨，快速锁定利润🔻';
        } else {
          rsi_factor = 1;
          rsi_msg = '🐢📉 超卖减弱，但未满足变化条件（未靠近同向轨道）🔹';
        }
      }
    }
  }
  return {
    rsi_factor,
    rsi_msg,
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
  direction,
  tendency
) {
  // 基础阈值（初始回撤/反弹容忍度）
  const min_threshold = 0.001; // 最小阈值，避免阈值过小
  const max_threshold = 0.012; // 最大阈值，避免阈值过大

  // 价格是否正在折返
  const is_retrace = tendency != 0 ? direction / tendency < 0 : false;

  // 获取指标数据
  const volatility = getVolatility(recent_prices, 30); // 30秒瞬时波动率（百分比）
  const atr_6 = getATR(candles, 6); // 10分钟ATR（绝对值）
  const atr_22 = getATR(candles, 25); // 10分钟ATR（绝对值）
  const rsi_fast = getFastRSI(recent_prices, 60); // 快速RSI(10)
  const rsi_slow = getFastRSI(recent_prices, 300); // 快速RSI(10)
  // const rsi_slow = getSlowRSI(10); // 慢速RSI(30)
  const { vol_avg_fast, vol_avg_slow } = getVolumeStandard(candles);
  const boll = getBOLL(candles, 20); // 20分钟BOLL(20)
  const vol_power = vol_avg_fast / vol_avg_slow; // 量能

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
  console.log(`- 🌡️ ATR(18):${(100 * atr_22).toFixed(2)}%`);

  console.log(`- 🎢布林带宽: ${(100 * boll.bandwidth).toFixed(2)}%`);
  // 4. 时间因子：每20分钟阈值递增0.1%
  const timeFactor = 1 - Math.min(Math.log1p(time_passed_seconds / 3600 / 24), 0.5);
  console.log(
    `- 🕒时间因子:${timeFactor.toFixed(2)} / ${(time_passed_seconds / 60).toFixed(2)}分钟`
  );
  console.log(`- 🌊量能因子: ${(100 * vol_power).toFixed(2)}%`);
  // 输出清晰的日志信息

  // 初始化阈值
  threshold = (atr_22 + atr_6 + threshold) / 3;

  // 确保阈值在合理范围内
  threshold = Math.max(min_threshold, Math.min(threshold, max_threshold));
  console.log(`- 🚀动量因子(RSI): ${rsi_fast.toFixed(0)} / ${rsi_slow.toFixed(0)}`);
  console.log(`- 🚧初始阈值: ${(threshold * 100).toFixed(2)}%`);
  console.log(`-------------------`);

  // 计算价格相对于布林带的位置（0-50范围，0=中轨，50=上/下轨）
  const bandDeviation =
    price > boll.middle
      ? ((price - boll.middle) / (boll.upper - boll.middle)) * 50 // 中轨以上
      : ((price - boll.middle) / (boll.middle - boll.lower)) * 50; // 中轨以下

  // 动态调整阈值
  const deviationAbs = Math.abs(bandDeviation);
  let thresholdAdjustment = 1;
  let deviationMessage = '';

  // 根据价格位置和趋势方向调整阈值
  if (deviationAbs < 10) {
    // 价格接近中轨，增加阈值
    thresholdAdjustment = 0.75;
    deviationMessage = '🪜 价格接近中轨，趋势大概率延续，减少门限。';
  } else if (deviationAbs > 35) {
    // 价格接近边界，根据趋势方向调整
    const isNearUpper = bandDeviation > 35;
    const isNearLower = bandDeviation < -35;

    deviationMessage = `${isNearUpper ? '📈价格正在 触及上轨' : '📉价格正在 触及下轨'}`;
    if (tendency !== 0) {
      const isTrendUp = tendency > 0;
      // 上升趋势接近上轨或下降趋势接近下轨时减小阈值
      if ((isTrendUp && isNearUpper) || (!isTrendUp && isNearLower)) {
        if (price_grid_count >= 3) {
          deviationMessage += `，且超过${price_distance_count.toFixed(2)}格，已有利润空间，🚧🔺 许更大回撤`;
          thresholdAdjustment = 1.5;
          if (price_distance_count >= 3.5) {
            deviationMessage += `，且超过${price_grid_count}格，先确保利润，🚧🔻 阈值减少`;
            thresholdAdjustment = 0.75;
          }
        } else if (price_grid_count >= 2) {
          deviationMessage += `，且超过${price_distance_count.toFixed(2)}格，已有利润空间，🚧🔺 许更大回撤`;
          thresholdAdjustment = 1.25;
          if (price_distance_count >= 2.5) {
            deviationMessage += `，且超过${price_grid_count}格，先确保利润，🚧🔻 阈值减少`;
            thresholdAdjustment = 0.5;
          }
        }
      } else {
        deviationMessage += `，反向触界，🚧🔺 阈值增加`;
        // 反向触及边界时增加阈值
        thresholdAdjustment = 1.5;
      }
    }
  } else {
    deviationMessage = '♻️ 价格在正常区间，🚧🔹 阈值不变';
  }

  // 应用阈值调整
  threshold *= thresholdAdjustment;

  [
    `📐价格偏离度：${bandDeviation.toFixed(2)}%`,
    `${deviationMessage}`,
    `🎯调整阈值至：🚧 ${(threshold * 100).toFixed(2)}%`,
  ].map(msg => console.log(` * ${msg}`));

  let {rsi_factor, rsi_msg} = getRSIFactor(rsi_fast, rsi_slow, bandDeviation, tendency, is_retrace);

  threshold = threshold * rsi_factor;
  console.log(` * ${rsi_msg}(${rsi_factor.toFixed(2)})`);
  console.log(` * 🎯调整阈值至：🚧 ${(threshold * 100).toFixed(2)}%`);
  console.log(` * ↩️ 当前回撤：🚧 ${(100 * diff_rate).toFixed(2)}%`);
  console.log(`-------------------`);

  // --- 合成动态阈值 ---

  // 硬性限制：阈值范围0.2%~5%
  return Math.min(Math.max(threshold, min_threshold), max_threshold);
}
