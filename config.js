import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { BarType, SettlementType, StrategyType, TradeEnv } from './src/enum.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const strategiesPath = path.join(__dirname, 'records/strategies.json');

// ==================== 策略配置（从 JSON 文件读取，支持运行时更新） ====================

let _strategiesConfig = null;
function loadStrategiesConfig() {
  try {
    const raw = fs.readFileSync(strategiesPath, 'utf-8');
    _strategiesConfig = JSON.parse(raw);
  } catch (e) {
    console.error(`[config] 读取 ${strategiesPath} 失败，使用默认配置:`, e.message);
    _strategiesConfig = { assets: [], order_his_show: [] };
  }
}
loadStrategiesConfig();

// MainGraph.assets — 从 JSON 提取 {id, theme}
const _mainGraphAssets = _strategiesConfig.assets.map(a => ({ id: a.assetId, theme: a.theme }));

// Strategies — 从 JSON 提取 {name, params}，_settlement_type 字符串转枚举
const _strategyList = _strategiesConfig.assets.map(a => ({
  name: StrategyType.GRID_TRADING,
  params: {
    assetId: a.assetId,
    ...a.params,
    _settlement_type: SettlementType[a.params._settlement_type] || SettlementType.VALUE,
  },
}));

// ==================== 运行时配置（从 JSON 文件读取，支持重启更新） ====================

export const Env = TradeEnv[_strategiesConfig.env] || TradeEnv.PRODUCTION;
export const trade_open = _strategiesConfig.trade_open ?? false;
export const disable_chart = _strategiesConfig.disable_chart ?? false;

// ==================== 风控配置 ====================
// 清仓阈值从 JSON 读取，其余为代码默认值
const _liquidationThreshold = _strategiesConfig.drawdown_liquidation_threshold ?? 0.19;

export const RiskControl = {
  // 回撤控制（口径见 docs/drawdown-liquidation-design.md）
  drawdown_liquidation_threshold: _liquidationThreshold,
  drawdown_warn_threshold: 0.1, // 纯展示用，无业务行为
  // 余额跳变防护：raw 与 confirmed 偏差超此阈值视为可疑，需连续两次相近才采纳
  // 阈值 0.3 > 回撤清仓线 0.2，保证真实 20% 回撤能即时反映，仅 >30% 的跳变需确认
  balance_jump_threshold: 0.3,
  balance_refresh_interval: 10000, // 账户余额刷新间隔（30 秒）
  // 实际账户杠杆等级阈值：<3x 正常 / 3~8x 预警 / >8x 危险
  leverage_warn_threshold: 3,
  leverage_danger_threshold: 8,
  // 止损下单失败重试次数
  liquidation_max_retry: 10,
};

export const KLine = {
  max_days: 3650,
  bar_type: BarType.MINUTE_5,
  candle_limit: {
    [TradeEnv.MIMIC]: 1000,
    [TradeEnv.PRODUCTION]: trade_open ? 3000 : 1000,
  }[Env],
  open_inerest_limit: Env === TradeEnv.PRODUCTION && trade_open ? 3000 : 100,
};

export const MainGraph = {
  assets: _mainGraphAssets,
  order_his_show: _strategiesConfig.order_his_show,
};

export const Strategies = _strategyList;
