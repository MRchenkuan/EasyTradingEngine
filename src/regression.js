import * as math from 'mathjs'


// 找到最佳拟合参数
export function findBestFitLine(A,B) {
    return adaptiveWeightedLinearRegression(A, B)
}

function adaptiveWeightedLinearRegression(x, y) {
    if (x.length !== y.length || x.length === 0) {
        throw new Error("Input arrays must have the same non-zero length");
    }

    const n = x.length;
    
    // 第一次回归，获取初步拟合结果
    const { a: a_init, b: b_init } = ordinaryLeastSquares(x, y);

    // 计算误差并定义权重：误差小的点权重大
    const epsilon = 1e-6; // 防止除零
    let weights = y.map((yi, i) => 1 / (Math.abs(yi - (a_init * x[i] + b_init)) + epsilon));

    // 重新计算加权最小二乘法回归
    return weightedLeastSquares(x, y, weights);
}


// 计算普通最小二乘法（OLS）
function ordinaryLeastSquares(x, y) {
    const n = x.length;
    const sumX = math.sum(x);
    const sumY = math.sum(y);
    const sumXX = math.sum(x.map(xi => xi * xi));
    const sumXY = math.sum(x.map((xi, i) => xi * y[i]));

    const denominator = n * sumXX - sumX * sumX;
    if (denominator === 0) {
        throw new Error("Denominator is zero, cannot compute regression");
    }

    const a = (n * sumXY - sumX * sumY) / denominator;
    const b = (sumY * sumXX - sumX * sumXY) / denominator;
    
    return { a, b };
}



// 计算加权最小二乘法（WLS）
function weightedLeastSquares(x, y, weights) {
    const sumW = math.sum(weights);
    const sumWX = math.sum(weights.map((w, i) => w * x[i]));
    const sumWY = math.sum(weights.map((w, i) => w * y[i]));
    const sumWXX = math.sum(weights.map((w, i) => w * x[i] * x[i]));
    const sumWXY = math.sum(weights.map((w, i) => w * x[i] * y[i]));

    const denominator = sumW * sumWXX - sumWX * sumWX;
    if (denominator === 0) {
        throw new Error("Denominator is zero, cannot compute regression");
    }

    const a = (sumW * sumWXY - sumWX * sumWY) / denominator;
    const b = (sumWY * sumWXX - sumWX * sumWXY) / denominator;

    return { a, b };
}
