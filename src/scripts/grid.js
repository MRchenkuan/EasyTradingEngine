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

function displayGridTrades(monit = false) {
  const filterSymbol = process.argv[3]?.toUpperCase(); // monit 模式下参数位置变化

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

  if (monit) {
    process.stdout.write('\x1b[2J');
    process.stdout.write('\x1b[0f');
  }

  const filteredTrades = filterSymbol
    ? trades.filter(order => order.instId.toUpperCase().startsWith(filterSymbol))
    : trades.filter(order => !!order);

  if (filteredTrades.length === 0) {
    console.log(`没有找到 ${filterSymbol} 的交易记录`);
    return;
  }

  // 计算网格收益
  const results = calculateGridProfit(filteredTrades);

  // 打印网格收益表格
  const header = [
    padString('品种', 10),
    padString(' 净盈亏', 10),
    padString(' 已实现', 10),
    padString(' 未实现', 10),
    padString(' 手续费', 9),
    padString(' 持仓数量', 10),
    padString(' 持仓价值', 10),
    padString(' 持仓均价', 10),
  ].join('');

  console.log('\n=== 盈亏统计 ===');
  console.log(header);
  console.log('-'.repeat(90));

  let totalNetProfit = 0;
  let totalRealizedProfit = 0;
  let totalUnrealizedProfit = 0;
  let totalFee = 0;
  let totalPositionValue = 0;

  for (const [instId, result] of Object.entries(results)) {
    const netProfitStr =
      result.netProfit >= 0
        ? `${colors.red} ${result.netProfit.toFixed(2)}${colors.reset}`
        : `${colors.green}${result.netProfit.toFixed(2)}${colors.reset}`;

    const realizedProfitStr =
      result.realizedProfit >= 0
        ? `${colors.red} ${result.realizedProfit.toFixed(2)}${colors.reset}`
        : `${colors.green}${result.realizedProfit.toFixed(2)}${colors.reset}`;

    const unrealizedProfitStr =
      result.unrealizedProfit >= 0
        ? `${colors.red} ${result.unrealizedProfit.toFixed(2)}${colors.reset}`
        : `${colors.green}${result.unrealizedProfit.toFixed(2)}${colors.reset}`;

    const row = [
      padString(instId, 10),
      padString(netProfitStr, 10),
      padString(realizedProfitStr, 10),
      padString(unrealizedProfitStr, 10),
      padString(result.totalFee >= 0 ? ' ' + result.totalFee.toFixed(2) : result.totalFee.toFixed(2), 9),
      padString(
        result.openPosition >= 0
          ? `${colors.red} ${result.openPosition.toFixed(2)}${colors.reset}`
          : `${colors.green}${result.openPosition.toFixed(2)}${colors.reset}`,
        10
      ),
      padString(
        result.positionValue >= 0
          ? `${colors.red} ${result.positionValue.toFixed(2)}${colors.reset}`
          : `${colors.green}${result.positionValue.toFixed(2)}${colors.reset}`,
        10
      ),
      padString(
        result.avgCost >= 0
          ? `${colors.red} ${result.avgCost.toFixed(2)}${colors.reset}`
          : `${colors.green}${result.avgCost.toFixed(2)}${colors.reset}`,
        10
      ),
    ].join('');

    console.log(row);

    // 累计总计数据
    totalNetProfit += result.netProfit;
    totalRealizedProfit += result.realizedProfit;
    totalUnrealizedProfit += result.unrealizedProfit;
    totalFee += result.totalFee;
    totalPositionValue += result.positionValue;
  }

  // 打印总计行
  console.log('-'.repeat(90));
  // 总计行
  const totalRow = [
    padString('总计', 10),
    padString(
      totalNetProfit >= 0
        ? `${colors.red} ${totalNetProfit.toFixed(2)}${colors.reset}`
        : `${colors.green}${totalNetProfit.toFixed(2)}${colors.reset}`,
      10
    ),
    padString(
      totalRealizedProfit >= 0
        ? `${colors.red} ${totalRealizedProfit.toFixed(2)}${colors.reset}`
        : `${colors.green}${totalRealizedProfit.toFixed(2)}${colors.reset}`,
      10
    ),
    padString(
      totalUnrealizedProfit >= 0
        ? `${colors.red} ${totalUnrealizedProfit.toFixed(2)}${colors.reset}`
        : `${colors.green}${totalUnrealizedProfit.toFixed(2)}${colors.reset}`,
      10
    ),
    padString(totalFee.toFixed(2) >= 0 ? ' ' + totalFee.toFixed(2) : totalFee.toFixed(2), 9),
    padString('', 10),
    padString(
      totalPositionValue >= 0
        ? `${colors.red} ${totalPositionValue.toFixed(2)}${colors.reset}`
        : `${colors.green}${totalPositionValue.toFixed(2)}${colors.reset}`,
      10
    ),
    padString('', 10),
  ].join('');
  console.log(totalRow);

  if (!monit) {
    process.exit(0);
  }
}

// 修改主函数逻辑
const command = process.argv[2];

switch (command) {
  case 'monit':
    setInterval(() => displayGridTrades(true), 1000);
    displayGridTrades(true);
    break;
  default:
    displayGridTrades();
}
