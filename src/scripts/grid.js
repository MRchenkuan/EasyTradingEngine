import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { calculateGridProfit, formatTimestamp } from '../tools.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const colors = {
  reset: '\x1b[0m',
  gray: '\x1b[90m',
  red: '\x1b[31m',
  green: '\x1b[32m',
};

function padString(str, length) {
  const visibleStr = str.replace(/\x1b\[\d+m/g, '');
  const strWidth = [...visibleStr].reduce((width, char) => {
    return width + (/[\u4e00-\u9fa5]/.test(char) ? 2 : 1);
  }, 0);
  const padding = ' '.repeat(Math.max(0, length - strWidth));
  return str + padding;
}

function displayGridTrades() {
  const filterSymbol = process.argv[2]?.toUpperCase();

  const gridPath = path.join(__dirname, '../../records/trade-results-grid.json');
  if (!fs.existsSync(gridPath)) {
    console.log('没有网格交易记录');
    return;
  }

  const trades = JSON.parse(fs.readFileSync(gridPath, 'utf8'));

  if (trades.length === 0) {
    console.log('没有网格交易记录');
    return;
  }

  // 过滤交易记录
  const filteredTrades = filterSymbol
    ? trades.filter(order => order.instId.toUpperCase().startsWith(filterSymbol))
    : trades.filter(order => !!order); // 过滤掉 null 值

  if (filteredTrades.length === 0) {
    console.log(`没有找到 ${filterSymbol} 的交易记录`);
    return;
  }

  const header = [
    padString('交易ID', 12),
    padString('时间', 15),
    padString('品种', 12),
    padString('方向', 8),
    padString(' 数量', 10),
    padString('价格', 12),
    padString(' 金额', 12),
    padString('手续费', 12),
  ].join('');

  console.log(header);
  console.log('-'.repeat(91)); // 增加分隔线长度

  filteredTrades.forEach(order => {
    const tradeId = order.clOrdId;
    const time = formatTimestamp(parseInt(order.ts));
    const symbol = order.instId;
    const side =
      order.side.toUpperCase() === 'BUY'
        ? `${colors.red}买入${colors.reset}`
        : `${colors.green}卖出${colors.reset}`;
    const amount = order.accFillSz;
    const price = order.avgPx;
    const total = (parseFloat(amount) * parseFloat(price)).toFixed(2);

    // 计算USDT手续费
    let feeInUsdt;
    if (order.feeCcy === 'USDT') {
      feeInUsdt = Math.abs(parseFloat(order.fee));
    } else {
      feeInUsdt = Math.abs(parseFloat(order.fee) * parseFloat(order.avgPx));
    }

    const row = [
      padString(tradeId, 12),
      padString(time, 15),
      padString(symbol, 12),
      padString(side, 8),
      padString(' ' + amount, 10),
      padString(parseFloat(price).toFixed(2), 12),
      padString(' ' + total, 12),
      padString(feeInUsdt.toFixed(4), 12),
    ].join('');

    console.log(row);
  });

  // 计算总金额、总数量和总手续费
  let totalAmount = 0;
  let totalQuantity = 0;
  let totalFee = 0;

  filteredTrades.forEach(order => {
    const amount = parseFloat(order.accFillSz);
    const price = parseFloat(order.avgPx);
    const orderAmount = amount * price;

    // 买入为负，卖出为正（金额）
    totalAmount += order.side.toUpperCase() === 'BUY' ? -orderAmount : orderAmount;
    // 买入为正，卖出为负（数量）
    totalQuantity += order.side.toUpperCase() === 'BUY' ? amount : -amount;

    // 累加手续费
    if (order.feeCcy === 'USDT') {
      totalFee += Math.abs(parseFloat(order.fee));
    } else {
      totalFee += Math.abs(parseFloat(order.fee) * price);
    }
  });


  // 打印分隔线和总结行
  console.log('-'.repeat(91));
  const summaryRow = [
    padString('总计', 47),
    padString(filterSymbol ? totalQuantity.toFixed(4) : '', 10),
    padString('', 12),
    padString((totalAmount > 0 ? ' ' : '') + totalAmount.toFixed(2), 12),
    padString(totalFee.toFixed(4), 12),
  ].join('');
  console.log(summaryRow);
  console.log('');

  const results = calculateGridProfit(filteredTrades);
  // 打印结果
  console.log('=== 网格交易盈亏统计 ===');
  for (const [instId, result] of Object.entries(results)) {
    console.log(`\n${instId}:`);
    console.log(`已实现盈利: ${result.realizedProfit} USDT`);
    console.log(`总手续费: ${result.totalFee} USDT`);
    console.log(`净盈利: ${result.netProfit} USDT`);
    if (result.openPosition !== 0) {
      console.log(`未平仓数量: ${result.openPosition}`);
      if (result.avgCost > 0) {
        console.log(`持仓均价: ${result.avgCost} USDT`);
      }
    }
  }

  process.exit(0);
}

displayGridTrades();
