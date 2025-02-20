import { batchOrders, getOrderInfo } from "./api.js"
import { readOpeningTransactions, recordClosingTransactions, recordOpeningTransactions } from "./recordTools.js"
import { hashString, parseOrderData } from "./tools.js"
import { generateCounterBasedId } from "./uuid.js";

/**
 * 开仓
 * @param {*} long 
 * @param {*} short 
 * @param {*} size 
 * @returns 
 */
export async function open_positions(long, short, size){
  const tradeId = hashString(generateCounterBasedId());

  const order_long = creaetOrder_market(long, size, 1)
  const order_short = creaetOrder_market(short, size, 0)

  // 下单
  console.log('开仓...',order_long, order_short)
  const {data=[]} = await batchOrders([ order_long, order_short ])

  let result = data.map(order=>{
    return parseOrderData(order);
  })

  result = Object.values(mergeOrder2Result([order_long,order_short, ...result]))

  let orderDetail = await Promise.all(result.map(async order=>{
    const {data=[]} = await getOrderInfo(order.instId, order.ordId)
    debugger
    return data[0]
  }));
  orderDetail = orderDetail.map(order=>{
    const {clOrdId,avgPx,ordId,sz,accFillSz} = order;
    return {clOrdId,avgPx,ordId,sz,accFillSz}
  })
  
  result = mergeOrder2Result([...result, ...orderDetail])
  console.log('开仓结果',result)

  // 有任何报错都撤单
  // TODO 撤单
  // 成功则记录订单信息
  recordOpeningTransactions(tradeId, Object.values(result))
  // 10秒后如果都未成交则撤单
  // TODO 超时撤单
  return tradeId;
}


/**
 * 平仓
 * @param {*} id 
 * @returns 
 */
export async function close_position(tradeId){
  
  const record = readOpeningTransactions(tradeId)
  
  // 需要做一些校验
  // todo 是否是开仓单等等
  const { orders } =record;
  const orders_info = orders.map(order=>{
    const {instId, side, avgPx:price, accFillSz:count } = order;
    debugger
    return creaetOrder_market(instId, count * price, side==='sell'?1:0);
  })

  console.log('平仓...', orders_info)
  const {data=[]} = await batchOrders(orders_info)
  let result = data.map(order=>{
    return parseOrderData(order);
  })
  result = mergeOrder2Result([...orders_info, ...result])

  const profit = 0
  console.log('平仓结果',result)

  // 有任何报错都撤单
  // TODO 撤单
  // 成功则记录订单信息
  recordClosingTransactions(tradeId, profit, Object.values(result))
  // 10秒后如果都未成交则撤单
  // TODO 超时撤单
  return 
}


function creaetOrder_limit(instId,price, size, side){
  return {
    instId,
    // "tdMode":side>0 ?"cash": 'isolated', // isolated
    "tdMode":side>0 ?"cash": 'cash', // isolated
    "side":side>0?"buy":"sell",
    "ordType":"limit",
    "px":price+"",
    "clOrdId":hashString(`${instId}${side}${price}${size}${Date.now()}`),
    "sz":size/price+""
  }
}

function creaetOrder_market(instId, size, side){
  return {
    instId,
    // "tdMode":side>0 ?"cash": 'isolated', // isolated
    "tdMode":side>0 ?"cash": 'cash', // isolated
    "side":side>0?"buy":"sell",
    "ordType":"market",
    "clOrdId":hashString(`${instId}${side}${size}${Date.now()}`),
    "sz":size+"",
    "tgtCcy": "quote_ccy", //base_ccy: 交易货币 ；quote_ccy：计价货币, 买单默认quote_ccy， 卖单默认base_ccy
  }
}

// open_positions('BTC-USDT','ETH-USDT', 10)

// setTimeout(()=)
close_position("c96a06c7")


function mergeOrder2Result(arr){
  const map = {};
  arr.map(it=>{
    map[it.clOrdId] = {...(map[it.clOrdId]||{}),...it};
  })
  return map
}