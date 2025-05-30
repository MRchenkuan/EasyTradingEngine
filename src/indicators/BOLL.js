export function calculateBOLL(priceData, last_window = 20, multiplier = 2) {
  if (priceData.length < last_window) throw '价格数据不足以计算BOLL';
  const o_length = priceData.length;

  // 初始化结果数组，用null填充所有位置
  const result = {
    ts: new Array(o_length).fill(null),
    middle: new Array(o_length).fill(null),
    upper: new Array(o_length).fill(null),
    lower: new Array(o_length).fill(null),
    bandwidth: new Array(o_length).fill(null)
  };

  // 填充时间戳
  result.ts = priceData.map(candle => candle.ts);

  // 从第last_window个点开始计算布林带值
  for (let i = last_window - 1; i < o_length; i++) {
    // 获取计算窗口的数据
    const windowData = priceData.slice(i - last_window + 1, i + 1);
    const closes = windowData.map(candle => candle.close);

    // 计算中轨（简单移动平均线）
    const sma = closes.reduce((sum, price) => parseFloat(sum) + parseFloat(price), 0) / last_window;

    // 计算标准差
    const squaredDiffs = closes.map(price => Math.pow(parseFloat(price) - sma, 2));
    const variance = squaredDiffs.reduce((sum, diff) => parseFloat(sum) + parseFloat(diff), 0) / last_window;
    const standardDeviation = Math.sqrt(variance);

    // 计算上轨和下轨
    const upperBand = sma + (multiplier * standardDeviation);
    const lowerBand = sma - (multiplier * standardDeviation);

    // 将计算结果放在对应位置
    result.middle[i] = sma;
    result.upper[i] = upperBand;
    result.lower[i] = lowerBand;
    result.bandwidth[i] = (upperBand - lowerBand) / sma;
  }

  // 返回最新的单个值和完整的数组
  return {
    middle: result.middle.at(-1),
    upper: result.upper.at(-1),
    lower: result.lower.at(-1),
    bandwidth: result.bandwidth.at(-1),
    tsArray: result.ts,
    middleArray: result.middle,
    upperArray: result.upper,
    lowerArray: result.lower,
    bandwidthArray: result.bandwidth
  };
}

/**
 * 高性能计算最新布林带值
 * @param {Array} priceData K线数据
 * @param {Number} last_window 计算窗口大小，默认20
 * @param {Number} multiplier 标准差倍数，默认2
 * @param {Number} offset 偏移量，0表示最新值，1表示倒数第二个值，默认0
 * @returns {Object} 指定位置的布林带值
 */
export function calculateBOLLLast(priceData, last_window = 20, multiplier = 2, offset = 0) {
  if (priceData.length < last_window + offset) throw '价格数据不足以计算BOLL';

  // 获取指定位置的窗口数据
  const targetIndex = priceData.length - 1 - offset;
  const closes = priceData
    .slice(targetIndex - last_window + 1, targetIndex + 1)
    .map(candle => parseFloat(candle.close));

  // 计算中轨（简单移动平均线）
  const sma = closes.reduce((sum, price) => sum + price, 0) / last_window;

  // 计算标准差
  const squaredDiffs = closes.map(price => Math.pow(price - sma, 2));
  const variance = squaredDiffs.reduce((sum, diff) => sum + diff, 0) / last_window;
  const standardDeviation = Math.sqrt(variance);

  // 计算上轨和下轨
  const upperBand = sma + (multiplier * standardDeviation);
  const lowerBand = sma - (multiplier * standardDeviation);

  // 返回指定位置的布林带值
  return {
    middle: sma,
    upper: upperBand,
    lower: lowerBand,
    bandwidth: (upperBand - lowerBand) / sma,
    ts: priceData[targetIndex].ts
  };
}