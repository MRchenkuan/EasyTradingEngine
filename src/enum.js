export const SettlementType = Object.freeze({
  AMOUNT: 'AMOUNT', // 等额
  LOTS: 'LOTS', // 等份
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
  NORMAL: 'normal',
  SUPPRESS: 'suppress',
  SURVIVAL: 'survival',
  SINGLE_SUPPRESS: 'single_suppress',
  SINGLE_SURVIVAL: 'single_survival',
  SINGLE_KILL: 'single_kill',
});