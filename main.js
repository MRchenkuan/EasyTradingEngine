import WebSocket from 'ws'
import express from 'express'
import { findBestFitLine } from './src/regression.js'
import { paint } from './src/paint.js'
import { getPrices, dataset, toTrickTimeMark, formatTimestamp, getTsOfStartOfToday } from './src/tools.js'
import { calculateReturns } from './src/mathmatic.js'
import { writeKeyValuePair } from './src/recordBeta.js'
// const ws_connection_pool={}

// const ws_private = new WebSocket(base_url+'/ws/v5/private');
// const ws_business = new WebSocket(base_url+'/ws/v5/business');
// storeConnection('ws_business', ws_business);
// storeConnection('ws_private', ws_private);

const gate = 0.02;
const bar_type = '1m';
const price_type = 'close'
const once_limit = 300;
const candle_limit = 2400;
const assets = [
  {id: 'TRUMP-USDT', theme:'#abb2b9'},
  {id: 'SOL-USDT', theme:'#ad85e9'},
  {id: 'BTC-USDT', theme:'#f5b041'},
  {id: 'ETH-USDT', theme:'#85c1e9'},
]

const params = {
  bar_type,
  price_type,
  once_limit,
  candle_limit,
  // from_when: Date.now(),
  // from_when: new Date(2025,1,14,19,0,0).getTime(),
  to_when:new Date(2025,1,10,0,0,0).getTime(),
}

const assetIds = assets.map(it=>it.id);
const themes = assets.map(it=>it.theme);

const klines = await Promise.all(assetIds.map(async (it,id)=>await getPrices(it, params)));

const refer_kline = klines[0];
const x_label = toTrickTimeMark(refer_kline.ts.slice().reverse());

const beta_arr=[1];
const scaled_prices = klines.map((it,id)=>{
  const {prices, ts} = it;
  if(id==0) return dataset(prices);
  const {a, b} = findBestFitLine(prices, refer_kline.prices);
  writeKeyValuePair(formatTimestamp(Date.now()),a)
  console.log("拟合的多项式系数:", assetIds[id], {a, b});
  beta_arr.push(a);
  return dataset(prices.map(it=>a*it+b));


  // const {a, b} = {a:1,b:0};
  // return calculateReturns(dataset(prices.map(it=>it*a+b)))
})

paint(assetIds, scaled_prices, themes, x_label, gate, klines, beta_arr)

// const {prices:price_a, ts:ts_a} = await getPrices(assetIdA, params);
// const {prices:price_b, ts:ts_b} = await getPrices(assetIdB, params);

// const ds_price_b = dataset(price_b);
// const ds_price_a = dataset(price_a);

// const {a, b} = findBestFitLine(ds_price_a, ds_price_b);
// console.log("拟合的多项式系数:", {a, b});

// const ds_price_a_scaled = dataset(price_a.map(it=>it*a+b)); // ds_price_a
// const ds_price_b_scaled = ds_price_b;//dataset(price_b.map(it=>(c[0]+c[1]*it+c[2]*it^2+c[3]*it^3)));

// paint(
//   assetIdA, 
//   assetIdB, 
//   ds_price_a_scaled, 
//   ds_price_b_scaled,
//   toTrickTimeMark(ts_a.slice().reverse()),
//   {
//     gate
//   })








// ws_business.on('open', async () => {
//   console.log('ws_business已连接到服务器');
//   await subscribeKlineChanel(ws_business, 'candle1s', "BTC-USDT")
//   await subscribeKlineChanel(ws_business, 'candle1s', "SOL-USDT")
//   runAnalysis(ws_business);
// });


// ws_business.on('message', (message) => {
//   const {arg, data} = JSON.parse(message.toString())
//   if(arg.channel==='candle1s'){
//     if(data){
//       const {open, close} = parseCandleData(data[0])
//       console.log(`[${arg.instId}]:${close-open}`)
//     }
//   }
// });

// ws_business.on('close', () => {
//   console.log('ws_business连接已关闭');
// });


// ws_private.on('open', async () => {
//     console.log('已连接到服务器');
//     await doLogin(ws_private);
//     runTrading(ws_private);
// });

// ws_private.on('message', (message) => {
//     console.log(`收到服务器消息: ${message}`);
// });

// ws_private.on('close', () => {
//     console.log('连接已关闭');
// });


// 保存一个ws链接
// function storeConnection(conn_id, ws){
//   ws_connection_pool[conn_id] = ws;
// }




