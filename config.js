import { BarType, SettlementType, StrategyType, TradeEnv } from './src/enum.js';

// export const Env = TradeEnv.MIMIC;
export const Env = TradeEnv.PRODUCTION;

// export const trade_open = true;
export const trade_open = false;

export const KLine = {
  bar_type: BarType.MINUTE_5,
  max_days: 3650,
  candle_limit: 3000,
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
      _min_price: 2.0,
      _max_price: 4.0,
      _base_amount: 30, // 每笔交易量
      _base_quantity: 10, // 每笔交易的份数
      _position_supress_count: 6, // 持仓警戒线
      _position_survival_count: 10, // 持仓止损线
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
      _min_price: 1500,
      _max_price: 5000,
      _base_amount: 30,
      _base_quantity: 10,
      _position_supress_count: 6, // 持仓警戒线
      _position_survival_count: 10, // 持仓止损线
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
      _min_price: 120,
      _max_price: 220,
      _base_amount: 30,
      _base_quantity: 10,
      _position_supress_count: 6, // 持仓警戒线
      _position_survival_count: 10, // 持仓止损线
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
      _min_price: 90000,
      _max_price: 130000,
      _swap_value: 0.01, //合约面值
      _base_amount: 60,
      _base_quantity: 10,
      _position_supress_count: 6, // 持仓警戒线
      _position_survival_count: 10, // 持仓止损线
      _settlement_type: SettlementType.VALUE, //交易单位 value 等金额，quantity 等数量
    },
  },
];
