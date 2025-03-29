import { AbstractProcessor } from './AbstractProcessor.js';
import { LocalVariable } from '../../LocalVariable.js';
import { TradeEngine } from '../TradeEngine.js';
import { createOrder_market } from '../../trading.js';

export class GridTradingProcessor extends AbstractProcessor {
  type = 'GridTradingProcessor';
  engine = null;
  asset_name = '';
  _timer = {};

  // 网格参数
  _grid_width = 0.025;     // 网格宽度
  _max_drawdown = 0.012;   // 最大回撤
  _max_bounce = 0.012;     // 最大反弹
  _trade_amount = 9000;    // 每次交易数量
  _max_position = 100000;  // 最大持仓
  _start_position = 0.5;   // 起始仓位
  _min_price = 0.1;       // 最低触发价格
  _max_price = 100;       // 最高触发价格

  // 全局变量
  _grid = [];
  _is_position_created = false;
  _current_price = 1;
  _prev_price = 1;
  _last_trade_price = 1;
  _last_turning_price = null;
  _tendency = 0;
  _direction = 0;

  constructor(asset_name, params = {}, engine) {
    super();
    this.engine = engine;
    this.asset_name = asset_name;
    this.id = `GridTradingProcessor_${asset_name}`;
    
    // 初始化参数
    Object.assign(this, params);
    
    // 初始化本地变量
    this.local_variables = new LocalVariable(`GridTradingProcessor/${this.asset_name}`);
    
    // 从本地变量恢复状态
    this._is_position_created = this.local_variables.is_position_created || false;
    this._last_trade_price = this.local_variables.last_trade_price || 1;
    this._last_turning_price = this.local_variables.last_turning_price || null;
    
    // 初始化网格
    this._initPriceGrid();
  }

  _initPriceGrid() {
    if (this._min_price >= this._max_price) {
      throw new Error("最低价必须小于最高价");
    }
    
    const grid = [];
    let current_price = 1; // 基准价格

    // 向上生成网格
    while (current_price < this._max_price) {
      current_price += current_price * this._grid_width;
      if (current_price <= this._max_price) {
        grid.push(Number(current_price.toFixed(3)));
      }
    }

    // 向下生成网格
    current_price = 1;
    while (current_price > this._min_price) {
      current_price -= current_price * this._grid_width;
      if (current_price >= this._min_price) {
        grid.unshift(Number(current_price.toFixed(3)));
      }
    }

    this._grid = grid;
    console.log('网格初始化完成：', this._grid);
  }

  // 根据价格确定上下边沿
  _findPriceBounds(price) {
    if (price < this._grid[0] || price > this._grid[this._grid.length - 1]) {
      throw new Error("给定价格超出网格范围");
    }
    
    if (this._grid.includes(price)) {
      return [price, price];
    }
    
    for (let i = 0; i < this._grid.length - 1; i++) {
      if (this._grid[i] < price && price < this._grid[i + 1]) {
        return [this._grid[i], this._grid[i + 1]];
      }
    }
    
    return [null, null];
  }

  // 计算两个价格之间的网格数量
  _countGridNumber(current, prev) {
    if (current === prev || !current || !prev) return 0;
    
    const lowerPrice = Math.min(current, prev);
    const upperPrice = Math.max(current, prev);
    
    const count = this._grid.filter(point => lowerPrice <= point && point <= upperPrice).length;
    
    if (count <= 1) return 0;
    return current > prev ? (count - 1) : -(count - 1);
  }

  // 确定价格走向
  _findPriceDirection() {
    if (this._current_price > this._prev_price) return 1;
    if (this._current_price < this._prev_price) return -1;
    return 0;
  }

  // 确定趋势
  _findPriceTendency() {
    if (this._current_price > this._last_trade_price) return 1;
    if (this._current_price < this._last_trade_price) return -1;
    return 0;
  }

  // 更新拐点价格
  _refreshTurningPoint() {
    let turnPoint = null;
    if (this._direction === 1 && this._tendency === -1) {
      turnPoint = this._prev_price;
      
      if (!this._last_turning_price) {
        this._last_turning_price = turnPoint;
        console.log(`初次设定拐点${this._last_turning_price}`);
      }

      if (this._direction < 0 && turnPoint > this._last_turning_price) {
        this._last_turning_price = turnPoint;
        console.log(`更新更高的拐点${this._last_turning_price}`);
      }
      
      if (this._direction > 0 && turnPoint < this._last_turning_price) {
        this._last_turning_price = turnPoint;
        console.log(`更新更低的拐点${this._last_turning_price}`);
      }
    }
  }

  // 计算回撤范围
  _correction() {
    if (!this._last_turning_price) return 0;
    return (this._current_price - this._last_turning_price) / this._last_turning_price;
  }

  /**
   * 时间触发器
   * @implements
   */
  tick() {
    // 获取最新价格
    this._current_price = this.engine.getRealtimePrice(this.asset_name);
    if (!this._current_price) return;

    // 更新价格走向和趋势
    this._direction = this._findPriceDirection();
    this._tendency = this._findPriceTendency();

    // 首次建仓
    if (!this._is_position_created) {
      // TODO: 实现建仓逻辑
      this._is_position_created = true;
      this._last_trade_price = this._current_price;
      this._last_turning_price = this._current_price;
      this._prev_price = this._current_price;
      return;
    }

    // 价格超出范围检查
    if (this._current_price < this._min_price || this._current_price > this._max_price) {
      console.log(`当前价格${this._current_price}超出设定区间，暂停交易`);
      return;
    }

    // 计算网格数量
    const gridCount = this._countGridNumber(this._current_price, this._last_trade_price);

    // 更新拐点价格
    this._refreshTurningPoint();

    // 执行交易策略
    this._orderStrategy(gridCount);

    // 更新历史价格
    this._prev_price = this._current_price;
  }

  _orderStrategy(gridCount) {
    // 当跨越了网格时则开始交易
    if (gridCount !== 0) {
      // 价格持续上涨
      if (gridCount > 0 && this._direction > 0) {
        console.log(`↑${this._current_price} 价格持续上涨(${((this._current_price-this._last_trade_price)/this._last_trade_price*100).toFixed(2)}%)，距离上次(${this._last_trade_price})交易${gridCount}个网格，不进行交易`);
        return;
      }
      
      // 价格持续下跌
      if (gridCount < 0 && this._direction < 0) {
        console.log(`↓${this._current_price} 价格持续下跌(${((this._current_price-this._last_trade_price)/this._last_trade_price*100).toFixed(2)}%)，距离上次(${this._last_trade_price})交易${gridCount}个网格，不进行交易`);
        return;
      }

      // 价格回撤
      if (gridCount > 0 && this._direction <= 0) {
        const correction = this._correction();
        if (Math.abs(correction) <= this._max_drawdown) {
          console.log(`⤵️${this._last_turning_price}->${this._current_price} 价格回撤 ${(correction*100).toFixed(2)}%，但未超过回撤线(${this._max_drawdown*100}%)，不进行交易`);
          return;
        }
        console.log(`⤵️${this._current_price} 价格回撤 ${(correction*100).toFixed(2)}%，且超过了回撤线(${(this._last_turning_price*(1-this._max_drawdown)).toFixed(3)})`);
        this._placeOrder(gridCount, '回撤下单');
      }

      // 价格反弹
      if (gridCount < 0 && this._direction >= 0) {
        const correction = this._correction();
        if (Math.abs(correction) <= this._max_bounce) {
          console.log(`⤴️${this._last_turning_price}->${this._current_price} 价格反弹 ${(correction*100).toFixed(2)}%，但未超过反弹线(${this._max_bounce*100}%)，不进行交易`);
          return;
        }
        console.log(`⤴️${this._current_price} 价格反弹 ${(correction*100).toFixed(2)}%，且超过了反弹线(${(this._last_turning_price*(1+this._max_bounce)).toFixed(3)})`);
        this._placeOrder(gridCount, '反弹下单');
      }
    }
  }

  async _placeOrder(gridCount, type) {
    const amount = -gridCount * this._trade_amount;
    console.log(`💰${type}：${this._current_price} ${amount} 个`);
    
    const order = createOrder_market(this.asset_name, Math.abs(amount), amount/Math.abs(amount), true);
    // 下单
    let result = await executeOrders([order]);
    
    // 更新价格
    this._last_turning_price = this._current_price;
    this._last_trade_price = this._current_price;
    
    // 保存状态到本地变量
    this.local_variables.is_position_created = this._is_position_created;
    this.local_variables.last_trade_price = this._last_trade_price;
    this.local_variables.last_turning_price = this._last_turning_price;
  }
}