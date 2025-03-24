import axios from 'axios'
import * as mimic from './config.security.mimic.js'
import * as firm from './config.security.js'
import { generateSignature } from './tools.js';

const base_url = 'https://www.okx.com'


export async function marketCandles(instId, bar, after, before, limit){
  const {data} = await axios.get(base_url+'/api/v5/market/candles', {
    params:{
      instId,bar, after, before, limit
    },
  })
  return data;
}

export async function marketCandlesHistory(instId,bar, after, before, limit){
  return axios.get(base_url+'/api/v5/market/history-candles', {
    params:{
      instId,bar, after, before, limit
    },
  })
}


/**
 * 获取订单信息 - 实盘
 * @param {Object} params 查询参数
 * @param {String} params.instType 产品类型 SPOT/MARGIN/SWAP/FUTURES/OPTION
 * @param {String} [params.uly] 标的指数
 * @param {String} [params.instFamily] 交易品种
 * @param {String} [params.instId] 产品ID
 * @param {String} [params.ordType] 订单类型
 * @param {String} [params.state] 订单状态
 * @param {String} [params.category] 订单种类
 * @param {String} [params.after] 请求此ID之前的分页内容
 * @param {String} [params.before] 请求此ID之后的分页内容
 * @param {String} [params.begin] 开始时间戳
 * @param {String} [params.end] 结束时间戳
 * @param {String} [params.limit] 返回结果数量，默认100
 */
export async function getOrderHistory(params = {}) {
  const timestamp = new Date().toISOString();
  const method = 'GET';
  const requestPath = '/api/v5/trade/orders-history-archive';
  
  // 构建查询字符串
  const queryString = Object.entries(params)
    .filter(([_, value]) => value !== undefined)
    .map(([key, value]) => `${key}=${value}`)
    .join('&');
    
  const fullPath = queryString ? `${requestPath}?${queryString}` : requestPath;
  
  const sign = generateSignature(timestamp, method, fullPath, '', firm.api_secret);

  const headers = {
    'OK-ACCESS-KEY': firm.api_key,
    'OK-ACCESS-SIGN': sign,
    'OK-ACCESS-TIMESTAMP': timestamp,
    'OK-ACCESS-PASSPHRASE': firm.pass_phrase
  };

  try {
    const { data } = await axios.get(base_url + fullPath, { headers });
    return data;
  } catch (error) {
    console.error('获取订单历史失败:', error.response?.data || error.message);
    throw error;
  }
}



// 批量订单交易
export async function batchOrders(orders){
  const timestamp = new Date().toISOString();
  const method = 'POST';
  const requestPath = '/api/v5/trade/batch-orders';
  const body = JSON.stringify(orders);
  const sign = generateSignature(timestamp, method, requestPath, body, mimic.api_secret);

  const headers = {
    'Content-Type': 'application/json',
    'OK-ACCESS-KEY': mimic.api_key,
    'OK-ACCESS-SIGN': sign,
    'OK-ACCESS-TIMESTAMP': timestamp,
    'OK-ACCESS-PASSPHRASE': mimic.pass_phrase,
    "x-simulated-trading":1
  };
  const {data} = await axios.post(base_url+requestPath, orders, {
    headers
  })
  return data;
}


// 获取订单信息
export async function getOrderInfo(instId, ordId){
  const timestamp = new Date().toISOString();
  const method = 'GET';
  const requestPath = `/api/v5/trade/order?ordId=${ordId}&instId=${instId}`;
  const sign = generateSignature(timestamp, method, requestPath, "", mimic.api_secret);

  const headers = {
    'OK-ACCESS-KEY': mimic.api_key,
    'OK-ACCESS-SIGN': sign,
    'OK-ACCESS-TIMESTAMP': timestamp,
    'OK-ACCESS-PASSPHRASE': mimic.pass_phrase,
    "x-simulated-trading":1
  };
  const {data} = await axios.get(base_url+requestPath, {
    headers
  })

  return data;
}



// 登录函数
export async function doLogin(ctx){

  // 准备登录请求
  const timestamp = Math.round(Date.now()/1000).toFixed(3);
  const method = 'GET';
  const requestPath = '/users/self/verify';
  const body = ''; // WebSocket登录请求没有body
  const sign = generateSignature(timestamp, method, requestPath, body, api_secret);
  await ctx.send(JSON.stringify({
    "op": "login",
    "args":
     [
        {
          apiKey: api_key,
          passphrase: pass_phrase,
          timestamp,
          sign
         }
      ]
   }))
}


export async function subscribeKlineChanel(ws, channel, instId){
  ws.send(JSON.stringify({
    "op":"subscribe",
    "args":[
      {
          "channel":channel,
          "instId": instId
      }
    ]
  }))
}
