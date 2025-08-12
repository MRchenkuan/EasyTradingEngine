import { StopLossLevel, PositionAction } from '../../../enum.js';

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
  const currentStrategyType =
    Math.sign(parseFloat(pos)) === Math.sign(tendency) ? PositionAction.CLOSE : PositionAction.OPEN;
  const tradeMultiple = Math.round(trade_suppress_multiple);
  const gridCountAbs = Math.abs(gridCount);
  const suppressedGridCount = Math.floor(gridCountAbs / tradeMultiple) * Math.sign(gridCount);

  const strategies = {
    [PositionAction.OPEN]: {
      [StopLossLevel.NORMAL]: {
        shouldSuppress: false,
        gridCount: gridCount,
        tradeCount: gridCount,
        description: '正常交易',
        threshold: threshold,
      },
      [StopLossLevel.SUPPRESS]: {
        // 抑制模式：拉宽网格，交易分数同样增大
        shouldSuppress: true,
        gridCount: suppressedGridCount,
        tradeCount: gridCount,
        threshold: threshold,
        description: '抑制交易(无损)',
      },
      [StopLossLevel.SURVIVAL]: {
        // 减仓模式：拉宽网格，交易分数减半
        shouldSuppress: true,
        gridCount: gridCount,
        tradeCount: (gridCountAbs / tradeMultiple) * Math.sign(gridCount),
        threshold: threshold,
        description: '减仓交易(有损)',
      },
      [StopLossLevel.SINGLE_SUPPRESS]: {
        shouldSuppress: true,
        gridCount: suppressedGridCount, // 单仓抑制模式：拉宽网格，交易分数同样增大
        tradeCount: gridCount,
        threshold: threshold,
        description: '单仓抑制交易（无损）',
      },
      [StopLossLevel.SINGLE_SURVIVAL]: {
        shouldSuppress: true,
        gridCount: gridCount, // 单仓减仓模式：拉宽网格，交易分数减半
        tradeCount: (gridCountAbs / tradeMultiple) * Math.sign(gridCount),
        threshold: threshold,
        description: '单仓减仓交易（有损）',
      },
    },

    [PositionAction.CLOSE]: {
      [StopLossLevel.NORMAL]: {
        shouldSuppress: false,
        gridCount: gridCount,
        tradeCount: gridCount,
        description: '正常交易',
        threshold: threshold,
      },
      [StopLossLevel.SUPPRESS]: {
        // 抑制模式：拉宽网格，交易分数同样增大
        shouldSuppress: true,
        gridCount: gridCount,
        tradeCount: gridCount,
        threshold: threshold / 2,
        description: '抑制交易 - 平仓(无损)',
      },
      [StopLossLevel.SURVIVAL]: {
        // 减仓模式：拉宽网格，交易分数减半
        shouldSuppress: true,
        gridCount: gridCount,
        tradeCount: gridCount,
        threshold: threshold / 4,
        description: '减仓交易 - 平仓(无损)',
      },
      [StopLossLevel.SINGLE_SUPPRESS]: {
        shouldSuppress: true,
        gridCount: gridCount,
        tradeCount: gridCount,
        threshold: threshold / 2,
        description: '单仓抑制交易 - 平仓(无损)',
      },
      [StopLossLevel.SINGLE_SURVIVAL]: {
        shouldSuppress: true,
        gridCount: gridCount,
        // tradeCount: gridCount + 0.5 * Math.sign(gridCount),
        tradeCount: gridCount,
        threshold: threshold / 4,
        description: '单仓减仓交易 - 平仓(无损)',
      },
    },
  };

  return (
    strategies[currentStrategyType][stopLossLevel] ||
    strategies[currentStrategyType][StopLossLevel.NORMAL]
  );
}
