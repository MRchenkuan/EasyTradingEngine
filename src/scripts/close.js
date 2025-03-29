import { close_position } from '../trading.js';
import { spawn } from 'child_process';

const [tradeId] = process.argv.slice(2);

if (!tradeId) {
  console.error('请提供完整参数：npm run close [交易ID]');
  console.error('例如：npm run close 318fe6d8');
  process.exit(1);
}

try {
  const result = await close_position(tradeId);
  if (result.success) {
    console.log(`平仓成功，盈亏: ${result.profit}`);
  } else {
    console.log(`平仓失败, ${result.msg}`);
  }
} catch (error) {
  console.error('平仓失败:', error);
} finally {
  spawn('npm', ['run', 'list'], { stdio: 'inherit' });
}
