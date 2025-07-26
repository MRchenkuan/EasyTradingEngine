import { BarType, SettlementType, StrategyType, TradeEnv } from './src/enum.js';

// export const Env = TradeEnv.MIMIC;
export const Env = TradeEnv.PRODUCTION;

export const KLine = {
  bar_type: BarType.MINUTE_5,
  max_days: 720,
  candle_limit: 2000,
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
      _base_amount: 20, // 每笔交易量
      _base_lots: 10, // 每笔交易的份数
      _settlement_type: SettlementType.AMOUNT, //交易单位 amount 等额，lots 等数量
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
      _max_price: 4200,
      _base_amount: 20,
      _base_lots: 10,
      _settlement_type: SettlementType.AMOUNT, //交易单位 amount 等额，lots 等数量
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
      _base_amount: 20,
      _base_lots: 10,
      _settlement_type: SettlementType.AMOUNT, //交易单位 amount 等额，lots 等数量
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
      _base_amount: 40,
      _base_lots: 10,
      _settlement_type: SettlementType.AMOUNT, //交易单位 amount 等额，lots 等数量
    },
  },
];
