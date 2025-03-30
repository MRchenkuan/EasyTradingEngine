import { getLastTransactions } from '../recordTools.js';
import { formatTimestamp } from '../tools.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

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
    padString('资金规模', 12),
    padString('盈亏', 10),
    padString('状态', 10),
    padString('持仓天数', 10),
  ].join('');
  console.log(header);
  console.log('-'.repeat(83));

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

    const row = [
      padString(tradeId.toString(), 12),
      padString(createTime, 15),
      padString(pairs, 14),
      padString(amount.toFixed(2), 12),
      padString(coloredProfit, 10),
      padString(status, 10),
      padString(daysHeld + '天', 10),
    ].join('');

    console.log(row);
  });
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

// 根据命令行参数执行不同功能
const command = process.argv[2];

switch (command) {
  case 'monit':
    // 实时监控模式
    setInterval(() => displayPositions(true), 1000);
    displayPositions(true); // 立即显示第一次
    break;
  case 'clear':
    // 清理已平仓数据
    clearPositions();
    displayPositions();
    break;
  default:
    // 默认显示一次持仓信息
    displayPositions();
}
