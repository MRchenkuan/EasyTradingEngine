import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// 获取 __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 读取JSON文件
const filePath = path.join(__dirname, 'records', 'data.json');
const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));

// 转换数据
const transformedData = data
  .filter(item => item.sCode === '0') // 只保留 sCode 为 0 的订单
  .map(item => {
    // 创建新对象，排除 originalOrder 字段
    const { originalOrder, ordType, gridCount, ...rest } = item;

    // 返回处理后的对象
    return {
      ...rest,
      order_status: 'confirmed',
      order_desc: '- 反弹下单',
      grid_count: item.gridCount || item.grid_count, // 保持原有的grid_count值
    };
  });

// 写回文件
fs.writeFileSync(filePath, JSON.stringify(transformedData, null, 2), 'utf8');

console.log('文件处理完成');
