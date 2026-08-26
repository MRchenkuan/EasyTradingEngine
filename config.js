import { BarType, SettlementType, StrategyType, TradeEnv } from './src/enum.js';

export const Env = TradeEnv.MIMIC;
// export const Env = TradeEnv.PRODUCTION;

export const trade_open = true;
// export const trade_open = false;

// ==================== 风控配置 ====================
export const RiskControl = {
  // 回撤控制（口径见 docs/drawdown-liquidation-design.md）
  drawdown_liquidation_threshold: 0.19, // 回撤达到 20% 触发清仓
  drawdown_warn_threshold: 0.1, // 回撤达到 10% 预警展示
  // 余额跳变防护：raw 与 confirmed 偏差超此阈值视为可疑，需连续两次相近才采纳
  // 阈值 0.3 > 回撤清仓线 0.2，保证真实 20% 回撤能即时反映，仅 >30% 的跳变需确认
  balance_jump_threshold: 0.3,
  balance_refresh_interval: 10000, // 账户余额刷新间隔（30 秒）
  // 实际账户杠杆等级阈值：<3x 正常 / 3~8x 预警 / >8x 危险
  leverage_warn_threshold: 3,
  leverage_danger_threshold: 8,
  // 清仓下单失败重试次数
  liquidation_max_retry: 3,
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
  assets: [
    { id: 'BTC-USDT-SWAP', theme: '#f0b27a' }, // 主参照
    { id: 'SOL-USDT-SWAP', theme: '#ad85e9' },
    { id: 'ETH-USDT-SWAP', theme: '#85c1e9' },
    { id: 'XRP-USDT-SWAP', theme: '#ffafde' },
    // { id: 'TRUMP-USDT-SWAP', theme: '#03fe07' },
  ],
  order_his_show: [
    // 'BTC-USDT',
    // 'ETH-USDT',
    // 'XRP-USDT',
  ],
};

export const Strategies = [
  {
    name: StrategyType.GRID_TRADING,
    params: {
      assetId: 'XRP-USDT-SWAP',
      // _grid_base_price: 2.0, //建仓基准价
      _upper_drawdown: 0.0075,
      _lower_drawdown: 0.0075,
      _grid_width: 0.005,
      _min_price: 0.5,
      _max_price: 5.0,
      _base_amount: 30, // 每笔交易量
      _base_quantity: 10, // 每笔交易的份数
      _suppress_lots: 15, // 持仓警戒线
      _survival_lots: 20, // 持仓止损线
      _settlement_type: SettlementType.VALUE, //交易单位 value 等金额，quantity 等数量
    },
  },
  {
    name: StrategyType.GRID_TRADING,
    params: {
      assetId: 'ETH-USDT-SWAP',
      _upper_drawdown: 0.0075,
      _lower_drawdown: 0.0075,
      _grid_width: 0.005,
      _min_price: 1200,
      _max_price: 6000,
      _base_amount: 30,
      _base_quantity: 10,
      _suppress_lots: 15, // 持仓警戒线
      _survival_lots: 20, // 持仓止损线
      _settlement_type: SettlementType.VALUE, //交易单位 value 等金额，quantity 等数量
    },
  },
  {
    name: StrategyType.GRID_TRADING,
    params: {
      assetId: 'SOL-USDT-SWAP',
      // _grid_base_price: 2.0, //建仓基准价
      _upper_drawdown: 0.0075,
      _lower_drawdown: 0.0075,
      _grid_width: 0.005,
      _min_price: 40,
      _max_price: 350,
      _base_amount: 30,
      _base_quantity: 10,
      _suppress_lots: 15, // 持仓警戒线1
      _survival_lots: 20, // 持仓止损线
      _settlement_type: SettlementType.VALUE, //交易单位 value 等金额，quantity 等数量
    },
  },
  {
    name: StrategyType.GRID_TRADING,
    params: {
      assetId: 'BTC-USDT-SWAP',
      _upper_drawdown: 0.0075,
      _lower_drawdown: 0.0075,
      _grid_width: 0.005,
      _min_price: 40000,
      _max_price: 150000,
      _swap_value: 0.01, //合约面值
      _base_amount: 60,
      _base_quantity: 10,
      _suppress_lots: 7, // 持仓警戒线
      _survival_lots: 12, // 持仓止损线
      _settlement_type: SettlementType.VALUE, //交易单位 value 等金额，quantity 等数量
    },
  },
  // {
  //   name: StrategyType.GRID_TRADING,
  //   params: {
  //     assetId: 'TRUMP-USDT-SWAP',
  //     _upper_drawdown: 0.0075,
  //     _lower_drawdown: 0.0075,
  //     _grid_width: 0.01,
  //     _min_price: 0.5,
  //     _max_price: 5.0,
  //     _swap_value: 0.01, //合约面值
  //     _base_amount: 10,
  //     _base_quantity: 10,
  //     _suppress_lots: 7, // 持仓警戒线
  //     _survival_lots: 12, // 持仓止损线
  //     _settlement_type: SettlementType.VALUE, //交易单位 value 等金额，quantity 等数量
  //   },
  // },
];
