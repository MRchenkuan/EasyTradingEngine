import { getInstruments, getOrderHistory } from './api.js';
import { LocalVariable } from './LocalVariable.js';
import { close_position, open_position, create_order_market, executeOrders } from './trading.js';

// const tradeId = await open_position('ETH-USDT','SOL-USDT',300)
// await open_position('BTC-USDT','SOL-USDT',200)
// await open_position('SOL-USDT','ETH-USDT',2000)
// await open_position('SOL-USDT','ETH-USDT',400)
// const tradeId = await open_position('SOL-USDT','ETH-USDT',300)
// const tradeId = await open_position('TRUMP-USDT','SOL-USDT',400)
// await open_position('ETH-USDT','BTC-USDT',400)
// await open_position('ETH-USDT','SOL-USDT',600)
// await open_position('OKB-USDT','BTC-USDT',400)
// await open_position('OKB-USDT','SOL-USDT',400)
// await open_position('ETH-USDT','OKB-USDT',400)
// await open_position('BTC-USDT','OKB-USDT',400)
// await open_position('ETH-USDT','XRP-USDT',2000)
// const tradeId = await open_position('BTC-USDT', 'ETH-USDT',200);
// setTimeout(()=>{
//   close_position(tradeId)
// },1000)

// close_position("40d5349d")
// const orders = await getOrderHistory({
//   instType: 'SPOT',
//   instId: 'ETH-USDT',
//   state: 'filled',
//   limit: '50'
// });
// debugger

// getLastTransactions(100, 'opening').map(it=>{
//   const orders = it.orders;
//   orders.map(o=>{
//     if(!Array.isArray(o.beta)) o.beta = [o.beta, 0]
//   })
//   updateTransaction(it.tradeId, 'opening', {orders})
// })

// const size = 100;
// const assetId = 'SOL-USDT-SWAP';
// const {
//   data: [{ ctVal }],
// } = await getInstruments('SWAP', assetId);
// // console.log(data);
// const price = new LocalVariable('TradeEngine/realtime_price')[assetId] * ctVal;
// const amount = (size / price).toFixed(2);
// executeOrders([create_order_market(assetId, amount, 1)]);
