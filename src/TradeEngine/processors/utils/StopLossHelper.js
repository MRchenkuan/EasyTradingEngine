import { StopLossLevel } from '../../../enum.js';

/**
 * 计算止损阈值调整
 * @param {number} baseThreshold 基础阈值
 * @param {string} stopLossLevel 止损级别
 * @param {number} tendency 趋势方向
 * @param {number} pos 持仓
 * @returns {number} 调整后的阈值
 */
function calculateStopLossThreshold(baseThreshold, stopLossLevel, tendency, pos) {
  let adjustedThreshold = baseThreshold;

  // 判断持仓方向与趋势的关系
  const noNeedPriorityClose = Math.sign(parseFloat(pos)) !== Math.sign(tendency);

  if (noNeedPriorityClose) {
    return adjustedThreshold;
  }

  // 根据止损级别调整阈值
  switch (stopLossLevel) {
    case StopLossLevel.SUPPRESS:
      adjustedThreshold = baseThreshold / 2;
      break;
    case StopLossLevel.SURVIVAL:
      adjustedThreshold = baseThreshold / 4; // 两次减半
      break;
    case StopLossLevel.SINGLE_SUPPRESS:
      adjustedThreshold = baseThreshold / 2;
      break;
    case StopLossLevel.SINGLE_SURVIVAL:
      adjustedThreshold = baseThreshold / 4;
      break;
    default:
      break;
  }

  return adjustedThreshold;
}

/**
 * 获取交易策略配置
 * @param {string} stopLossLevel 止损级别
 * @param {number} gridCount 网格数量
 * @param {boolean} isPositionWarning 是否持仓警告
 * @param {boolean} isPositionCritical 是否持仓严重警告
 * @param {number} pos_count 持仓份数
 * @returns {object} 交易策略配置
 */
export function StopLossControl(
  threshold,
  stopLossLevel,
  tendency,
  pos,
  trade_suppress_multiple,
  gridCount
) {
  const tradeMultiple = Math.round(trade_suppress_multiple);
  const adjustedThreshold = calculateStopLossThreshold(threshold, stopLossLevel, tendency, pos);
  const gridCountAbs = Math.abs(gridCount);
  const suppressedGridCount = Math.floor(gridCountAbs / tradeMultiple) * Math.sign(gridCount);

  const strategies = {
    [StopLossLevel.NORMAL]: {
      shouldSuppress: false,
      gridCount: gridCount,
      tradeCount: gridCount,
      description: '正常交易',
      threshold: adjustedThreshold,
    },
    [StopLossLevel.SUPPRESS]: {
      // 抑制模式：拉宽网格，交易分数同样增大
      shouldSuppress: true,
      gridCount: suppressedGridCount,
      tradeCount: suppressedGridCount * tradeMultiple,
      threshold: adjustedThreshold,
      description: '抑制交易(无损)',
    },
    [StopLossLevel.SURVIVAL]: {
      // 减仓模式：拉宽网格，交易分数减半
      shouldSuppress: true,
      gridCount: suppressedGridCount,
      tradeCount: suppressedGridCount,
      threshold: adjustedThreshold,
      description: '减仓交易(有损)',
    },
    [StopLossLevel.SINGLE_SURVIVAL]: {
      shouldSuppress: true,
      gridCount: suppressedGridCount, // 单仓减仓模式：拉宽网格，交易分数减半
      tradeCount: suppressedGridCount,
      threshold: adjustedThreshold,
      description: '单仓减仓交易（有损）',
    },
    [StopLossLevel.SINGLE_SUPPRESS]: {
      shouldSuppress: true,
      gridCount: suppressedGridCount, // 单仓抑制模式：拉宽网格，交易分数同样增大
      tradeCount: suppressedGridCount * tradeMultiple,
      threshold: adjustedThreshold,
      description: '单仓抑制交易（无损）',
    },
  };

  return strategies[stopLossLevel] || strategies[StopLossLevel.NORMAL];
}
