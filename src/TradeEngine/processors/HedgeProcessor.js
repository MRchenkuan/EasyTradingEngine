import { getLastTransactions, updateTransaction } from "../../recordTools.js";
import { AbstractProcessor } from "./AbstractProcessor.js";
import crypto from 'crypto';
import { TradeEngine } from "../TradeEngine.js";
import { calcProfit, formatTimestamp } from "../../tools.js";
import { close_position, open_positions } from "../../trading.js";
import { LocalVariable } from "../../LocalVariable.js";

export class HedgeProcessor extends AbstractProcessor{
  
  asset_names = [];
  opening_transactions=[];
  engine = null;
  type = 'HedgeProcessor'
  _open_gate = 0.045;// 开仓门限
  _close_gate = 0.003;// 平仓-重置门限
  _timer = {};
  _position_size = 10; // 10 usdt
  /**
   * 
   * @param {*} assetNames 
   */
  constructor(asset_names, size, gate, engine){
    super();
    this.engine = engine;
    this.id=hashString(`${Date.now()}${asset_names.join('')}`)
    this.asset_names = asset_names;
    this._open_gate = gate; // 门限大小
    this._position_size = size; // 头寸规模
    this.local_variables = new LocalVariable(`HedgeProcessor/${this.asset_names.sort().join(":")}`);
    
    // 轮询本地头寸
    this.refreshOpeningTrasactions();
  }

  get _prev_diff_rate(){
    this.local_variables._prev_diff_rate??=0;
    return this.local_variables._prev_diff_rate;
  }

  set _prev_diff_rate(v){
    this.local_variables._prev_diff_rate = v
  }


  /**
   * 获取两个对冲资产的价格
   * @returns 
   */
  getHedgePrices(){
    return this.asset_names.map(asset_name=>{
      return this.engine.getMarketData(asset_name)
    })
  }

  // 轮询本地未平仓头寸
  refreshOpeningTrasactions(){
    this.opening_transactions = this._getTransactions({side:'opening'});
    clearTimeout(this._timer.refresh_opening_trans);
    // 轮询
    this._timer.refresh_opening_trans = setTimeout(()=>{
      this.refreshOpeningTrasactions();
    }, 1000)
  }

  /**
   * 获取已存在的开仓记录
   */
  _getTransactions({ closed = false, side = '' } = {}) {
    const assetSet = new Set(this.asset_names);
    const transList = getLastTransactions(100, side);
    return transList.filter(tran => {
      // 筛选closed状态
      if (closed && !tran.closed) return false;
      if (!closed && tran.closed) return false;
      // 检查orders是否为有效数组
      if (!Array.isArray(tran.orders)) return false;
      // 提取订单中的资产
      const orderAssets = new Set(tran.orders.map(item => item.instId));
      // 确认包含所有当前资产
      return Array.from(assetSet).every(asset => orderAssets.has(asset));
    });
  }

  /**
   * 时间触发器
   * @param {*} args 引擎的上下文
   * @implements
   */
  tick(args){
    // console.log('tick', this.asset_names , args.realtime_prices)
    // 检查各比头寸当前是否已经收敛 gate为 0.5
    this.captureClosing(args);
    // 检查当前是否有开仓机会
    this.captureOpening(args);
  }

  /**
   * 捕捉平仓机会
   * @param {} args 
   */
  captureClosing(args){
    const transactions = this._getTransactions({side:'opening'});

    //遍历所有未平仓的头寸，根据当前价格和历史beta计算是否关闭
    transactions.forEach(({ tradeId, orders }) => {
      const close_gate = this._close_gate;
      /**
       * 关于平仓条件 betaMap 这里需要考虑一个问题
       * 如果按照开仓时的对冲比平仓，可以确保利润，可能等的时间更长，也可能牺牲超额利润
       * 如果照当前实时的对冲比平仓，可以快速平仓，可能牺牲利润，也可能获得超额利润
       *  */
      /* 这里为按开仓对冲比平仓，确保利润 */
      const betaMap_fixed = Object.fromEntries(orders.map(({ instId, beta }) => [instId, beta]));
      /* 这里为按照实时对冲比平仓，只要不亏利润（!!!由于滑点的存在，可能仍然会亏滑点） */
      const betaMap_realtime = this.engine._beta_map;
      
      const [instId1, instId2] = this.asset_names;
      const [px1, px2] = this.asset_names.map(assetId=>this.engine.getRealtimePrice(assetId));
    
      if(!px1 || !px2){
        return false;
      }

      const n = this.engine._normalizePrice;
      // 固定标准化价格
      const spx1_fixed = n(px1, betaMap_fixed[instId1]);
      const spx2_fixed = n(px2, betaMap_fixed[instId2]);
      // 固定价差比率
      const diff_rate_fixed = TradeEngine._calcPriceGapProfit(spx1_fixed, spx2_fixed, (spx1_fixed+spx2_fixed)/2);

      // 动态标准化价格
      const spx1_realtime = n(px1, betaMap_realtime[instId1]);
      const spx2_realtime = n(px2, betaMap_realtime[instId2]);
      // 动态价差比率
      const diff_rate_realtime = TradeEngine._calcPriceGapProfit(spx1_realtime, spx2_realtime, (spx1_realtime+spx2_realtime)/2);

      /**
       * 最终还是需要两个结合，优先能平仓，且不亏钱
       * 不论是哪个 betaMap（现价也好，开仓价也好） 如果能平且没亏就平
       * 两种价差比率有一种达到门限，即平仓，确保尽快平仓避免资金占用
       * 不必担心开仓即平仓，因为一般来说开仓后的β不会发生大的变化
       * 而长时间后，尽管β发生变化，但我们的平仓目的不再是盈利而是避免资金占用，因此尽快平仓
       *  */ 

      if(diff_rate_fixed <= close_gate || diff_rate_realtime <= close_gate){
        // 平仓
        const profit = this.engine._calcRealtimeProfit(orders);
        if(profit>0){
          close_position(tradeId);
        } else {
          console.log(`[${tradeId}][${orders.map(it=>it.instId).join('->')}]满足平仓条件：固定${(diff_rate_fixed*100).toFixed(2)}% or 实时${(diff_rate_realtime*100).toFixed(2)}% <= 门限${(close_gate*100).toFixed(2)}% 但利润为负:$${profit.toFixed(2)}`)
        }       
      }

    })
  }

  /**
   * 捕捉开仓机会
   * @param {*} args 
   */
  captureOpening(args){

    const open_gate = this._open_gate;
    const close_gate = this._close_gate;
    const betaMap = this.engine._beta_map;
    const [instId1, instId2] = this.asset_names;
    const [px1, px2] = this.asset_names.map(assetId=>this.engine.getRealtimePrice(assetId));
  
    if(!px1 || !px2){
      return false;
    }

    // 计算实时标准化价格
    const spx1 = px1 * betaMap[instId1][0] + betaMap[instId1][1];
    const spx2 = px2 * betaMap[instId2][0] + betaMap[instId2][1];

    // 计算价差比率
    const diff_rate = TradeEngine._calcPriceGapProfit(spx1, spx2, (spx1+spx2)/2);
    
    // 判断是否超过门限
    if(!open_gate) return;
    // 交易信号生成
    console.log(`${instId1}:${instId2}开仓门限${(open_gate*100).toFixed(2)}, 当前${(diff_rate*100).toFixed(2)}，前次${(this._prev_diff_rate*100).toFixed(2)}`)
    if(diff_rate < open_gate){
      //没有达到门限
      if(this._prev_diff_rate){
        // 有前次门限
        if(diff_rate<=close_gate){
          // 如果当前距离足够小，则认为已经收敛，重置门限，准备重新开仓
          console.log(`${this._prev_diff_rate}门限过小，进行重置`)
          this._prev_diff_rate=0;
        }
      }
      return;
    } else {

      // 先看 transition 中有没有同方向的小于当前距离*1.5的，且未平仓的
      // 另外最多保持10秒一单，不能超了
      // 如果有则不管
      // 如果没有则直接开仓
      // todo 遇到的一个问题是当滑点严重时，重启程序会重新开仓，需要记录开仓距离
      let transactions = this._getTransactions({ closed:false, side: 'opening' });
      
      if(spx1>spx2){
        transactions = transactions.filter(({orders})=>{
          return orders.every(({instId, side})=>{
            return side === {
              [instId1]:'sell',
              [instId2]:'buy'
            }[instId]; // 同方向
          })
        }).sort((a, b) => a.ts - b.ts);
      } else {
        transactions = transactions.filter(({orders})=>{
          return orders.every(({instId, side})=>{
            return side === {
              [instId1]:'buy',
              [instId2]:'sell'
            }[instId]; // 同方向
          })
        }).sort((a, b) => a.ts - b.ts);
      }
      
      const prev_transactions = transactions.at(-1);
      // 如果查询到之前有开平仓记录，则与当前进行比较
      if(prev_transactions){
        console.log(`最近一次开仓:${formatTimestamp(prev_transactions.ts)},${prev_transactions.orders.map(o=>[o.instId, o.side, o.sz, o.avgPx])}`)
        const [pt_px1, pt_px2] = prev_transactions.orders.map(it=>it.avgPx)
        if(pt_px1 && pt_px2){// 如果价格存在则表示开仓订单正常
          const [beta1, beta2] = prev_transactions.orders.map(it=>it.beta)
          const [spt_px1, spt_px2]=[pt_px1*beta1[0]+beta1[1], pt_px2*beta2[0]+beta2[1]];
          const prev_transactions_diff_rate = TradeEngine._calcPriceGapProfit(spt_px1, spt_px2, (spt_px1+spt_px2)/2)

          console.log(`最近一次开仓的 diff_rate：${(prev_transactions_diff_rate*100).toFixed(2)}, 最近一次记录的最大值为：${(this._prev_diff_rate*100).toFixed(2)}`)
          // 此处 max 一下是为了避免交易滑点导致成交距离小于预期距离，进而导致下一次重复交易
          this._prev_diff_rate = Math.max(this._prev_diff_rate, prev_transactions_diff_rate)
        }
      }

      // 达到门限
      if(this._prev_diff_rate){
        // 前次达到过，再次达到门限，超上次 n 倍
        if(diff_rate > this._prev_diff_rate*1.5){
          ;spx1 > spx2
          ? open_positions(instId1, instId2, this._position_size)
          : open_positions(instId2, instId1, this._position_size)
          console.log(`-----再次达到门限，${diff_rate}超上次(${this._prev_diff_rate}) n 倍-------开仓----long:${spx1 > spx2?instId2:instId1}-----short:${spx1 < spx2?instId2:instId1}------`)
          this._prev_diff_rate = diff_rate;
          return
        }else{
          // 没超则过
          return;                  
        }
      }else{
        // 首次达到门限
        console.log(`------首次达到门限------开仓----long:${spx1 > spx2?instId2:instId1}-----short:${spx1 < spx2?instId2:instId1}------`)
        ;spx1 > spx2
        ? open_positions(instId1, instId2, this._position_size)
        : open_positions(instId2, instId1, this._position_size)
        this._prev_diff_rate = diff_rate;
        return;
      }
    }
  }


  /**
   * 设置主资产
   * @param {*} assetId 
   * @returns 
   */

  setMainAsset(assetId){
    // this.market_data = assetId;
    // return this.market_data[assetId];
  }

}

// 生成hash
function hashString(input,length=8) {
  const hash = crypto.createHash('sha256');
  hash.update(input);
  const fullHash = hash.digest('hex');
  return fullHash.substring(0, length); // 截取前16位
}