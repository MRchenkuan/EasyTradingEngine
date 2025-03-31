import { getLastTransactions } from '../recordTools.js';
import { formatTimestamp } from '../tools.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { TradeEngine } from '../TradeEngine/TradeEngine.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const colors = {
  reset: '\x1b[0m',
  gray: '\x1b[90m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  orange: '\x1b[33m', // 添加橙色
};

function padString(str, length) {
  const visibleStr = str.replace(/\x1b\[\d+m/g, '');
  const strWidth = [...visibleStr].reduce((width, char) => {
    return width + (/[\u4e00-\u9fa5]/.test(char) ? 2 : 1);
  }, 0);

  const hasColor = str !== visibleStr;
  const padding = ' '.repeat(Math.max(0, length - strWidth));
  return hasColor ? `${str}${padding}` : str + padding;
}

function clearScreen() {
  process.stdout.write('\x1b[2J');
  process.stdout.write('\x1b[0f');
}

function displayPositions(monit = false) {
  const openPositions = getLastTransactions(100, 'opening');
  const closingTransactions = getLastTransactions(100, 'closing');

  if (monit) {
    clearScreen();
  }

  if (openPositions.length === 0) {
    console.log('当前没有持仓');
    return;
  }

  const header = [
    padString('交易ID', 12),
    padString('创建时间', 15),
    padString('对冲品种', 14),
    padString('头寸规模', 12),
    padString('盈亏', 10),
    padString('收敛度', 10),
    padString('状态', 10),
    padString('持仓天数', 10),
  ].join('');
  console.log(header);
  console.log('-'.repeat(93));

  openPositions.forEach(({ tradeId, profit, orders, ts, closed }) => {
    const createTime = formatTimestamp(new Date(ts).getTime());

    // 重新排序对冲品种，SELL在前，BUY在后
    const sortedOrders = [...orders].sort((a, b) => {
      if (a.side.toUpperCase() === 'SELL' && b.side.toUpperCase() === 'BUY') return -1;
      if (a.side.toUpperCase() === 'BUY' && b.side.toUpperCase() === 'SELL') return 1;
      return 0;
    });
    const pairs = sortedOrders.map(o => o.instId.split('-')[0]).join(':');

    const amount = orders.reduce(
      (sum, o) => sum + parseFloat(o.accFillSz) * parseFloat(o.avgPx),
      0
    );

    const createTs = new Date(ts).getTime();
    const closeTs = closed
      ? closingTransactions.find(t => t.tradeId === tradeId)?.ts || Date.now()
      : Date.now();
    const daysHeld = ((closeTs - createTs) / (1000 * 60 * 60 * 24)).toFixed(1);

    const status = closed ? `${colors.gray}已平仓${colors.reset}` : '未平仓';

    const profitValue = profit?.toFixed(2) || '0';
    const coloredProfit =
      parseFloat(profitValue) >= 0
        ? `${colors.red}${profitValue}${colors.reset}`
        : `${colors.green}${profitValue}${colors.reset}`;

    // 计算实时价差率
    let diffRate = '-';
    let diffValue = 0;
    const [order1, order2] = sortedOrders;
    const price1 = closed ? order1.avgPx : TradeEngine.getRealtimePrice(order1.instId);
    const price2 = closed ? order2.avgPx : TradeEngine.getRealtimePrice(order2.instId);

    if (price1 && price2 && order1.beta && order2.beta) {
      const sr_px1 = price1 * order1.beta[0] + order1.beta[1];
      const sr_px2 = price2 * order2.beta[0] + order2.beta[1];
      diffValue = TradeEngine._calcPriceGapProfit(sr_px1, sr_px2, (sr_px1 + sr_px2) / 2);
      const formattedDiff = (diffValue * 100).toFixed(2);
      diffRate = closed
        ? `${colors.gray}${formattedDiff}%${colors.reset}`
        : Math.abs(diffValue) < 0.01
          ? `${colors.orange}${formattedDiff}%${colors.reset}`
          : `${formattedDiff}%`;
    }

    const row = [
      padString(tradeId.toString(), 12),
      padString(createTime, 15),
      padString(pairs, 14),
      padString(amount.toFixed(2), 12),
      padString(coloredProfit, 10),
      padString(diffRate, 10),
      padString(status, 10),
      padString(daysHeld + '天', 10),
    ].join('');

    console.log(row);
  });

  // 添加汇总信息
  let totalProfit = 0;
  let totalAmount = 0;

  openPositions.forEach(({ profit, orders }) => {
    totalProfit += parseFloat(profit || 0);
    totalAmount += orders.reduce(
      (sum, o) => sum + parseFloat(o.accFillSz) * parseFloat(o.avgPx),
      0
    );
  });

  // 打印分隔线和汇总行
  console.log('-'.repeat(93));
  const summaryRow = [
    padString('总计', 41),
    padString(totalAmount.toFixed(2), 12),
    padString(
      totalProfit >= 0
        ? `${colors.red}${totalProfit.toFixed(2)}${colors.reset}`
        : `${colors.green}${totalProfit.toFixed(2)}${colors.reset}`,
      10
    ),
    padString('', 30),
  ].join('');
  console.log(summaryRow);

  if (!monit) {
    process.exit(0);
  }
}

function clearPositions() {
  const openPositions = getLastTransactions(100, 'opening');
  if (openPositions.length === 0) {
    console.log('当前没有持仓');
    return;
  }

  // 清理 opening 文件中的已平仓交易
  const openingPath = path.join(__dirname, '../../records/trade-results-opening.json');
  const activePositions = openPositions.filter(p => !p.closed);
  fs.writeFileSync(openingPath, JSON.stringify(activePositions, null, 2), 'utf-8');

  // 清理 closing 文件中对应的平仓记录
  const closingPath = path.join(__dirname, '../../records/trade-results-closing.json');
  if (fs.existsSync(closingPath)) {
    fs.writeFileSync(closingPath, JSON.stringify([], null, 2), 'utf-8');
  }

  console.log('已清理平仓数据');
}

function deletePosition(tradeId) {
  const openPositions = getLastTransactions(100, 'opening');
  const closingTransactions = getLastTransactions(100, 'closing');

  if (openPositions.length === 0) {
    console.log('当前没有持仓');
    return;
  }

  // 清理 opening 文件
  const openingPath = path.join(__dirname, '../../records/trade-results-opening.json');
  const remainingPositions = openPositions.filter(p => p.tradeId.toString() !== tradeId);

  // 清理 closing 文件
  const closingPath = path.join(__dirname, '../../records/trade-results-closing.json');
  const remainingClosing = closingTransactions.filter(p => p.tradeId.toString() !== tradeId);

  if (
    remainingPositions.length === openPositions.length &&
    remainingClosing.length === closingTransactions.length
  ) {
    console.log(`未找到交易ID: ${tradeId}`);
    return;
  }

  // 保存更新后的数据
  fs.writeFileSync(openingPath, JSON.stringify(remainingPositions, null, 2), 'utf-8');
  fs.writeFileSync(closingPath, JSON.stringify(remainingClosing, null, 2), 'utf-8');

  console.log(`已删除交易ID: ${tradeId}`);
}

// 根据命令行参数执行不同功能
const command = process.argv[2];
const tradeId = process.argv[3];

switch (command) {
  case 'monit':
    // 实时监控模式
    setInterval(() => displayPositions(true), 1000);
    displayPositions(true);
    break;
  case 'clear':
    // 清理已平仓数据
    clearPositions();
    displayPositions();
    break;
  case 'delete':
    // 删除指定交易ID的数据
    if (!tradeId) {
      console.log('请指定要删除的交易ID');
      break;
    }
    deletePosition(tradeId);
    displayPositions();
    break;
  default:
    // 默认显示一次持仓信息
    displayPositions();
}
