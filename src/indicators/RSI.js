export function calculateRSI(closes, period = 14) {
  if (closes.length < period + 1) return -1;

  // 只取最后需要的数据进行计算
  // 需要period+1个数据点，因为要计算period个价格变化
  const recentCloses = closes.slice(-(period + 1));

  let gains = 0,
    losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = recentCloses[i] - recentCloses[i - 1];
    if (diff > 0) gains += diff;
    else losses -= diff;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;

  // 由于我们已经只取了所需的数据，这个循环可以移除
  // 最后一个价格变化已经在上面的循环中计算过了

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}
