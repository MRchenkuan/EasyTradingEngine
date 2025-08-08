import { AbstractProcessor } from './AbstractProcessor.js';
import { LocalVariable } from '../../LocalVariable.js';
import { create_order_market, executeOrders, fetchOrders } from '../../trading.js';
import { updateGridTradeOrder } from '../../recordTools.js';
import { trendReversalThreshold } from './utils/TrendReversalCalculator.js';
import { OrderStatus, SettlementType, StopLossLevel } from '../../enum.js';
import { trade_open } from '../../../config.js';
import { StopLossControl } from './utils/StopLossHelper.js';
export class GridTradingProcessor extends AbstractProcessor {
  type = 'GridTradingProcessor';
  engine = null;
  asset_name = '';
  _timer = {};
  turtle = 0; // 频率控制

  // 网格参数
  _grid_width = 0.025; // 网格宽度
  _upper_drawdown = 0.012; // 最大回撤
  _lower_drawdown = 0.012; // 最大反弹
  _base_lots = 10; // 每次交易数量
  _base_amount = 10; // 每次交易的金额
  _instrument_info = {}; // 每次交易数量
  _position_supress_count = 6; // 持仓警告线
  _position_survival_count = 12; // 持仓严重警告线
  _settlement_type = SettlementType.AMOUNT; //交易单位 amount 等额，lots 等数量
  _min_price = 0.1; // 最低触发价格
  _max_price = 100; // 最高触发价格
  _backoff_1st_time = 30 * 60; // 15 分钟
  _backoff_2nd_time = 60 * 60; // 25 分钟
  _backoff_3nd_time = 90 * 60; // 30 分钟
  // 风险控制
  _max_trade_grid_count = 8; // 最大网格数量
  // 策略锁
  _stratage_locked = false;
  _last_turtle_ts = 0; // 限流锁
  _recent_prices = []; // 最近价格，用于计算波动率
  // 全局变量
  // 全局变量部分添加新的变量
  _grid = [];
  _is_position_created = false;
  _current_price = null;
  _current_price_ts = null;
  _prev_price = null;
  _prev_price_ts = null;
  _last_trade_price = null;
  _last_trade_price_ts = null;
  _last_upper_turning_price = null; // 上拐点价格
  _last_upper_turning_price_ts = null; // 上拐点时间戳
  _last_lower_turning_price = null; // 下拐点价格
  _last_lower_turning_price_ts = null; // 下拐点时间戳
  _grid_base_price = null;
  _grid_base_price_ts = null;
  _tendency = 0;
  _direction = 0;
  _enable_none_grid_trading = false; // 是否启用无网格交易,网格内跨线回撤
  _last_grid_count_overtime_reset_ts = null;
  _last_reset_grid_count = 0;
  // 外部因子
  factor_is_people_bullish = false;

  _threshold = 0.05;
  _snapshot = 'none';

  _min_mgn_ratio_supress = 4000; // 抑制状态最小保证金率 4000%

  _min_mgn_ratio_survival = 2000; // 止损状态最小保证金率 1000%

  _min_mgn_ratio_break = 500; // 斩仓状态最小保证金率 1000%

  _trade_suppress_multiple = 2; // 交易抑制倍数 倍数越大则成交要求越高： 1 为不抑制 3：3倍抑制， 只能是整数，否则报错

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
  }

  _loadState() {
    this._is_position_created = this.local_variables.is_position_created || false;

    // todo
    // 先恢复前次交易的状态，更新最真实交易的结果（最近一次交易状态为成功的）

    this._last_trade_price = this.local_variables.last_trade_price;
    this._last_trade_price_ts = this.local_variables.last_trade_price_ts;
    this._last_lower_turning_price = this.local_variables.last_lower_turning_price;
    this._last_lower_turning_price_ts = this.local_variables.last_lower_turning_price_ts;
    this._last_upper_turning_price = this.local_variables.last_upper_turning_price;
    this._last_upper_turning_price_ts = this.local_variables.last_upper_turning_price_ts;

    // 初始化重置时间
    this._last_grid_count_overtime_reset_ts = this._last_trade_price_ts;
    // this._current_price = this.local_variables.current_price;
    // this._current_price_ts = this.local_variables.current_price_ts;
    // this._tendency = this.local_variables.tendency || 0;
    // this._direction = this.local_variables.direction || 0;

    // 修改网格数据加载逻辑
    // this._grid_base_price = this.local_variables._grid_base_price;
    this._last_reset_grid_count = this.local_variables._last_reset_grid_count || 0;
  }

  _saveState() {
    this.local_variables.is_position_created = this._is_position_created;
    this.local_variables.last_trade_price = this._last_trade_price;
    this.local_variables.last_trade_price_ts = this._last_trade_price_ts;
    this.local_variables.last_lower_turning_price = this._last_lower_turning_price;
    this.local_variables.last_lower_turning_price_ts = this._last_lower_turning_price_ts;
    this.local_variables.last_upper_turning_price = this._last_upper_turning_price;
    this.local_variables.last_upper_turning_price_ts = this._last_upper_turning_price_ts;
    this.local_variables.prev_price = this._prev_price;
    this.local_variables.current_price = this._current_price;
    this.local_variables.current_price_ts = this._current_price_ts;
    this.local_variables.tendency = this._tendency;
    this.local_variables.direction = this._direction;
    this.local_variables._grid_base_price = this._grid_base_price; // 添加网格数据的保存
    this.local_variables._grid_base_price_ts = this._grid_base_price_ts; // 添加网格数据的保存
    this.local_variables._min_price = this._min_price;
    this.local_variables._max_price = this._max_price;
    this.local_variables._grid_width = this._grid_width;
    this.local_variables._last_reset_grid_count = this._last_reset_grid_count;
    this.local_variables._last_grid_count_overtime_reset_ts =
      this._last_grid_count_overtime_reset_ts;
    this.local_variables._threshold = this._threshold;
  }

  _refreshTurningPoint() {
    if (this._direction === 1 && this._tendency === -1) {
      // 趋势向下，瞬时向上，更新下拐点
      if (!this._last_lower_turning_price || this._current_price < this._last_lower_turning_price) {
        this._last_lower_turning_price = this._prev_price;
        this._last_lower_turning_price_ts = this._prev_price_ts;
      }
    } else if (this._direction === -1 && this._tendency === 1) {
      // 趋势向上，瞬时向下，更新上拐点
      if (!this._last_upper_turning_price || this._current_price > this._last_upper_turning_price) {
        this._last_upper_turning_price = this._prev_price;
        this._last_upper_turning_price_ts = this._prev_price_ts;
      }
    }
  }

  _correction() {
    // 计算回撤范围
    if (this._direction > 0 && this._last_lower_turning_price) {
      // 趋势向上，计算反弹范围
      // 防止除以0或者拐点价格无效
      if (this._last_lower_turning_price <= 0) {
        return 0;
      }
      return (
        (this._current_price - this._last_lower_turning_price) / this._last_lower_turning_price
      );
    }

    if (this._direction < 0 && this._last_upper_turning_price) {
      // 趋势向下，计算回撤范围
      // 防止除以0或者拐点价格无效
      if (this._last_upper_turning_price <= 0) {
        return 0;
      }
      return (
        (this._current_price - this._last_upper_turning_price) / this._last_upper_turning_price
      );
    }
    return 0;
  }

  display(chart) {
    // 将来在此处实现绘制接口
  }

  _recordPrice() {
    // 获取当前时间戳（秒级）
    const currentTimestamp = Math.floor(Date.now() / 1000);

    // 如果与上次记录时间戳相同，则跳过
    if (currentTimestamp === this._last_record_timestamp) {
      return;
    }

    // 记录价格并更新时间戳
    this._recent_prices.push(this._current_price);
    this._last_record_timestamp = currentTimestamp;

    // 限制数组长度
    if (this._recent_prices.length > 350) {
      this._recent_prices = this._recent_prices.slice(-300);
    }
  }

  /**
   * 时间触发器
   * @implements
   */
  tick() {
    // 获取最新价格
    this._current_price = this.engine.getRealtimePrice(this.asset_name) || this._prev_price;

    // 获取最新的产品信息
    this._instrument_info = this.engine.getInstrumentInfo(this.asset_name);

    if (!this._last_trade_price) {
      // 冷启动没有历史价格时记录当时价格
      this._last_trade_price = this._current_price;
    }
    this._current_price_ts = this.engine.realtime_price_ts[this.asset_name] || this._prev_price_ts;

    // 保存价格记录
    this._recordPrice();

    // 检查是否需要重置网格
    if (!this._current_price) {
      this._saveState(); // 使用统一的状态保存方法
      return;
    }

    // 如果本地没有网格数据，则初始化
    if (!this._grid.length) {
      this._grid_base_price = this.local_variables._grid_base_price || this._current_price;
      this._grid_base_price_ts = this.local_variables._grid_base_price_ts || this._current_price_ts;

      this._grid = GridTradingProcessor._initPriceGrid(
        this._grid_base_price,
        this._min_price,
        this._max_price,
        this._grid_width
      );
    }

    // 更新价格走向和趋势
    this._direction = this._findPriceDirection();
    this._tendency = this._findPriceTendency();

    // 首次建仓
    if (!this._is_position_created) {
      this._is_position_created = true;
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

    // 计算当前价格横跨网格
    const gridCount = this._last_trade_price
      ? this._countGridNumber(this._current_price, this._last_trade_price)
      : Math.min(this._countGridNumber(this._current_price, this._grid_base_price), 2);

    // 更新拐点价格
    this._refreshTurningPoint();

    // 执行交易策略

    this._orderStrategy(gridCount);

    // 更新历史价格
    this._prev_price = this._current_price;
    this._prev_price_ts = this._current_price_ts;
    this._saveState(); // 使用统一的状态保存方法
    // console.log(this.engine.market_candle['1m']['XRP-USDT']);
  }

  getGridBox(price) {
    if (price <= this._grid[0]) {
      return { floor: price, ceil: this._grid[0] };
    }

    if (price >= this._grid[this._grid.length - 1]) {
      return { floor: this._grid[this._grid.length - 1], ceil: price };
    }

    // 处理空数组情况
    for (let i = 0; i < this._grid.length - 1; i++) {
      const floor = this._grid[i];
      const ceil = this._grid[i + 1];
      if (price >= floor && price <= ceil) {
        return { floor, ceil };
      }
    }
    return {
      floor: price,
      ceil: price,
    };
  }

  /**
   * 获取止损等级
   * @param {number} mgnRatio 保证金比例
   * @param {number} pos 持仓
   * @param {number} notionalUsd 持仓金额
   * @returns {StopLossLevel} 止损等级
   */
  _getStopLossLevel(mgnRatio, pos, notionalUsd) {
    if (parseFloat(pos) === 0) {
      return StopLossLevel.NORMAL;
    }
    const mgnRatioPercent = 100 * mgnRatio;
    let position_count = 0;
    const { ctVal } = this._instrument_info;
    if (this._settlement_type === SettlementType.AMOUNT) {
      position_count = notionalUsd / this._base_amount;
    } else if (this._settlement_type === SettlementType.LOTS) {
      position_count = pos / (this._base_lots / ctVal);
    }
    // 单个斩仓
    // if (Math.abs(position_count) >  2 * this._position_survival_count) {
    //   return StopLossLevel.SINGLE_KILL;
    // }

    // 整体止损状态
    if (mgnRatioPercent < this._min_mgn_ratio_survival) {
      return StopLossLevel.SURVIVAL;
    }
    // 整体抑制状态
    if (mgnRatioPercent < this._min_mgn_ratio_supress) {
      return StopLossLevel.SUPPRESS;
    }

    // 单个止损
    if (Math.abs(position_count) > this._position_survival_count) {
      return StopLossLevel.SINGLE_SURVIVAL;
    }
    // 单个抑制
    if (Math.abs(position_count) > this._position_supress_count) {
      return StopLossLevel.SINGLE_SUPPRESS;
    }

    return StopLossLevel.NORMAL;
  }

  async _orderStrategy(gridCount) {
    if (this._stratage_locked) return;
    const now = Date.now();
    if (now - this._last_turtle_ts < this.turtle) return;
    this._last_turtle_ts = now;

    const {
      posSide, // long short net
      pos, // 持仓
      avgPx, // 开仓均价
      upl, // 未实现盈亏
      uplRatio, // 未实现盈亏比例
      mgnRatio, // 保证金比例
      adl, // 信号强弱
      notionalUsd,
    } = this.engine.getPositionList(this.asset_name) || {};

    try {
      this._stratage_locked = true;
      // 趋势和方向一致时不交易
      if (this._tendency == 0 || this._direction / this._tendency >= 0) {
        // console.log(`[${this.asset_name}]价格趋势与方向一致，不进行交易`);
        return;
      }

      // 检查网格数量变化并处理超时重置
      const currentGridCountAbs = Math.abs(gridCount);

      // 当网格数量增加且超过上次重置的网格数时重置超时时间
      if (
        currentGridCountAbs < 3 &&
        currentGridCountAbs > 1 &&
        currentGridCountAbs > this._last_reset_grid_count
      ) {
        console.log(
          `[${this.asset_name}]网格突破新高点：从${this._last_reset_grid_count}增加到${currentGridCountAbs}，重置超时间`
        );
        this._last_grid_count_overtime_reset_ts = this._current_price_ts;
        this._last_reset_grid_count = currentGridCountAbs;
      }

      const timeDiff =
        (this._current_price_ts - this._last_grid_count_overtime_reset_ts || 1) / 1000;

      const correction = this._correction();
      const grid_count_abs = Math.abs(gridCount);
      // 退避机制 ---- 在一个格子内做文章
      // 如果大于 5 分钟,则减少回撤门限使其尽快平仓
      // 减少回撤门限，仅限于平仓
      // 通过当前持仓方向与价格趋势方向是否一致来判断是否平仓
      // 持仓方向判断很重要，不能盲目加仓
      // 判断动量，如果涨跌速度过快则不能盲目减少回撤门限

      const price_diff = Math.abs(this._current_price - this._last_trade_price);
      const ref_price =
        this._direction > 0
          ? Math.min(this._current_price, this._last_trade_price)
          : Math.max(this._current_price, this._last_trade_price);
      const diff_rate = price_diff / ref_price;

      const price_distance_grid = diff_rate / this._grid_width;
      const default_threshold = this._direction < 0 ? this._upper_drawdown : this._lower_drawdown;

      const grid_box = this.getGridBox(this._current_price);

      console.log(`=========指标数据[${this.asset_name}]========`);

      const { threshold, snapshot } = trendReversalThreshold(
        this.engine.getCandleData(this.asset_name),
        this._recent_prices,
        this._current_price,
        default_threshold,
        price_distance_grid,
        grid_count_abs,
        timeDiff,
        correction,
        this._tendency,
        grid_box
      );
      this._threshold = threshold;
      this._snapshot = snapshot;

      // 止损控制
      const stopLossLevel = this._getStopLossLevel(mgnRatio, pos, notionalUsd);
      const {
        shouldSuppress,
        gridCount: adjustedGridCount,
        tradeCount: adjustedTradeCount,
        description,
        threshold: adjustedThreshold,
      } = StopLossControl(
        this._threshold,
        stopLossLevel,
        this._tendency,
        pos,
        this._trade_suppress_multiple,
        gridCount
      );

      console.log(
        `- [${this.asset_name}] 当前止损等级：${stopLossLevel}，阈值调整：${(100 * this._threshold).toFixed(2)}% -> ${(100 * adjustedThreshold).toFixed(2)}%`
      );

      this._threshold = adjustedThreshold;

      // 如果超过两格则回撤判断减半，快速锁定利润
      // 可能还要叠加动量，比如上涨速度过快时，需要允许更大/更小的回撤
      const is_return_arrived = Math.abs(correction) > this._threshold;
      // 回撤/反弹条件是否满足
      if (!is_return_arrived) {
        console.log(
          `- [${this.asset_name}] 回撤门限: ${(this._threshold * 100).toFixed(2)}%，当前价差 ${price_distance_grid.toFixed(2)} 格，当前回调幅度: ${(correction * 100).toFixed(2)}%，🐢继续等待...\n`
        );
        return;
      }

      if (shouldSuppress) {
        // 止损模式，抑制交易
        console.log(
          `- [${this.asset_name}] 当前过度持仓，保证金率偏低：${(mgnRatio * 100).toFixed(2)}%； 抑制交易:${gridCount}格 => ${adjustedGridCount}格，当前抑制倍数:${this._trade_suppress_multiple}`
        );
      }

      if (Math.abs(adjustedGridCount) >= 1) {
        console.log(
          `[${this.asset_name}]${this._current_price} 价格穿越了 ${gridCount} 个网格，回撤门限: ${(this._threshold * 100).toFixed(2)}%，当前价差 ${price_distance_grid.toFixed(2)} 格，当前回调幅度: ${(correction * 100).toFixed(2)}%，触发策略`
        );
        // 上涨 n 倍 才卖出一份，牺牲利润，有损
        await this._placeOrder(adjustedTradeCount), `- 回调下单 - ${description} `;
        return;
      }

      // 未超过一格但实际距离超过 1.5
      if (price_distance_grid > 1.5) {
        // 正常满足条件下单
        console.log(
          `[${this.asset_name}]${this._current_price} 价格穿越了 ${gridCount} 个网格，回撤门限: ${(this._threshold * 100).toFixed(2)}%，当前价差 ${price_distance_grid.toFixed(2)} 格，当前回调幅度: ${(correction * 100).toFixed(2)}%，触发策略`
        );
        if (this._tendency > 0) {
          await this._placeOrder(1, '- 回调下单:格内');
        } else {
          await this._placeOrder(-1, '- 回调下单:格内');
        }
        return;
      }

      // console.log(`[${this.asset_name}]未触发任何交易条件，继续等待...`);
    } finally {
      // 解锁策略
      this._stratage_locked = false;
    }
  }

  static _initPriceGrid(base_price, _min_price, _max_price, _grid_width) {
    const grid = [];
    const basePrice = base_price;

    if (_min_price >= _max_price) {
      throw new Error(`[网格生成]最低价必须小于最高价`);
    }
    if (!(_min_price <= basePrice && basePrice <= _max_price)) {
      throw new Error(`[网格生成]基准价格必须在最低价和最高价之间`);
    }

    // 向上生成网格
    let current_price = basePrice;
    while (current_price < _max_price) {
      current_price += current_price * _grid_width;
      if (current_price <= _max_price) {
        grid.push(Number(current_price.toFixed(3)));
      } else {
        break;
      }
    }

    // 向下生成网格
    current_price = basePrice;
    while (current_price > _min_price) {
      current_price -= current_price * _grid_width;
      if (current_price >= _min_price) {
        grid.unshift(Number(current_price.toFixed(3)));
      } else {
        break;
      }
    }

    // 确保基准价格在网格中
    if (!grid.includes(basePrice)) {
      grid.push(basePrice);
      grid.sort((a, b) => a - b);
    }

    return grid; // 返回生成的网格数组
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
    if (this._current_price > (this._last_trade_price || this._grid_base_price)) {
      return 1; // 价格上涨趋势
    }
    if (this._current_price < (this._last_trade_price || this._grid_base_price)) {
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
    const result = current > prev ? count - 1 : -(count - 1);
    return Math.min(result, this._max_trade_grid_count);
  }

  /**
   * 下单
   * @param {number} gridCount 跨越的网格数量
   * @param {string} orderDesc 订单类型
   */
  async _placeOrder(gridCount, orderDesc, retry_count = 0) {
    const { ctVal } = this._instrument_info;
    let amount = 0;
    if (this._settlement_type === SettlementType.AMOUNT) {
      const swap_price = this._current_price * ctVal;
      const swap_amount = this._base_amount / swap_price;
      amount = (-gridCount * swap_amount).toFixed(2);
    } else if (this._settlement_type === SettlementType.LOTS) {
      amount = (-gridCount * this._base_lots) / ctVal;
    }

    console.log(`💰${orderDesc}：${this._current_price} ${amount} 个`);
    // 然后执行交易
    const order = create_order_market(this.asset_name, Math.abs(amount), amount / Math.abs(amount));

    await updateGridTradeOrder(this.asset_name, order.clOrdId, null, {
      ...order,
      order_status: OrderStatus.PENDING,
      snapshot: Object.keys(this._snapshot)
        .map(key => `[${key}]:${this._snapshot[key]};`)
        .join('|'),
      grid_count: gridCount,
      target_price: this._current_price,
      avgPx: this._current_price,
      accFillSz: Math.abs(amount),
      ts: this._current_price_ts,
      logs: [this._current_price, this._threshold, this._correction(), orderDesc].join('::'),
    });
    // todo 1.先记录...
    // todo 2.然后执行
    // waring 一定要先保存成交点，否则容易重复下单
    this._resetKeyPrices(this._current_price, this._current_price_ts);
    if (!trade_open) return;
    const result = await executeOrders([order]);

    // todo 3.如果失败则重置关键参数,并更新记录状态：交易成功|失败
    if (!result.success) {
      console.error(`⛔${this.asset_name} 交易失败: ${orderDesc}`);
      await updateGridTradeOrder(this.asset_name, order.clOrdId, null, {
        order_status: OrderStatus.UNSUCESS,
        error: result.msg,
        retry_count,
      });
      // 再次尝试下单
      if (retry_count < 3) {
        await this._placeOrder(gridCount, orderDesc, retry_count + 1);
      } else {
        await updateGridTradeOrder(this.asset_name, order.clOrdId, null, {
          order_status: OrderStatus.FAILED,
          retry_count,
          error: result.msg,
        });
      }
      return;
    } else {
      // todo 3.2 成功则先查询
      const { originalOrder, clOrdId, ordId, tag, ...rest } = result.data[0];
      await updateGridTradeOrder(this.asset_name, clOrdId, ordId, {
        clOrdId,
        ordId,
        ...rest,
        ...order,
        ...originalOrder,
        order_status: OrderStatus.PLACED,
        retry_count,
      });

      console.log(`✅${this.asset_name} 交易成功: ${orderDesc}`);
      // 重置关键参数
      this._saveState(); // 立即保存状态
      try {
        // todo 3.2.1 开始查询订单信息，更新关键参数
        const [o] = (await fetchOrders(result.data)) || [];
        if (o && o.avgPx && o.fillTime) {
          console.log(
            `✅${this.asset_name} 远程重置关键参数成功`,
            parseFloat(o.avgPx),
            parseFloat(o.fillTime)
          );
          // todo 3.2.2 最终完成记录
          // todo 3.2 成功则先查询
          await updateGridTradeOrder(this.asset_name, order.clOrdId, null, {
            avgPx: o.avgPx,
            ts: o.fillTime,
            order_status: OrderStatus.CONFIRMED,
          });
        } else {
          await updateGridTradeOrder(this.asset_name, order.clOrdId, null, {
            order_status: OrderStatus.CONFIRM_FAILED,
            error: '未获取到订单信息',
          });
          console.error(`⛔${this.asset_name} 远程重置关键参数失败: 未获取到订单信息`);
        }
      } catch (e) {
        await updateGridTradeOrder(this.asset_name, order.clOrdId, null, {
          order_status: OrderStatus.CONFIRM_ERROR,
          error: '订单确认错误',
        });
        // todo 3.3 报错，记录为查询失败
        console.error(`⛔${this.asset_name} 远程重置关键参数失败: ${e.message}`);
      }
      this._saveState(); // 立即保存状态
    }
  }

  async confirmOrder(order) {
    try {
      // 查询订单信息
      const [orderInfo] = (await fetchOrders([order])) || [];

      if (orderInfo && orderInfo.avgPx && orderInfo.fillTime) {
        // 更新关键价格参数
        this._resetKeyPrices(parseFloat(orderInfo.avgPx), parseFloat(orderInfo.fillTime));
        console.log(
          `✅${this.asset_name} 订单确认成功，更新价格参数：`,
          parseFloat(orderInfo.avgPx),
          parseFloat(orderInfo.fillTime)
        );

        // 更新订单状态为已确认
        await updateGridTradeOrder(this.asset_name, order.clOrdId, null, {
          order_status: OrderStatus.CONFIRMED,
          ...orderInfo,
        });

        return {
          success: true,
          data: orderInfo,
        };
      } else {
        // 未获取到订单信息
        await updateGridTradeOrder(this.asset_name, order.clOrdId, null, {
          order_status: OrderStatus.CONFIRM_FAILED, // 修改 unconfirmed -> confirm_failed
          error: '未获取到订单信息',
        });
        console.error(`⛔${this.asset_name} 订单确认失败：未获取到订单信息`);

        return {
          success: false,
          error: '未获取到订单信息',
        };
      }
    } catch (error) {
      // 确认过程发生错误
      await updateGridTradeOrder(this.asset_name, order.clOrdId, null, {
        order_status: OrderStatus.CONFIRM_ERROR,
        error: error.message,
      });
      console.error(`⛔${this.asset_name} 订单确认错误：${error.message}`);

      return {
        success: false,
        error: error.message,
      };
    } finally {
      this._saveState(); // 保存状态
    }
  }

  /**
   * 重置关键参数
   * @param {number} price 最新价格
   * @param {number} ts 最新价格时间戳
   */
  _resetKeyPrices(price, ts) {
    // 重置关键参数
    this._last_trade_price = price;
    this._last_trade_price_ts = ts;
    this._last_grid_count_overtime_reset_ts = ts;
    // 重置拐点
    this._last_lower_turning_price = price;
    this._last_lower_turning_price_ts = ts;

    this._last_upper_turning_price = price;
    this._last_upper_turning_price_ts = ts;
    // 重置基准点
    // this._grid_base_price = this._current_price;
    // this._grid_base_price_ts = this._current_price_ts;
    this._prev_price = price; // 重置前一价格
    this._prev_price_ts = ts;
    // 交易成功后重置标记，允许下一轮首次突破重置
    // 重置网格计数
    this._last_reset_grid_count = 0;
  }
}
