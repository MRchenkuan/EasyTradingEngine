/**
 * 计算筹码分布
 * @param {Array} data - 分钟K线数据数组，每个元素包含:
 *        {number} open - 开盘价
 *        {number} high - 最高价
 *        {number} low - 最低价
 *        {number} close - 收盘价
 *        {number} volume - 成交量
 * @param {number} [step=0.01] - 价格区间步长（默认0.01元）
 * @returns {Object} 包含价格区间和对应筹码分布值的对象
 */
export function calculateChipDistribution(data, step = 0.01) {
  // 1. 确定全局价格范围
  let minPrice = Infinity;
  let maxPrice = -Infinity;

  for (const bar of data) {
    minPrice = Math.min(minPrice, bar.low);
    maxPrice = Math.max(maxPrice, bar.high);
  }

  // 2. 初始化价格区间分布数组
  const rangeCount = Math.ceil((maxPrice - minPrice) / step) + 1;
  const distribution = new Array(rangeCount).fill(0);

  // 3. 遍历每个K线，分配成交量
  for (const bar of data) {
    const pricePoints = [bar.open, bar.high, bar.low, bar.close];

    // 计算每个价格点应分配的成交量（1/4）
    const volumePerPoint = bar.volume / 4;

    // 将成交量分配到四个关键价格点
    for (const price of pricePoints) {
      // 计算当前价格所属区间索引
      const index = Math.floor((price - minPrice) / step);

      // 确保索引在有效范围内
      if (index >= 0 && index < rangeCount) {
        distribution[index] += volumePerPoint;
      }
    }
  }

  // 4. 生成价格区间标签
  const priceLevels = [];
  for (let i = 0; i < rangeCount; i++) {
    priceLevels.push(parseFloat((minPrice + i * step).toFixed(4)));
  }

  // 5. 返回结果
  return { priceLevels, distribution };
}
