export function calculateATR(priceData, period = 14) {
  if (priceData.length < period + 1) return -1;

  // 只取最后 period+1 个数据点进行计算
  const recentData = priceData.slice(-(period + 1));

  let trSum = 0;
  const trs = [];
  for (let i = 1; i < recentData.length; i++) {
    const prevClose = recentData[i - 1].close;
    const tr = Math.max(
      recentData[i].high - recentData[i].low,
      Math.abs(recentData[i].high - prevClose),
      Math.abs(recentData[i].low - prevClose)
    );
    trs.push(tr);
    if (i <= period) trSum += tr;
  }

  let atr = trSum / period;
  for (let i = period; i < trs.length; i++) {
    atr = (atr * (period - 1) + trs[i]) / period; // EMA平滑
  }
  return atr;
}
