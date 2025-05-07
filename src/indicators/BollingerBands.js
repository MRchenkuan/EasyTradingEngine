class BollingerBands {
  constructor(period = 20, multiplier = 2) {
    this.period = period;        // 移动平均周期，默认20
    this.multiplier = multiplier; // 标准差倍数，默认2
    this.prices = [];            // 价格数据
  }

  // 添加新价格
  update(price) {
    this.prices.push(price);
    // 保持数组长度等于周期
    if (this.prices.length > this.period) {
      this.prices.shift();
    }
  }

  // 计算移动平均线(中轨)
  calculateMA() {
    if (this.prices.length < this.period) return null;
    const sum = this.prices.reduce((a, b) => a + b, 0);
    return sum / this.period;
  }

  // 计算标准差
  calculateSD() {
    if (this.prices.length < this.period) return null;
    const ma = this.calculateMA();
    const squaredDiffs = this.prices.map(price => Math.pow(price - ma, 2));
    const variance = squaredDiffs.reduce((a, b) => a + b, 0) / this.period;
    return Math.sqrt(variance);
  }

  // 获取布林带值
  getBands() {
    const ma = this.calculateMA();
    if (!ma) return null;

    const sd = this.calculateSD();
    const upperBand = ma + (this.multiplier * sd);
    const lowerBand = ma - (this.multiplier * sd);

    return {
      upper: upperBand,
      middle: ma,
      lower: lowerBand
    };
  }
}

// 使用示例
const bb = new BollingerBands(20, 2);

// 在网格交易中使用
bb.update(currentPrice);
const bands = bb.getBands();
if (bands) {
  const { upper, middle, lower } = bands;
  // 价格突破上轨
  if (currentPrice > upper) {
    // 考虑卖出信号
  }
  // 价格突破下轨
  if (currentPrice < lower) {
    // 考虑买入信号
  }
}