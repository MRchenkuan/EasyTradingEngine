import { create_order_market, executeOrders, fetchOrders } from '../../trading.js';
import { updateGridTradeOrder } from '../../recordTools.js';
import { OrderStatus } from '../../enum.js';
import { trade_open } from '../../../config.js';

/**
 * @abstract
 * @param {TradeEngine} engine
 * @param {string} asset_name
 */
export class AbstractProcessor {
  type = 'AbstractProcessor';
  engine = null;
  asset_name = '';

  static _max_retry = 3;

  constructor(engine, asset_name) {
    if (new.target === AbstractProcessor) {
      throw new Error('抽象类不能直接实例化');
    }
    // 运行时检查是否实现了必要的方法
    if (typeof this.tick !== 'function') {
      throw new Error('子类必须实现 tick 方法');
    }
    if (typeof this.display !== 'function') {
      throw new Error('子类必须实现 display 方法');
    }

    // 设置基础属性
    this.engine = engine;
    this.asset_name = asset_name;

    // 验证必要参数
    if (!engine) {
      throw new Error('engine 参数不能为空');
    }
    if (!asset_name) {
      throw new Error('asset_name 参数不能为空');
    }
  }

  /**
   * @abstract
   * @param {number} deltaTime
   */
  tick() {
    throw new Error(`${this.constructor.name} 必须实现 tick 方法`);
  } // 抽象方法占位

  /**
   * @abstract
   * @returns {string} 返回处理器的状态信息
   */
  display() {
    throw new Error(`${this.constructor.name} 必须实现 display 方法`);
  } // 抽象方法占位

  // ==================== 分阶段下单（静态，供 _placeOrder 和 Liquidator 复用） ====================

  /**
   * 分阶段下单（PENDING → PLACED → CONFIRMED）
   *
   * @param {object} order - create_order_market 返回的订单对象
   * @param {object} meta - 订单元数据（snapshot/grid_count/target_price/ts/logs 等）
   * @param {number} retryCount - 当前重试次数
   * @param {number} [maxRetry] - 最大重试次数
   * @returns {Promise<object|null>} 确认后的订单详情，失败返回 null
   */
  static async _placeOrderStaged(
    order,
    meta,
    retryCount = 0,
    maxRetry = AbstractProcessor._max_retry
  ) {
    const { instId, clOrdId } = order;

    // ==================== 阶段1: PENDING ====================
    await updateGridTradeOrder(instId, clOrdId, null, {
      ...order,
      ...meta,
      order_status: OrderStatus.PENDING,
      retry_count: retryCount,
    });

    if (!trade_open) return null;

    // ==================== 阶段2: 执行 ====================
    let result;
    try {
      result = await executeOrders([order]);
    } catch (e) {
      await updateGridTradeOrder(instId, clOrdId, null, {
        order_status: OrderStatus.UNSUCESS,
        error: e.message,
        retry_count: retryCount,
      });
      return AbstractProcessor._retryOrderOrFail(order, meta, retryCount, e.message, maxRetry);
    }

    if (!result.success) {
      await updateGridTradeOrder(instId, clOrdId, null, {
        order_status: OrderStatus.UNSUCESS,
        error: result.msg,
        retry_count: retryCount,
      });
      return AbstractProcessor._retryOrderOrFail(order, meta, retryCount, result.msg, maxRetry);
    }

    // ==================== 阶段2成功: PLACED ====================
    const { originalOrder, clOrdId: _c, ordId, tag, ...rest } = result.data[0];
    await updateGridTradeOrder(instId, clOrdId, ordId, {
      clOrdId,
      ordId,
      ...rest,
      ...order,
      ...originalOrder,
      ...meta,
      order_status: OrderStatus.PLACED,
      retry_count: retryCount,
    });

    // ==================== 阶段3: CONFIRMED ====================
    try {
      const [confirmed] = (await fetchOrders(result.data)) || [];
      if (confirmed && confirmed.avgPx && confirmed.fillTime) {
        await updateGridTradeOrder(instId, clOrdId, null, {
          avgPx: confirmed.avgPx,
          ts: confirmed.fillTime,
          accFillSz: confirmed.accFillSz,
          order_status: OrderStatus.CONFIRMED,
        });
        return confirmed;
      } else {
        await updateGridTradeOrder(instId, clOrdId, null, {
          order_status: OrderStatus.CONFIRM_FAILED,
          error: '未获取到订单信息',
        });
        return confirmed || null;
      }
    } catch (e) {
      await updateGridTradeOrder(instId, clOrdId, null, {
        order_status: OrderStatus.CONFIRM_ERROR,
        error: '订单确认错误',
      });
      return null;
    }
  }

  /**
   * 重试或标记为 FAILED（静态）
   */
  static async _retryOrderOrFail(order, meta, retryCount, errorMsg, maxRetry) {
    if (retryCount < maxRetry) {
      return AbstractProcessor._placeOrderStaged(order, meta, retryCount + 1, maxRetry);
    }
    await updateGridTradeOrder(order.instId, order.clOrdId, null, {
      order_status: OrderStatus.FAILED,
      retry_count: retryCount,
      error: errorMsg,
    });
    return null;
  }

  /**
   * 清仓下单：市价平掉指定持仓（静态，无需 processor 实例）
   * 供 Liquidator 直接调用，与 _placeOrder 复用同一套 _placeOrderStaged 逻辑
   *
   * @param {string} assetName - 品种名称
   * @param {number} pos - 持仓数量（正=多，负=空）
   * @param {number} markPx - 标记价格（用于 PENDING 阶段记录）
   * @returns {Promise<object|null>} 确认后的订单详情
   */
  static async placeLiquidationOrder(assetName, pos, markPx) {
    const size = Math.abs(pos);
    const side = pos > 0 ? -1 : 1; // 多头→sell，空头→buy
    const order = create_order_market(assetName, size, side);
    const meta = {
      snapshot: 'liquidation',
      grid_count: 0,
      target_price: markPx || null,
      avgPx: markPx || null,
      accFillSz: size,
      ts: Date.now(),
      logs: ['liquidation', `pos=${pos}`].join('::'),
    };
    return AbstractProcessor._placeOrderStaged(order, meta, 0);
  }
}
