export function calculateRSI(closes, period = 14) {
  // 至少需要10个数据点才能计算价格变化
  if (closes.length < 10) return -1;

  // 动态调整计算周期，取实际数据长度和目标周期的较小值
  const actualPeriod = Math.min(period, closes.length - 1);

  // 只取最后需要的数据进行计算
  const recentCloses = closes.slice(-(actualPeriod + 1));

  let gains = 0,
    losses = 0;
  for (let i = 1; i <= actualPeriod; i++) {
    const diff = recentCloses[i] - recentCloses[i - 1];
    if (diff > 0) gains += diff;
    else losses -= diff;
  }
  let avgGain = gains / actualPeriod;
  let avgLoss = losses / actualPeriod;

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}
