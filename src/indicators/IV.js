/**
   * 瞬时波动率计算函数
   * @param {Array} recentPrices 价格序列
   * @param {number} p 计算周期，默认14
   * @returns {number} 分钟级波动率
   */
export function calculateIV(recentPrices) {
  // 检查输入数据
  if (!recentPrices || recentPrices.length < 2) {
    return 0;
  }

  // 确保使用最新的p个数据点
  const prices = recentPrices;

  // 计算对数收益率
  const returns = [];
  for (let i = 1; i < prices.length; i++) {
    // 使用对数收益率
    const return_rate = Math.log(prices[i] / prices[i - 1]);
    returns.push(return_rate);
  }

  if (returns.length === 0) {
    return 0;
  }

  // 计算收益率的均值
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;

  // 计算方差（使用无偏估计）
  const variance = returns.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / (returns.length - 1);

  // 转换为分钟级波动率
  // 假设输入的价格序列是秒级的，需要转换为分钟级
  // 使用时间缩放因子：sqrt(60)，因为波动率与时间的平方根成正比
  return Math.sqrt(variance) * Math.sqrt(60);
}