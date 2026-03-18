import {
  StopLossLevel,
  PositionAction,
  SettlementType,
  PositionRiskLevel,
  PositionCompositeRiskLevel,
} from '../../../enum.js';

/**
 * 统一仓位控制管理器
 * 整合所有仓位相关的计算、风险评估和控制逻辑
 */
export class PositionController {
  engine = null;
  processor = null;
  _suppress_lots = 12;
  _survival_lots = 20;
  _min_mgn_ratio_notice = 10000; // 抑制状态最小保证金率 4000%
  _min_mgn_ratio_supress = 6000; // 抑制状态最小保证金率 4000%
  _min_mgn_ratio_survival = 4000; // 止损状态最小保证金率 1000%
  _max_open_grid_count = 8; // 最大开仓网格数量

  constructor(engine, processor) {
    this.engine = engine;
    this.processor = processor;
    this._suppress_lots = processor._suppress_lots;
    this._survival_lots = processor._survival_lots; // 基础配置
  }

  // ==================== 持仓数据获取 ====================

  /**
   * 获取当前持仓的份额
   * @returns {number} 持仓份额
   */
  getPositionLots() {
    const pos_contracts = this.getPositionContracts();
    const pos_value = this.getPositionValue();

    let position_count = 0;
    const { _instrument_info, _settlement_type, _base_amount, _base_quantity } = this.processor;

    const { ctVal } = _instrument_info;
    if (_settlement_type === SettlementType.VALUE) {
      position_count = pos_value / _base_amount;
    } else if (_settlement_type === SettlementType.QUANTITY) {
      position_count = pos_contracts / (_base_quantity / ctVal);
    }
    return position_count;
  }

  /**
   * 获取当前持仓的合约数量
   * @returns {number} 持仓合约数量
   */
  getPositionContracts() {
    return parseFloat((this.engine.getPositionList(this.processor.asset_name) || {}).pos || 0);
  }

  /**
   * 获取当前持仓的价值
   * @returns {number} 持仓价值
   */
  getPositionValue() {
    const pos = parseFloat((this.engine.getPositionList(this.processor.asset_name) || {}).pos || 0);
    return (
      Math.abs(
        parseFloat((this.engine.getPositionList(this.processor.asset_name) || {}).notionalUsd || 0)
      ) * Math.sign(pos)
    );
  }

  /**
   * 获取当前维持保证金率
   * @returns {number} 维持保证金率
   */
  getMaintenanceMarginRate() {
    return parseFloat((this.engine.getPositionList(this.processor.asset_name) || {}).mgnRatio || 0);
  }

  /**
   * 获取逐仓风险等级
   * @returns {PositionRiskLevel} 隔离风险等级
   */
  getIsolateRiskLevel() {
    const pos_contracts = this.getPositionContracts();
    const position_count = this.getPositionLots();

    if (pos_contracts === 0) {
      return PositionRiskLevel.NORMAL;
    }

    // 单个止损
    if (Math.abs(position_count) > this._survival_lots) {
      return PositionRiskLevel.EMERGENCY;
    }

    // 单个抑制
    if (Math.abs(position_count) > this._suppress_lots) {
      return PositionRiskLevel.HIGHT;
    }

    return StopLossLevel.NORMAL;
  }

  /**
   * 获取全仓风险等级
   * @returns {PositionRiskLevel} 跨仓风险等级
   */
  getCrossRiskLevel() {
    // const pos_contracts = this.getPositionContracts();
    const mmr = this.getMaintenanceMarginRate();

    const mgnRatioPercent = 100 * mmr;

    // if (pos_contracts === 0) {
    //   return PositionRiskLevel.NORMAL;
    // }

    // 整体止损状态
    if (mgnRatioPercent < this._min_mgn_ratio_survival) {
      return PositionRiskLevel.EMERGENCY;
    }

    // 整体抑制状态
    if (mgnRatioPercent < this._min_mgn_ratio_supress) {
      return PositionRiskLevel.HIGHT;
    }

    if (mgnRatioPercent < this._min_mgn_ratio_notice) {
      return PositionRiskLevel.NOTICE;
    }

    return StopLossLevel.NORMAL;
  }

  /**
   * 计算当前持仓风险等级
   * @returns {object} 风险等级和控制参数
   */
  calculatePositionRisk() {}

  // ==================== 交易控制 ====================

  getMixedRiskLevel() {
    const isolate_risk_Level = this.getIsolateRiskLevel();
    const cross_risk_Level = this.getCrossRiskLevel();
    const RiskLevel = PositionCompositeRiskLevel;
    // 使用优化后的风险等级映射表,减少重复判断
    const riskLevelMap = {
      '00': RiskLevel.NORMAL, // NORMAL-NORMAL
      '01': RiskLevel.NOTICE, // NORMAL-HIGHT
      '02': RiskLevel.CROSS_HIGH, // NORMAL-HIGHT
      '03': RiskLevel.CROSS_EMERGENCY, // NORMAL-EMERGENCY

      10: RiskLevel.ISOLATE_HIGHT, // NOTICE-HIGHT
      11: RiskLevel.ISOLATE_HIGHT, // NOTICE-HIGHT
      12: RiskLevel.CROSS_HIGH, // NOTICE-HIGHT
      13: RiskLevel.CROSS_EMERGENCY, // NOTICE-EMERGENCY

      20: RiskLevel.ISOLATE_HIGHT, // NORMAL-HIGHT
      21: RiskLevel.ISOLATE_HIGHT, // NORMAL-HIGHT
      22: RiskLevel.DUAL_HIGH, // HIGHT-HIGHT
      23: RiskLevel.CROSS_EMERGENCY, // HIGHT-EMERGENCY

      30: RiskLevel.ISOLATE_EMERGENCY, // HIGHT-NORMAL
      31: RiskLevel.ISOLATE_EMERGENCY, // HIGHT-EMERGENCY
      32: RiskLevel.ISOLATE_EMERGENCY, // HIGHT-EMERGENCY
      33: RiskLevel.DUAL_EMERGENCY, // HIGHT-EMERGENCY
    };

    // 风险等级数字编码转换
    const riskLevelCode = {
      [PositionRiskLevel.NORMAL]: 0,
      [PositionRiskLevel.NOTICE]: 1,
      [PositionRiskLevel.HIGHT]: 2,
      [PositionRiskLevel.EMERGENCY]: 3,
    };

    // 计算风险等级键值
    const key = `${riskLevelCode[isolate_risk_Level]}${riskLevelCode[cross_risk_Level]}`;
    return riskLevelMap[key] || RiskLevel.NORMAL;
  }

  /**
   * 获取持仓操作类型
   * @param {number} tendency 趋势方向
   * @returns {PositionAction} 持仓操作类型
   */
  getPositionAction(tendency) {
    const pos = this.getPositionContracts();
    return Math.sign(parseFloat(pos)) === Math.sign(tendency)
      ? PositionAction.CLOSE
      : PositionAction.OPEN;
  }

  /**
   * 获取交易策略配置
   * @param {number} tendency 趋势方向
   * @param {number} threshold 基础阈值
   * @param {number} gridCount 网格数量
   * @param {number} grid_span 网格间距 绝对值
   * @returns {object} 交易策略配置
   */
  getPositionStrategy(
    tendency,
    threshold,
    gridCount,
    grid_span_abs,
    last_open_grid_span,
    last_close_grid_span
  ) {
    const actionType = this.getPositionAction(tendency);
    const riskLevel = this.getMixedRiskLevel();

    const getSuppressedGridCount = multiple => Math.trunc(gridCount / multiple);
    const fullTradeCount = Math.sign(gridCount) * Math.round(grid_span_abs * 10) / 10;

    const {
      NORMAL,
      NOTICE,
      CROSS_HIGH,
      ISOLATE_HIGHT,
      DUAL_HIGH,
      CROSS_EMERGENCY,
      ISOLATE_EMERGENCY,
      DUAL_EMERGENCY,
    } = PositionCompositeRiskLevel;
    // 按照单仓、全仓的风险等级进行分类
    const baseTemplates = {
      [PositionAction.OPEN]: {
        gridCount,
        tradeCount: gridCount,
        threshold,
        tradeMultiple: 1,
        thresholdSuppress: 1,
        description: '正常开仓',
      },
      [PositionAction.CLOSE]: {
        gridCount,
        tradeCount: gridCount,
        threshold,
        tradeMultiple: 1,
        thresholdSuppress: 1,
        description: '正常平仓',
      },
    };

    const OPEN_OVERRIDES = {
      [NORMAL]: {},
      [NOTICE]: {},
      // 高风险：抑制模式，拉宽网格，交易份数放大
      [ISOLATE_HIGHT]: {
        tradeMultiple: 2,
        description: '单仓抑制交易',
      },
      [DUAL_HIGH]: {
        tradeMultiple: 2,
        thresholdSuppress: 1.5,
        description: '双重抑制交易',
      },

      // 超高风险：减仓模式，交易份数放大3倍
      [ISOLATE_EMERGENCY]: {
        tradeMultiple: 3,
        thresholdSuppress: 1.5,
        description: '单仓减仓交易',
      },
      // 传导性风险
      [CROSS_HIGH]: {
        tradeMultiple: 2,
        thresholdSuppress: 1.5,
        description: '全仓抑制交易',
      },
      [CROSS_EMERGENCY]: {
        tradeMultiple: 20000, // 停止开仓
        description: '全仓减仓开仓',
      },
      [DUAL_EMERGENCY]: {
        tradeMultiple: 20000, // 停止开仓
        description: '双重减仓交易',
      },
    };

    const CLOSE_OVERRIDES = {
      [NORMAL]: {},
      [NOTICE]: {},
      // 高风险：减仓模式,阈值减半
      [ISOLATE_HIGHT]: {
        thresholdSuppress: 0.5,
        description: '单仓抑制交易',
      },
      [DUAL_HIGH]: {
        tradeCount: fullTradeCount,
        thresholdSuppress: 0.5,
        description: '双重抑制交易',
      },

      // 超高风险：减仓模式,阈值极度压缩
      [ISOLATE_EMERGENCY]: {
        tradeCount: fullTradeCount,
        thresholdSuppress: 0.5,
        description: '单仓减仓交易',
      },
      [DUAL_EMERGENCY]: {
        //停止开仓，正常平仓
        tradeCount: fullTradeCount,
        thresholdSuppress: 0.25,
        description: '双重减仓交易',
      },

      // 传导性风险
      [CROSS_HIGH]: {
        thresholdSuppress: 0.5,
        description: '全仓抑制交易',
      },
      [CROSS_EMERGENCY]: {
        //停止开仓，正常平仓
        tradeCount: fullTradeCount,
        thresholdSuppress: 0.5,
        description: '全仓减仓交易',
      },
    };

    const overridesMap = {
      [PositionAction.OPEN]: OPEN_OVERRIDES,
      [PositionAction.CLOSE]: CLOSE_OVERRIDES,
    };

    const base = baseTemplates[actionType];
    const overrides = overridesMap[actionType][riskLevel] || overridesMap[actionType][NORMAL] || {};
    const strategy = { ...base, ...overrides };

    const finalTradeCount =
      actionType === PositionAction.OPEN
        ? Math.min(strategy.tradeCount, this._max_open_grid_count)
        : strategy.tradeCount;

    const finalGridCount = getSuppressedGridCount(strategy.tradeMultiple || 1);

    const finalThreshold = strategy.threshold * strategy.thresholdSuppress;

    return {
      ...strategy,
      riskLevel,
      threshold: finalThreshold,
      gridCount: finalGridCount,
      tradeCount: finalTradeCount,
    };
  }
}
