import fs from 'fs'
import path from 'path'

// 获取当前文件的目录路径
const __dirname = path.dirname(new URL(import.meta.url).pathname);
// 文件路径
const filePath_beta = path.join(__dirname, '../records/β.json');
const filePath_trade_results_opening = path.join(__dirname, '../records/trade-results-opening.json');
const filePath_trade_results_closing = path.join(__dirname, '../records/trade-results-closing.json');
const filePath_trade_results_makert_maker = path.join(__dirname, '../records/trade-market-maker.json');
const filePath_beta_map = path.join(__dirname, '../records/realtime-beta-map.json');
const filePath_price = path.join(__dirname, '../records/realtime-price.json');

export function getOpeningTransaction(transId){
    const file_path = filePath_trade_results_opening;
    try {
        // 读取现有内容
        let data = [];
        if (fs.existsSync(file_path)) {
            const content = fs.readFileSync(file_path, 'utf-8');
            data = JSON.parse(content);
            if (!Array.isArray(data)) data = [];
        }

        // 更新键值对
        return data.find(it=>it.tradeId==transId);

        // 写入文件
    } catch (error) {
        console.error('错误:', error);
    }
}

export function getClosingTransaction(transId){
    const file_path = filePath_trade_results_closing;
    try {
        // 读取现有内容
        let data = [];
        if (fs.existsSync(file_path)) {
            const content = fs.readFileSync(file_path, 'utf-8');
            data = JSON.parse(content);
            if (!Array.isArray(data)) data = [];
        }

        // 更新键值对
        return data.find(it=>it.tradeId==transId);

        // 写入文件
    } catch (error) {
        console.error('错误:', error);
    }
}

export function getLastTransactions(last_n,type){
    const file_path = {
        "opening":filePath_trade_results_opening,
        "closing":filePath_trade_results_closing
    }[type]
    try {
        // 读取现有内容
        let data = [];
        if (fs.existsSync(file_path)) {
            const content = fs.readFileSync(file_path, 'utf-8');
            data = JSON.parse(content);
            if (!Array.isArray(data)) data = [];
        }

        // 更新键值对
        return data.slice(-last_n)

        // 写入文件
    } catch (error) {
        console.error('订单记录错误:', error);
    }
}

// 更新开平仓单
export function updateTransaction(tradeId, type, args){
    const file_path = {
        "opening":filePath_trade_results_opening,
        "closing":filePath_trade_results_closing
    }[type]
    try {
        // 读取现有内容
        let data = [];
        if (fs.existsSync(file_path)) {
            const content = fs.readFileSync(file_path, 'utf-8');
            data = JSON.parse(content);
            if (!Array.isArray(data)) data = [];
        }

        const index = data.findIndex(item => item.tradeId === tradeId);


        // 更新键值对
        data[index]={
            ...data[index], ...args
        };

        // 写入文件
        fs.writeFileSync(file_path, JSON.stringify(data, null, 2), 'utf-8');
        return tradeId;
    } catch (error) {
        console.error('订单记录错误:', error);
    }
}


export function recordOpeningTransactions(tradeId, orders) {
    try {
        // 读取现有内容
        let data = [];
        if (fs.existsSync(filePath_trade_results_opening)) {
            const content = fs.readFileSync(filePath_trade_results_opening, 'utf-8');
            data = JSON.parse(content);
            if (!Array.isArray(data)) data = [];
        }

        const index = data.findIndex(item => item.tradeId === tradeId);
        const record = {
            tradeId, side:"opening", closed:false, orders
        }
        if(index<0) {
            data.push(record);
        } else {
            data[index]=record;
        }


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
        let data = [];
        if (fs.existsSync(filePath_trade_results_closing)) {
            const content = fs.readFileSync(filePath_trade_results_closing, 'utf-8');
            data = JSON.parse(content);
            if (!Array.isArray(data)) data = [];
        }

        const index = data.findIndex(item => item.tradeId === tradeId);
        const record = {
            tradeId, side:"closing", profit, orders
        };
        if(index<0) {
            data.push(record);
        } else {
            data[index]=record;
        }
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
            return null;
        }
  
        // 读取文件内容
        const content = fs.readFileSync(filePath_trade_results_opening, 'utf-8');
        const data = JSON.parse(content);
        if (!Array.isArray(data)) data = [];

        const index = data.findIndex(item => item.tradeId === tradeId);
        return index>=0?data[index]:null;
    } catch (error) {
        console.error('订单读取错误:', error);
        return null;
    }
  }


// 写入键值对到β.json文件中，如果key相同则覆盖
export function writeBetaValue(key, value) {
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
export function readLastNBeta(n=1) {
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
export function readLastBeta() {
  try {
      if (!fs.existsSync(filePath_beta)) {
          console.log('File does not exist.');
          return {};
      }

      // 读取文件内容
      const content = fs.readFileSync(filePath_beta, 'utf-8');
      const data = JSON.parse(content);

      // 获取所有键值对并转换为数组
      return Object.values(data).pop();
  } catch (error) {
      console.error('Error reading file:', error);
      return {};
  }
}

export function recordPrice(assetId, price) {
    try {
        // 读取现有内容
        let data = {};
        if (fs.existsSync(filePath_price)) {
            const content = fs.readFileSync(filePath_price, 'utf-8');
            data = JSON.parse(content);
        }
        data[assetId] = price;
        // 写入文件
        fs.writeFileSync(filePath_price, JSON.stringify(data, null, 2), 'utf-8');
    } catch (error) {
        console.error('价格记录错误:', error);
    }
}

export function readPrice(assetId) {
    try {
        if (!fs.existsSync(filePath_price)) {
            console.log('File does not exist.');
            return null;
        }
        // 读取文件内容
        const content = fs.readFileSync(filePath_price, 'utf-8');
        const data = JSON.parse(content);
        return data[assetId]
    } catch (error) {
        console.error('订单读取错误:', error);
        return null;
    }
}


export function recordBetaMap(beta_map) {
    try {
        // 写入文件
        fs.writeFileSync(filePath_beta_map, JSON.stringify(beta_map, null, 2), 'utf-8');
    } catch (error) {
        console.error('记录错误:', error);
    }
}

export function readBetaMap() {
    try {
        if (!fs.existsSync(filePath_beta_map)) {
            console.log('File does not exist.');
            return null;
        }
        // 读取文件内容
        const content = fs.readFileSync(filePath_beta_map, 'utf-8');
        const data = JSON.parse(content);
        return data
    } catch (error) {
        console.error('读取错误:', error);
        return null;
    }
}



export function recordMarketMakerTransactions(tradeId, orders) {
    try {
        // 读取现有内容
        let data = [];
        if (fs.existsSync(filePath_trade_results_makert_maker)) {
            const content = fs.readFileSync(filePath_trade_results_makert_maker, 'utf-8');
            data = JSON.parse(content);
            if (!Array.isArray(data)) data = [];
        }

        const index = data.findIndex(item => item.tradeId === tradeId);
        const record = {
            tradeId, orders
        };
        if(index<0) {
            data.push(record);
        } else {
            data[index]=record;
        }
        // 写入文件
        fs.writeFileSync(filePath_trade_results_makert_maker, JSON.stringify(data, null, 2), 'utf-8');
    } catch (error) {
        console.error('订单记录错误:', error);
    }
}