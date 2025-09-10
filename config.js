import { BarType, SettlementType, StrategyType, TradeEnv } from './src/enum.js';

// export const Env = TradeEnv.MIMIC;
export const Env = TradeEnv.PRODUCTION;

export const trade_open = true;
// export const trade_open = false;

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
      _min_price: 1.0,
      _max_price: 5.0,
      _base_amount: 30, // 每笔交易量
      _base_quantity: 10, // 每笔交易的份数
      _suppress_lots: 10, // 持仓警戒线
      _survival_lots: 15, // 持仓止损线
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
      _suppress_lots: 10, // 持仓警戒线
      _survival_lots: 15, // 持仓止损线
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
      _min_price: 80,
      _max_price: 350,
      _base_amount: 30,
      _base_quantity: 10,
      _suppress_lots: 10, // 持仓警戒线
      _survival_lots: 15, // 持仓止损线
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
      _min_price: 60000,
      _max_price: 150000,
      _swap_value: 0.01, //合约面值
      _base_amount: 60,
      _base_quantity: 10,
      _suppress_lots: 7, // 持仓警戒线
      _survival_lots: 10, // 持仓止损线
      _settlement_type: SettlementType.VALUE, //交易单位 value 等金额，quantity 等数量
    },
  },
];
