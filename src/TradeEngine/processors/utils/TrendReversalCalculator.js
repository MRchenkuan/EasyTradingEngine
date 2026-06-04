import { calculateATR } from '../../../indicators/ATR.js';
import { calculateBOLLLast } from '../../../indicators/BOLL.js';
import { calculateIV } from '../../../indicators/IV.js';
import { calculateMA } from '../../../indicators/MA.js';
import { calculateRSI } from '../../../indicators/RSI.js';

function situations({
  price_span,
  price_grid_count,
  candles,
  price,
  tendency,
  rsi_fast,
  rsi_slow,
  grid_ceil_line,
  grid_floor_line,
}) {
  let boll_factor = 1;
  let boll_msg = '♻️ 价格在正常区间，🚧🔹 阈值不变';
  const { middle, upper, lower, bandwidth, ts } = calculateBOLLLast(candles, 20, 2, 0);
  const middle_offset = price - middle;
  const half_band_width = price > middle ? upper - middle : middle - lower;
  const band_deviation = (middle_offset / half_band_width) * 50;
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
  } else if (band_deviation_abs <= 55) {
    boll_factor = 0.4;
    boll_msg = middle_offset > 0 ? '📈价格突破上轨' : '📉价格突破下轨';
  }
  if (band_deviation_abs > 55) {
    boll_factor = 0.3;
    boll_msg = middle_offset > 0 ? '📈价格显著突破上轨' : '📉价格显著突破下轨';
  }
  if (band_deviation_abs > 65) {
    boll_factor = 0.2;
    boll_msg = middle_offset > 0 ? '📈价格极速突破上轨' : '📉价格极速突破下轨';
  }
  if (band_deviation_abs > 85) {
    boll_factor = 0.1;
    boll_msg = middle_offset > 0 ? '📈价格猛烈突破上轨' : '📉价格猛烈突破下轨';
  }

  let grid_factor = 1;
  let grid_msg = '♻️ 价格在正常区间，🚧🔹 阈值不变';

  const remain_distance = tendency < 0 ? grid_ceil_line - price : price - grid_floor_line;
  const cell_width = Math.abs(grid_ceil_line - grid_floor_line);
  const over_grid_distance = remain_distance / cell_width;
  if (price_grid_count >= 1) {
    grid_msg = `只超过${price_span.toFixed(2)}格，越过网格线${over_grid_distance.toFixed(2)}格，🚧🔹 阈值不变`;
    grid_factor = 1;
    if (over_grid_distance <= 0.1) {
      grid_msg = `价格${price_span.toFixed(2)}格，距离网格线${over_grid_distance.toFixed(2)}格，🚧🔹 阈值不变`;
      grid_factor = 1;
    }
  }

  if (price_grid_count >= 2) {
    grid_msg = `超过${price_span.toFixed(2)}格，🚧🔹 放宽阈值`;
    grid_factor = 1;
    if (over_grid_distance <= 0.1) {
      grid_msg = `价格${price_span.toFixed(2)}格，距离网格线${over_grid_distance.toFixed(2)}格，🚧🔻 锁定利润`;
      grid_factor = 0.2;
    }
  }
  if (price_grid_count >= 3) {
    grid_msg = `超过${price_span.toFixed(2)}格，🚧🔺 允许更大回撤`;
    grid_factor = 1.25;
    if (over_grid_distance <= 0.1) {
      grid_msg = `价格${price_span.toFixed(2)}格，距离网格线${over_grid_distance.toFixed(2)}格，🚧🔻 锁定利润`;
      grid_factor = 0.2;
    }
  }
  if (price_grid_count >= 4) {
    grid_msg = `超过${price_span.toFixed(2)}格，🚧🔺 许更大回撤`;
    grid_factor = 1.5;
    if (over_grid_distance <= 0.1) {
      grid_msg = `价格${price_span.toFixed(2)}格，距离网格线${over_grid_distance.toFixed(2)}格，🚧🔻 锁定利润`;
      grid_factor = 0.2;
    }
  }

  let rsi_msg = '⌛价格收集中...';
  let rsi_factor = 1;
  if (!(rsi_fast >= 0 && rsi_slow >= 0)) {
    rsi_factor = 1;
    rsi_msg = '⌛价格收集中...';
  } else {
    rsi_msg = '♻️ 价格平稳';
    rsi_factor = 1;
    const isTrendUp = tendency > 0;
    const isTrendDown = tendency < 0;
    const is_over_buy = rsi_fast > 70;
    const is_over_sell = rsi_fast < 30;

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

function getATR(candles, p = 10) {
  return calculateATR(candles, p);
}

function getVolatility(prices, p = 14) {
  return calculateIV(prices.slice(-p));
}

function getVolume(candles, acc = false) {
  if (acc) {
    return candles.map(candle => candle.vol).reduce((a, b) => a + b, 0);
  }
  return parseFloat(candles.map(candle => candle.vol).at(-1));
}

function getFastRSI(prices, p = 10) {
  return calculateRSI(prices, p);
}

function getSlowRSI(candles, p = 10) {
  const prices = candles.map(candle => candle.close);
  return calculateRSI(prices, p);
}

function getBOLL(candles, p = 20) {
  return calculateBOLLLast(candles, p);
}

function getVolumeStandard(candles, slow_window = 30, fast_window = 3) {
  const volumeArray = candles
    .map(candle => parseFloat(candle.vol));

  const { vol: lastVol, ts } = candles.at(-1);

  const movingAverages = calculateMA(volumeArray, slow_window);
  const movingAverages_fast = calculateMA(volumeArray, fast_window);
  const lastMovingAverage = movingAverages.at(-1) || 0;
  const lastMovingAverage_fast = movingAverages_fast.at(-1) || 0;

  const currentTime = Math.floor(Date.now() / 1000);
  const elapsedSeconds = Math.max(1, currentTime - ts / 1000);

  return {
    vol: parseFloat(lastVol),
    vol_avg_slow: lastMovingAverage,
    vol_avg_fast: lastMovingAverage_fast,
    second: elapsedSeconds,
  };
}

export function trendReversalThreshold(
  candles,
  recent_prices,
  price,
  threshold,
  price_span,
  price_grid_count,
  time_passed_seconds,
  diff_rate,
  tendency,
  grid_box
) {
  if (price_span > 1.75 && price_grid_count < 2) {
    threshold = threshold * 0.75;
  }

  const min_threshold = 0.001;
  const max_threshold = 0.012;

  const volatility = getVolatility(recent_prices, 30);
  const atr_6 = getATR(candles, 6);
  const atr_22 = getATR(candles, 25);
  const atr_120 = getATR(candles, 120);
  const rsi_fast = getFastRSI(recent_prices, 60);
  const rsi_slow = getFastRSI(recent_prices, 300);
  const { vol_avg_fast, vol_avg_slow } = getVolumeStandard(candles);
  const boll = getBOLL(candles, 20);
  const vol_power = vol_avg_fast / vol_avg_slow;
  const { ceil: grid_ceil_line, floor: grid_floor_line } = grid_box;

  const initial_threshold = (threshold = Math.min(atr_120 * 3, threshold));
  threshold = Math.max(min_threshold, Math.min(threshold, max_threshold));

  const {
    boll: { factor: boll_factor, msg: boll_msg },
    grid: { factor: grid_factor, msg: grid_msg },
    rsi: { factor: rsi_factor, msg: rsi_msg },
  } = situations({
    price_span,
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

  threshold *= timeFactor;
  threshold *= (boll_factor + rsi_factor) * 0.5;
  threshold *= grid_factor;

  const final_threshold = Math.min(Math.max(threshold, min_threshold), max_threshold);

  return {
    threshold: final_threshold,
    snapshot: {
      initial: initial_threshold,
      boll_factor,
      boll_msg,
      grid_factor,
      grid_msg,
      rsi_factor,
      rsi_msg,
      time_factor: timeFactor,
    },
    indicators: {
      price,
      price_span,
      price_grid_count,
      volatility,
      atr_6,
      atr_22,
      atr_120,
      boll_bandwidth: boll.bandwidth,
      vol_power,
      rsi_fast,
      rsi_slow,
      initial_threshold,
      final_threshold,
      diff_rate,
      time_passed_seconds,
      factors: {
        boll_factor,
        boll_msg,
        grid_factor,
        grid_msg,
        rsi_factor,
        rsi_msg,
        time_factor: timeFactor,
      },
    },
  };
}