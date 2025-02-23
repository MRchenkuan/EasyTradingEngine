import { batchOrders, getOrderInfo } from "./api.js"
import { readLastBeta, readOpeningTransactions, recordClosingTransactions, recordOpeningTransactions, updateTransaction } from "./recordTools.js"
import { hashString, parseOrderData } from "./tools.js"
import { generateCounterBasedId } from "./uuid.js";



// 订单执行器（通用下单逻辑）
async function executeOrders(orderList) {
  const {data=[]} = await batchOrders(orderList)
  let result = mergeOrder2Result([...orderList, ...data])
  let orderDetails = await Promise.all(result.map(async order=>{
    const {data=[]} = await getOrderInfo(order.instId, order.ordId)
    return data[0];
  }));
  // 处理和过滤下订单数据
  orderDetails = processOrderDetail(orderDetails)
  debugger
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
  const order_long = createOrder_limit(long, price_long, size, 1)
  const order_short = createOrder_limit(short, price_short, size, 0)

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
    "px":price+"",
    "sz":size/price+"",
    "clOrdId":hashString(`${instId}${side}${price}${size}${Date.now()}`),
  }
}

function createOrder_market(instId, size, side, is_base_ccy){
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

function calcProfit(orders){
  let fee_usdt = 0,cost = 0,sell=0
  orders.map(order=>{
    const {
      side,// 方向  sell buy
      sz,// 交易了多少金额
      accFillSz,// 交易了多少数量
      avgPx,// 交易的平均价格
      fee,// 平台收取的手续费，为负数 //卖的手续费为USTD, 买的为本币
      tgtCcy,//
      feeCcy,
    } = order
    
    // 单位 false:本币; true:usdt
    const unit_fgt = tgtCcy === 'base_ccy'?false:true;
    const unit_fee = feeCcy === 'USDT'?true:false;

    if(side==='buy'){
      cost += unit_fgt ? parseFloat(sz) : parseFloat(sz * avgPx);
    }
    if(side==='sell'){
      sell += unit_fgt ? parseFloat(sz) : parseFloat(sz * avgPx);
    }
    fee_usdt += unit_fee ? parseFloat(fee) : parseFloat(fee * avgPx)
  })
  console.log(`计算盈利: 总买单${cost}, 总卖单${sell},总手续费${fee_usdt}, 利润${sell - cost + fee_usdt}`)
  return sell - cost + fee_usdt;
}




// 标准化订单参数
function processOrderDetail(orderDetail){
  return orderDetail.map(order=>{
    const {instId,clOrdId,avgPx,px, ordId,sz,accFillSz, fee,feeCcy} = order;
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
    }
  })
}


const tradeId = await open_positions('ETH-USDT','SOL-USDT',300)
// const tradeId = await open_positions('SOL-USDT','BTC-USDT',10)
// const tradeId = await open_positions('SOL-USDT','ETH-USDT',200)
// const tradeId = await open_positions('ETH-USDT','BTC-USDT',200)
// const tradeId = await open_positions('BTC-USDT', 'ETH-USDT',200);
// const tradeId = await open_positions_limit('BTC-USDT', 'ETH-USDT',91000, 3500, 20)
// setTimeout(()=>{
//   close_position(tradeId)
// },1000)


// close_position("bc4fcd25")
