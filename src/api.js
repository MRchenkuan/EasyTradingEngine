import axios from 'axios'
import * as mimic from './config.security.mimic.js'
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
