/**
Copyright (C) 2024@MRchenkuan
本程序基于 GNU Affero General Public License v3.0 授权。
详情请参阅根目录的 LICENSE 文件或访问 https://www.gnu.org/licenses/agpl-3.0.html
商业使用需联系作者授权。
*/

// 找到最佳拟合参数
export function findBestFitLine(A,B) {
    // return fitOLS(A, B)
    return fitStockRelationship(A.slice(),B.slice())
    // return  {a:0.06545 ,b:0}
}



// 基础线性回归
function fitOLS(stockA, stockB){
    if(stockA.length<=100){
        // debugger
    }
    const minLength = Math.min(stockA.length, stockB.length); // 取两个数组的最小长度
    if (minLength === 0) {
        throw new Error("Input arrays must have at least one element");
    }
    
    let sumAB = 0, sumAA = 0;
    
    for (let i = 0; i < minLength; i++) {
        sumAB += stockA[i] * stockB[i];
        sumAA += stockA[i] * stockA[i];
    }
    
    // 计算 OLS 估计的斜率 a
    const a = sumAB / sumAA;
    return {a, b:0}
}


function skew(x) {
    return x
    // return 1-Math.abs(x);
}

function fitStockRelationship(stockA, stockB) {
    const {A,B} = cleanElements(stockA, stockB, 15)
    if (A.length !== B.length || A.length === 0) {
        throw new Error("Input arrays must have the same non-zero length");
    }

    let sumWAB = 0, sumWAA = 0;
    const n = A.length;

    for (let i = 0; i < n; i++) {
        sumWAB += A[i] * B[i];
        sumWAA += A[i] * A[i];
    }

    const a = sumWAB / sumWAA;

    return { a,b:0 };
  }


  // 归一化数组
  function normalizeArrayToRange(arr, a = -1, b = 1) {
    const min = Math.min(...arr);
    const max = Math.max(...arr);

    if (min === max) {
        return arr.map(() => a); // 如果所有值相同，返回全为 a 的数组
    }

    return arr.map(x => a + (x - min) * (b - a) / (max - min));
}


// 查找数组中ZScore2以内的元素
function filterOutliersIndices(arr, threshold = 1.5) {
    const mean = arr.reduce((sum, val) => sum + val, 0) / arr.length;
    const std = Math.sqrt(arr.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / arr.length);

    return arr
        .map((val, index) => ({ index, zScore: (val - mean) / std }))
        .filter(item => Math.abs(item.zScore) < threshold)
        .map(item => item.index);
}


function filterOutsideElements(data, distances){
    const saved_arr = filterOutliersIndices(distances);
    return data.filter((_, index) => saved_arr.includes(index))
}


function cleanElements(stockA, stockB, iterater=1){
    let A = stockA.slice(), B= stockB.slice();
    if(stockA.length<=10 || stockB.length<=10) return {A:stockA, B:stockB};
    while(iterater-->0){
        if(stockA.length<=10 || stockB.length<=10) {
            console.log("过度整理...进行还原1")
            return {A, B};
        }
        let {a} = fitOLS(stockA,stockB);
        let distances = stockA.map(it=>it*a).map((s_a,id)=>s_a-stockB[id]);
        stockA = filterOutsideElements(stockA, distances);
        stockB = filterOutsideElements(stockB, distances);
    }
    if(stockA.length<=10 || stockB.length<=10) {
        console.log("过度整理...进行还原2")
        return {A, B};
    }
    return {A:stockA, B:stockB}
}