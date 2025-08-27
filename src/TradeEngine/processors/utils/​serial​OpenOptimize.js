import { PositionAction } from "../../../enum.js";

export function serialOpenOptimize(asset_name, last_open_grid_span, grid_span, position_action) {
  // 防止连续开仓

  let shouldOpen = true;
  if (
    position_action === PositionAction.OPEN &&
    last_open_grid_span > 0 &&
    grid_span < (1 + last_open_grid_span * 0.5) &&
    grid_span <= 3
  ) {
   console.log(
        `- [${asset_name}] 上次开仓距离（ ${last_open_grid_span.toFixed(2)} 格）过近，当前开仓距离 ${grid_span.toFixed(2)} 格`
      );
    shouldOpen = false;
  }
  return {
    shouldOpen,
  }
}