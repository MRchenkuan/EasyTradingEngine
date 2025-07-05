export function calculateATR(priceData, period = 14) {
  if (priceData.length < period + 1) return -1;

  // 只取最后 period+1 个数据点进行计算
  const recentData = priceData.slice(-(period + 1));

  let trSum = 0;
  const trs = [];
  for (let i = 1; i < recentData.length; i++) {
    const prevClose = parseFloat(recentData[i - 1].close);
    const currentHigh = parseFloat(recentData[i].high);
    const currentLow = parseFloat(recentData[i].low);
    
    const tr = Math.max(
      currentHigh - currentLow,
      Math.abs(currentHigh - prevClose),
      Math.abs(currentLow - prevClose)
    );
    
    // 如果需要百分比，则除以当前收盘价
    trs.push(tr / prevClose);
    if (i <= period) trSum += trs[i - 1];
  }

  let atr = trSum / period;
  for (let i = period; i < trs.length; i++) {
    atr = (atr * (period - 1) + trs[i]) / period; // EMA平滑
  }
  return atr;
}
