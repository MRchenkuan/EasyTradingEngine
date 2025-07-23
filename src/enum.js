export const SettlementType = Object.freeze({
  AMOUNT: 'AMOUNT', // 等额
  LOTS: 'LOTS', // 等份
});


export const BarType = Object.freeze({
  MINUTE: '1m',
  MINUTE_5: '5m',
  MINUTE_15: '15m',
  MINUTE_30: '30m',
  HOUR: '1h',
  DAY: '1d',
})

export const OrderStatus = Object.freeze({
  PENDING:'pending',
  FAILED:'failed',
  UNSUCESS:'unsuccess',
  PLACED:'placed',
  CONFIRMED:'confirmed',
  CONFIRM_FAILED:'confirm_failed',
  CONFIRM_ERROR:'confirm_error',
})