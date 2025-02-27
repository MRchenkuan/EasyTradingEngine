import WebSocket from 'ws'
import express from 'express'
import { findBestFitLine } from './src/regression.js'
import { paint, paintTransactionSlice } from './src/paint.js'
import { getPrices, toTrickTimeMark, formatTimestamp, getTsOfStartOfToday, parseCandleData, throttleAsync, getLastWholeMinute, createMapFrom } from './src/tools.js'
import { calculateReturns } from './src/mathmatic.js'
import { getLastTransactions, readOpeningTransactions, recordBetaMap, recordPrice, updateTransaction } from './src/recordTools.js'
import { base_url } from './src/config.security.js'
import { subscribeKlineChanel } from './src/api.js'
import { TradeEngine } from './src/TradeEngine/TradeEngine.js'

const ws_connection_pool={}
const dkp={}

// const ws_private = new WebSocket(base_url+'/ws/v5/private');

// storeConnection('ws_private', ws_private);

const gate = 10.1;
const bar_type = '5m';
const price_type = 'close'
const once_limit = 300;
const candle_limit =2000;
const assets = [
  {id: 'SOL-USDT', theme:'#ad85e9'},
  {id: 'BTC-USDT', theme:'#f0b27a'},
  {id: 'ETH-USDT', theme:'#85c1e9'},
  {id: 'TRUMP-USDT', theme:'#abb2b9'},
  {id: 'OKB-USDT', theme:'#85dde9'},
]

TradeEngine.start()

const params = {
  bar_type,
  price_type,
  once_limit,
  candle_limit,
  from_when: getLastWholeMinute(new Date()),
  to_when:new Date(2025,1,20,0,0,0).getTime(),
}

const assetIds = assets.map(it=>it.id);
const themes = assets.map(it=>it.theme);

const klines = await Promise.all(assetIds.map(async (it,id)=>await getPrices(it, params)));

klines.map(({id, prices, ts})=>{
  TradeEngine.updatePrices(id, prices, ts, bar_type);
})


// TradeEngine.renderGraph(100);



printKlines(Object.values(TradeEngine.getAllMarketData(bar_type)));

function printKlines(klines){
  try{
    const refer_kline = klines[0];
    const x_label = toTrickTimeMark(refer_kline.ts);
    const beta_map={ [assets[0].id]: [1, 0] };
    const scaled_prices = klines.map((it,id)=>{
      const {prices, ts, id:assetId} = it;
      if(id==0) return prices;
      const {a, b} = findBestFitLine(prices, refer_kline.prices);
      console.log(`[${formatTimestamp(ts[0])}]拟合的多项式系数:`, {a, b});
      beta_map[assetId] = [a, b];
      return prices.map(it=>a*it+b);
    })
    recordBetaMap(beta_map);
    paint(assetIds, scaled_prices, themes, x_label, gate, klines, beta_map, bar_type)
    
    // 绘制每次开仓的截图
    const opening_transactions = [...getLastTransactions(100,'opening')];
    opening_transactions.map(({tradeId, })=>{
      paintTransactionSlice(tradeId, createMapFrom(assetIds, themes), x_label, klines, bar_type)
    })
    
  }catch(e){
    console.log(e);
    console.log(klines)
  }
}


const refreshKlineGraph = throttleAsync(()=>{
  let klines_dynamic = [];// {'SOL-USDT':{id, ts, prices}}
  assets.map((asset, id)=>{
    const instId = asset.id;
    klines_dynamic[id] = TradeEngine.getMarketData(instId, bar_type)
  })


  // 交易信号判断和处理
  const opening_transactions = getLastTransactions(100,'opening');

  opening_transactions.map(({tradeId, closed, orders})=>{
    if(!closed){

      let fee_usdt = 0,cost = 0,sell=0;
      orders.map(({instId, side, sz, tgtCcy, avgPx, accFillSz, fee, feeCcy})=>{
        const realtime_price = TradeEngine.getPrice(instId);
        // 单位 false:本币; true:usdt
        const unit_fgt = tgtCcy === 'base_ccy'?false:true;
        const unit_fee = feeCcy === 'USDT'?true:false;

        if(side==='buy'){
          cost += unit_fgt ? parseFloat(sz) : parseFloat(sz * avgPx);
          // 实时估算
          sell += realtime_price * accFillSz
        }

        if(side==='sell'){
          sell += unit_fgt ? parseFloat(sz) : parseFloat(sz * avgPx);
          // 实时估算
          cost += realtime_price * accFillSz
        }
        fee_usdt += unit_fee ? parseFloat(fee) : parseFloat(fee * avgPx)
      })
      const profit =  sell - cost + fee_usdt;
      updateTransaction(tradeId,'opening',{profit});
    }
  });

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
      recordPrice(instId, close);
      dkp[instId] ??= { };
      dkp[instId][formatTimestamp(ts)] = {price:close, ts};
      refreshKlineGraph(dkp);
      TradeEngine.updatePrice(instId, close, ts, bar_type);
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


function duplicateRemoval(klines_dynamic){
    // 对合并后的K线数据去重
    const unque_ts = {};
    const dump_ts=[]
    klines_dynamic.ts.map((it,id)=>{
      if(unque_ts[it]){
        dump_ts.push(id);
      }
      unque_ts[it] = 1;
    })
    const {ts, prices} = klines_dynamic;
    klines_dynamic.ts = ts.filter((it, index) => !dump_ts.includes(index));
    klines_dynamic.prices = prices.filter((it, index) => !dump_ts.includes(index));
    return klines_dynamic;
}


