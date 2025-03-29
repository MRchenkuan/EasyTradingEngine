import { open_position } from '../trading.js';
import { spawn } from 'child_process';

const [asset1, asset2, amount] = process.argv.slice(2);

if (!asset1 || !asset2 || !amount) {
  console.error('请提供完整参数：npm run open [空头资产] [多头资产] [金额]');
  console.error('例如：npm run open sol eth 2000');
  process.exit(1);
}

// 处理资产名称
function formatAssetName(asset) {
  const name = asset.toUpperCase();
  return name.includes('-USDT') ? name : `${name}-USDT`;
}

try {
  const formattedAsset1 = formatAssetName(asset1);
  const formattedAsset2 = formatAssetName(asset2);
  const result = await open_position(formattedAsset1, formattedAsset2, Number(amount));

  if (result.success) {
    console.log(`开仓成功，交易ID: ${result.tradeId}`);

  } else {
    console.log(`开仓失败, ${result.msg}`);
  }
} catch (error) {
  console.error('开仓失败:', error);
} finally {
  spawn('npm', ['run', 'list'], { stdio: 'inherit' });
}
