import { recordBetaMap } from "../recordTools.js";
import { findBestFitLine } from "../regression.js";
import { formatTimestamp, toTrickTimeMark } from "../tools.js";
import { HedgeProcessor } from "./HedgeProcessor.js";

export class TradeEngine{
  static processors = [];
  static market_data={}
  static realtime_price = {};
  static _main_asset = ""
  static _timer = {};
  static _bar_type = "";
  static _beta_map = {};

  /**
   * 工厂函数，创建监听器
   * @param {*} assetNames 
   */
  static createHedge(assetNames){
    const hp = new HedgeProcessor(assetNames)
    this.processors.push(hp);
    return hp;
  }

  /**
   * 刷新beta
   */
  static refreshBeta(){
    const mainAsset = this.getMainAsset();
    this._beta_map[mainAsset.id] = [1,0];
    Object.values(this.getAllMarketData()).map((it,id)=>{
      const {prices, ts, id:assetId} = it;
      if(assetId==this._main_asset) return;
      const {a, b} = findBestFitLine(prices, mainAsset.prices);
      console.log(`[${formatTimestamp(ts.at(-1))}]拟合的多项式系数(${assetId}):`, {a, b});
      this._beta_map[assetId] = [a, b];
    });
    recordBetaMap(this._beta_map);
    return this._beta_map;
  }


  /**
   * 渲染图片
   * @param {*} duration 
   */
  static renderGraph(duration){
    try{
      const refer_kline = this.getMainAsset();
      const x_label = toTrickTimeMark(refer_kline.ts);
      const klines = this.getAllMarketData();
      const scaled_prices = Object.values(klines).map((it,id)=>{
        const {prices, ts, id:assetId} = it;
        if(assetId==this._main_asset) return prices;
        const [a, b] = this._beta_map[assetId] || [1, 0];
        return prices.map(it=>a*it+b);
      });

      // // 绘制主图
      // paint(assetIds, scaled_prices, themes, x_label, gate, klines, beta_map, bar_type)
      
      // // 绘制每次开仓的截图
      // const opening_transactions = [...getLastTransactions(100,'opening')];
      // opening_transactions.map(({tradeId, })=>{
      //   paintTransactionSlice(tradeId, createMapFrom(assetIds, themes), x_label, klines, bar_type)
      // })
      
    }catch(e){
      console.log(e);
    }

    this._timer.render_graph = setTimeout(()=>{
      this.renderGraph(duration);
    }, duration)
  }

  /**
   * 设置主资产
   * @param {*} assetId 
   * @returns 
   */
  static setMainAsset(assetId){
    this._main_asset = assetId;
    return this.getMainAsset();
  }

  /**
   * 设置引擎基本信息
   * @param {*} param0 
   */
  static setMetaInfo({bar, main_asset}){
    if(bar) this._bar_type = bar;
    if(main_asset) this._main_asset = main_asset;
    this.refreshBeta();
    // dosmt
  }

  /**
   * 设置主资产
   * @param {*} assetId 
   * @returns 
   */
  static getMainAsset(){
    return this.market_data[this._bar_type][this._main_asset];
  }


  /**
   * 获取所有行情数据
   * @returns 
   */
  static getAllMarketData(bar_type){
    if(!bar_type) bar_type = this._bar_type;
    return this.market_data[bar_type];
  }

  /**
   * 获取资产的行情数据
   * @param {*} assetId 
   * @param {*} bar 
   * @returns 
   */
  static getMarketData(assetId, bar){
    if(!bar) bar = this._bar_type; 
    return this.market_data[bar][assetId];
  }

  /**
   * 获取资产实时价格
   * @param {*} assetId 
   * @returns 
   */
  static getPrice(assetId){
    return this.realtime_price[assetId];
  }

  /**
   * 更新时间价格序列
   * @param {*} assetId 资产标识
   * @param {*} price_arr 时间价格序列
   * @param {*} ts_arr 时间序列
   * @param {*} bar 数据粒度 1m 1H
   */ 
  static updatePrices(assetId, price_arr, ts_arr, bar){
    // 设置默认资产
    if(!this._main_asset) this._main_asset = assetId
    // 设置默认k线粒度
    if(!this._bar_type) this._bar_type = bar
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
      ts=parseFloat(ts);
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
      ts: sortedTimestamps,
      prices: sorted_prices
    };

    // 更新实时价格
    this.realtime_price[assetId] = sorted_prices.at(-1);
    this.refreshBeta()
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
  if(!this._main_asset) this._main_asset = assetId
  // 设置默认k线粒度
  if(!this._bar_type) this._bar_type = bar
  ts = parseFloat(ts);
  price = parseFloat(price)
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
      ts: []
    };
    assetData = this.market_data[bar][assetKey];
  }

  // 查找插入位置（要求现有数据已排序）
  const existingTs = assetData.ts;
  const existingPrices = assetData.prices;

  // 使用二分查找优化插入效率
  const insertionIndex = this._findInsertIndex(existingTs, ts);

  // 判断是否重复时间戳
  if (existingTs[insertionIndex] == ts) {
    // 覆盖已有数据
    existingPrices[insertionIndex] = price;
  } else {
    // 插入新数据
    existingTs.splice(insertionIndex, 0, ts);
    existingPrices.splice(insertionIndex, 0, price);
  }
  // 更新实时价格
  this.realtime_price[assetId] = existingPrices.at(-1);
  this.refreshBeta();
}

  /**
   * 二分查找插入位置（私有方法）
   * @param {number[]} sortedArray - 已排序数组
   * @param {number} value - 查找值
   * @returns {number} 插入位置索引
   */
  static _findInsertIndex(sortedArray, value) {
    let low = 0, high = sortedArray.length;
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


  /**
   * 监听
   */
  static start(){
    this._timer.start = setTimeout(()=>{
      // this.market_data['SOL-USDT']
      this.start()
    }, 1000);
  }

  static stop(){
    clearTimeout(this._timer)
  }

}


// const T1 = new HedgeTrigger(['SOL-USDT', 'TRUMP-USDT']);

// T1.listen();





