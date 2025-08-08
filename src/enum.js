export const SettlementType = Object.freeze({
  VALUE: 'VALUE', // 等额
  QUANTITY: 'QUANTITY', // 等份
});

export const BarType = Object.freeze({
  SECOND: '1s',
  MINUTE: '1m',
  MINUTE_5: '5m',
  MINUTE_15: '15m',
  HOUR: '1H',
  DAY: '1D',
});

export const OrderStatus = Object.freeze({
  PENDING: 'pending',
  FAILED: 'failed',
  UNSUCESS: 'unsuccess',
  PLACED: 'placed',
  CONFIRMED: 'confirmed',
  CONFIRM_FAILED: 'confirm_failed',
  CONFIRM_ERROR: 'confirm_error',
});

export const TradeEnv = Object.freeze({
  MIMIC: 'mimic',
  PRODUCTION: 'production',
});

export const StrategyType = Object.freeze({
  GRID_TRADING: 'grid_trading',
  SCALPING_TRADING: 'scalping_trading',
  HEDGE_TRADING: 'hedge_trading',
});

export const StopLossLevel = Object.freeze({
  NORMAL: 'NORMAL',
  SUPPRESS: 'SUPPRESS',
  SURVIVAL: 'SURVIVAL',
  SINGLE_SUPPRESS: 'SINGLE_SUPPRESS',
  SINGLE_SURVIVAL: 'SINGLE_SURVIVAL',
  SINGLE_KILL: 'SINGLE_KILL',
});
