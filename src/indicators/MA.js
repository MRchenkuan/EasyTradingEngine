class MA {
  constructor(period = 20) {
    this.period = period;    // 移动平均周期，默认20
    this.prices = [];        // 价格数据
  }

  // 添加新价格
  update(price) {
    this.prices.push(price);
    // 保持数组长度等于周期
    if (this.prices.length > this.period) {
      this.prices.shift();
    }
  }

  // 计算移动平均线
  getValue() {
    if (this.prices.length < this.period) return null;
    const sum = this.prices.reduce((a, b) => a + b, 0);
    return sum / this.period;
  }

  // 获取当前价格相对于MA的位置
  getPosition(currentPrice) {
    const ma = this.getValue();
    if (!ma) return null;
    
    return {
      value: ma,
      position: currentPrice > ma ? 'above' : 'below',
      deviation: (currentPrice - ma) / ma  // 偏离程度
    };
  }

  // 重置数据
  reset() {
    this.prices = [];
  }
}

// 使用示例
/*
const ma = new MA(20);  // 创建20日均线

// 在交易中使用
ma.update(currentPrice);
const maValue = ma.getValue();
const position = ma.getPosition(currentPrice);

if (position) {
  const { value, position, deviation } = position;
  // 可以根据position和deviation来判断交易信号
}
*/