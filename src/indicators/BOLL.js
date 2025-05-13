export function calculateBOLL(priceData, period = 20, multiplier = 2) {
  if (priceData.length < period) throw '价格数据不足以计算BOLL';

  // 只取最后需要的数据进行计算
  const recentData = priceData.slice(-period);
  const closes = recentData.map(candle => candle.close);

  // 计算中轨（简单移动平均线）
  const sma = closes.reduce((sum, price) => parseFloat(sum) + parseFloat(price), 0) / period;

  // 计算标准差
  const squaredDiffs = closes.map(price => Math.pow(parseFloat(price) - sma, 2));
  const variance = squaredDiffs.reduce((sum, diff) => parseFloat(sum) + parseFloat(diff), 0) / period;
  const standardDeviation = Math.sqrt(variance);

  // 计算上轨和下轨
  const upperBand = sma + (multiplier * standardDeviation);
  const lowerBand = sma - (multiplier * standardDeviation);

  return {
    middle: sma,           // 中轨
    upper: upperBand,      // 上轨
    lower: lowerBand,      // 下轨
    bandwidth: (upperBand - lowerBand) / sma  // 带宽（百分比）
  };
}
