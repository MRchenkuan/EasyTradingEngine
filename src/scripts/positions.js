import { getLastTransactions } from '../recordTools.js';
import { formatTimestamp } from '../tools.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// 获取 __dirname 的 ES 模块等价物
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 处理字符串宽度（中文字符占两个位置，忽略颜色控制字符）
function padString(str, length) {
  // 移除颜色控制字符后计算实际显示宽度
  const visibleStr = str.replace(/\x1b\[\d+m/g, '');
  const strWidth = [...visibleStr].reduce((width, char) => {
    return width + (/[\u4e00-\u9fa5]/.test(char) ? 2 : 1);
  }, 0);
  
  // 如果原字符串包含颜色控制，保留颜色并在末尾添加重置颜色
  const hasColor = str !== visibleStr;
  const padding = ' '.repeat(Math.max(0, length - strWidth));
  return hasColor ? `${str}${padding}` : str + padding;
}

const clearFlag = process.argv[2] === 'clear';
const openPositions = getLastTransactions(100, 'opening');

if (openPositions.length === 0) {
  console.log('当前没有持仓');
} else {
  // 如果带了 clear 参数，清理已平仓数据
  if (clearFlag) {
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

  // 添加颜色处理函数
  const colors = {
    reset: '\x1b[0m',
    gray: '\x1b[90m',
    red: '\x1b[31m',
    green: '\x1b[32m'
  };

  openPositions.forEach(({ tradeId, profit, orders, ts, closed }) => {
    const createTime = formatTimestamp(new Date(ts).getTime());
    const pairs = orders.map(o => o.instId.split('-')[0]).join(':');
    const amount = orders.reduce(
      (sum, o) => sum + parseFloat(o.accFillSz) * parseFloat(o.avgPx),
      0
    );

    // 处理状态颜色，未平仓使用默认颜色
    const status = closed 
      ? `${colors.gray}已平仓${colors.reset}`
      : '未平仓';

    // 处理盈亏颜色
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
