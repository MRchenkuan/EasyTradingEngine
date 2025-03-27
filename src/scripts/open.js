import { open_positions } from '../trading.js';

const [asset1, asset2, amount] = process.argv.slice(2);

if (!asset1 || !asset2 || !amount) {
  console.error('请提供完整参数：npm run open [空头资产] [多头资产] [金额]');
  console.error('例如：npm run open BTC-USDT ETH-USDT 2000');
  process.exit(1);
}

try {
  const result = await open_positions(asset1, asset2, Number(amount));
  if (result.success) {
    console.log(`开仓成功，交易ID: ${result.tradeId}`);
  } else {
    console.log(`开仓失败, ${result.msg}`);
  }
} catch (error) {
  console.error('开仓失败:', error);
}
