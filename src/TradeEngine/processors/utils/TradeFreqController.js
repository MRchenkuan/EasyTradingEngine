import { PositionAction, PositionCompositeRiskLevel } from '../../../enum.js';

export function TradeFreqController(params) {
  const {
    asset_name,
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

  // 非连续交易不节流
  if (!isSerialTrade) {
    return {
      shouldTrade: true,
    };
  }

  const lastTradeGridSpan = {
    [PositionAction.OPEN]: last_open_grid_span,
    [PositionAction.CLOSE]: last_close_grid_span,
  }[position_action];

  // 开仓/平仓距离超过最大节流时间不节流
  if (time_since_last_trade > throttleResetTime) {
    return {
      shouldTrade: true,
    };
  }

  // 开仓/平仓距离超过最大节流距离不节流
  if(grid_span_abs> maxThrottleDistance){
    return {
      shouldTrade: true,
    };
  }


  const { ISOLATE_HIGHT, ISOLATE_EMERGENCY, DUAL_EMERGENCY, DUAL_HIGH, CROSS_HIGH, CROSS_EMERGENCY } = PositionCompositeRiskLevel;

  // 对于平仓，根据风险设定节流距离
  if(position_action === PositionAction.CLOSE){
    // 1 在紧急状况下，不节流
    if([ISOLATE_EMERGENCY, DUAL_EMERGENCY, DUAL_HIGH].includes(risk_level)){
      return {
        shouldTrade: true,
      };
    }
    // 2 在高风险下，有限节流
    if([ISOLATE_HIGHT, DUAL_HIGH, CROSS_EMERGENCY].includes(risk_level)){
      if (grid_span_abs < 1 + lastTradeGridSpan) {
        return {
          shouldTrade: false,
        };
      }
    }
    // 3 在低风险下，常规节流
    if (grid_span_abs < 1 + lastTradeGridSpan * 1.25) {
      return {
        shouldTrade: false,
      };
    }
  }

  // 对于开仓，根据风险设定节流距离
  if(position_action === PositionAction.OPEN){
    // 1 在紧急状况下，高度节流
    if([ISOLATE_EMERGENCY, DUAL_EMERGENCY, DUAL_HIGH].includes(risk_level)){
      if (grid_span_abs < 1 + lastTradeGridSpan * 2) {
        return {
          shouldTrade: false,
        };
      }
    }
    // 2 在高风险下，强化节流
    if([ISOLATE_HIGHT, DUAL_HIGH, CROSS_EMERGENCY].includes(risk_level)){
      if (grid_span_abs < 1 + lastTradeGridSpan * 1.5) {
        return {
          shouldTrade: false,
        };
      }
    }
    // 3 在低风险下，常规节流
    if (grid_span_abs < 1 + lastTradeGridSpan * 1.25) {
      return {
        shouldTrade: false,
      };
    }
  }

  // 兜底
  return {
    shouldTrade: true,
  };
}
