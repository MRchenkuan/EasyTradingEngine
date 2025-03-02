import { getLastTransactions, updateTransaction } from "../recordTools.js";
import { IProcessor } from "./IProcessor.js";
import crypto from 'crypto';
import { TradeEngine } from "./TradeEngine.js";

export class HedgeProcessor extends IProcessor{
  
  asset_names = [];
  opening_transactions=[];
  engine = null;
  _open_gate = 0.045;// 开仓门限
  _close_gate = 0.005;// 平仓-重置门限
  _timer = {};
  _prev_diff_rate = 0;
  /**
   * 
   * @param {*} assetNames 
   */
  constructor(asset_names, engine){
    super(asset_names);
    this.engine = engine;
    this.id=hashString(`${Date.now()}${asset_names.join('')}`)
    this.asset_names = asset_names;
    

    // 轮询本地仓单
    this.refreshOpeningTrasactions();
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

  // 轮询本地仓单
  refreshOpeningTrasactions(){
    this.opening_transactions = this._getOpenTransactions();
    clearTimeout(this._timer.refresh_opening_trans)
    // 轮询
    this._timer.refresh_opening_trans = setTimeout(()=>{
      this.refreshOpeningTrasactions();
    }, 1000)
  }

  /**
   * 获取已存在的开仓记录
   */
  _getOpenTransactions() {
    const assetSet = new Set(this.asset_names);
    const transList = getLastTransactions(100, 'opening');
    return transList.filter(tran => {

        const orderAssets = new Set(tran.orders.map(item => item.instId));
        return Array.from(assetSet).every(asset => orderAssets.has(asset));
    });
  }

  /**
   * 时间触发器
   */
  tick(args){
    // console.log('tick', this.asset_names , args.realtime_prices)
    // 检查各个仓单当前是否已经收敛 gate为 0.5
    this.captureClosing(args);
    // 检查当前是否有开仓机会
    this.captureOpening(args);
  }



  /**
   * 捕捉平仓机会
   * @param {} args 
   */
  captureClosing(args){

    // transactions.forEach(({ orders, profit, closed, side: transaction_side }) => {
    //   const [order1, order2] = orders;
    //   const { ts: ts1, avgPx: px1, instId: instId1, sz: sz1, side: side1, tgtCcy:tgtCcy1, beta:beta1, } = order1;
    //   const { ts: ts2, avgPx: px2, instId: instId2, sz: sz2, side: side2, tgtCcy:tgtCcy2, beta:beta2, } = order2;

      
    //   // 计算实时标准化价格
    //   const spx1 = px1 * betaMap[instId1][0] + betaMap[instId1][1];
    //   const spx2 = px2 * betaMap[instId2][0] + betaMap[instId2][1];

    //   // 计算开仓时标准化价格
    //   const fspx1 = px1 * beta1[0] + beta2[1];
    //   const fspx2 = px2 * beta2[0] + beta2[1];

  
    //   // 计算价差比率
    //   const diffRate = TradeEngine._calcPriceGapProfit(fspx1, fspx2, (fspx1+fspx2)/2);


    // })


    const close_gate = this._close_gate;

    /**
     * 关于 betaMap 这里需要考虑一个问题
     * 如果按照开仓时的对冲比平仓，可以确保利润，可能等的时间更长，也可能牺牲超额利润
     * 如果照当前实时的对冲比平仓，可以快速平仓，可能牺牲利润，也可能获得超额利润
     *  */ 
    const betaMap = this.engine._beta_map;
    const [instId1, instId2] = this.asset_names;
    const [px1, px2] = this.asset_names.map(assetId=>this.engine.getPrice(assetId));
  
    if(!px1 || !px2){
      return false;
    }

    // 计算实时标准化价格
    const spx1 = px1 * betaMap[instId1][0] + betaMap[instId1][1];
    const spx2 = px2 * betaMap[instId2][0] + betaMap[instId2][1];

    // 计算价差比率
    const diff_rate = TradeEngine._calcPriceGapProfit(spx1, spx2, (spx2+spx2)/2);

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
    const [px1, px2] = this.asset_names.map(assetId=>this.engine.getPrice(assetId));
  
    if(!px1 || !px2){
      return false;
    }

    // 计算实时标准化价格
    const spx1 = px1 * betaMap[instId1][0] + betaMap[instId1][1];
    const spx2 = px2 * betaMap[instId2][0] + betaMap[instId2][1];

    // 计算价差比率
    const diff_rate = TradeEngine._calcPriceGapProfit(spx1, spx2, (spx2+spx2)/2);
    
    // 判断是否超过门限
    if(!open_gate) return;
    // 交易信号生成
    if(diff_rate < open_gate){
      //没有达到门限











      const transactions = this._getOpenTransactions()

      // transactions.
      // 先看 transition 中有没有同方向的小于当前距离*1.5的，且未平仓的
      // 另外最多保持10秒一单，不能超了
      // 如果有则不管
      // 如果没有则直接开仓











      if(this._prev_diff_rate){
        // 有前次门限
        if(diff_rate<=close_gate){
          // 如果当前距离足够小，则认为已经收敛，重置门限，重新开仓
          this._prev_diff_rate=0;
        }
      }
      return;
    } else {
      // 达到门限
      if(this._prev_diff_rate){
        // 再次达到门限，超上次 n 倍
        if(diff_rate > this._prev_diff_rate*1.5){
          this._prev_diff_rate = diff_rate;
          console.log("------------开仓---------------")
        }else{
          // 没超则过
          return;                  
        }
      }else{
        // 首次达到门限
        this._prev_diff_rate = diff_rate
        console.log("------------开仓---------------")
      }
    }
    this._prev_diff_rate = diff_rate
    console.log("------------开仓---------------")
  }


  calculateProfit(){

  }

  renderGraph(chart){

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

  /**
   * 开仓
   */

  openTransaction(){

  }

  /**
   * 平仓
   */

  closeTransaction(){

  }

}

// 生成hash
function hashString(input,length=8) {
  const hash = crypto.createHash('sha256');
  hash.update(input);
  const fullHash = hash.digest('hex');
  return fullHash.substring(0, length); // 截取前16位
}