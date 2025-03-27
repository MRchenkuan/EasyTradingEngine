import { close_position } from '../trading.js';

const tradeId = process.argv[2];
if (!tradeId) {
  console.error('请提供交易ID');
  process.exit(1);
}

try {
  const result = await close_position(tradeId);
  if (result.success) {
    console.log(`平仓成功，盈利: ${result.profit}`);
  } else {
    console.log(`平仓失败: ${result.msg}`);
  }
} catch (error) {
  console.error('平仓失败:', error);
}
