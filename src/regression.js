export function findBestFitLine2(A,B){
    if (A.length !== B.length) {
        throw new Error('Arrays A and B must have the same length');
    }

    const n = A.length;
    
    // 计算 A 的平均值和 B 的平均值
    const meanA = A.reduce((sum, a) => sum + a, 0) / n;
    const meanB = B.reduce((sum, b) => sum + b, 0) / n;
    
    // 计算 a 的分子和分母
    let numerator = 0;
    let denominator = 0;
    for (let i = 0; i < n; i++) {
        numerator += (A[i] - meanA) * (B[i] - meanB);
        denominator += (A[i] - meanA) ** 2;
    }

    // 计算 a 和 b
    const a = numerator / denominator;
    const b = meanB - a * meanA;

    return { a, b };
  }
  

  export function findBestFitLine(A,B){
    const n = A.length;

    // 计算必要的和
    let sumA = 0, sumB = 0, sumAB = 0, sumA2 = 0;
    for (let i = 0; i < n; i++) {
        sumA += A[i];
        sumB += B[i];
        sumAB += A[i] * B[i];
        sumA2 += A[i] * A[i];
    }

    // 计算a和b
    const a = (n * sumAB - sumA * sumB) / (n * sumA2 - sumA * sumA);
    const b = (sumB - a * sumA) / n;

    return { a, b };
  }
