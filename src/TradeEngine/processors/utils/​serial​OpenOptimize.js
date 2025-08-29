import { PositionAction, PositionCompositeRiskLevel, PositionRiskLevel } from '../../../enum.js';

export function serialOpenOptimize(asset_name, last_open_grid_span, grid_span, position_action) {
  // 防止连续开仓

  let shouldOpen = true;
  if (
    position_action === PositionAction.OPEN &&
    last_open_grid_span > 0 &&
    grid_span < 1 + last_open_grid_span * 0.5 &&
    grid_span <= 3
  ) {
    console.log(
      `- [${asset_name}] 上次开仓距离（ ${last_open_grid_span.toFixed(2)} 格）过近，当前开仓距离 ${grid_span.toFixed(2)} 格`
    );
    shouldOpen = false;
  }
  return {
    shouldOpen,
  };
}

export function serialTradeOptimize(params) {
  const {
    asset_name,
    last_open_grid_span,
    last_close_grid_span,
    grid_span,
    position_action,
    time_since_last_trade,
    risk_level,
  } = params;

  const { ISOLATE_HIGHT, ISOLATE_EMERGENCY, CROSS_EMERGENCY } = PositionCompositeRiskLevel;

  if (
    position_action === PositionAction.CLOSE &&
    [ISOLATE_HIGHT, ISOLATE_EMERGENCY, CROSS_EMERGENCY].includes(risk_level)
  ) {
    return {
      shouldTrade: true,
    };
  }

  const isSerialTrade = {
    [PositionAction.OPEN]: last_open_grid_span > 0,
    [PositionAction.CLOSE]: last_close_grid_span > 0,
  }[position_action];

  // 非连续交易
  if (!isSerialTrade) {
    return {
      shouldTrade: true,
    };
  }

  const lastTradeGridSpan = {
    [PositionAction.OPEN]: last_open_grid_span,
    [PositionAction.CLOSE]: last_close_grid_span,
  }[position_action];

  const minutes = time_since_last_trade / 60000;

  // 大于 60 分钟没交易则不节流
  if (minutes > 120) {
    return {
      shouldTrade: true,
    };
  }

  const isDistanceSatisfied = grid_span < 1 + lastTradeGridSpan * 0.75 && grid_span <= 3;
  if (isDistanceSatisfied) {
    console.log(
      {
        [PositionAction.OPEN]: `- [${asset_name}] 上次开仓距离（ ${lastTradeGridSpan.toFixed(2)} 格）过近，当前开仓距离 ${grid_span.toFixed(2)} 格`,
        [PositionAction.CLOSE]: `- [${asset_name}] 上次平仓距离（ ${lastTradeGridSpan.toFixed(2)} 格）过近，当前平仓距离 ${grid_span.toFixed(2)} 格`,
      }[position_action]
    );
    return {
      shouldTrade: false,
    };
  }

  // 兜底
  return {
    shouldTrade: true,
  };
}
