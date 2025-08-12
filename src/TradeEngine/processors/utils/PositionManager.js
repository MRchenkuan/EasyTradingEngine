import { StopLossLevel, PositionAction, SettlementType } from '../../../enum.js';

/**
 * 统一仓位控制管理器
 * 整合所有仓位相关的计算、风险评估和控制逻辑
 */
export class PositionManager {
  constructor(config = {}) {
    // 基础配置
    this.engine = null;
    this.asset_name = '';
    this._instrument_info = null;
    this._settlement_type = SettlementType.VALUE;
    this._base_amount = 0;
    this._base_quantity = 0;

    // 风险控制参数
    this._supress_lots = config.position_supress_count || 10;
    this._survival_lots = config.position_survival_count || 20;
    this._min_mgn_ratio_supress = config.min_mgn_ratio_supress || 3000;
    this._min_mgn_ratio_survival = config.min_mgn_ratio_survival || 1500;
    this._min_mgn_ratio_break = config.min_mgn_ratio_break || 500;
    this._trade_suppress_multiple = config.trade_suppress_multiple || 2;

    // 持仓控制参数
    this.maxPositionRatio = config.maxPositionRatio || 0.3;
    this.targetPositionRatio = config.targetPositionRatio || 0.15;
    this.forceCloseRatio = config.forceCloseRatio || 0.25;
    this.emergencyCloseRatio = config.emergencyCloseRatio || 0.35;

    // 阈值调整参数
    this.baseThresholdMultiplier = config.baseThresholdMultiplier || 1.0;
    this.minThresholdMultiplier = config.minThresholdMultiplier || 0.1;
    this.maxThresholdMultiplier = config.maxThresholdMultiplier || 5.0;
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
  initialize(engine, assetName, instrumentInfo, settlementType, baseAmount, baseQuantity) {
    this.engine = engine;
    this.asset_name = assetName;
    this._instrument_info = instrumentInfo;
    this._settlement_type = settlementType;
    this._base_amount = baseAmount;
    this._base_quantity = baseQuantity;
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
    const { ctVal } = this._instrument_info;
    if (this._settlement_type === SettlementType.VALUE) {
      position_count = pos_value / this._base_amount;
    } else if (this._settlement_type === SettlementType.QUANTITY) {
      position_count = pos_contracts / (this._base_quantity / ctVal);
    }
    return position_count;
  }

  /**
   * 获取当前持仓的合约数量
   * @returns {number} 持仓合约数量
   */
  getPositionContracts() {
    return parseFloat((this.engine.getPositionList(this.asset_name) || {}).pos || 0);
  }

  /**
   * 获取当前持仓的价值
   * @returns {number} 持仓价值
   */
  getPositionValue() {
    const pos = parseFloat((this.engine.getPositionList(this.asset_name) || {}).pos || 0);
    return (
      Math.abs(parseFloat((this.engine.getPositionList(this.asset_name) || {}).notionalUsd || 0)) *
      Math.sign(pos)
    );
  }

  /**
   * 获取当前维持保证金率
   * @returns {number} 维持保证金率
   */
  getMaintenanceMarginRate() {
    return parseFloat((this.engine.getPositionList(this.asset_name) || {}).mgnRatio || 0);
  }

  /**
   * 获取未实现盈亏
   * @returns {number} 未实现盈亏
   */
  getUnrealizedPnl() {
    return parseFloat((this.engine.getPositionList(this.asset_name) || {}).upl || 0);
  }

  /**
   * 获取账户总价值
   * @returns {number} 账户总价值
   */
  getAccountValue() {
    // 这里需要根据实际的账户信息获取方式来实现
    // 暂时返回一个默认值，实际使用时需要从engine获取
    return this.engine.getAccountValue ? this.engine.getAccountValue() : 100000;
  }

  // ==================== 风险评估 ====================

  /**
   * 获取止损等级
   * @returns {StopLossLevel} 止损等级
   */
  getStopLossLevel() {
    const pos_contracts = this.getPositionContracts();
    const mmr = this.getMaintenanceMarginRate();

    if (pos_contracts === 0) {
      return StopLossLevel.NORMAL;
    }

    const mgnRatioPercent = 100 * mmr;
    const position_count = this.getPositionLots();

    // 单个止损
    if (Math.abs(position_count) > this._survival_lots) {
      return StopLossLevel.SINGLE_SURVIVAL;
    }

    // 整体止损状态
    if (mgnRatioPercent < this._min_mgn_ratio_survival) {
      return StopLossLevel.SURVIVAL;
    }

    // 单个抑制
    if (Math.abs(position_count) > this._supress_lots) {
      return StopLossLevel.SINGLE_SUPPRESS;
    }

    // 整体抑制状态
    if (mgnRatioPercent < this._min_mgn_ratio_supress) {
      return StopLossLevel.SUPPRESS;
    }

    return StopLossLevel.NORMAL;
  }

  /**
   * 计算当前持仓风险等级
   * @returns {object} 风险等级和控制参数
   */
  calculatePositionRisk() {
    const accountValue = this.getAccountValue();
    const positionValue = this.getPositionValue();
    const unrealizedPnl = this.getUnrealizedPnl();
    const positionRatio = Math.abs(positionValue) / accountValue;

    // 计算风险等级
    let riskLevel = 'LOW';
    let riskScore = 0;

    // 基于持仓比例的风险评估
    if (positionRatio > this.emergencyCloseRatio) {
      riskLevel = 'EMERGENCY';
      riskScore = 5;
    } else if (positionRatio > this.maxPositionRatio) {
      riskLevel = 'CRITICAL';
      riskScore = 4;
    } else if (positionRatio > this.targetPositionRatio * 2) {
      riskLevel = 'HIGH';
      riskScore = 3;
    } else if (positionRatio > this.targetPositionRatio) {
      riskLevel = 'MEDIUM';
      riskScore = 2;
    } else {
      riskLevel = 'LOW';
      riskScore = 1;
    }

    // 基于未实现盈亏调整风险等级
    const pnlRatio = unrealizedPnl / accountValue;
    if (pnlRatio < -0.05) {
      // 亏损超过5%
      riskScore = Math.min(riskScore + 1, 5);
    }

    return {
      riskLevel,
      riskScore,
      positionRatio,
      pnlRatio,
      accountValue,
      positionValue,
      unrealizedPnl,
      shouldReducePosition: positionRatio > this.targetPositionRatio,
      shouldForceClose: positionRatio > this.forceCloseRatio,
      shouldEmergencyClose: positionRatio > this.emergencyCloseRatio,
    };
  }

  // ==================== 交易控制 ====================

  /**
   * 获取交易策略配置
   * @param {number} threshold 基础阈值
   * @param {number} gridCount 网格数量
   * @param {number} tendency 趋势方向
   * @param {number} pos 当前持仓
   * @returns {object} 交易策略配置
   */
  getTradeStrategy(threshold, gridCount, tendency, pos) {
    const stopLossLevel = this.getStopLossLevel();
    const currentStrategyType =
      Math.sign(parseFloat(pos)) === Math.sign(tendency)
        ? PositionAction.CLOSE
        : PositionAction.OPEN;

    const tradeMultiple = Math.round(this._trade_suppress_multiple);
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
          shouldSuppress: true,
          gridCount: suppressedGridCount,
          tradeCount: gridCount,
          threshold: threshold,
          description: '抑制交易(无损)',
        },
        [StopLossLevel.SURVIVAL]: {
          shouldSuppress: true,
          gridCount: gridCount,
          tradeCount: (gridCountAbs / tradeMultiple) * Math.sign(gridCount),
          threshold: threshold,
          description: '减仓交易(有损)',
        },
        [StopLossLevel.SINGLE_SUPPRESS]: {
          shouldSuppress: true,
          gridCount: suppressedGridCount,
          tradeCount: gridCount,
          threshold: threshold,
          description: '单仓抑制交易（无损）',
        },
        [StopLossLevel.SINGLE_SURVIVAL]: {
          shouldSuppress: true,
          gridCount: gridCount,
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
          shouldSuppress: true,
          gridCount: gridCount,
          tradeCount: gridCount,
          threshold: threshold / 2,
          description: '抑制交易 - 平仓(无损)',
        },
        [StopLossLevel.SURVIVAL]: {
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

  /**
   * 计算动态交易阈值
   * @param {number} baseThreshold 基础阈值
   * @param {number} gridCount 网格数量
   * @param {string} tradeDirection 交易方向 ('OPEN' | 'CLOSE')
   * @returns {number} 调整后的阈值
   */
  calculateDynamicThreshold(baseThreshold, gridCount, tradeDirection) {
    const riskAssessment = this.calculatePositionRisk();
    let multiplier = this.baseThresholdMultiplier;

    // 根据风险等级调整阈值
    switch (riskAssessment.riskScore) {
      case 1: // LOW
        multiplier = tradeDirection === 'OPEN' ? 1.0 : 0.8;
        break;
      case 2: // MEDIUM
        multiplier = tradeDirection === 'OPEN' ? 1.5 : 0.6;
        break;
      case 3: // HIGH
        multiplier = tradeDirection === 'OPEN' ? 2.5 : 0.4;
        break;
      case 4: // CRITICAL
        multiplier = tradeDirection === 'OPEN' ? 4.0 : 0.2;
        break;
      case 5: // EMERGENCY
        multiplier = tradeDirection === 'OPEN' ? 10.0 : 0.1;
        break;
    }

    // 根据网格数量进一步调整
    const gridAdjustment = Math.min(Math.abs(gridCount) * 0.1, 1.0);
    if (tradeDirection === 'OPEN') {
      multiplier += gridAdjustment; // 开仓时网格越多阈值越高
    } else {
      multiplier = Math.max(multiplier - gridAdjustment, 0.1); // 平仓时网格越多阈值越低
    }

    // 限制阈值范围
    multiplier = Math.max(
      this.minThresholdMultiplier,
      Math.min(this.maxThresholdMultiplier, multiplier)
    );

    return baseThreshold * multiplier;
  }

  /**
   * 计算交易数量调整
   * @param {number} baseTradeCount 基础交易数量
   * @param {string} tradeDirection 交易方向
   * @returns {number} 调整后的交易数量
   */
  calculateTradeCountAdjustment(baseTradeCount, tradeDirection) {
    const riskAssessment = this.calculatePositionRisk();
    let adjustment = 1.0;

    if (tradeDirection === 'OPEN' && riskAssessment.shouldReducePosition) {
      // 开仓时根据风险等级减少交易数量
      switch (riskAssessment.riskScore) {
        case 2:
          adjustment = 0.8;
          break;
        case 3:
          adjustment = 0.5;
          break;
        case 4:
          adjustment = 0.2;
          break;
        case 5:
          adjustment = 0.1;
          break;
      }
    } else if (tradeDirection === 'CLOSE' && riskAssessment.shouldReducePosition) {
      // 平仓时根据风险等级增加交易数量
      switch (riskAssessment.riskScore) {
        case 2:
          adjustment = 1.2;
          break;
        case 3:
          adjustment = 1.5;
          break;
        case 4:
          adjustment = 2.0;
          break;
        case 5:
          adjustment = 3.0;
          break;
      }
    }

    return Math.max(0.1, baseTradeCount * adjustment);
  }

  /**
   * 检查是否需要强制平仓
   * @returns {object} 强制平仓建议
   */
  checkForceClose() {
    const riskAssessment = this.calculatePositionRisk();

    if (riskAssessment.shouldEmergencyClose) {
      return {
        shouldForceClose: true,
        closeRatio: 0.8, // 紧急平仓80%
        reason: '紧急风险控制',
        priority: 'EMERGENCY',
        riskAssessment,
      };
    }

    if (riskAssessment.shouldForceClose) {
      return {
        shouldForceClose: true,
        closeRatio: 0.5, // 强制平仓50%
        reason: '持仓风险过高',
        priority: 'HIGH',
        riskAssessment,
      };
    }

    return {
      shouldForceClose: false,
      closeRatio: 0,
      reason: '',
      priority: 'NORMAL',
      riskAssessment,
    };
  }

  // ==================== 日志和监控 ====================

  /**
   * 获取持仓状态报告
   * @returns {object} 持仓状态报告
   */
  getPositionReport() {
    const riskAssessment = this.calculatePositionRisk();
    const stopLossLevel = this.getStopLossLevel();
    const forceCloseCheck = this.checkForceClose();

    return {
      timestamp: Date.now(),
      asset: this.asset_name,
      position: {
        contracts: this.getPositionContracts(),
        lots: this.getPositionLots(),
        value: this.getPositionValue(),
        unrealizedPnl: this.getUnrealizedPnl(),
      },
      risk: riskAssessment,
      stopLossLevel,
      forceClose: forceCloseCheck,
      marginRate: this.getMaintenanceMarginRate(),
    };
  }

  /**
   * 记录持仓控制日志
   * @param {string} action 操作类型
   * @param {object} details 详细信息
   */
  logPositionControl(action, details = {}) {
    const report = this.getPositionReport();
    console.log(`[PositionManager][${this.asset_name}] ${action}:`, {
      ...details,
      positionReport: report,
    });
  }
}

// 导出便捷函数，保持向后兼容
export function StopLossControl(
  threshold,
  stopLossLevel,
  tendency,
  pos,
  trade_suppress_multiple,
  gridCount
) {
  // 创建临时实例来使用新的逻辑
  const tempManager = new PositionManager({
    trade_suppress_multiple,
  });

  return tempManager.getTradeStrategy(threshold, gridCount, tendency, pos);
}
