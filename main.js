import WebSocket from 'ws'
import express from 'express'
import { findBestFitLine } from './src/regression.js'
import { paint } from './src/paint.js'
import { getPrices, dataset, toTrickTimeMark, formatTimestamp, getTsOfStartOfToday, parseCandleData, throttleAsync, getLastWholeMinute } from './src/tools.js'
import { calculateReturns } from './src/mathmatic.js'
import { writeBetaValue } from './src/recordTools.js'
import { base_url } from './src/config.security.js'
import { subscribeKlineChanel } from './src/api.js'

const ws_connection_pool={}
const dkp={}

// const ws_private = new WebSocket(base_url+'/ws/v5/private');

// storeConnection('ws_private', ws_private);

const gate = 10.03;
const bar_type = '5m';
const price_type = 'close'
const once_limit = 300;
const candle_limit =1800;
const assets = [
  {id: 'SOL-USDT', theme:'#ad85e9'},
  {id: 'TRUMP-USDT', theme:'#abb2b9'},
  {id: 'ETH-USDT', theme:'#85c1e9'},
  {id: 'BTC-USDT', theme:'#f0b27a'},
  // {id: 'OKB-USDT', theme:'#85dde9'},
]

const params = {
  bar_type,
  price_type,
  once_limit,
  candle_limit,
  from_when: getLastWholeMinute(new Date()),
  to_when:new Date(2025,1,17,0,0,0).getTime(),
}

const assetIds = assets.map(it=>it.id);
const themes = assets.map(it=>it.theme);

const klines = await Promise.all(assetIds.map(async (it,id)=>await getPrices(it, params)));

printKlines(klines);

function printKlines(klines){
  try{
    const refer_kline = klines[0];
    const x_label = toTrickTimeMark(refer_kline.ts.slice().reverse());
  
    const beta_arr=[1];
    const scaled_prices = klines.map((it,id)=>{
      const {prices, ts} = it;
      if(id==0) return dataset(prices);
      const {a, b} = findBestFitLine(prices, refer_kline.prices);
      if(id==1) writeBetaValue(formatTimestamp(Date.now()),a)
      console.log(`[${formatTimestamp(ts[0])}]拟合的多项式系数:`, {a, b});
      beta_arr.push(a);
      return dataset(prices.map(it=>a*it+b));
    })
  
    paint(assetIds, scaled_prices, themes, x_label, gate, klines, beta_arr, bar_type)
  }catch(e){
    console.log(e);
    console.log(klines)
  }
}


const refreshKlineGraph = throttleAsync((dkp)=>{
  const klines_dynamic = [];
  assets.map((asset, id)=>{
    const instId = asset.id;
    if(!dkp[instId]) return;
    const additions_prices = Object.values(dkp[instId]).slice().reverse()
    const ts_arr = additions_prices.map(it=>it.ts);
    const price_arr = additions_prices.map(it=>it.price)

    const kline = klines[id];
    klines_dynamic[id] ??= { prices:[], ts:[]};
    klines_dynamic[id].prices = price_arr.concat(kline.prices)
    klines_dynamic[id].ts = ts_arr.concat(kline.ts)
    klines_dynamic[id].id = instId;
  })

  // 交易信号判断和处理

  if(klines_dynamic.every(it=>it) && klines_dynamic.length>=assets.length){
    printKlines(klines_dynamic);
  }
}, 5000);


const ws_business = new WebSocket(base_url+'/ws/v5/business');
storeConnection('ws_business', ws_business);

ws_business.on('open', () => {
  console.log('ws_business已连接到服务器');
  assets.map(async it=>{
    await subscribeKlineChanel(ws_business, 'candle'+bar_type, it.id);
  })
});


ws_business.on('message', (message) => {
  const {arg={}, data} = JSON.parse(message.toString())
  const {channel, instId} = arg;
  if(channel.indexOf('candle')===0){
    if(data){
      const {open, close,ts} = parseCandleData(data[0])
      dkp[instId] ??= { };
      dkp[instId][formatTimestamp(ts)] = {price:close, ts};
      refreshKlineGraph(dkp);
    }
  }
});

ws_business.on('close', (code, reason) => {
  console.log(`ws_business连接已关闭, 关闭码: ${code}, 原因: ${reason}`);
});

// ws_private.on('open', async () => {
//     console.log('已连接到服务器');
//     await doLogin(ws_private);
//     runTrading(ws_private);
// });

// ws_private.on('message', (message) => {
//     console.log(`收到服务器消息: ${message}`);
// });

// ws_business.on('close', (code, reason) => {
//   console.log(`ws_business连接已关闭, 关闭码: ${code}, 原因: ${reason}`);
// });


// 保存一个ws链接
function storeConnection(conn_id, ws){
  ws_connection_pool[conn_id] = ws;
}

