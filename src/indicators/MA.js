/**
 *  * 计算移动平均线
 * @param {*} volumeArray 
 * @param {*} windowSize 
 * @returns `
 */
export function calculateMA(volumeArray, windowSize) {
  // 参数校验：确保输入合法
  if (!Array.isArray(volumeArray) || windowSize <= 0 || windowSize > volumeArray.length) {
    return [];
  }

  const result = [];
  let sum = 0;

  // 计算初始窗口（前 windowSize 个元素）的和
  for (let i = 0; i < windowSize; i++) {
    sum += volumeArray[i];
  }
  result.push(sum / windowSize); // 添加第一个移动平均值

  // 滑动窗口，依次计算后续的移动平均
  for (let i = windowSize; i < volumeArray.length; i++) {
    sum += volumeArray[i] - volumeArray[i - windowSize]; // 更新总和：加上新元素，减去旧元素
    result.push(sum / windowSize); // 添加当前窗口的平均值
  }
  return result;
}