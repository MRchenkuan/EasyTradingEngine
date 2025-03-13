import { close_position, open_positions } from "./trading.js";

// const tradeId = await open_positions('ETH-USDT','SOL-USDT',300)
// await open_positions('SOL-USDT','BTC-USDT',200)
// await open_positions('SOL-USDT','ETH-USDT',400)
// const tradeId = await open_positions('SOL-USDT','ETH-USDT',300)
// const tradeId = await open_positions('TRUMP-USDT','SOL-USDT',400)
// await open_positions('ETH-USDT','BTC-USDT',400)
// await open_positions('ETH-USDT','SOL-USDT',600)
// await open_positions('OKB-USDT','BTC-USDT',400)
// await open_positions('OKB-USDT','SOL-USDT',400)
// await open_positions('ETH-USDT','OKB-USDT',400)
// await open_positions('BTC-USDT','OKB-USDT',400)
await open_positions('ETH-USDT','BTC-USDT',200)
// const tradeId = await open_positions('BTC-USDT', 'ETH-USDT',200);
// setTimeout(()=>{
//   close_position(tradeId)
// },1000)


// close_position("0d8b38f8")

// const profit = await marketMaker('SOL-USDT', readPrice('SOL-USDT'), 100, 0)

// getLastTransactions(100, 'opening').map(it=>{
//   const orders = it.orders;
//   orders.map(o=>{
//     if(!Array.isArray(o.beta)) o.beta = [o.beta, 0]
//   })
//   updateTransaction(it.tradeId, 'opening', {orders})
// })