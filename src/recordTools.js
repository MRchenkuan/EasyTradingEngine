import fs from 'fs'
import path from 'path'
import { hashString } from './tools.js';
import { generateCounterBasedId } from './uuid.js';

// 获取当前文件的目录路径
const __dirname = path.dirname(new URL(import.meta.url).pathname);
// 文件路径
const filePath_beta = path.join(__dirname, '../β.json');
const filePath_trade_results_opening = path.join(__dirname, '../trade-results-opening.json');
const filePath_trade_results_closing = path.join(__dirname, '../trade-results-closing.json');


export function recordOpeningTransactions(tradeId, orders) {
    try {
        // 读取现有内容
        let data = {};
        if (fs.existsSync(filePath_trade_results_opening)) {
            const content = fs.readFileSync(filePath_trade_results_opening, 'utf-8');
            data = JSON.parse(content);
        }

        // 更新键值对
        data[tradeId]={
            tradeId, side:"open", orders
        };

        // 写入文件
        fs.writeFileSync(filePath_trade_results_opening, JSON.stringify(data, null, 2), 'utf-8');
        return tradeId;
    } catch (error) {
        console.error('订单记录错误:', error);
    }
}

export function recordClosingTransactions(tradeId, profit, orders) {
    try {
        // 读取现有内容
        let data = {};
        if (fs.existsSync(filePath_trade_results_closing)) {
            const content = fs.readFileSync(filePath_trade_results_closing, 'utf-8');
            data = JSON.parse(content);
        }

        // 更新键值对
        data[tradeId]={
            tradeId, side:"closing", profit, orders
        };

        // 写入文件
        fs.writeFileSync(filePath_trade_results_closing, JSON.stringify(data, null, 2), 'utf-8');
    } catch (error) {
        console.error('订单记录错误:', error);
    }
}

export function readOpeningTransactions(tradeId) {
    try {
        if (!fs.existsSync(filePath_trade_results_opening)) {
            console.log('File does not exist.');
            return {};
        }
  
        // 读取文件内容
        const content = fs.readFileSync(filePath_trade_results_opening, 'utf-8');
        const data = JSON.parse(content);
        return data[tradeId];
    } catch (error) {
        console.error('订单读取错误:', error);
        return {};
    }
  }


// 写入键值对到β.json文件中，如果key相同则覆盖
export function writeKeyValuePair(key, value) {
    try {
        // 读取现有内容
        let data = {};
        if (fs.existsSync(filePath_beta)) {
            const content = fs.readFileSync(filePath_beta, 'utf-8');
            data = JSON.parse(content);
        }

        // 更新键值对
        data[key] = value;

        // 写入文件
        fs.writeFileSync(filePath_beta, JSON.stringify(data, null, 2), 'utf-8');
    } catch (error) {
        console.error('Error writing key-value pair:', error);
    }
}

// 读取文件的最后n行
export function readLastNKeyValues(n) {
  try {
      if (!fs.existsSync(filePath_beta)) {
          console.log('File does not exist.');
          return {};
      }

      // 读取文件内容
      const content = fs.readFileSync(filePath_beta, 'utf-8');
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