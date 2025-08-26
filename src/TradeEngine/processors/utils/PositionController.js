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
  _suppress_lots = 8;
  _survival_lots = 12;
  _min_mgn_ratio_notice = 5000; // 抑制状态最小保证金率 4000%
  _min_mgn_ratio_supress = 2000; // 抑制状态最小保证金率 4000%
  _min_mgn_ratio_survival = 1500; // 止损状态最小保证金率 1000%
  _max_open_grid_count = 8; // 最大开仓网格数量

  constructor(engine, processor) {
    this.engine = engine;
    this.processor = processor;
    this._suppress_lots = processor._suppress_lots;
    this._survival_lots = processor._survival_lots; // 基础配置
  }

  /**
   * 初始化管理器
   * @param {object} engine 交易引擎
   * @param {string} assetName 资产名称
   * @param {object} instrumentInfo 合约信息
   * @param {string} settlementType 结算类型
   * @param {number} baseAmount 基础金额
   * @param {number} baseQuantity 基础数量
   */
  initialize() {}

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
    const pos_contracts = this.getPositionContracts();
    const mmr = this.getMaintenanceMarginRate();

    const mgnRatioPercent = 100 * mmr;

    if (pos_contracts === 0) {
      return PositionRiskLevel.NORMAL;
    }

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
      // 使用数字编码优化键值对存储
      // isolate_risk_level * 10 + cross_risk_level 作为key
      // NORMAL = 0, HIGHT = 1, EMERGENCY = 2
      '00': RiskLevel.NORMAL, // NORMAL-NORMAL
      '01': RiskLevel.NOTICE, // NORMAL-HIGHT
      '02': RiskLevel.CROSS_HIGH, // NORMAL-HIGHT
      '03': RiskLevel.CROSS_EMERGENCY, // NORMAL-EMERGENCY

      20: RiskLevel.ISOLATE_HIGHT, // NORMAL-HIGHT
      21: RiskLevel.ISOLATE_HIGHT, // NORMAL-HIGHT
      22: RiskLevel.DUAL_HIGH, // HIGHT-HIGHT
      23: RiskLevel.DUAL_HIGH, // EMERGENCY-EMERGENCY

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
  getPositionStrategy(tendency, threshold, gridCount, grid_span) {
    const actionType = this.getPositionAction(tendency);
    const riskLevel = this.getMixedRiskLevel();

    const gridCountAbs = Math.abs(gridCount);
    const gridCountSign = Math.sign(gridCount);
    const getSuppressedGridCount = (multiple) => gridCountSign * Math.floor(gridCountAbs / multiple);
    const getSuppressedTradeCount = (multiple) => gridCountSign * Math.round(10 * gridCountAbs / multiple) / 10;
    const baseCloseTradeCount = Math.round(gridCountSign * grid_span * 10) / 10;

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
    const strategies = {
      // 开仓策略
      [PositionAction.OPEN]: {
        // 无风险
        [NORMAL]: {
          shouldSuppress: false,
          gridCount: gridCount,
          tradeCount: gridCount,
          description: '正常交易',
          threshold: threshold,
        },
        // 提示性风险
        [NOTICE]: {
          shouldSuppress: false,
          gridCount: gridCount,
          tradeCount: gridCount,
          description: '正常交易',
          threshold: threshold,
        },

        // 高风险：抑制模式，拉宽网格，交易份数放大
        [ISOLATE_HIGHT]: {
          shouldSuppress: true,
          gridCount: getSuppressedGridCount(2),
          tradeCount: gridCount,
          threshold: threshold,
          tradeMultiple: 2,
          description: '单仓抑制交易(无损)',
        },
        [DUAL_HIGH]: {
          shouldSuppress: true,
          gridCount: getSuppressedGridCount(2),
          tradeMultiple: 2,
          tradeCount: gridCount,
          threshold: threshold,
          description: '双重抑制交易（无损）',
        },

        // 超高风险：减仓模式，交易份数放大3倍
        [ISOLATE_EMERGENCY]: {
          shouldSuppress: true,
          gridCount: getSuppressedGridCount(3),
          tradeMultiple: 3,
          tradeCount: gridCount,
          threshold: threshold,
          description: '单仓减仓交易（无损）',
        },
        [DUAL_EMERGENCY]: {
          shouldSuppress: true,
          gridCount: getSuppressedGridCount(3),
          tradeCount: getSuppressedTradeCount(2),
          tradeMultiple: 3,
          threshold: threshold,
          description: '双重减仓交易（有损）',
        },

        // 传导性风险
        [CROSS_HIGH]: {
          shouldSuppress: true,
          gridCount: getSuppressedGridCount(2),
          tradeMultiple: 2,
          tradeCount: gridCount,
          threshold: threshold,
          description: '全仓抑制交易(无损)',
        },
        [CROSS_EMERGENCY]: {
          shouldSuppress: true,
          gridCount: getSuppressedGridCount(2),
          tradeMultiple: 2,
          tradeCount: gridCount,
          threshold: threshold,
          description: '全仓减仓开仓(无损)',
        },
      },
      // 平仓策略
      [PositionAction.CLOSE]: {
        // 无风险
        [NORMAL]: {
          shouldSuppress: false,
          gridCount: gridCount,
          tradeCount: gridCount,
          threshold: threshold,
          description: '正常平仓',
        },
        // 提示性风险
        [NOTICE]: {
          shouldSuppress: false,
          gridCount: gridCount,
          tradeCount: baseCloseTradeCount,
          threshold: threshold,
          description: '正常平仓',
        },
        // 高风险：减仓模式,阈值减半
        [ISOLATE_HIGHT]: {
          shouldSuppress: true,
          gridCount: gridCount,
          tradeCount: baseCloseTradeCount,
          threshold: threshold,
          description: '单仓抑制交易 - 平仓(有损)',
        },
        [DUAL_HIGH]: {
          shouldSuppress: true,
          gridCount: gridCount,
          tradeCount: baseCloseTradeCount,
          threshold: threshold * 0.5,
          description: '双重抑制交易 - 平仓(有损)',
        },

        // 超高风险：减仓模式,阈值极度压缩
        [ISOLATE_EMERGENCY]: {
          shouldSuppress: true,
          gridCount: gridCount,
          tradeCount: baseCloseTradeCount,
          threshold: threshold * 0.5,
          description: '单仓减仓交易 - 平仓(有损)',
        },
        [DUAL_EMERGENCY]: {
          shouldSuppress: true,
          gridCount: gridCount,
          tradeCount: baseCloseTradeCount,
          threshold: threshold * 0.25,
          description: '双重减仓交易 - 平仓(有损)',
        },

        // 传导性风险
        [CROSS_HIGH]: {
          shouldSuppress: true,
          gridCount: gridCount,
          tradeCount: gridCount,
          threshold: threshold * 0.5,
          description: '全仓抑制交易 - 平仓(无损)',
        },
        [CROSS_EMERGENCY]: {
          shouldSuppress: true,
          gridCount: gridCount,
          tradeCount: baseCloseTradeCount,
          threshold: threshold * 0.5,
          description: '全仓减仓交易 - 平仓(有损)',
        },
      },
    }[actionType];
    const _s = strategies[riskLevel] || strategies[NORMAL];
    return {
      ..._s,
      riskLevel,
      tradeMultiple: _s.tradeMultiple || 1,
      tradeCount:
        actionType === PositionAction.OPEN
          ? Math.min(_s.tradeCount, this._max_open_grid_count)
          : _s.tradeCount,
    };
  }

  // ==================== 日志和监控 ====================

  /**
   * 获取持仓状态报告
   * @returns {object} 持仓状态报告
   */
  getPositionReport() {}

  /**
   * 记录持仓控制日志
   * @param {string} action 操作类型
   * @param {object} details 详细信息
   */
  logPositionControl(action, details = {}) {}
}
