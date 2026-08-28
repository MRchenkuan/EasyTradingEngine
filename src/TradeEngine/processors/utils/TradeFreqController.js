import { PositionAction, PositionCompositeRiskLevel } from '../../../enum.js';

export function TradeFreqController(params) {
  const {
    last_trade_grid_span, // 上次同类交易的网格跨度（统一通道，不分开仓/平仓）
    grid_span_abs,
    position_action,
    time_since_last_trade,
    risk_level,
    current_trade_side, // 本次买卖方向 (1=买, -1=卖)
    last_trade_side, // 上次买卖方向 (1=买, -1=卖, 0=无)
  } = params;

  // 节流重置时间
  const throttleResetTime = 420 * 60 * 1000;
  // 最大节流距离
  const maxThrottleDistance = 10;

  // 连续同类交易判断：基于实际买卖方向（尊重价格趋势延续性）
  // 平多(卖)→开空(卖) 仍视为连续卖出；平多(卖)→平空(买) 方向切换不视为连续
  const isSerialTradeBase = last_trade_grid_span > 0;
  const isSameTradeDirection = last_trade_side !== 0 && last_trade_side === current_trade_side;
  const isSerialTrade = isSerialTradeBase && isSameTradeDirection;

  const { ISOLATE_HIGHT, ISOLATE_EMERGENCY, DUAL_EMERGENCY, DUAL_HIGH, CROSS_EMERGENCY } =
    PositionCompositeRiskLevel;

  // 节流距离基于上次同类交易的网格跨度（统一通道）
  const lastTradeGridSpan = last_trade_grid_span;

  // 节流距离计算：开仓和平仓分开
  // 开仓：高风险高节流（需要更大跨度才放行）
  const openThrottleSpan = {
    emergency: 1 + lastTradeGridSpan * 2,
    high: 1 + lastTradeGridSpan * 1.5,
    low: 1 + lastTradeGridSpan * 1.25,
  };
  // 平仓：高风险低节流（更容易平仓以减少风险暴露）
  const closeThrottleSpan = {
    high: 1 + lastTradeGridSpan,
    low: 1 + lastTradeGridSpan * 1.25,
  };

  // 风险等级分组
  const emergencyRiskLevels = [ISOLATE_EMERGENCY, DUAL_EMERGENCY, DUAL_HIGH, CROSS_EMERGENCY];
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

  // 平仓条件（高风险低节流，更容易平仓）
  const passCloseEmergencyNoThrottle = isClose && isEmergencyRisk;
  const passCloseHighRiskSpan = isClose && isHighRisk && grid_span_abs >= closeThrottleSpan.high;
  const passCloseLowRiskSpan = isClose && grid_span_abs >= closeThrottleSpan.low;

  // 开仓条件（高风险高节流，更难开仓）
  const passOpenEmergencySpan =
    isOpen && isEmergencyRisk && grid_span_abs >= openThrottleSpan.emergency;
  const passOpenHighRiskSpan = isOpen && isHighRisk && grid_span_abs >= openThrottleSpan.high;
  const passOpenLowRiskSpan = isOpen && grid_span_abs >= openThrottleSpan.low;

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
    // 2 在高风险下，低节流（更容易平仓）
    if (isHighRisk && grid_span_abs < closeThrottleSpan.high) {
      return {
        shouldTrade: false,
        ...args,
      };
    }
    // 3 在低风险下，常规节流
    if (grid_span_abs < closeThrottleSpan.low) {
      return {
        shouldTrade: false,
        ...args,
      };
    }
  }

  // 对于开仓，根据风险设定节流距离
  if (position_action === PositionAction.OPEN) {
    // 1 在紧急状况下，高度节流
    if (isEmergencyRisk && grid_span_abs < openThrottleSpan.emergency) {
      return {
        shouldTrade: false,
        ...args,
      };
    }
    // 2 在高风险下，强化节流
    if (isHighRisk && grid_span_abs < openThrottleSpan.high) {
      return {
        shouldTrade: false,
        ...args,
      };
    }
    // 3 在低风险下，常规节流
    if (grid_span_abs < openThrottleSpan.low) {
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
