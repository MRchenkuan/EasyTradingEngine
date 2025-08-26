/**
 * 计算数组的相对标准差（RSD，变异系数）
 * @param {number[]} array - 输入数组
 * @param {number} period - 取最后多少个数进行计算
 * @returns {number} 相对标准差值（百分比形式）
 */
export function RSD(array, period) {
  // 参数验证
  if (!Array.isArray(array)) {
    throw new Error('第一个参数必须是数组');
  }
  
  if (typeof period !== 'number' || period <= 0) {
    throw new Error('第二个参数必须是大于0的数字');
  }
  
  if (array.length === 0) {
    return 0;
  }
  
  // 如果期间大于数组长度，使用整个数组
  const actualPeriod = Math.min(period, array.length);
  
  // 获取最后actualPeriod个数
  const slice = array.slice(-actualPeriod);
  
  // 计算平均值
  const mean = slice.reduce((sum, value) => sum + value, 0) / slice.length;
  
  // 如果平均值为0，无法计算相对标准差
  if (mean === 0) {
    return 0;
  }
  
  // 计算标准差
  const variance = slice.reduce((sum, value) => {
    const diff = value - mean;
    return sum + (diff * diff);
  }, 0) / slice.length;
  
  const standardDeviation = Math.sqrt(variance);
  
  // 计算相对标准差（百分比形式）
  return (standardDeviation / Math.abs(mean)) * 100;
}

/**
 * 计算滚动相对标准差数组
 * @param {number[]} array - 输入数组
 * @param {number} period - 滚动窗口大小
 * @returns {number[]} 相对标准差数组
 */
export function rollingRSD(array, period) {
  if (!Array.isArray(array)) {
    throw new Error('第一个参数必须是数组');
  }
  
  if (typeof period !== 'number' || period <= 0) {
    throw new Error('第二个参数必须是大于0的数字');
  }
  
  const result = [];
  
  for (let i = 0; i < array.length; i++) {
    if (i + 1 >= period) {
      // 计算当前窗口的相对标准差
      const windowData = array.slice(i + 1 - period, i + 1);
      result.push(RSD(windowData, period));
    } else {
      // 数据不足时返回NaN
      result.push(NaN);
    }
  }
  
  return result;
}
