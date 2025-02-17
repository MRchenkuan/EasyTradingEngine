import fs from 'fs'
import path from 'path'

// 获取当前文件的目录路径
const __dirname = path.dirname(new URL(import.meta.url).pathname);
// 文件路径
const filePath = path.join(__dirname, '../β.json');

// 写入键值对到β.json文件中，如果key相同则覆盖
export function writeKeyValuePair(key, value) {
    try {
        // 读取现有内容
        let data = {};
        if (fs.existsSync(filePath)) {
            const content = fs.readFileSync(filePath, 'utf-8');
            data = JSON.parse(content);
        }

        // 更新键值对
        data[key] = value;

        // 写入文件
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
        console.log(`Key "${key}" has been written to file.`);
    } catch (error) {
        console.error('Error writing key-value pair:', error);
    }
}

// 读取文件的最后n行
export function readLastNKeyValues(n) {
  try {
      if (!fs.existsSync(filePath)) {
          console.log('File does not exist.');
          return {};
      }

      // 读取文件内容
      const content = fs.readFileSync(filePath, 'utf-8');
      const data = JSON.parse(content);

      // 获取所有键值对并转换为数组
      const keyValuePairs = Object.entries(data);

      // 获取最后n个键值对
      const lastNKeyValues = keyValuePairs.slice(-n);

      // 将数组转换回对象
      const result = Object.fromEntries(lastNKeyValues);
      return result;
  } catch (error) {
      console.error('Error reading file:', error);
      return {};
  }
}