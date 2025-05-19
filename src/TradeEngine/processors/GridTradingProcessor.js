import { AbstractProcessor } from './AbstractProcessor.js';
import { LocalVariable } from '../../LocalVariable.js';
import { createOrder_market, executeOrders, fetchOrders } from '../../trading.js';
import { getGridTradeOrders, updateGridTradeOrder } from '../../recordTools.js';
import { calculateATR } from '../../indicators/ATR.js';
import { calculateIV } from '../../indicators/IV.js';
import { calculateMA } from '../../indicators/MA.js';
import { calculateRSI } from '../../indicators/RSI.js';
import { calculateBOLL, calculateBOLLLast } from '../../indicators/BOLL.js';
export class GridTradingProcessor extends AbstractProcessor {
  type = 'GridTradingProcessor';
  engine = null;
  asset_name = '';
  _timer = {};

  // 网格参数
  _grid_width = 0.025; // 网格宽度
  _upper_drawdown = 0.012; // 最大回撤
  _lower_drawdown = 0.012; // 最大反弹
  _trade_amount = 9000; // 每次交易数量
  _max_position = 100000; // 最大持仓
  _min_price = 0.1; // 最低触发价格
  _max_price = 100; // 最高触发价格
  _backoff_1st_time = 30 * 60; // 15 分钟
  _backoff_2nd_time = 60 * 60; // 25 分钟
  _backoff_3nd_time = 90 * 60; // 30 分钟
  // 风险控制
  _max_trade_grid_count = 8; // 最大网格数量
  // 策略锁
  _stratage_locked = false;
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
    const ctx = chart.ctx;
    ctx.save();
    // 绘制指标信息
    const volatility = this.getVolatility(30);
    const atr = this.getATR();
    const { vol, vol_avg_fast, vol_avg_slow, second } = this.getVolumeStandard();
    const vol_power = vol_avg_fast / vol_avg_slow;

    // 设置文本样式
    ctx.font = '16px Monaco, Menlo, Consolas, monospace';
    ctx.fillStyle = '#6c3483';
    ctx.textAlign = 'right';

    // 计算右上角位置（留出一些边距）
    const rightMargin = chart.width - 60;
    let topMargin = 40;
    const lineHeight = 22;

    // 绘制各项指标
    ctx.fillText(`${(atr * 100).toFixed(2)}% : ATR`, rightMargin, topMargin);
    topMargin += lineHeight;

    ctx.fillText(`${(volatility * 100).toFixed(2)}% : 瞬时波动率`, rightMargin, topMargin);
    topMargin += lineHeight;

    ctx.fillText(`${(this._threshold * 100).toFixed(2)}% : 回撤门限`, rightMargin, topMargin);
    topMargin += lineHeight;

    ctx.fillText(
      `${(vol / 1000).toFixed(0)}k/${(vol_avg_fast / 1000).toFixed(0)}k/${(vol_avg_slow / 1000).toFixed(0)}k : VOL`,
      rightMargin,
      topMargin
    );
    topMargin += lineHeight;

    ctx.fillText(`${(vol_power * 100).toFixed(2)}% : 量能`, rightMargin, topMargin);
    topMargin += lineHeight;

    ctx.fillText(`${60 - second}s : 剩余`, rightMargin, topMargin);

    ctx.restore();
  }

  getATR(p = 10) {
    const candles = this.engine.getCandleData(this.asset_name);
    return calculateATR(candles, p);
  }

  getVolatility(p = 14) {
    // const prices = this.engine.getCandleData(this.asset_name).map(candle => candle.close);
    const prices = this._recent_prices;
    return calculateIV(prices.slice(-p));
  }

  getVolume(acc = false) {
    const candles = this.engine.getCandleData(this.asset_name);
    if (acc) {
      return candles.map(candle => candle.vol).reduce((a, b) => a + b, 0);
    }
    return parseFloat(candles.map(candle => candle.vol).at(-1));
  }

  getFastRSI(p = 10) {
    return calculateRSI(this._recent_prices, p);
  }
  getSlowRSI(p = 10) {
    const candles = this.engine.getCandleData(this.asset_name);
    const prices = candles.map(candle => candle.close);
    return calculateRSI(prices, p);
  }

  getBOLL(p = 20) {
    const candles = this.engine.getCandleData(this.asset_name);
    return calculateBOLLLast(candles, p);
  }

  _recordPrice() {
    this._recent_prices.push(this._current_price);
    if (this._recent_prices.length > 300) {
      this._recent_prices = this._recent_prices.slice(-300);
    }
  }

  getVolumeStandard(slow_window = 30, fast_window = 3) {
    const candles = this.engine.getCandleData(this.asset_name);

    const volumeArray = candles
      // .filter(candle => candle.confirm > 0)
      .map(candle => parseFloat(candle.vol));

    // 获取最后n根K线数据
    const { vol: lastVol, ts } = candles.at(-1); // 最新的K线

    const movingAverages = calculateMA(volumeArray, slow_window);
    const movingAverages_fast = calculateMA(volumeArray, fast_window);
    const lastMovingAverage = movingAverages.at(-1) || 0;
    const lastMovingAverage_fast = movingAverages_fast.at(-1) || 0;

    // 计算当前分钟已经过去的时间（秒）
    const currentTime = Math.floor(Date.now() / 1000);
    const elapsedSeconds = Math.max(1, currentTime - ts / 1000); // 防止除零

    return {
      vol: parseFloat(lastVol), // 当前分钟已成交量
      vol_avg_slow: lastMovingAverage, // 移动平均成交量
      vol_avg_fast: lastMovingAverage_fast, // 移动平均成交量
      second: elapsedSeconds, // 已经过去的秒数
    };
  }

  /**
   * 时间触发器
   * @implements
   */
  tick() {
    // 获取最新价格
    this._current_price = this.engine.getRealtimePrice(this.asset_name) || this._prev_price;

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
    // 计算上拐点价横跨网格数量
    const gridTurningCount_upper = this._countGridNumber(
      this._last_upper_turning_price,
      this._last_trade_price
    );
    // 计算下拐点价横跨网格数量
    const gridTurningCount_lower = this._countGridNumber(
      this._last_lower_turning_price,
      this._last_trade_price
    );

    // 更新拐点价格
    this._refreshTurningPoint();

    // 执行交易策略

    this._orderStrategy(gridCount, gridTurningCount_upper, gridTurningCount_lower);

    // 更新历史价格
    this._prev_price = this._current_price;
    this._prev_price_ts = this._current_price_ts;
    this._saveState(); // 使用统一的状态保存方法
    // console.log(this.engine.market_candle['1m']['XRP-USDT']);
  }

  /**
   * 动态计算趋势翻转的阈值
   * @param {*} price_distance_count 价格距离上次交易的绝对格数，可以是小数
   * @param {*} price_grid_count 价格距离上次交易的格数，绝对格数，确定跨越两条网格线
   * @param {*} time_passed_seconds 距离上次交易的时间，秒数
   */
  trendReversalThreshold(
    price,
    threshold,
    price_distance_count,
    price_grid_count,
    time_passed_seconds,
    diff_rate,
    direction,
    tendency
  ) {
    // 基础阈值（初始回撤/反弹容忍度）
    const min_threshold = 0.001; // 最小阈值，避免阈值过小
    const max_threshold = 0.012; // 最大阈值，避免阈值过大

    // 价格是否正在回撤
    const is_returning = tendency != 0 ? direction / tendency < 0 : false;

    // 获取指标数据
    const volatility = this.getVolatility(30); // 30秒瞬时波动率（百分比）
    const atr = this.getATR(10); // 10分钟ATR（绝对值）
    const rsi_fast = this.getFastRSI(7); // 快速RSI(10)
    const rsi_slow = this.getFastRSI(180); // 快速RSI(10)
    // const rsi_slow = this.getSlowRSI(10); // 慢速RSI(30)
    const { vol_avg_fast, vol_avg_slow } = this.getVolumeStandard();
    const boll = this.getBOLL(20); // 20分钟BOLL(20)
    const vol_power = vol_avg_fast / vol_avg_slow; // 量能

    console.log(`- 💵价格:${this._current_price.toFixed(3)}`);
    // --- 因子计算（新增price_distance_count和price_grid_count的差异化处理）---
    console.log(`- ↕️ 价距格数:${price_distance_count.toFixed(2)}`);

    // 2. 网格跨越因子（price_grid_count）：离散格数强化趋势强度
    console.log(`- 📶价差格数:${price_grid_count}`);

    // 3. 波动率因子：波动率>2%时放大阈值
    console.log(`- 🌪️ 瞬时波动:${(100 * volatility).toFixed(2)}%`);

    // 3. 波动率因子：波动率>2%时放大阈值
    console.log(`- 🌡️ 真实波动(ATR):${(100 * atr).toFixed(2)}%`);

    // 4. 时间因子：每20分钟阈值递增0.1%
    const timeFactor = Math.log1p(time_passed_seconds / 3600);
    console.log(
      `- 🕒时间因子:${timeFactor.toFixed(2)} / ${(time_passed_seconds / 60).toFixed(2)}分钟`
    );
    console.log(`- 🌊量能因子: ${(100 * vol_power).toFixed(2)}%`);
    // 输出清晰的日志信息
    console.log(`- 🎢布林带宽: [${(100 * boll.bandwidth).toFixed(2)}%]`);
    console.log(`- 🚀动量因子(RSI): ${rsi_fast.toFixed(0)} / ${rsi_slow.toFixed(0)}`);
    console.log(`-------------------`);
    /**
     * 一定需要判断上穿下穿方向
     * 例如在向下中，如果到了下轨，明显有反弹，此时不应该减少门限
     * 例如在向上中，如果到了上轨，明显有回撤，此时同样不应该减少门限
     * 只有上到了上轨，下到了下轨，才应该减少门限，甚至下到了上轨上到了上轨更要增加门限
     *
     * ？中线与网格线相接近的情况，因为跨越网格线代表利润阶跃（但回撤时应减少门限），而跨越中线则代表变化扩大（应该放大门限），因此需要考虑如何设计折中。
     * 例如，在向下中，如果价格接近中轨，应该增加门限，因为这可能是一个较大的回撤。但如果接近网格线，则应该减少门限，尽快平仓，因为这可能是一个较大的利润回撤。
     */

    // 计算价格相对于布林带的位置（0-50范围，0=中轨，50=上/下轨）
    const bandDeviation =
      price > boll.middle
        ? ((price - boll.middle) / (boll.upper - boll.middle)) * 50 // 中轨以上
        : ((price - boll.middle) / (boll.middle - boll.lower)) * 50; // 中轨以下

    // 动态调整阈值
    const deviationAbs = Math.abs(bandDeviation);
    let thresholdAdjustment = 1;
    let deviationMessage = '';

    // 根据价格位置和趋势方向调整阈值
    if (deviationAbs < 20) {
      // 价格接近中轨，增加阈值
      thresholdAdjustment = 1.5;
      deviationMessage = '🪜 价格接近中轨';
    } else if (deviationAbs > 35) {
      // 价格接近边界，根据趋势方向调整
      const isNearUpper = bandDeviation > 35;
      const isNearLower = bandDeviation < -35;

      deviationMessage = `🚧价格正在${isNearUpper ? '📈 触及上轨' : '📉 触及下轨'}`;
      if (tendency !== 0) {
        const isTrendUp = tendency > 0;
        // 上升趋势接近上轨或下降趋势接近下轨时减小阈值
        if ((isTrendUp && isNearUpper) || (!isTrendUp && isNearLower)) {
          if (price_distance_count >= 3.5 && price_grid_count >= 3) {
            deviationMessage += `，且超过${price_distance_count.toFixed(2)}格，已有利润空间，⬅️ ➡️ 许更大回撤`;
            thresholdAdjustment = 1.5;
          } else if (price_distance_count >= 2.2) {
            thresholdAdjustment = 0.7;
            deviationMessage += `，且超过${price_distance_count.toFixed(2)}格，➡️ ⬅️ 阈值减少`;
          } else {
            deviationMessage += `，不足2格，⬅️ ➡️ 阈值增加`;
            thresholdAdjustment = 1.2;
          }
        } else {
          deviationMessage += `，反向触界，⬅️ ➡️ 阈值增加`;
          // 反向触及边界时增加阈值
          thresholdAdjustment = 1.75;
        }
      }
    } else {
      deviationMessage = '♻️ 价格在正常区间';
    }

    // 应用阈值调整
    threshold *= thresholdAdjustment;

    [
      `📐价格偏离度：${bandDeviation.toFixed(2)}%`,
      `${deviationMessage}`,
      `⛩ 阈值调整：${thresholdAdjustment === 1 ? '⭕️ 不变' : thresholdAdjustment > 1 ? '⬅️ ➡️ 扩大' : '➡️ ⬅️ 缩小'}`,
      `⛩ 当前阈值：${(threshold * 100).toFixed(2)}%`,
    ].map(msg => console.log(` * ${msg}`));

    // 5. RSI动量因子：超买/超卖反向调整
    // ...existing code ...
    // RSI动量因子优化：根据背离程度调整
    let rsiFactor = 1;
    const rsiDivergence = Math.abs(rsi_fast - rsi_slow);
    let rsi_msg = '⌛价格收集中...';
    if (rsi_fast >= 0 && rsi_slow >= 0) {
      rsi_msg = '♻️ 价格平稳';
      if (rsi_fast > 70) {
        // 超买区域
        if (rsi_fast > rsi_slow) {
          // RSI快线上穿慢线，超买加强，降低阈值
          rsiFactor = Math.max(0.3, 1 - rsiDivergence / 30);
          rsi_msg = '🚀📈 超买加强，降低阈值➡️ ⬅️';
        } else {
          // RSI快线下穿慢线，超买减弱，轻微提高阈值
          rsiFactor = Math.min(1.5, 1 + rsiDivergence / 50);
          rsi_msg = '🐢📈 超买减弱，轻微提高阈值⬅️ ➡️';
        }
      } else if (rsi_fast < 30) {
        // 超卖区域
        if (rsi_fast < rsi_slow) {
          // RSI快线下穿慢线，超卖加强，降低阈值
          rsiFactor = Math.max(0.3, 1 - rsiDivergence / 30);
          rsi_msg = '🚀📉 超卖加强，降低阈值➡️ ⬅️';
        } else {
          // RSI快线上穿慢线，超卖减弱，轻微提高阈值
          rsiFactor = Math.min(1.5, 1 + rsiDivergence / 50);
          rsi_msg = '🐢📉 超卖减弱，轻微提高阈值⬅️ ➡️';
        }
      }
    }
    threshold = threshold * rsiFactor;
    console.log(` * ${rsi_msg}(${rsiFactor.toFixed(2)})`);
    console.log(` * 🎯调整阈值至：⛩ ${(threshold * 100).toFixed(2)}%`);
    console.log(` * ↩️ 当前回撤：⛩ ${(100 * diff_rate).toFixed(2)}%`);
    console.log(`-------------------`);

    // --- 合成动态阈值 ---

    // 硬性限制：阈值范围0.2%~5%
    return Math.min(Math.max(threshold, min_threshold), max_threshold);
  }

  async _orderStrategy(gridCount, gridTurningCount_upper, gridTurningCount_lower) {
    // if (this._stratage_locked) return;
    // this._stratage_locked = true;
    // await this._placeOrder(-1, '下单测试');
    // // 等待1秒
    // await new Promise(resolve => setTimeout(resolve, 3000));
    // this._stratage_locked = false;
    // return;
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

      const timeDiff = (this._current_price_ts - this._last_grid_count_overtime_reset_ts) / 1000;

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

      this._threshold = this.trendReversalThreshold(
        this._current_price,
        default_threshold,
        price_distance_grid,
        grid_count_abs,
        timeDiff,
        correction,
        this._direction,
        this._tendency
      );

      console.log(`- 当前阈值：${(100 * this._threshold).toFixed(2)}%\n`);

      // 如果超过两格则回撤判断减半，快速锁定利润
      // 可能还要叠加动量，比如上涨速度过快时，需要允许更大/更小的回撤
      // const atr = this.getATR();
      const is_return_arrived = Math.abs(correction) > this._threshold;
      // 回撤/反弹条件是否满足
      if (!is_return_arrived) {
        console.log(
          `[${this.asset_name}]回撤门限: ${(this._threshold * 100).toFixed(2)}%，当前价差 ${price_distance_grid.toFixed(2)} 格，当前回调幅度: ${(correction * 100).toFixed(2)}%，🐢继续等待...`
        );
        return;
      }

      //  todo 不论是回撤还是反弹，都不能超过一个格子，否则会过度反弹高位买入
      if (grid_count_abs >= 1) {
        // 正常满足条件下单
        console.log(
          `[${this.asset_name}]${this._current_price} 价格穿越了 ${gridCount} 个网格，回撤门限: ${(this._threshold * 100).toFixed(2)}%，当前价差 ${price_distance_grid.toFixed(2)} 格，当前回调幅度: ${(correction * 100).toFixed(2)}%，触发策略`
        );
        await this._placeOrder(gridCount, this._direction < 0 ? '- 回撤下单' : '- 反弹下单');
        return;
      }

      // 处理拐点交易逻辑
      if (
        this._enable_none_grid_trading &&
        this._direction < 0 &&
        Math.abs(gridTurningCount_upper) >= 1
      ) {
        console.log(
          `↪️[${this.asset_name}]${this._current_price} 价格穿越了上拐点，触发上拐点回调交易`
        );
        await this._placeOrder(1, '- 格内上穿拐点下单');
        return;
      }

      if (
        this._enable_none_grid_trading &&
        this._direction > 0 &&
        Math.abs(gridTurningCount_lower) >= 1
      ) {
        // 这里应该使用 gridTurningCount_lower
        console.log(
          `↩️[${this.asset_name}]${this._current_price} 价格穿越了下拐点，触发下拐点回调交易`
        );
        await this._placeOrder(-1, '- 格内下穿拐点下单');
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
  async _placeOrder(gridCount, orderDesc) {
    const amount = -gridCount * this._trade_amount;

    if (Math.abs(amount) > this._max_position) {
      console.warn(`⚠️ 交易量${amount}超过最大持仓限制${this._max_position}`);
      return;
    }

    console.log(`💰${orderDesc}：${this._current_price} ${amount} 个`);
    // 然后执行交易
    const order = createOrder_market(
      this.asset_name,
      Math.abs(amount),
      amount / Math.abs(amount),
      true
    );

    await updateGridTradeOrder(order.clOrdId, null, {
      order_status: 'pendding',
      order_desc: orderDesc,
      grid_count: gridCount,
    });
    // todo 1.先记录...
    // todo 2.然后执行
    let result = {};
    try {
      result = await executeOrders([order]);
    } catch (error) {
      console.error(`⛔${this.asset_name} 交易失败: ${orderDesc}`);
      this._resetKeyPrices(this._last_trade_price, this._last_trade_price_ts);
      await updateGridTradeOrder(order.clOrdId, null, {
        order_status: 'faild',
        error: error.message,
      });
      return;
    }

    // todo 3.如果失败则重置关键参数,并更新记录状态：交易成功|失败
    if (!result.success) {
      // todo 3.1 失败则直接记录为失败订单
      console.error(`⛔${this.asset_name} 交易失败: ${orderDesc}`);
      this._resetKeyPrices(this._last_trade_price, this._last_trade_price_ts);
      await updateGridTradeOrder(order.clOrdId, null, {
        order_status: 'failed',
        error: result.error,
      });
      return;
    } else {
      // todo 3.2 成功则先查询
      const order = result.data[0];
      const orign_order = order.originalOrder;
      delete order.originalOrder;
      await updateGridTradeOrder(order.clOrdId, order.ordId, {
        ...order,
        ...orign_order,
        order_status: 'placed',
      });

      console.log(`✅${this.asset_name} 交易成功: ${orderDesc}`);
      // 重置关键参数
      this._resetKeyPrices(this._current_price, this._current_price_ts);
      this._saveState(); // 立即保存状态
      try {
        // todo 3.2.1 开始查询订单信息，更新关键参数
        const [o] = (await fetchOrders(result.data)) || [];
        if (o && o.avgPx && o.fillTime) {
          this._resetKeyPrices(parseFloat(o.avgPx), parseFloat(o.fillTime));
          console.log(
            `✅${this.asset_name} 远程重置关键参数成功`,
            parseFloat(o.avgPx),
            parseFloat(o.fillTime)
          );
          // todo 3.2.2 最终完成记录
          // todo 3.2 成功则先查询
          await updateGridTradeOrder(order.clOrdId, null, {
            order_status: 'confirmed',
          });
        } else {
          await updateGridTradeOrder(order.clOrdId, null, {
            order_status: 'confirm-failed',
            error: '未获取到订单信息',
          });
          console.error(`⛔${this.asset_name} 远程重置关键参数失败: 未获取到订单信息`);
        }
      } catch (e) {
        await updateGridTradeOrder(order.clOrdId, null, {
          order_status: 'confirm-error',
          error: '订单确认错误',
        });
        // todo 3.3 报错，记录为查询失败
        console.error(`⛔${this.asset_name} 远程重置关键参数失败: ${e.message}`);
      }
      this._saveState(); // 立即保存状态
    }
  }

  confirmOrder(order) {
    // todo 1.先记录...
    // todo 2.然后执行
    let result = {};
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
