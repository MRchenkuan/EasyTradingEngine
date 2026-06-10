import { PositionAction, PositionCompositeRiskLevel } from '../../../enum.js';

export function TradeFreqController(params) {
  const {
    last_open_grid_span,
    last_close_grid_span,
    grid_span_abs,
    position_action,
    time_since_last_trade,
    risk_level,
  } = params;

  // 节流重置时间
  const throttleResetTime = 420 * 60 * 1000;
  // 最大节流距离
  const maxThrottleDistance = 10;

  const isSerialTrade = {
    [PositionAction.OPEN]: last_open_grid_span > 0,
    [PositionAction.CLOSE]: last_close_grid_span > 0,
  }[position_action];

  const { ISOLATE_HIGHT, ISOLATE_EMERGENCY, DUAL_EMERGENCY, DUAL_HIGH, CROSS_EMERGENCY } =
    PositionCompositeRiskLevel;

  const lastTradeGridSpan = {
    [PositionAction.OPEN]: last_open_grid_span,
    [PositionAction.CLOSE]: last_close_grid_span,
  }[position_action];

  // 节流距离计算
  const throttleSpan = {
    emergency: 1 + lastTradeGridSpan * 2,
    high: 1 + lastTradeGridSpan * 1.5,
    low: 1 + lastTradeGridSpan * 1.25,
  };

  // 风险等级分组
  const emergencyRiskLevels = [ISOLATE_EMERGENCY, DUAL_EMERGENCY, DUAL_HIGH];
  const highRiskLevels = [ISOLATE_HIGHT, DUAL_HIGH, CROSS_EMERGENCY];

  const isEmergencyRisk = emergencyRiskLevels.includes(risk_level);
  const isHighRisk = highRiskLevels.includes(risk_level);

  const isOpen = position_action === PositionAction.OPEN;
  const isClose = position_action === PositionAction.CLOSE;

  // 各条件是否通过（true=允许交易，false=被该条件阻止）
  // 通用条件：任一满足即可放行
  const passNotSerialTrade = !isSerialTrade;
  const passOverThrottleResetTime = time_since_last_trade > throttleResetTime;
  const passOverThrottleDistance = grid_span_abs > maxThrottleDistance;

  // 平仓条件
  const passCloseEmergencyNoThrottle = isClose && isEmergencyRisk;
  const passCloseHighRiskSpan = isClose && isHighRisk && grid_span_abs >= throttleSpan.high;
  const passCloseLowRiskSpan = isClose && grid_span_abs >= throttleSpan.low;

  // 开仓条件
  const passOpenEmergencySpan =
    isOpen && isEmergencyRisk && grid_span_abs >= throttleSpan.emergency;
  const passOpenHighRiskSpan = isOpen && isHighRisk && grid_span_abs >= throttleSpan.high;
  const passOpenLowRiskSpan = isOpen && grid_span_abs >= throttleSpan.low;

  const args = {
    // 通用条件
    passNotSerialTrade,
    passOverThrottleResetTime,
    passOverThrottleDistance,

    // 平仓条件
    passCloseEmergencyNoThrottle: isClose ? passCloseEmergencyNoThrottle : undefined,
    passCloseHighRiskSpan: isClose && isHighRisk ? passCloseHighRiskSpan : undefined,
    passCloseLowRiskSpan: isClose ? passCloseLowRiskSpan : undefined,

    // 开仓条件
    passOpenEmergencySpan: isOpen && isEmergencyRisk ? passOpenEmergencySpan : undefined,
    passOpenHighRiskSpan: isOpen && isHighRisk ? passOpenHighRiskSpan : undefined,
    passOpenLowRiskSpan: isOpen ? passOpenLowRiskSpan : undefined,
  };

  // 非连续交易不节流
  if (!isSerialTrade) {
    return {
      shouldTrade: true,
      ...args,
    };
  }

  // 开仓/平仓距离超过最大节流时间不节流
  if (time_since_last_trade > throttleResetTime) {
    return {
      shouldTrade: true,
      ...args,
    };
  }

  // 开仓/平仓距离超过最大节流距离不节流
  if (grid_span_abs > maxThrottleDistance) {
    return {
      shouldTrade: true,
      ...args,
    };
  }

  // 对于平仓，根据风险设定节流距离
  if (position_action === PositionAction.CLOSE) {
    // 1 在紧急状况下，不节流
    if (isEmergencyRisk) {
      return {
        shouldTrade: true,
        ...args,
      };
    }
    // 2 在高风险下，有限节流
    if (isHighRisk && grid_span_abs < throttleSpan.high) {
      return {
        shouldTrade: false,
        ...args,
      };
    }
    // 3 在低风险下，常规节流
    if (grid_span_abs < throttleSpan.low) {
      return {
        shouldTrade: false,
        ...args,
      };
    }
  }

  // 对于开仓，根据风险设定节流距离
  if (position_action === PositionAction.OPEN) {
    // 1 在紧急状况下，高度节流
    if (isEmergencyRisk && grid_span_abs < throttleSpan.emergency) {
      return {
        shouldTrade: false,
        ...args,
      };
    }
    // 2 在高风险下，强化节流
    if (isHighRisk && grid_span_abs < throttleSpan.high) {
      return {
        shouldTrade: false,
        ...args,
      };
    }
    // 3 在低风险下，常规节流
    if (grid_span_abs < throttleSpan.low) {
      return {
        shouldTrade: false,
        ...args,
      };
    }
  }

  // 兜底
  return {
    shouldTrade: true,
    ...args,
  };
}
