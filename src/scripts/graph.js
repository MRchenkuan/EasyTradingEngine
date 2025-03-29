import { LocalVariable } from '../LocalVariable.js';

const type = process.argv[2];

if (!type || !['orders', 'trans'].includes(type)) {
  console.log('用法: npm run graph orders 或 npm run graph trans');
  process.exit(1);
}

const config = new LocalVariable('config');

if (type === 'orders') {
  config.show_orders = config.show_orders === false ? true : false;
  console.log(`已${config.show_orders ? '显示' : '隐藏'}主图上的历史订单记录`);
} else {
  config.show_transactions = config.show_transactions === false? true : false;
  console.log(`已${config.show_transactions ? '显示' : '隐藏'}主图上的开平仓信息`);
}