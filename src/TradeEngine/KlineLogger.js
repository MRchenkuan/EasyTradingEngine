import fs from 'fs';
import path from 'path';
import { parseCandleData, formatTimestamp, safeParseFloat } from '../tools.js';

const LOG_DIR = path.join(process.cwd(), 'kline_data');

// 上次刷盘时间
let lastFlushTime = 0;
// 刷盘间隔（毫秒）
const FLUSH_INTERVAL = 5000;

/**
 * 确保 kline_data 目录和资产子目录存在
 */
function ensureDir(assetId, barType) {
  const dir = path.join(LOG_DIR, assetId, String(barType));
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * 根据 candle 时间戳确定所属的日期切片文件名
 * @param {number|string} ts - 时间戳（毫秒）
 * @param {string} barType - K线周期
 * @returns {string} 文件名，如 '2025-06-15.jsonl'
 */
function getSliceFileName(ts, barType) {
  const date = new Date(Number(ts));
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}.jsonl`;
}

// 写入缓冲：key = "assetId:barType:日期切片"，value = Map<ts, candle>
// 同一 ts 只保留最新，避免重复记录
const writeBufferMaps = new Map();

/**
 * 记录单条 K 线数据
 */
export function logCandle(assetId, barType, candle) {
  const fileName = getSliceFileName(candle.ts, barType);
  const key = `${assetId}:${barType}:${fileName}`;
  if (!writeBufferMaps.has(key)) {
    writeBufferMaps.set(key, { assetId, barType, fileName, tsMap: new Map() });
  }
  // 同 ts 只保留最新
  writeBufferMaps.get(key).tsMap.set(String(candle.ts), candle);
}

/**
 * 批量记录 K 线数据（初始化时用）
 */
export function logCandles(assetId, barType, candleArray) {
  for (const candle of candleArray) {
    logCandle(assetId, barType, candle);
  }
}

/**
 * 将缓冲中的数据刷盘到文件
 * 同一 ts 只写一行，写入前检查文件末尾是否有相同 ts 则替换
 */
export function flush() {
  for (const [key, group] of writeBufferMaps.entries()) {
    if (group.tsMap.size === 0) continue;

    const dir = ensureDir(group.assetId, group.barType);
    const filePath = path.join(dir, group.fileName);

    // 将缓冲中的 candle 按 ts 排序
    const sortedTs = [...group.tsMap.keys()].sort((a, b) => Number(a) - Number(b));
    const newLines = sortedTs.map(ts => JSON.stringify(group.tsMap.get(ts)));

    if (fs.existsSync(filePath)) {
      // 读取文件已有内容
      const content = fs.readFileSync(filePath, 'utf8');
      const existingLines = content.trim().split('\n').filter(Boolean);

      // 找出缓冲中哪些 ts 已存在于文件中
      const bufferTsSet = new Set(sortedTs);
      const existingTsMap = new Map();
      for (let i = 0; i < existingLines.length; i++) {
        try {
          const obj = JSON.parse(existingLines[i]);
          existingTsMap.set(String(obj.ts), i);
        } catch (e) {}
      }

      // 需要替换的行和新增的行
      const replaceIndices = [];
      const appendLines = [];
      for (let i = 0; i < sortedTs.length; i++) {
        const ts = sortedTs[i];
        if (existingTsMap.has(ts)) {
          // 替换已有行
          existingLines[existingTsMap.get(ts)] = newLines[i];
        } else {
          // 新增行
          appendLines.push(newLines[i]);
        }
      }

      // 写回：已有行（部分替换）+ 新增行
      const finalContent = existingLines.concat(appendLines).join('\n') + '\n';
      fs.writeFileSync(filePath, finalContent, 'utf8');
    } else {
      // 文件不存在，直接写入
      fs.writeFileSync(filePath, newLines.join('\n') + '\n', 'utf8');
    }

    group.tsMap.clear();
  }
  lastFlushTime = Date.now();
}

/**
 * 启动定时刷盘
 */
let flushTimer = null;
export function startAutoFlush() {
  if (flushTimer) return;
  flushTimer = setInterval(() => {
    flush();
  }, FLUSH_INTERVAL);
  console.log(`[KlineLogger] 自动刷盘已启动，间隔 ${FLUSH_INTERVAL / 1000}s`);
}

/**
 * 停止定时刷盘并执行最后一次刷盘
 */
export function stopAutoFlush() {
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
  flush(); // 最后一次刷盘
  console.log('[KlineLogger] 自动刷盘已停止');
}

/**
 * 加载指定资产的历史 K 线数据
 * @param {string} assetId
 * @param {string} barType
 * @param {number} [maxDays=30] - 加载最近多少天的数据
 * @returns {Array} candle 数组
 */
export function loadCandles(assetId, barType, maxDays = 30) {
  const dir = path.join(LOG_DIR, assetId, String(barType));
  if (!fs.existsSync(dir)) {
    return [];
  }

  const files = fs
    .readdirSync(dir)
    .filter(f => f.endsWith('.jsonl'))
    .sort();
  // 只取最近 maxDays 天的文件
  const recentFiles = files.slice(-maxDays);

  const candles = [];
  for (const file of recentFiles) {
    const filePath = path.join(dir, file);
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.trim().split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        candles.push(JSON.parse(line));
      } catch (e) {
        // 跳过损坏的行
      }
    }
  }

  // 按 ts 去重（同一时间戳只保留最后一条）
  const map = new Map();
  for (const c of candles) {
    map.set(String(c.ts), c);
  }

  // 按 ts 排序
  const sorted = [...map.values()].sort((a, b) => Number(a.ts) - Number(b.ts));
  console.log(
    `[KlineLogger] 加载 ${assetId}(${barType}) 历史 K 线: ${sorted.length} 条, 日期范围: ${sorted.length > 0 ? formatTimestamp(sorted[0].ts) + ' ~ ' + formatTimestamp(sorted[sorted.length - 1].ts) : '无'}`
  );
  return sorted;
}

/**
 * 获取日志目录路径
 */
export function getLogDir() {
  return LOG_DIR;
}

/**
 * 从本地 jsonl 加载完整行情数据，用于启动时跳过 REST
 * @param {string} assetId
 * @param {string|number} barType
 * @param {object} [options]
 * @param {number} [options.maxDays=30] - 加载最近多少天
 * @param {string} [options.priceField='close'] - 价格字段
 * @param {number} [options.stalenessMs=2*60*60*1000] - 允许的最大新鲜度（默认 2 小时）
 * @returns {{
 *   hit: boolean,              // 本地数据是否可用（够新 + 够量）
 *   reason?: string,           // hit=false 时的原因
 *   data?: {                   // hit=true 时返回完整数据
 *     id: string,
 *     prices: number[],
 *     ts: number[],
 *     orign_data: object[]     // candle 对象数组（非 REST 原始数组，但 TradeEngine.updateCandleDates 能处理）
 *   },
 *   lastTs?: number,           // 本地最后一根 K 线的 ts，供补 REST 时使用
 *   candleCount?: number
 * }}
 */
export function loadMarketData(assetId, barType, options = {}) {
  const { maxDays = 30, priceField = 'close', stalenessMs = 2 * 60 * 60 * 1000 } = options;

  const dir = path.join(LOG_DIR, assetId, String(barType));
  if (!fs.existsSync(dir)) {
    return { hit: false, reason: `本地目录不存在: ${dir}` };
  }

  const candles = loadCandles(assetId, barType, maxDays);
  if (candles.length === 0) {
    return { hit: false, reason: '本地无 K 线数据' };
  }

  const lastTs = Number(candles[candles.length - 1].ts);
  const ageMs = Date.now() - lastTs;

  if (ageMs > stalenessMs) {
    return {
      hit: false,
      reason: `本地数据过旧: 最后一根 ${formatTimestamp(lastTs)}, 距今 ${(ageMs / 3600000).toFixed(1)}h > ${(stalenessMs / 3600000).toFixed(1)}h`,
      lastTs,
      candleCount: candles.length,
    };
  }

  // 本地或ign_data 是 parse 后的对象 { ts, open, high, low, close, vol, ... }
  // TradeEngine.updateCandleDates 会再 parseCandleData —— 但它期望 REST 原始数组格式
  // 这里转成 REST 原始数组格式（跟 getPrices/getHistoryPrices 返回的 orign_data 一致）
  const orign_data = candles.map(c => [
    String(c.ts),
    c.open,
    c.high,
    c.low,
    c.close,
    c.vol,
    c.vol_ccy,
    c.val_ccy_quote,
    c.confirm,
  ]);

  const prices = candles.map(it => safeParseFloat(it[priceField] ?? it.close));
  const ts = candles.map(it => Number(it.ts));

  console.log(
    `[KlineLogger] ✅ 本地命中 ${assetId}(${barType}): ${candles.length} 根, 最后 ${formatTimestamp(lastTs)}, 距今 ${(ageMs / 3600000).toFixed(2)}h`
  );

  return {
    hit: true,
    lastTs,
    candleCount: candles.length,
    data: { id: assetId, prices, ts, orign_data },
  };
}
