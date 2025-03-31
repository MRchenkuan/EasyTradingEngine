import { AbstractProcessor } from './AbstractProcessor.js';
import { LocalVariable } from '../../LocalVariable.js';
import { TradeEngine } from '../TradeEngine.js';
import { createOrder_market, executeOrders } from '../../trading.js';
import { recordGridTradeOrders } from '../../recordTools.js';

export class GridTradingProcessor extends AbstractProcessor {
  type = 'GridTradingProcessor';
  engine = null;
  asset_name = '';
  _timer = {};

  // 网格参数
  _grid_width = 0.025; // 网格宽度
  _max_drawdown = 0.012; // 最大回撤
  _max_bounce = 0.012; // 最大反弹
  _trade_amount = 9000; // 每次交易数量
  _max_position = 100000; // 最大持仓
  _min_price = 0.1; // 最低触发价格
  _max_price = 100; // 最高触发价格

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
    this._loadState();

    // 如果本地没有网格数据，则初始化
    if (!this._grid.length) {
      this._initPriceGrid();
    }
  }

  _loadState() {
    this._is_position_created = this.local_variables.is_position_created || false;
    this._last_trade_price = this.local_variables.last_trade_price || 1;
    this._last_turning_price = this.local_variables.last_turning_price || null;
    this._prev_price = this.local_variables.prev_price || 1;
    this._current_price = this.local_variables.current_price || 1;
    this._tendency = this.local_variables.tendency || 0;
    this._direction = this.local_variables.direction || 0;
    // this._grid = this.local_variables.grid || [];  // 添加网格数据的载入
  }

  _saveState() {
    this.local_variables.is_position_created = this._is_position_created;
    this.local_variables.last_trade_price = this._last_trade_price;
    this.local_variables.last_turning_price = this._last_turning_price;
    this.local_variables.prev_price = this._prev_price;
    this.local_variables.current_price = this._current_price;
    this.local_variables.tendency = this._tendency;
    this.local_variables.direction = this._direction;
    // this.local_variables.grid = this._grid;  // 添加网格数据的保存
  }

  _refreshTurningPoint() {
    // 当价格方向向上且趋势向下时，可能出现拐点
    if (this._direction === 1 && this._tendency === -1) {
      const turnPoint = this._prev_price;

      if (!this._last_turning_price) {
        this._last_turning_price = turnPoint;
        console.log(`初次设定拐点${this._last_turning_price}`);
        return;
      }

      // 修正判断逻辑：当前拐点高于上一个拐点时更新
      if (turnPoint > this._last_turning_price) {
        this._last_turning_price = turnPoint;
        console.log(`更新更高的拐点${this._last_turning_price}`);
      }
    }
    // 当价格方向向下且趋势向上时，可能出现拐点
    else if (this._direction === -1 && this._tendency === 1) {
      const turnPoint = this._prev_price;

      if (!this._last_turning_price) {
        this._last_turning_price = turnPoint;
        console.log(`初次设定拐点${this._last_turning_price}`);
        return;
      }

      // 修正判断逻辑：当前拐点低于上一个拐点时更新
      if (turnPoint < this._last_turning_price) {
        this._last_turning_price = turnPoint;
        console.log(`更新更低的拐点${this._last_turning_price}`);
      }
    }
  }

  // 删除这里的第一个 tick 方法实现

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
    if (!this._current_price) {
      this._saveState(); // 使用统一的状态保存方法
      return;
    }

    // 更新价格走向和趋势
    this._direction = this._findPriceDirection();
    this._tendency = this._findPriceTendency();

    // 首次建仓
    if (!this._is_position_created) {
      this._is_position_created = true;
      this._last_trade_price = this._current_price;
      this._last_turning_price = this._current_price;
      this._prev_price = this._current_price;
      this._saveState(); // 使用统一的状态保存方法
      return;
    }

    // 价格超出范围检查
    // 优化后的价格范围检查
    if (this._current_price < this._min_price) {
      console.log(`当前价格${this._current_price}低于最低价${this._min_price}，暂停交易`);
      this._saveState();
      return;
    }
    if (this._current_price > this._max_price) {
      console.log(`当前价格${this._current_price}高于最高价${this._max_price}，暂停交易`);
      this._saveState();
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
    this._saveState(); // 使用统一的状态保存方法
  }

  _orderStrategy(gridCount) {
    if (gridCount === 0) {
      // 添加跨线回调处理逻辑
      const gridTurningCount = this._countGridNumber(
        this._last_turning_price,
        this._last_trade_price
      );
      if (gridTurningCount !== 0) {
        const correction = this._correction();
        const threshold = gridTurningCount > 0 ? this._max_drawdown : this._max_bounce;

        if (Math.abs(correction) > threshold) {
          console.log(
            `↪️${this._current_price} 价格${gridTurningCount > 0 ? '回撤' : '反弹'} ${(correction * 100).toFixed(2)}%，触发跨线回调交易`
          );
          this._placeOrder(
            gridTurningCount,
            gridTurningCount > 0 ? '跨线回撤下单' : '跨线反弹下单'
          );
        }
      }
      return;
    }

    const priceChange = (
      ((this._current_price - this._last_trade_price) / this._last_trade_price) *
      100
    ).toFixed(2);

    // 价格持续上涨/下跌时不交易
    if ((gridCount > 0 && this._direction > 0) || (gridCount < 0 && this._direction < 0)) {
      console.log(
        `${gridCount > 0 ? '↑' : '↓'}${this._current_price} 价格持续${gridCount > 0 ? '上涨' : '下跌'}(${priceChange}%)，距离上次交易${gridCount}个网格，不进行交易`
      );
      return;
    }

    const correction = this._correction();
    const threshold = gridCount > 0 ? this._max_drawdown : this._max_bounce;

    if (Math.abs(correction) <= threshold) {
      console.log(
        `${gridCount > 0 ? '⤵️' : '⤴️'}${this._last_turning_price}->${this._current_price} 价格${gridCount > 0 ? '回撤' : '反弹'} ${(correction * 100).toFixed(2)}%，但未超过${gridCount > 0 ? '回撤' : '反弹'}线(${threshold * 100}%)，不进行交易`
      );
      return;
    }

    console.log(
      `${gridCount > 0 ? '⤵️' : '⤴️'}${this._current_price} 价格${gridCount > 0 ? '回撤' : '反弹'} ${(correction * 100).toFixed(2)}%，且超过了${gridCount > 0 ? '回撤' : '反弹'}线(${(this._last_turning_price * (1 + (gridCount > 0 ? -this._max_drawdown : this._max_bounce))).toFixed(3)})`
    );
    this._placeOrder(gridCount, gridCount > 0 ? '回撤下单' : '反弹下单');
  }

  _initPriceGrid() {
    this._grid = [];
    const basePrice = this._current_price || 1; // 使用当前价格作为基准，默认为1

    if (this._min_price >= this._max_price) {
      throw new Error('最低价必须小于最高价');
    }
    if (!(this._min_price <= basePrice <= this._max_price)) {
      throw new Error('基准价格必须在最低价和最高价之间');
    }

    // 向上生成网格
    let current_price = basePrice;
    while (current_price < this._max_price) {
      current_price += current_price * this._grid_width;
      if (current_price <= this._max_price) {
        this._grid.push(Number(current_price.toFixed(3)));
      } else {
        break;
      }
    }

    // 向下生成网格
    current_price = basePrice;
    while (current_price > this._min_price) {
      current_price -= current_price * this._grid_width;
      if (current_price >= this._min_price) {
        this._grid.unshift(Number(current_price.toFixed(3)));
      } else {
        break;
      }
    }

    // 确保基准价格在网格中
    if (!this._grid.includes(basePrice)) {
      this._grid.push(basePrice);
      this._grid.sort((a, b) => a - b);
    }

    console.log(`初始化网格完成，共${this._grid.length}个网格点`);
    console.log(`网格范围: ${this._grid[0]} - ${this._grid[this._grid.length - 1]}`);
    console.log(`网格点: ${this._grid.join(', ')}`);
  }

  _findPriceDirection() {
    if (this._current_price > this._prev_price) {
      return 1; // 价格上涨
    }
    if (this._current_price < this._prev_price) {
      return -1; // 价格下跌
    }
    return 0; // 价格持平
  }

  _findPriceTendency() {
    if (this._current_price > this._last_trade_price) {
      return 1; // 价格上涨趋势
    }
    if (this._current_price < this._last_trade_price) {
      return -1; // 价格下跌趋势
    }
    return 0; // 价格持平
  }

  _countGridNumber(current, prev) {
    if (current === prev) return 0;
    if (!current || !prev) return 0;

    const lowerPrice = Math.min(current, prev);
    const upperPrice = Math.max(current, prev);

    // 统计在范围内的网格数量
    let count = this._grid.filter(price => price >= lowerPrice && price <= upperPrice).length;

    if (count <= 1) return 0;
    return current > prev ? count - 1 : -(count - 1);
  }

  async _placeOrder(gridCount, orderType) {
    const amount = -gridCount * this._trade_amount;

    if (Math.abs(amount) > this._max_position) {
      console.warn(`⚠️ 交易量${amount}超过最大持仓限制${this._max_position}`);
      return;
    }

    console.log(`💰${orderType}：${this._current_price} ${amount} 个`);
    const order = createOrder_market(
      this.asset_name,
      Math.abs(amount),
      amount / Math.abs(amount),
      true
    );
    let result = await executeOrders([order]);
    if (!result.success) {
      console.error(`⛔交易失败: ${orderType}`);
      return;
    }
    recordGridTradeOrders({...result.data[0], gridCount});
    console.log(`✅交易成功: ${orderType}`);
    // 重置关键参数
    this._last_trade_price = this._current_price;
    this._last_turning_price = this._current_price; // 重置拐点价格为当前价格
    this._prev_price = this._current_price; // 重置前一价格
    this._saveState(); // 立即保存状态
  }
}
