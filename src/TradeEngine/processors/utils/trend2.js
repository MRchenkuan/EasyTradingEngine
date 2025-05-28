// ---------------------- 通用工具函数 ----------------------
/**
 * 计算指数移动平均线(EMA)
 * @description
 * - 相比SMA更重视近期数据，对市场变化反应更敏感
 * - 计算公式：EMA = 当日价格 * k + 前一日EMA * (1-k)，其中k = 2/(周期+1)
 * - 应用：用于MACD等指标的基础计算，能更快反映价格趋势
 */
function calculateEMA(data, periods) {
  const k = 2 / (periods + 1);
  const ema = [data[0]];
  for (let i = 1; i < data.length; i++) {
    ema.push(data[i] * k + ema[i - 1] * (1 - k));
  }
  return ema;
}

/**
 * 计算简单移动平均线(SMA)
 * @description
 * - 最基础的均线指标，反映价格的平均走势
 * - 计算方法：N日内价格的算术平均值
 * - 应用：用于识别整体趋势，也是布林带的中轨计算基础
 */
function calculateSMA(data, periods) {
  const sma = [];
  for (let i = periods - 1; i < data.length; i++) {
    const sum = data.slice(i - periods + 1, i + 1).reduce((a, b) => a + b, 0);
    sma.push(sum / periods);
  }
  return sma;
}

// ---------------------- 指标计算函数 ----------------------
/**
 * 计算相对强弱指标(RSI)
 * @description
 * - 衡量价格的超买超卖状态
 * - 计算逻辑：
 *   1. 计算价格变化的上涨和下跌幅度
 *   2. 分别计算上涨和下跌的平均值
 *   3. 通过相对强度计算RSI值(0-100)
 * - 信号生成：
 *   - RSI > 70 表示超买，可能下跌
 *   - RSI < 30 表示超卖，可能上涨
 */
function calculateRSI(closes, periods = 14) {
  if (closes.length < periods) return { values: [], signal: 0 };

  const deltas = closes.slice(1).map((c, i) => c - closes[i]);
  const gains = deltas.map(d => Math.max(d, 0));
  const losses = deltas.map(d => Math.abs(Math.min(d, 0)));

  let avgGain = gains.slice(0, periods).reduce((a, b) => a + b, 0) / periods;
  let avgLoss = losses.slice(0, periods).reduce((a, b) => a + b, 0) / periods;

  const rsi = [];
  for (let i = periods; i < closes.length; i++) {
    avgGain = (avgGain * (periods - 1) + gains[i]) / periods;
    avgLoss = (avgLoss * (periods - 1) + losses[i]) / periods;
    const rs = avgGain / (avgLoss || 0.0001);
    rsi.push(100 - 100 / (1 + rs));
  }

  const currentRSI = rsi[rsi.length - 1] || 50;
  const signal = Math.max(Math.min((currentRSI - 70) / 10, 1), Math.min((30 - currentRSI) / 10, 1));
  return { values: rsi, signal };
}

/**
 * 计算MACD指标
 * @description
 * - 用于判断趋势的强弱和可能的转折点
 * - 计算组成：
 *   1. 快线(DIF)：短期EMA和长期EMA的差值
 *   2. 慢线(DEA)：对DIF的移动平均
 *   3. 柱状图：DIF-DEA
 * - 背离判断：
 *   - 当价格创新高而MACD未创新高时，表示可能存在顶背离
 *   - 用于预警可能的趋势反转
 */
function calculateMACD(closes, fast = 12, slow = 26, signal = 9) {
  const emaFast = calculateEMA(closes, fast);
  const emaSlow = calculateEMA(closes, slow);

  // MACD线对齐处理
  const macdLine = emaFast.slice(slow - 1).map((f, i) => f - emaSlow[i]);
  const signalLine = calculateEMA(macdLine, signal);

  // 背离检测（最近5周期）
  const priceSlice = closes.slice(-5);
  const macdSlice = macdLine.slice(-5);
  const bearishDivergence =
    priceSlice.every((p, i) => i === 0 || p > priceSlice[i - 1]) &&
    macdSlice.every((m, i) => i === 0 || m < macdSlice[i - 1])
      ? 0.8
      : 0;

  return { macdLine, signalLine, divergenceSignal: bearishDivergence };
}

function checkMACross(ema5, ema10) {
  if (ema5.length < 2 || ema10.length < 2) return 0;
  const crossDown =
    ema5[ema5.length - 2] > ema10[ema10.length - 2] &&
    ema5[ema5.length - 1] < ema10[ema10.length - 1];
  return crossDown ? 0.7 : 0;
}

/**
 * 计算随机指标(KD)
 * @description
 * - 基于价格在高低点间的相对位置判断超买超卖
 * - 计算方法：
 *   1. K值：(收盘价-最低价)/(最高价-最低价)*100
 *   2. D值：K值的移动平均
 * - 应用：
 *   - K线下穿D线形成死叉，增加看空信号权重
 *   - 配合其他指标使用，提高信号可靠性
 */
function calculateStochastic(highs, lows, closes, periods = 14) {
  const kValues = [];
  for (let i = periods; i < closes.length; i++) {
    const high = Math.max(...highs.slice(i - periods, i));
    const low = Math.min(...lows.slice(i - periods, i));
    kValues.push(((closes[i] - low) / (high - low || 1)) * 100);
  }
  const dValues = calculateEMA(kValues, 3);

  // 死叉检测
  if (kValues.length < 2 || dValues.length < 2) return 0;
  const cross =
    kValues[kValues.length - 2] > dValues[dValues.length - 2] &&
    kValues[kValues.length - 1] < dValues[dValues.length - 1];
  return cross ? 0.6 : 0;
}

/**
 * 计算布林带指标
 * @description
 * - 反映价格的波动区间和趋势强度
 * - 计算方法：
 *   1. 中轨：N周期SMA
 *   2. 上轨：中轨 + N倍标准差
 *   3. 下轨：中轨 - N倍标准差
 * - 应用策略：
 *   - 价格突破上轨后回落，可能形成做空信号
 *   - 价格突破下轨后反弹，可能形成做多信号
 *   - 带宽扩大表示波动加剧，收窄表示盘整
 */
function calculateBollingerBands(closes, periods = 20, dev = 2) {
  const sma = calculateSMA(closes, periods);
  const stdDev = [];
  for (let i = periods - 1; i < closes.length; i++) {
    const slice = closes.slice(i - periods + 1, i + 1);
    const mean = sma[i - periods + 1];
    const variance = slice.reduce((a, c) => a + (c - mean) ** 2, 0) / periods;
    stdDev.push(Math.sqrt(variance));
  }

  const upper = sma.map((s, i) => s + dev * stdDev[i]);
  const lower = sma.map((s, i) => s - dev * stdDev[i]);

  // 信号计算
  const lastClose = closes[closes.length - 1];
  const prevClose = closes[closes.length - 2];
  const breakRetrace =
    (prevClose > upper[upper.length - 2] && lastClose < upper[upper.length - 1]) ||
    (prevClose < lower[lower.length - 2] && lastClose > lower[lower.length - 1])
      ? 0.7
      : 0;

  return { upper, lower, mid: sma, breakSignal: breakRetrace };
}

// ---------------------- 主计算函数 ----------------------
export function calculateReversalProbability(klines) {
  // 数据准备
  const closes = klines.map(k => k.close);
  const highs = klines.map(k => k.high);
  const lows = klines.map(k => k.low);

  // 各指标计算
  const rsi = calculateRSI(closes);
  const macd = calculateMACD(closes);
  const ema5 = calculateEMA(closes, 5);
  const ema10 = calculateEMA(closes, 10);
  const maCross = checkMACross(ema5.slice(-10), ema10.slice(-10)); // 取最近10个数据点
  const stochastic = calculateStochastic(highs, lows, closes);
  const bb = calculateBollingerBands(closes);

  // 权重配置
  const weights = {
    rsi: 0.2,
    macdDivergence: 0.15,
    maCross: 0.15,
    stochastic: 0.1,
    bbBreak: 0.15,
    // 可添加其他权重...
  };

  // 综合计算
  const total =
    rsi.signal * weights.rsi +
    macd.divergenceSignal * weights.macdDivergence +
    maCross * weights.maCross +
    stochastic * weights.stochastic +
    bb.breakSignal * weights.bbBreak;

  // Sigmoid归一化
  return 1 / (1 + Math.exp(-total * 2.5));
}

// ---------------------- 使用示例 ----------------------
const klines = [
  /* 1000根K线数据 */
];
const reversalProb = calculateReversalProbability(klines);
console.log(`反转概率: ${(reversalProb * 100).toFixed(1)}%`);
