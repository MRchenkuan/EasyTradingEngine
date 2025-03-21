import WebSocket from 'ws'
import express from 'express'
import { getPrices, parseCandleData, getLastWholeMinute } from './src/tools.js'
import { base_url } from './src/config.security.js'
import { subscribeKlineChanel } from './src/api.js'
import { TradeEngine } from './src/TradeEngine/TradeEngine.js'
import { VisualEngine } from './src/TradeEngine/VisualEngine.js'

const ws_connection_pool={}

// const ws_private = new WebSocket(base_url+'/ws/v5/private');

// storeConnection('ws_private', ws_private);

const bar_type = '5m';
const price_type = 'close'
const once_limit = 300;
const candle_limit =2000;
const assets = [
  {id: 'BTC-USDT', theme:'#f0b27a'},
  {id: 'SOL-USDT', theme:'#ad85e9'},
  {id: 'ETH-USDT', theme:'#85c1e9'},
  {id: 'TRUMP-USDT', theme:'#90a4ae'},
  {id: 'XRP-USDT', theme:'#ffafde'},
  // {id: 'OKB-USDT', theme:'#52be80'},
  // {id: 'ADA-USDT', theme:'#85dfe9'},
]
const params = {
  bar_type,
  price_type,
  once_limit,
  candle_limit,
  from_when: getLastWholeMinute(new Date()),
  // from_when: new Date(2025,2,7,0,0,0).getTime(),
  to_when:new Date(2025,2,10,0,0,0).getTime(),
}


/**
 * 启动交易引擎
 */
TradeEngine.setMetaInfo({
  main_asset:assets[0].id,
  bar_type,
  once_limit, 
  candle_limit, 
  assets
}).start();

// TradeEngine.createHedge(['BTC-USDT', 'ETH-USDT'], 200, 0.02);
// TradeEngine.createHedge(['OKB-USDT', 'ETH-USDT'], 200, 0.02);
// TradeEngine.createHedge(['OKB-USDT', 'BTC-USDT'], 200, 0.02);

// TradeEngine.createHedge(['SOL-USDT', 'BTC-USDT'], 200, 0.02);
TradeEngine.createHedge(['XRP-USDT', 'BTC-USDT'], 2000, 0.01);

/**
 * 启动图像引擎
 */
VisualEngine.setMetaInfo({
  assets
}).start();

const assetIds = assets.map(it=>it.id);

const klines = await Promise.all(assetIds.map(async (it,id)=>await getPrices(it, params)));
klines.map(({id, prices, ts})=>{
  TradeEngine.updatePrices(id, prices, ts, bar_type);
})


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
      TradeEngine.updatePrice(instId, close, ts, bar_type);
    }
  }
});

ws_business.on('close', (code, reason) => {
  TradeEngine.stop();
  VisualEngine.stop();
  console.log(`ws_business连接已关闭, 关闭码: ${code}, 原因: ${reason}`);
});


// 保存一个ws链接
function storeConnection(conn_id, ws){
  ws_connection_pool[conn_id] = ws;
}

