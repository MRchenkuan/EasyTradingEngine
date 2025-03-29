import { getLastTransactions } from '../recordTools.js';
import { formatTimestamp } from '../tools.js';

const colors = {
  reset: '\x1b[0m',
  gray: '\x1b[90m',
  red: '\x1b[31m',
  green: '\x1b[32m'
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

function displayPositions() {
  const openPositions = getLastTransactions(100, 'opening');

  clearScreen();
  
  if (openPositions.length === 0) {
    console.log('当前没有持仓');
    return;
  }

  console.log('当前持仓:');
  const header = [
    padString('交易ID', 12),
    padString('创建时间', 15),
    padString('对冲品种', 14),
    padString('资金规模', 12),
    padString('盈亏', 10),
    padString('状态', 10),
  ].join('');
  console.log(header);
  console.log('-'.repeat(73));

  openPositions.forEach(({ tradeId, profit, orders, ts, closed }) => {
    const createTime = formatTimestamp(new Date(ts).getTime());
    const pairs = orders.map(o => o.instId.split('-')[0]).join(':');
    const amount = orders.reduce(
      (sum, o) => sum + parseFloat(o.accFillSz) * parseFloat(o.avgPx),
      0
    );

    const status = closed 
      ? `${colors.gray}已平仓${colors.reset}`
      : '未平仓';

    const profitValue = profit?.toFixed(2) || '0';
    const coloredProfit = parseFloat(profitValue) >= 0
      ? `${colors.red}${profitValue}${colors.reset}`
      : `${colors.green}${profitValue}${colors.reset}`;

    const row = [
      padString(tradeId.toString(), 12),
      padString(createTime, 15),
      padString(pairs, 14),
      padString(amount.toFixed(2), 12),
      padString(coloredProfit, 10),
      padString(status, 10),
    ].join('');

    console.log(row);
  });
}

// 每秒更新一次
setInterval(displayPositions, 1000);
displayPositions(); // 立即显示第一次