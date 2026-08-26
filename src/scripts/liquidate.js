/**
 * 手动清仓脚本
 *
 * 直接调用 Liquidator 一键清仓，验证清仓逻辑是否正确。
 * Liquidator 内部处理：获取持仓→市价平仓→远程确认→重置策略状态
 *
 * 用法：
 *   npm run liquidate                    # 清仓全部持仓（交互确认）
 *   npm run liquidate -- --yes          # 清仓全部持仓（跳过确认）
 *   npm run liquidate -- BTC-USDT-SWAP  # 只清仓指定品种
 */
import { Liquidator } from '../TradeEngine/Liquidator.js';
import { Env } from '../../config.js';
import { TradeEnv } from '../enum.js';
import readline from 'readline';

const C = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
};

const args = process.argv.slice(2);
const skipConfirm = args.includes('--yes');
const instIdArg = args.find(a => !a.startsWith('--'));
const IS_MIMIC = Env === TradeEnv.MIMIC;

console.log(`${C.cyan}=== 手动清仓 ===${C.reset}`);
console.log(`${C.gray}环境: ${IS_MIMIC ? '模拟盘' : '实盘'}${C.reset}`);
if (instIdArg) {
  console.log(`${C.gray}目标: ${instIdArg}${C.reset}`);
}
console.log();

// 确认
if (!skipConfirm) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise(resolve => {
    rl.question(`${C.yellow}确认执行一键清仓？(y/N) ${C.reset}`, resolve);
  });
  rl.close();
  if (answer.toLowerCase() !== 'y') {
    console.log('已取消');
    process.exit(0);
  }
}

// 调用 Liquidator 一键清仓（无 engine，仅平仓不重置策略状态）
const result = await Liquidator.liquidate(null, instIdArg);

console.log();
if (result.success && result.closed > 0) {
  console.log(`${C.green}清仓成功：${result.closed} 笔已成交${C.reset}`);
  if (result.details && result.details.length > 0) {
    console.log(
      `${C.gray}${'品种'.padEnd(20)} ${'方向'.padEnd(8)} ${'成交'.padEnd(12)} ${'均价'.padEnd(14)} ${'状态'}${C.reset}`
    );
    console.log('-'.repeat(65));
    for (const d of result.details) {
      const stateColor = d.state === 'filled' ? C.green : C.yellow;
      console.log(
        `${d.instId.padEnd(20)} ${(d.side || '').padEnd(8)} ${String(d.accFillSz || '-').padEnd(12)} ${(d.avgPx || '-').padEnd(14)} ${stateColor}${d.state}${C.reset}`
      );
    }
  }
} else if (result.closed === 0 && !result.error) {
  console.log(`${C.green}无持仓，无需清仓${C.reset}`);
} else {
  console.error(`${C.red}清仓失败: ${result.error || result.failed + ' 笔未成交'}${C.reset}`);
  if (result.details && result.details.length > 0) {
    for (const d of result.details) {
      console.log(`  ${d.instId} ${d.side} state=${d.state} avgPx=${d.avgPx || '-'}`);
    }
  }
  process.exit(1);
}
