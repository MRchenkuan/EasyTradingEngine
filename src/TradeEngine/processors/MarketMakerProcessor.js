import { recordMarketMakerTransactions } from "../../recordTools";
import { calcProfit, hashString } from "../../tools";
import { createOrder_limit, executeOrders, mergeOrder2Result } from "../../trading";
import { generateCounterBasedId } from "../../uuid";
import { IProcessor } from "./IProcessor";

export class MarketMakerProcessor extends IProcessor{

  async bid(assetId, price, size, dir){
    const tradeId = hashString(generateCounterBasedId());
    let p1= 0,p2=0
    if(dir>0){
      p2=price*1.005;
      p1=price*1;
    }
    if(dir<0){
      p2=price*1;
      p1=price*0.995;
    }
  
    if(dir==0){
      p2=price*1.005;
      p1=price*0.995;
    }
  
    const order_short = createOrder_limit(assetId, p2, size/p2, 0)
    const order_long = createOrder_limit(assetId, p1, size/p1, 1)
  
    // 下单
    let result = await executeOrders([order_long, order_short])
    result = mergeOrder2Result([order_short, order_long, ...result])
    recordMarketMakerTransactions(tradeId, result)
    let order_details = await fetchOrders(result);
    order_details = mergeOrder2Result([...result,...order_details])
    recordMarketMakerTransactions(tradeId, order_details)
    const profit = calcProfit(order_details);
    return profit;
  }

}