import { getInstruments, getOpenInterest, getOrderHistory, getPositions } from '../api.js';
import { LocalVariable } from '../LocalVariable.js';
import {
  getClosingTransaction,
  getLastTransactions,
  getOpeningTransaction,
  updateTransaction,
} from '../recordTools.js';
import { findBestFitLine } from '../regression.js';
import { calculateStep, formatTimestamp, parseCandleData } from '../tools.js';
import { HedgeProcessor } from './processors/HedgeProcessor.js';
import { MarketMakerProcessor } from './processors/MarketMakerProcessor.js';
import { GridTradingProcessor } from './processors/GridTradingProcessor.js';
import { calculateChipDistribution } from '../indicators/CD.js';

export class TradeEngine {
  static processors = [];
  static market_data = {}; // 行情数据
  static market_candle = {};
  static realtime_price = new LocalVariable('TradeEngine/realtime_price');
  static realtime_price_ts = new LocalVariable('TradeEngine/realtime_price_ts');
  static _main_asset = ''; // 主资产
  static _timer = {};
  static _bar_type = '';
  static _beta_map = new LocalVariable('TradeEngine/_beta_map');
  static _main_asset = '';
  static _once_limit = 100;
  static _candle_limit = 300;
  static _asset_names = []; // 资产列表
  static _status = 0; //1 启动中 2运行中 -1出错
  static _trade_fee_rate = 0.001;
  static _show_order_his = [];
  static _positionCost = new LocalVariable('TradeEngine/positionCost');
  static _max_candle_size = 3000;
  static _instrument_timers = {}; // 存储每个品种的定时器
  static _position_timers = {}; // 存储每个品种的定时器
  static _position_refresh_interval = 5000; // 存储每个品种的持仓刷新间隔
  static _instrument_refresh_interval = 10000; // 存储每个品种的持仓刷新间隔
  static _instrument_info = {}; // 存储品种信息
  static _interest_history = {}; // 存储品种历史数据
  static _chip_distribution = {};
  static _chip_distribution_cache_duration = 1000 * 9;
  static _position_list = {};
  // 添加缓存相关变量
  static _interest_cache = {}; // 持仓兴趣缓存
  static _volume_cache = {}; // 成交量缓存
  static _chip_cache_duration = 10000; // 缓存有效期 5秒

  /**
   * 对冲监听器
   * @param {*} assetNames
   * @param {*} size
   * @param {*} gate
   * @returns
   */
  static createHedge(assetNames, size, gate) {
    if (!assetNames || assetNames.length < 2) throw new Error(`${assetNames}未设置对冲资产`);
    if (!gate || gate <= 0) throw new Error(assetNames, `${assetNames}必须设置门限`);
    const hp = new HedgeProcessor(assetNames, size, gate, this);
    this.processors.push(hp);
    return hp;
  }

  /**
   * 创建做市商
   * @param {*} assetName
   * @param {*} size
   * @param {*} distance
   */
  static createMarketMaker(assetName, size, distance) {
    const mp = new MarketMakerProcessor(assetName, size, distance, this);
    this.processors.push(mp);
    return mp;
  }

  /**
   * TODO 实现私有属性的读取
   * @returns
   */
  static getMetaInfo() {
    // TODO 后续再实现
    return {};
  }

  /**
   * 获取根据主资产缩放后的价格
   * @returns
   */
  static getAllScaledPrices() {
    const klines = Object.values(this.getAllMarketData());
    return klines.map((it, id) => {
      const { prices, ts, id: assetId } = it;
      if (assetId == TradeEngine._main_asset) return { ...it };
      const [a, b] = TradeEngine._beta_map[assetId] || [1, 0];
      return {
        ...it,
        prices: prices.map(it => a * it + b),
      };
    });
  }

  /**
   * 获取主资产
   * @returns
   */
  static getMainAssetLabels() {
    return this.getMainAsset().ts.map(it => formatTimestamp(it, this._bar_type));
  }

  static _normalizePrice(price, beta) {
    return price * beta[0] + beta[1];
  }
  /**
   * 获取实时利润
   */
  static getRealtimeProfits() {
    const scaled_prices = this.getAllScaledPrices();
    const profit = {};
    for (let i = 0; i < scaled_prices.length - 1; i++) {
      for (let j = i + 1; j < scaled_prices.length; j++) {
        const assetId1 = scaled_prices[i].id;
        const assetId2 = scaled_prices[j].id;

        const prices1 = scaled_prices[i].prices;
        const prices2 = scaled_prices[j].prices;
        profit[`${assetId1}:${assetId2}`] = this._calcPriceGapProfit(
          prices1.at(-1),
          prices2.at(-1),
          (prices1.at(-1) + prices2.at(-1)) / 2
        );
      }
    }
    return profit;
  }

  /**
   * 获取实时利润
   */
  static getAllHistoryProfits() {
    const scaled_prices = this.getAllScaledPrices();
    const profit = {};
    for (let i = 0; i < scaled_prices.length - 1; i++) {
      for (let j = i + 1; j < scaled_prices.length; j++) {
        const assetId1 = scaled_prices[i].id;
        const assetId2 = scaled_prices[j].id;
        const prices1 = scaled_prices[i].prices;
        const prices2 = scaled_prices[j].prices;

        profit[`${assetId1}:${assetId2}`] = prices1.map((p1, id) => {
          const p2 = prices2[id];
          return this._calcPriceGapProfit(p1, p2, (p1 + p2) / 2);
        });
      }
    }
    return profit;
  }

  /**
   * 计算预期开仓利润率
   * @param {*} a
   * @param {*} b
   * @param {*} n
   * @returns
   */
  static _calcPriceGapProfit(a, b, n) {
    return (((n - b) / b - (n - a) / a) / 2) * (a > b ? 1 : -1);
  }

  /**
   * 计算实际平仓利润率
   * @param {*} a
   * @param {*} b
   * @param {*} n
   * @returns
   */
  static _calcClosingProfitRate(tradeId) {
    const { orders: order_o } = getOpeningTransaction(tradeId);
    const { orders: order_c } = getClosingTransaction(tradeId);
    const beta_map = Object.fromEntries(order_o.map(o => [o.instId, o.beta]));
    let [a, b] = order_o
      .sort((a, b) => a.instId.localeCompare(b.instId))
      .map(it => parseFloat(beta_map[it.instId][0] * it.avgPx + beta_map[it.instId][1]));
    let [a2, b2] = order_c
      .sort((a, b) => a.instId.localeCompare(b.instId))
      .map(it => parseFloat(beta_map[it.instId][0] * it.avgPx + beta_map[it.instId][1]));
    return (((b2 - b) / b - (a2 - a) / a) / 2) * (a > b ? 1 : -1);
  }

  static _orderHistoryCache = {};
  static _lastCacheTime = {};
  static CACHE_DURATION = 60000; // 缓存时间10秒

  /**
   * 获取订单历史（带缓存）
   */
  static getOrderHistory(params) {
    const cacheKey = params.instId;
    this._updateCache(params, cacheKey);
    // 计算持仓成本
    this._calculatePositionCost(cacheKey);
    return this._orderHistoryCache[cacheKey] || [];
  }

  // 异步更新缓存的私有方法
  static async _updateCache(params, cacheKey) {
    try {
      // 如果缓存过期，异步更新缓存
      const now = Date.now();
      this._lastCacheTime[cacheKey] ??= now;
      const expired = now - this._lastCacheTime[cacheKey] >= this.CACHE_DURATION;
      const empty = !this._orderHistoryCache[cacheKey]?.length;
      if (expired || empty) {
        const { data } = await getOrderHistory(params);
        this._orderHistoryCache[cacheKey] = data;
        this._lastCacheTime[cacheKey] = Date.now();
      }
    } catch (error) {
      console.error('更新订单历史缓存失败:', error.message);
    }
  }

  /**
   * 刷新beta
   */
  static refreshBeta() {
    // 获取主资产数据
    const mainAssetData = this.getMarketData(this._main_asset);
    if (!mainAssetData) {
      console.error('主资产数据未找到');
      return;
    }

    // 处理单个资产
    const processAsset = assetId => {
      const assetData = this.getMarketData(assetId);
      if (
        !assetData?.prices ||
        !assetData?.ts ||
        !assetData?.prices?.length ||
        !mainAssetData?.prices?.length
      ) {
        console.warn(`资产 ${assetId} 数据不完整`);
        return;
      }
      if (assetId === this._main_asset) {
        this._beta_map[assetId] = [1, 0];
        return; // 跳过主资产
      }
      const { a, b } = findBestFitLine(assetData.prices, mainAssetData.prices);
      const lastTs = assetData.ts[assetData.ts.length - 1];

      // 记录拟合结果
      // recordBetaHistory(assetId, a, b, lastTs); // 记录历史拟合结果

      this._beta_map[assetId] = [a, b];
    };

    const allAssets = this.getAllMarketData();
    for (const [id, data] of Object.entries(allAssets)) {
      processAsset(id); // 直接传递资产ID
    }
    // recordBetaMap(this._beta_map);
  }

  static getChipDistribution(assetId, bar_type = this._bar_type) {
    const last_time = this._chip_distribution[assetId]?.last_time || 0;
    if (Date.now() - last_time > this._chip_distribution_cache_duration) {
      this._chip_distribution[assetId] = calculateChipDistribution(
        this.getCandleData(assetId, bar_type),
        ts => {
          return this.getHisInterestByTime(assetId, bar_type, ts);
        },
        ts => {
          return this.getHisVolumeByTime(assetId, bar_type, ts);
        }
      );
      this._chip_distribution[assetId].last_time = Date.now();
    }
    return this._chip_distribution[assetId];
  }

  /**
   * 设置主资产
   * @param {*} assetId
   * @returns
   */
  static setMainAsset(assetId) {
    this._main_asset = assetId;
    return this.getMainAsset();
  }

  /**
   * 设置引擎基本信息
   * @param {*} param0
   */
  static setMetaInfo({ bar_type, main_asset, once_limit, candle_limit, assets }) {
    if (bar_type) this._bar_type = bar_type;
    if (main_asset) this._main_asset = main_asset;
    if (once_limit) this._once_limit = once_limit;
    if (candle_limit) this._candle_limit = once_limit;
    if (assets) {
      this._asset_names = assets.map(it => it.id);
    }
    return this;
    // dosmt
  }

  /**
   * 设置主资产
   * @param {*} assetId
   * @returns
   */
  static getMainAsset() {
    return this.market_data?.[this._bar_type]?.[this._main_asset];
  }

  /**
   * 获取所有行情数据
   * @returns
   */
  static getAllMarketData(bar_type) {
    if (!bar_type) bar_type = this._bar_type;
    return this.market_data[bar_type];
  }

  /**
   * 获取资产的行情数据
   * @param {*} assetId
   * @param {*} bar
   * @returns
   */
  static getMarketData(assetId, bar) {
    const barType = bar ?? this._bar_type;
    return this.market_data?.[barType]?.[assetId];
  }

  /**
   * 获取资产实时价格
   * @param {*} assetId
   * @returns
   */
  static getRealtimePrice(assetId) {
    // if()
    return this.realtime_price[assetId];
  }

  /**
   * 获取资产实时价格列表
   * @param {*} assetId
   * @returns
   */
  static getRealtimePrices() {
    return this.realtime_price;
  }

  static getCandleData(assetId, bar_type) {
    const barType = bar_type ?? this._bar_type;
    return this.market_candle?.[barType]?.[assetId];
  }

  static updateCandleData(assetId, bar_type, candle_data) {
    // 设置默认资产
    if (!this._main_asset) this._main_asset = assetId;
    // 设置默认k线粒度
    if (!this._bar_type) this._bar_type = bar_type;

    // 初始化数据结构
    this.market_candle ||= {};
    this.market_candle[bar_type] ||= {};
    this.market_candle[bar_type][assetId] ||= [];
    // 解析K线数据
    const candleInfo = parseCandleData(candle_data);

    // 获取现有的K线数据
    const existingCandles = this.market_candle[bar_type][assetId];

    // 查找是否存在相同时间戳的K线
    const existingIndex = existingCandles.findIndex(candle => candle.ts === candleInfo.ts);

    if (existingIndex !== -1) {
      // 如果存在相同时间戳的K线，更新它
      existingCandles[existingIndex] = candleInfo;
    } else {
      // 如果不存在，添加新的K线并保持时间顺序
      const insertIndex = this._findInsertIndex(
        existingCandles.map(candle => candle.ts),
        candleInfo.ts
      );
      existingCandles.splice(insertIndex, 0, candleInfo);
    }
    this.market_candle[bar_type][assetId] = existingCandles.slice(-this._max_candle_size);
  }

  static updateCandleDates(assetId, bar_type, candle_data_array) {
    // 设置默认资产
    if (!this._main_asset) this._main_asset = assetId;
    // 设置默认k线粒度
    if (!this._bar_type) this._bar_type = bar_type;

    // 初始化数据结构
    this.market_candle ||= {};
    this.market_candle[bar_type] ||= {};
    this.market_candle[bar_type][assetId] ||= [];
    // 解析每一条K线数据
    const candleInfoArray = candle_data_array.map(data => parseCandleData(data));

    // 创建临时映射表用于去重和排序
    const candleMap = new Map();

    // 获取现有的K线数据
    const existingCandles = this.market_candle[bar_type][assetId] || [];

    // 合并现有数据和新数据
    [...existingCandles, ...candleInfoArray].forEach(candle => {
      candleMap.set(candle.ts, candle);
    });

    // 按时间戳排序
    const sortedTimestamps = [...candleMap.keys()].sort((a, b) => a - b);

    // 生成有序的K线数据
    this.market_candle[bar_type][assetId] = sortedTimestamps
      .map(ts => candleMap.get(ts))
      .slice(-this._max_candle_size);
  }

  /**
   * 更新时间价格序列
   * @param {*} assetId 资产标识
   * @param {*} price_arr 时间价格序列
   * @param {*} ts_arr 时间序列
   * @param {*} bar 数据粒度 1m 1H
   */
  static updatePrices(assetId, price_arr, ts_arr, bar) {
    // 设置默认资产
    if (!this._main_asset) this._main_asset = assetId;
    // 设置默认k线粒度
    if (!this._bar_type) this._bar_type = bar;
    // 数据校验
    if (price_arr.length !== ts_arr.length) {
      throw new Error('价格序列与时间戳序列长度必须一致');
    }

    // 初始化数据结构
    this.market_data ||= {};
    this.market_data[bar] ||= {};

    // 创建临时映射表（O(n)时间复杂度）
    const newDataMap = new Map();
    ts_arr.forEach((ts, index) => {
      ts = parseFloat(ts);
      newDataMap.set(ts, parseFloat(price_arr[index]));
    });

    // 合并已有数据
    const existing = this.market_data[bar][assetId];
    if (existing) {
      // 合并策略：保留最新数据
      existing.ts.forEach((ts, index) => {
        if (!newDataMap.has(ts)) {
          newDataMap.set(ts, existing.prices[index]);
        }
      });
    }

    // 生成有序数据集
    const sortedTimestamps = [...newDataMap.keys()].sort((a, b) => a - b);

    // 更新存储
    const sorted_prices = sortedTimestamps.map(ts => newDataMap.get(ts));
    this.market_data[bar][assetId] = {
      id: assetId,
      ts: sortedTimestamps.slice(-this._max_candle_size), // 只保留最新的3000个数据点
      prices: sorted_prices.slice(-this._max_candle_size),
      max_length: this._max_candle_size, // 添加长度限制标记
    };

    // 更新实时价格
    this.realtime_price[assetId] = sorted_prices.at(-1);
    this.realtime_price_ts[assetId] = sortedTimestamps.at(-1);
    // recordPrice(assetId, this.realtime_price[assetId]);
    // this._status
  }

  /**
   * 更新单个价格数据点
   * [功能特性]
   * 1. 支持时间戳去重覆盖
   * 2. 自动维护时间序列有序性
   * 3. 高效二分查找插入
   * 4. 数据合法性校验
   * @param {string} assetId - 资产标识
   * @param {number} price - 新价格
   * @param {number} ts - 时间戳（秒级）
   * @param {string} bar - 数据粒度
   */
  static updatePrice(assetId, price, ts, bar) {
    // 设置默认资产
    if (!this._main_asset) this._main_asset = assetId;
    // 设置默认k线粒度
    if (!this._bar_type) this._bar_type = bar;
    ts = parseFloat(ts);
    price = parseFloat(price);
    // 参数校验
    if (typeof ts !== 'number' || ts <= 0) {
      throw new Error(`无效时间戳: ${ts}`);
    }
    if (typeof price !== 'number' || !Number.isFinite(price)) {
      throw new Error(`无效价格值: ${price}`);
    }

    // 初始化数据结构
    this.market_data ||= {};
    this.market_data[bar] ||= {};
    const assetKey = assetId;

    // 获取或初始化资产数据
    let assetData = this.market_data[bar][assetKey];
    if (!assetData) {
      this.market_data[bar][assetKey] = {
        id: assetId,
        prices: [],
        ts: [],
        max_length: this._max_candle_size, // 添加数据长度限制
      };
      assetData = this.market_data[bar][assetKey];
    }

    // 查找插入位置
    const insertionIndex = this._findInsertIndex(assetData.ts, ts);

    // 判断是否重复时间戳
    if (assetData.ts[insertionIndex] === ts) {
      // 覆盖已有数据
      assetData.prices[insertionIndex] = price;
    } else {
      // 插入新数据
      assetData.ts.splice(insertionIndex, 0, ts);
      assetData.prices.splice(insertionIndex, 0, price);

      // 维护数组长度
      if (assetData.ts.length > assetData.max_length) {
        assetData.ts = assetData.ts.slice(-assetData.max_length);
        assetData.prices = assetData.prices.slice(-assetData.max_length);
      }
    }

    // 更新实时价格
    this.realtime_price[assetId] = price;
    this.realtime_price_ts[assetId] = ts;
  }

  /**
   * 二分查找插入位置（私有方法）
   * @param {number[]} sortedArray - 已排序数组
   * @param {number} value - 查找值
   * @returns {number} 插入位置索引
   */
  static _findInsertIndex(sortedArray, value) {
    let low = 0,
      high = sortedArray.length;
    while (low < high) {
      const mid = (low + high) >>> 1; // 无符号右移等价于 Math.floor((low + high)/2)
      if (sortedArray[mid] < value) {
        low = mid + 1;
      } else {
        high = mid;
      }
    }
    return low;
  }

  static refreshTransactions() {
    //todo 将来做筛选交易信号判断和处理
    const opening_transactions = getLastTransactions(100, 'opening');

    opening_transactions.map(({ tradeId, closed, orders }) => {
      if (!closed) {
        const profit = this._calcRealtimeProfit(orders);
        updateTransaction(tradeId, 'opening', { profit });
      }
    });
  }

  /**
   * 根据实时价格计算订单实时净利润
   * @param {*} orders
   * @returns
   */
  static _calcRealtimeProfit(orders) {
    let fee_usdt = 0,
      cost = 0,
      sell = 0;
    const realtime_price_map = TradeEngine.getRealtimePrices();

    orders.map(({ instId, side, sz, tgtCcy, avgPx, accFillSz, fee, feeCcy }) => {
      const realtime_price = realtime_price_map[instId];
      if (!realtime_price) {
        // console.warn(`实时价格获取不到: ${instId}`);
        return 0;
      }
      // 单位 false:本币; true:usdt
      const unit_fgt = tgtCcy === 'base_ccy' ? false : true;
      const unit_fee = feeCcy === 'USDT' ? true : false;

      if (side === 'buy') {
        cost += unit_fgt ? parseFloat(sz) : parseFloat(sz * avgPx);
        // 实时估算
        sell += realtime_price * accFillSz;
        fee_usdt -= realtime_price * accFillSz * this._trade_fee_rate;
      }

      if (side === 'sell') {
        sell += unit_fgt ? parseFloat(sz) : parseFloat(sz * avgPx);
        // 实时估算
        cost += realtime_price * accFillSz;
        fee_usdt -= realtime_price * accFillSz * this._trade_fee_rate;
      }
      fee_usdt += unit_fee ? parseFloat(fee) : parseFloat(fee * avgPx);
    });
    const profit = sell - cost + fee_usdt;
    return profit;
  }

  static checkEngine() {
    try {
      if (this._status !== 2) {
        // 启动中
        if (Object.values(this.getAllMarketData() || {}).length === this._asset_names.length) {
          // 初始化中
          this._status = 1;
          const isBetaMapReady = this._asset_names.every(a_n => this._beta_map[a_n]?.length == 2);
          // 检查beta映射和instruments信息是否都准备就绪
          if (isBetaMapReady) {
            this._status = 2;
          }
          // if(Object.values(this._beta_map).length >= this._asset_names.length){

          // }
        }
      }
      return this._status;
    } catch (e) {
      console.log(e);
      this._status = -1;
    }
  }

  static runAllProcessors() {
    this.processors.forEach(p => {
      if (this._instrument_info[p.asset_name]) {
        setTimeout(() => {
          p.tick();
        });
      } else {
        console.warn(`未找到合约产品信息: ${p.asset_name}，暂不执行交易策略`);
      }
    });
  }

  static start() {
    const status = this.checkEngine();
    // const restore = this._rewriteConsole('交易引擎启动中...');

    try {
      if (status == 2) {
        // restore(); // 如果完全启动，先恢复console
        this.refreshBeta();
        this.refreshTransactions();
        this.runAllProcessors();
      } else if (status == 1) {
        console.log('启动完成,进行初始化...');
        this.refreshBeta();
      } else if (status === 0) {
        console.log('正在启动交易引擎...');
      } else {
        restore(); // 出错时恢复console
        throw new Error('启动失败...');
      }
    } finally {
      // restore(); // 确保一定会恢复console
    }

    clearTimeout(this._timer.start);
    this._timer.start = setTimeout(() => {
      this.start();
    }, 500);
  }

  static stop() {
    clearTimeout(this._timer.start);
    this._status = 0;
  }

  /**
   * 计算持仓成本
   * @param {string} instId - 合约ID
   * @returns {number} 持仓成本
   */
  static _calculatePositionCost(instId) {
    const orders = this._orderHistoryCache[instId] || [];
    let totalPosition = 0;
    let buyTotalCost = 0;
    let sellTotalCost = 0;
    let feeTotalCoset = 0;

    // if (orders.length) {
    //   debugger;
    // }
    orders.forEach(order => {
      let { side, avgPx, state, tgtCcy, accFillSz, sz, feeCcy, fee } = order;
      if (state !== 'filled') return;

      accFillSz = parseFloat(accFillSz);
      const size = parseFloat(sz);
      const price = parseFloat(avgPx);
      fee = parseFloat(fee);

      const isQuoteCcy = tgtCcy === 'quote_ccy';
      const isFeeQuoteCcy = feeCcy === 'USDT';

      // 计算实际的quote数量
      const quoteCost = isQuoteCcy ? size : size * price;

      const feeCoset = isFeeQuoteCcy ? fee : fee * price;

      if (side === 'buy') {
        totalPosition += accFillSz;
        buyTotalCost += quoteCost;
      } else {
        totalPosition -= accFillSz;
        sellTotalCost += quoteCost;
      }
      feeTotalCoset += feeCoset;
    });

    // if (orders.length) {
    //   debugger;
    // }
    // 计算净花费（买单总花费 - 卖单总收入）
    const netCost = buyTotalCost - sellTotalCost + feeTotalCoset;

    // 计算平均持仓成本 = 净花费 / 当前持仓量
    const avgCost = totalPosition !== 0 ? netCost / totalPosition : 0;

    // 更新到 LocalVariable
    this._positionCost[instId] = {
      instId,
      position: totalPosition,
      totalCost: netCost,
      avgCost: avgCost,
      updateTime: Date.now(),
    };
  }

  // 添加获取持仓成本的公共方法
  static getPositionCost(instId) {
    return (
      this._positionCost[instId] || {
        instId,
        position: 0,
        totalCost: 0,
        avgCost: 0,
        updateTime: 0,
      }
    );
  }

  /**
   * 注册品种并定期更新信息
   * @param {string} assetName - 品种名称
   * @param {string} instType - 品种类型 (SPOT/SWAP等)
   */
  static registerInstrument(assetName, instType) {
    // 清除已存在的定时器
    if (this._instrument_timers[assetName]) {
      clearTimeout(this._instrument_timers[assetName]);
    }
    if (this._position_timers[assetName]) {
      clearTimeout(this._position_timers[assetName]);
    }
    // 创建定时更新任务
    const updateInstrument = async () => {
      try{
        // 从API获取品种信息
        const { data: base } = await getInstruments(instType, assetName);
        const { data: openInterest } = await getOpenInterest(instType, assetName);
        const inst_base = base.find(it => it.instId === assetName);
        const inst_open_interest = openInterest.find(it => it.instId === assetName);

        if (inst_base) {
          this._instrument_info[assetName] = {
            ...inst_base,
            lastUpdateTime: Date.now(),
          };
        }

        if (inst_open_interest) {
          this._instrument_info[assetName] = {
            ...this._instrument_info[assetName],
            ...inst_open_interest,
            lastUpdateTime: Date.now(),
          };
        }
      }catch(e){
        console.log(e);
      } finally {
        // 设置定时器
        this._instrument_timers[assetName] = setTimeout(
          updateInstrument,
          this._instrument_refresh_interval
        );
      }
    };

    const updatePositions = async () => {
      try{
        const { data: positions } = await getPositions(assetName);
        if (positions.length) {
          this._position_list[assetName] = {
            ...this._position_list[assetName],
            ...positions[0],
            lastUpdateTime: Date.now(),
          };
        } else {
          this._position_list[assetName] = null;
        }
      } catch(e){
        console.log(e);
      } finally {
        // 设置定时器
        this._position_timers[assetName] = setTimeout(
          updatePositions,
          this._position_refresh_interval
        );
      }
    };

    // 立即执行一次
    updateInstrument();
    updatePositions();
  }

  static getPositionList(assetName) {
    return this._position_list[assetName] || null;
  }

  static getHisInterestByTime(assetName, bar_type, ts = Date.now()) {
    const cacheKey = `${assetName}_${bar_type}_${Math.floor(ts / this._chip_cache_duration)}`;
    // 检查缓存
    if (!this._interest_cache[cacheKey]) {
      this._cleanCache(this._interest_cache);
      const _interest_history = this._interest_history[assetName]?.[bar_type];
      // 找到 data 中 data.ts 离 ts 最近的元素，data 非有序
      let last = _interest_history[0];
      let minDiff = Math.abs(ts - last?.ts||0);
      for (let i = 1; i < _interest_history.length; i++) {
        const diff = Math.abs(ts - _interest_history[i].ts);
        if (diff < minDiff) {
          minDiff = diff;
          last = _interest_history[i];
        }
      }
      this._interest_cache[cacheKey] = last;
    }
    return this._interest_cache[cacheKey];
  }

  static getHisVolumeByTime(assetName, bar_type, ts = Date.now()) {
    const cacheKey = `${assetName}_${bar_type}_${Math.floor(ts / this._chip_cache_duration)}`;

    // 检查缓存
    if (!this._volume_cache[cacheKey]) {
      this._cleanCache(this._volume_cache);
      const candle_data = this.market_candle[bar_type]?.[assetName];
      // 找到 data 中 data.ts 离 ts 最近的元素，data 非有序
      let last = candle_data.at(-1);
      let minDiff = Math.abs(ts - last.ts);
      for (let i = 1; i < candle_data.length; i++) {
        const diff = Math.abs(ts - candle_data[i].ts);
        if (diff < minDiff) {
          minDiff = diff;
          last = candle_data[i];
        }
      }
      this._volume_cache[cacheKey] = last;
    }
    return this._volume_cache[cacheKey];
  }

  // 清理过期缓存
  static _cleanCache(cache) {
    const keys = Object.keys(cache);

    // 如果缓存项超过1000个，清理过期的
    if (keys.length > 15000) {
      keys.forEach(key => {
        delete cache[key];
      });
    }
  }

  //
  static setOpenInterest(assetName, bar_type, data) {
    // 按照 data.item[0] 去重
    const interest_map = new Map();
    data.forEach(it => {
      interest_map.set(it[0], it);
    });
    const unique_data = Array.from(interest_map.values()).map(it => {
      return {
        ts: it[0],
        oi: it[1],
        oiCcy: it[2],
        oiUsd: it[3],
      };
    });
    this._interest_history[assetName] ??= {};
    this._interest_history[assetName][bar_type] = unique_data;
  }

  /**
   * 获取品种信息
   * @param {string} assetName - 品种名称
   * @returns {Object|null} 品种信息
   */
  static getInstrumentInfo(assetName) {
    return this._instrument_info[assetName] || null;
  }

  /**
   * 创建网格交易处理器
   * @param {string} assetName - 交易资产名称
   * @param {object} params - 网格参数
   * @returns {GridTradingProcessor}
   */
  static createGridTrading(assetName, params = {}) {
    const instType = assetName.endsWith('-SWAP') ? 'SWAP' : 'SPOT';
    this._instrument_info[assetName] ??= null;
    this.registerInstrument(assetName, instType);
    const gp = new GridTradingProcessor(assetName, params, this);
    this.processors.push(gp);
    return gp;
  }
}
