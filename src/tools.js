import { marketCandles } from './api.js'
import crypto from 'crypto'

// 生成签名的函数
export function generateSignature(timestamp, method, requestPath, body, secretKey) {
  // sign=CryptoJS.enc.Base64.stringify(CryptoJS.HmacSHA256(timestamp +'GET'+ '/users/self/verify', secret))
  const message = `${timestamp}${method}${requestPath}${body}`;
  const hmac = crypto.createHmac('sha256', secretKey);
  hmac.update(message);
  return hmac.digest('base64');
}



export function safeParseFloat(str) {
  const num = parseFloat(str);
  if (isNaN(num)) {
      console.warn("Invalid input:", str);
      return null; // 或者返回默认值
  }
  return num;
}



export function toTrickTimeMark(data){
  return data.map(it=>formatTimestamp(it))
}

export function formatTimestamp(timestamp) {
  const date = new Date(parseInt(timestamp));
  // 获取月、日、小时和分钟
  const month = String(date.getMonth() + 1).padStart(2, '0');  // 获取月份（0-11），加1得到1-12
  const day = String(date.getDate()).padStart(2, '0');          // 获取日期
  const hours = String(date.getHours()).padStart(2, '0');       // 获取小时
  const minutes = String(date.getMinutes()).padStart(2, '0');   // 获取分钟
  // 格式化为 MM-DD HH:mm
  return `${month}-${day} ${hours}:${minutes}`;
}

export function parseCandleData(data){
  return {
    ts: data[0],
    open: data[1],
    high: data[2],
    low:data[3],
    close: data[4],
    vol:data[5],
    vol_ccy:data[6],
    val_ccy_quote: data[7],
    confirm: data[8]
  }
}


export async function getPrices(assetId, {
  to_when,
  from_when,
  bar_type,
  price_type,
  once_limit,
  candle_limit
}){
  const limit=candle_limit,bar=bar_type, feild=price_type;
  try{
    let times = Math.trunc(limit/once_limit)
    let collections = []
    let last_ts =  from_when||Date.now();
    while(times-->0){
      const { data } = await marketCandles(assetId, bar, last_ts,to_when, once_limit);
      console.log(assetId, formatTimestamp(last_ts), bar, data.length)
      if(!(data && data.length>0)) break; 
      last_ts = parseCandleData(data[data.length-1])['ts']
      collections = collections.concat(data);
    }
    return {
      prices:collections.map(it=>safeParseFloat(parseCandleData(it)[feild])),
      ts:collections.map(it=>parseCandleData(it)['ts']),
    }
  }catch(e){
    console.error(e)
  }
}


export function dataset(data){
  // return calculateReturns(data.slice().reverse()).map(it=>it*100)
  return data.slice().reverse();
}

export function getTsOfStartOfToday(){
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return startOfDay.getTime();
}


export function throttleAsync(fn, delay) {
  let isRunning = false; // 是否正在执行
  let lastArgs = null;   // 最新的参数
  let timeout = null;    // 定时器

  async function invoke() {
      if (!lastArgs) return; // 没有待处理的调用，直接返回
      isRunning = true;
      await fn(...lastArgs); // 执行异步函数
      lastArgs = null;       // 清空参数，避免重复执行
      timeout = setTimeout(() => {
          isRunning = false;
          if (lastArgs) invoke(); // 如果有新的调用请求，执行它
      }, delay);
  }

  return (...args) => {
      lastArgs = args; // 记录最新参数
      if (!isRunning) invoke(); // 仅当没有正在运行的任务时才调用
  };
}


export function getLastWholeMinute(now, m=1, s=30) {

  now.setMinutes(now.getMinutes() - m); // 减去 1 分钟
  now.setSeconds(now.getSeconds() - s); // 再减去 30 秒

  return now.getTime();
}