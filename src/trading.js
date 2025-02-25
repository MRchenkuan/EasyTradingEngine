import { batchOrders, getOrderInfo } from "./api.js"
import { readLastBeta, readOpeningTransactions, readPrice, recordClosingTransactions, recordMarketMakerTransactions, recordOpeningTransactions, updateTransaction } from "./recordTools.js"
import { calcProfit, hashString, parseOrderData } from "./tools.js"
import { generateCounterBasedId } from "./uuid.js";



// 订单执行器（通用下单逻辑）
export async function executeOrders(orderList) {
  const {data=[]} = await batchOrders(orderList)
  let result = mergeOrder2Result([...orderList, ...data])
  let orderDetails = await Promise.all(result.map(async order=>{
    const {data=[]} = await getOrderInfo(order.instId, order.ordId)
    return data[0];
  }));
  // 处理和过滤下订单数据
  orderDetails = processOrderDetail(orderDetails)
  console.log('下单完成..',orderDetails)
  return mergeOrder2Result([...result, ...orderDetails,])
}

/**
 * 市价开仓
 * @param {*} long 
 * @param {*} short 
 * @param {*} size 
 * @returns 
 */
export async function open_positions(long, short, size){
  const tradeId = hashString(generateCounterBasedId());
  const beta = readLastBeta();
  const order_long = createOrder_market(long, size, 1)
  const order_short = createOrder_market(short, size, 0)

  // 下单
  const result = await executeOrders([order_long, order_short])
  // 有任何报错都撤单
  // TODO 撤单
  // 成功则记录订单信息
  recordOpeningTransactions(tradeId, result, beta)
  // 10秒后如果都未成交则撤单
  // TODO 超时撤单
  return tradeId;
}


/**
 * 限价开仓
 * @param {*} long 
 * @param {*} short 
 * @param {*} size 
 * @returns 
 */
export async function open_positions_limit(long, short, price_long, price_short, size){
  const tradeId = hashString(generateCounterBasedId());
  const beta = readLastBeta();
  const order_long = createOrder_limit(long, price_long, size/price_long, 1)
  const order_short = createOrder_limit(short, price_short, size/price_short, 0)

  // 下单
  const result = await executeOrders([order_long, order_short])
  // 有任何报错都撤单
  // TODO 撤单
  // 成功则记录订单信息
  recordOpeningTransactions(tradeId, result, beta)
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
  
  const openingRecord = readOpeningTransactions(tradeId)
  // 需要做一些校验
  if(!openingRecord) throw new Error('平仓单不存在');
  if(openingRecord.closed){
    console.warn('不能重复对订单平仓')
    return;
  }
  // todo 是否是开仓单等等
  const { orders:opening_orders } =openingRecord;

  // 创建订单参数
  const beta = readLastBeta();
  const orders_info = opening_orders.map(opening_order=>{
    // todo 严谨来说需要做各种单位判断
    const {instId, side, avgPx:price, accFillSz:count, clOrdId } = opening_order;
    return createOrder_market(instId, count, side==='sell'?1:0, true);
  })

  console.log('平仓...', orders_info)
  const result = await executeOrders(orders_info)

  // 计算利润
  const profit = calcProfit([...opening_orders, ...result]);

  // 更新订单记录
  updateTransaction(tradeId, 'opening', {"closed":true,"profit":profit})
  updateTransaction(tradeId, 'closing', {"profit":profit})

  // 有任何报错都撤单
  // TODO 撤单
  // 成功则记录订单信息
  recordClosingTransactions(tradeId, profit, result, beta)
  // 10秒后如果都未成交则撤单
  // TODO 超时撤单
  return 
}


function createOrder_limit(instId, price, size, side){
  return {
    instId,
    // "tdMode":side>0 ?"cash": 'isolated', // isolated
    "tdMode":side>0 ?"cash": 'cash', // isolated
    "side":side>0?"buy":"sell",
    "ordType":"limit",
    "clOrdId":hashString(`${instId}${side}${size}${Date.now()}`),
    "px":price+"",
    "sz":size+"",
    "clOrdId":hashString(`${instId}${side}${price}${size}${Date.now()}`),
  }
}

export function createOrder_market(instId, size, side, is_base_ccy){
  return {
    instId,
    // "tdMode":side>0 ?"cash": 'isolated', // isolated
    "tdMode":side>0 ?"cash": 'cash', // isolated
    "side":side>0?"buy":"sell",
    "ordType":"market",
    "clOrdId":hashString(`${instId}${side}${size}${Date.now()}`),
    "sz":size+"",
    "tgtCcy": is_base_ccy?"base_ccy":"quote_ccy", //base_ccy: 交易货币 ；quote_ccy：计价货币, 买单默认quote_ccy， 卖单默认base_ccy
  }
}

// 合并订单结果
function mergeOrder2Result(arr){
  const map = {};
  arr.map(it=>{
    map[it.clOrdId] = {...(map[it.clOrdId]||{}),...it};
  })
  return Object.values(map);
}


// 标准化订单参数
function processOrderDetail(orderDetail){
  return orderDetail.map(order=>{
    const {instId, clOrdId,avgPx,px, ordId,sz,accFillSz, fee,feeCcy, tgtCcy, state} = order;
    return {
      instId,
      clOrdId,
      px,// 委托均价
      avgPx, // 成交均价
      ordId,
      sz,// 委托份数
      accFillSz,// 成交份数
      fee,// 费用
      feeCcy,
      tgtCcy,
      state, // canceled：撤单成功 live：等待成交 partially_filled：部分成交 filled：完全成交 mmp_canceled：做市商保护机制导致的自动撤单
    }
  })
}


export async function marketMaker(assetId, price, size, dir){
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


async function fetchOrders(orders){
  let orderDetails = await Promise.all(orders.map(async order=>{
    const {data=[]} = await getOrderInfo(order.instId, order.ordId)
    return data[0];
  }));
  if(orderDetails.every(order=>order.state ==='filled')){
    return orderDetails;
  } else {
    await new Promise(resove=>setTimeout(resove, 3000));
    return await fetchOrders(orders);
  }
}



// const tradeId = await open_positions('ETH-USDT','SOL-USDT',300)
// await open_positions('SOL-USDT','BTC-USDT',400)
// const tradeId = await open_positions('SOL-USDT','ETH-USDT',300)
// const tradeId = await open_positions('TRUMP-USDT','SOL-USDT',300)
// await open_positions('ETH-USDT','BTC-USDT',400)
// const tradeId = await open_positions('BTC-USDT', 'ETH-USDT',200);
// setTimeout(()=>{
//   close_position(tradeId)
// },1000)


close_position("5f5271c0")

// const profit = await marketMaker('SOL-USDT', readPrice('SOL-USDT'), 100, 0)