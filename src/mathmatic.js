import { mean, sum, std } from 'mathjs';

// 计算收益率变化
export function calculateReturns(prices) {
  let returns = [];
  for (let i = 1; i < prices.length; i++) {
    let returnValue = (prices[i] - prices[i - 1]) / prices[i - 1];
    returns.push(returnValue);
  }
  return returns;
}

// 皮尔逊相关性
export function pearsonCorrelation(arr1, arr2) {
  const mean1 = mean(arr1);
  const mean2 = mean(arr2);
  const covariance =
    sum(arr1.map((val, i) => (val - mean1) * (arr2[i] - mean2))) / (arr1.length - 1);
  const stdDev1 = std(arr1);
  const stdDev2 = std(arr2);
  return covariance / (stdDev1 * stdDev2);
}

export function calculateCorrelationMatrix(stocks) {
  const n = stocks.length;
  const returns = stocks.map(stock => calculateReturns(stock));

  // 初始化相关性矩阵
  const correlationMatrix = Array.from({ length: n }, () => Array(n).fill(0));

  // 计算相关性矩阵
  for (let i = 0; i < n; i++) {
    for (let j = i; j < n; j++) {
      const corr = pearsonCorrelation(returns[i], returns[j]);
      correlationMatrix[i][j] = corr.toFixed(2);
      correlationMatrix[j][i] = corr.toFixed(2); // 相关性矩阵是对称的
    }
  }

  return correlationMatrix;
}
