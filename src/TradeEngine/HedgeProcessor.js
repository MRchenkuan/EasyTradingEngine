import { IProcessor } from "./IProcessor.js";
import crypto from 'crypto';

export class HedgeProcessor extends IProcessor{
  
  assetNames = [];

  constructor(assetNames){
    super(assetNames);
    this.id=hashString(`${Date.now()}${assetNames.join('')}`)
    this.assetNames = assetNames;
  }

  calculateProfit(){

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