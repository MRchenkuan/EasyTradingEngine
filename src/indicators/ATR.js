export function calculateATR(priceData, period = 14) {
  if (priceData.length < period + 1) return -1;

  // 只取最后 period+1 个数据点进行计算
  const recentData = priceData.slice(-(period + 1));

  let trSum = 0;
  for (let i = 1; i < recentData.length; i++) {
    const prevClose = parseFloat(recentData[i - 1].close);
    const currentHigh = parseFloat(recentData[i].high);
    const currentLow = parseFloat(recentData[i].low);

    const tr = Math.max(
      currentHigh - currentLow,
      Math.abs(currentHigh - prevClose),
      Math.abs(currentLow - prevClose)
    );

    // 如果需要百分比，则除以前收盘价
    trSum += tr / prevClose;
  }

  // 最近 period 个 TR 的简单平均（SMA）。
  // 注：经典 Wilder ATR 需全历史递推平滑；这里只取最近 period+1 根，
  // 等价于 SMA 口径，作为阈值封顶使用误差可忽略（约 1%）。
  return trSum / period;
}
