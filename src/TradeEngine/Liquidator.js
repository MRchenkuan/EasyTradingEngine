/**
 * 一键清仓器
 *
 * 将清仓能力集中到一个独立模块，供 AccountRiskMonitor（回撤触发）和手动脚本调用。
 * 订单的分阶段记录（PENDING → PLACED → CONFIRMED）委托给 processor.placeLiquidationOrder，
 * 与 GridTradingProcessor._placeOrder 复用同一套 _placeOrderStaged 逻辑。
 *
 * 调用方式：
 *   Liquidator.liquidate(engine)          // 清仓全部持仓 + 重置策略状态
 *   Liquidator.liquidate(engine, instId)   // 只清仓指定品种
 *   Liquidator.liquidate(null, instId)     // 无 engine（手动脚本），仅平仓不重置状态
 */
import { getPositions } from '../api.js';
import { RiskControl, Env } from '../../config.js';
import { TradeEnv } from '../enum.js';
import { AbstractProcessor } from './processors/AbstractProcessor.js';

export class Liquidator {
  /**
   * 一键清仓：市价平掉全部持仓并重置策略状态
   *
   * @param {object|null} engine - TradeEngine 类引用（有则重置策略状态，null 则仅平仓）
   * @param {string|null} instId - 可选，只清仓指定品种
   * @returns {Promise<{success: boolean, closed: number, failed: number, details: Array}>}
   */
  static async liquidate(engine = null, instId = null) {
    const IS_MIMIC = Env === TradeEnv.MIMIC;
    console.warn(`[Liquidation] 开始止损 ${instId || '全部'}（${IS_MIMIC ? '模拟盘' : '实盘'}）`);

    // ==================== 1. 获取持仓 ====================
    let positions;
    try {
      const { data, success } = await getPositions(instId, 'SWAP');
      if (!success || !data || data.length === 0) {
        console.log('[Liquidation] 无持仓，跳过清仓');
        Liquidator.#resetProcessors(engine);
        return { success: true, closed: 0, failed: 0, details: [] };
      }
      positions = data;
    } catch (e) {
      console.error(`[Liquidation] 获取持仓失败: ${e.message}`);
      return { success: false, closed: 0, failed: 0, details: [], error: e.message };
    }

    // ==================== 2. 过滤非零持仓 ====================
    const activePositions = positions.filter(p => {
      const pos = parseFloat(p.pos);
      return isFinite(pos) && pos !== 0;
    });

    if (activePositions.length === 0) {
      console.log('[Liquidation] 无非零持仓，跳过清仓');
      Liquidator.#resetProcessors(engine);
      return { success: true, closed: 0, failed: 0, details: [] };
    }

    // ==================== 3. 逐笔清仓（委托 AbstractProcessor.placeLiquidationOrder） ====================
    const allConfirmed = [];
    console.log(`[Liquidation] 发现 ${activePositions.length} 个持仓`);

    for (const p of activePositions) {
      const pos = parseFloat(p.pos);
      const { instId, markPx } = p;

      console.log(
        `[Liquidation] ${instId} pos=${pos} → ${pos > 0 ? 'sell' : 'buy'} ${Math.abs(pos)}`
      );
      try {
        const confirmed = await AbstractProcessor.placeLiquidationOrder(instId, pos, markPx);
        if (confirmed) {
          allConfirmed.push({ instId, ...confirmed });
        }
      } catch (e) {
        console.error(`[Liquidation] ${instId} 清仓异常: ${e.message}`);
      }
    }

    // ==================== 4. 重置策略状态 ====================
    Liquidator.#resetProcessors(engine);

    // ==================== 5. 汇总 ====================
    const closed = allConfirmed.filter(o => o.state === 'filled').length;
    const failed = activePositions.length - closed;
    console.warn(
      `[Liquidation] 清仓结束：成功 ${closed} / 失败 ${failed} / 共 ${activePositions.length}`
    );
    return { success: closed === activePositions.length, closed, failed, details: allConfirmed };
  }

  /**
   * 重置所有策略的状态（清仓后让策略从当前价重新开始）
   */
  static #resetProcessors(engine) {
    if (!engine || !engine.processors) return;
    for (const p of engine.processors) {
      try {
        if (typeof p.resetAfterLiquidation === 'function') {
          p.resetAfterLiquidation();
        }
      } catch (e) {
        console.error(`[Liquidation] 重置策略 ${p.asset_name} 状态失败: ${e.message}`);
      }
    }
  }
}
