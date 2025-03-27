// 找到最佳拟合参数
export function findBestFitLine(A, B) {
  // return fitOLS(A, B)
  return fitStockRelationship_A(A.slice(), B.slice());
  // return  {a:0.06545 ,b:0}
}

// 基础线性回归
function fitOLS(stockA, stockB) {
  if (stockA.length <= 100) {
    // debugger
  }
  const minLength = Math.min(stockA.length, stockB.length); // 取两个数组的最小长度
  if (minLength === 0) {
    throw new Error('Input arrays must have at least one element');
  }

  let sumAB = 0,
    sumAA = 0;

  for (let i = 0; i < minLength; i++) {
    sumAB += weight(i, minLength) * stockA[i] * stockB[i];
    sumAA += weight(i, minLength) * stockA[i] * stockA[i];
  }

  // 计算 OLS 估计的斜率 a
  const a = sumAB / sumAA;
  return { a, b: 0 };
}

function skew(x) {
  return x;
  // return 1-Math.abs(x);
}

/**
 * 标准线性拟合-带截距的
 * @param {*} stockA
 * @param {*} stockB
 * @returns
 */
function fitStockRelationship_AB(stockA, stockB) {
  ({ A: stockA, B: stockB } = cleanElements(stockA, stockB, 3));
  const minLength = Math.min(stockA.length, stockB.length);
  if (minLength === 0) {
    throw new Error('Input arrays must have at least one element');
  }

  // 初始化加权累加器
  let sumW = 0,
    sumWX = 0,
    sumWY = 0,
    sumWXY = 0,
    sumWX2 = 0;

  for (let i = 0; i < minLength; i++) {
    // 计算权重（左侧权重更大）
    // 可替换为其他权重函数：
    // const weight = 1 / (i + 1);          // 1/(i+1) 递减
    // const weight = Math.exp(-0.1 * i);   // 指数递减

    // 累加加权值
    const x = stockA[i];
    const y = stockB[i];
    sumW += weight(i, minLength);
    sumWX += weight(i, minLength) * x;
    sumWY += weight(i, minLength) * y;
    sumWXY += weight(i, minLength) * x * y;
    sumWX2 += weight(i, minLength) * x * x;
  }

  // 计算斜率 a 和截距 b
  const denominator = sumW * sumWX2 - sumWX * sumWX;
  if (Math.abs(denominator) < 1e-10) {
    throw new Error('Cannot compute OLS for collinear data');
  }

  const a = (sumW * sumWXY - sumWX * sumWY) / denominator;
  const b = (sumWY - a * sumWX) / sumW;

  return { a, b };
}

/**
 * 不带截距的拟合
 * @returns
 */
function fitStockRelationship_A(stockA, stockB) {
  ({ A: stockA, B: stockB } = cleanElements(stockA, stockB, 3));
  const minLength = Math.min(stockA.length, stockB.length);
  if (minLength === 0) throw new Error('Input arrays must have at least one element');

  let sumAB = 0,
    sumAA = 0;

  for (let i = 0; i < minLength; i++) {
    // 计算加权累加项
    const x = stockA[i],
      y = stockB[i];
    sumAB += weight(i, minLength) * x * y;
    sumAA += weight(i, minLength) * x * x;
  }

  // 计算斜率a（无截距项）
  const a = sumAB / sumAA;
  return { a, b: 0 }; // 强制截距为0
}

/**
 * 不同实现的权重方法
 * @param {*} i
 * @param {*} length
 * @returns
 */
function weight(i, length) {
  // /**
  //  * 常数
  //  */
  // return 1

  /**
   * 线性递减
   */
  return 1 - i / length;

  /**
   * 非线性递减
   */
  const c = 0.66; // 转折点位置
  const m = 0.5; // 左侧衰减速度（m越小越平缓）
  const n = 5; // 右侧衰减速度（n越大越陡峭）
  const threshold = c * length;
  let w;
  if (i <= threshold) {
    w = 1 - Math.pow(i / threshold, m); // 左侧慢衰减
  } else {
    w = Math.pow(1 - (i - threshold) / (length - threshold), n); // 右侧快衰减
  }
  return w;

  /**
   * 指数递减
   */
  return Math.exp(-0.1 * i);

  /**
   * 常数
   */
  return 1;
}

// 归一化数组
function normalizeArrayToRange(arr, a = -1, b = 1) {
  const min = Math.min(...arr);
  const max = Math.max(...arr);

  if (min === max) {
    return arr.map(() => a); // 如果所有值相同，返回全为 a 的数组
  }

  return arr.map(x => a + ((x - min) * (b - a)) / (max - min));
}

// 查找数组中ZScore2以内的元素
function filterOutliersIndices(arr, threshold = 5) {
  const mean = arr.reduce((sum, val) => sum + val, 0) / arr.length;
  const std = Math.sqrt(arr.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / arr.length);

  // 根据数据量动态调整阈值
  const dynamicThreshold = Math.max(threshold, 1.5 + arr.length / 1000);

  return arr
    .map((val, index) => ({ index, zScore: (val - mean) / std }))
    .filter(item => Math.abs(item.zScore) < dynamicThreshold)
    .map(item => item.index);
}

function filterOutsideElements(data, distances) {
  const saved_arr = filterOutliersIndices(distances);
  return data.filter((_, index) => saved_arr.includes(index));
}

function cleanElements(stockA, stockB, iterater = 1) {
  let A = stockA.slice(),
    B = stockB.slice();
  if (stockA.length <= 10 || stockB.length <= 10) return { A: stockA, B: stockB };
  while (iterater-- > 0) {
    if (stockA.length <= 10 || stockB.length <= 10) {
      console.log('过度整理...进行还原1');
      return { A, B };
    }
    let { a } = fitOLS(stockA, stockB);
    let distances = stockA.map(it => it * a).map((s_a, id) => s_a - stockB[id]);
    stockA = filterOutsideElements(stockA, distances);
    stockB = filterOutsideElements(stockB, distances);
  }
  if (stockA.length <= 10 || stockB.length <= 10) {
    console.log('过度整理...进行还原2');
    return { A, B };
  }
  return { A: stockA, B: stockB };
}
