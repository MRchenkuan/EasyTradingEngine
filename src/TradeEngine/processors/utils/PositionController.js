import { StopLossLevel } from '../../../enum.js';

/**
 * 持仓控制器 - 通过减少收益来维持低持仓
 */
export class PositionController {
  constructor(config = {}) {
    // 持仓控制参数
    this.maxPositionRatio = config.maxPositionRatio || 0.3; // 最大持仓比例（相对于账户总资金）
    this.targetPositionRatio = config.targetPositionRatio || 0.15; // 目标持仓比例
    this.positionDecayFactor = config.positionDecayFactor || 0.8; // 持仓衰减因子
    
    // 动态调整参数
    this.baseThresholdMultiplier = config.baseThresholdMultiplier || 1.0;
    this.maxThresholdMultiplier = config.maxThresholdMultiplier || 3.0;
    this.minThresholdMultiplier = config.minThresholdMultiplier || 0.5;
    
    // 强制平仓参数
    this.forceCloseRatio = config.forceCloseRatio || 0.5; // 强制平仓比例
    this.emergencyCloseRatio = config.emergencyCloseRatio || 0.8; // 紧急平仓比例
  }

  /**
   * 计算当前持仓风险等级
   * @param {number} currentPosition 当前持仓数量
   * @param {number} accountValue 账户总价值
   * @param {number} positionValue 持仓价值
   * @param {number} unrealizedPnl 未实现盈亏
   * @returns {object} 风险等级和控制参数
   */
  calculatePositionRisk( accountValue, positionValue, unrealizedPnl) {
    const positionRatio = Math.abs(positionValue) / accountValue;
    
    // 计算风险等级
    let riskLevel = 'LOW';
    let riskScore = 0;
    
    // 基于持仓比例的风险评估
    if (positionRatio > this.maxPositionRatio) {
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
    if (pnlRatio < -0.05) { // 亏损超过5%
      riskScore = Math.min(riskScore + 1, 4);
    }
    
    return {
      riskLevel,
      riskScore,
      positionRatio,
      shouldReducePosition: positionRatio > this.targetPositionRatio,
      shouldForceClose: positionRatio > this.forceCloseRatio,
      shouldEmergencyClose: positionRatio > this.emergencyCloseRatio
    };
  }

  /**
   * 计算动态交易阈值
   * @param {number} baseThreshold 基础阈值
   * @param {object} riskAssessment 风险评估结果
   * @param {number} gridCount 网格数量
   * @param {string} tradeDirection 交易方向 ('OPEN' | 'CLOSE')
   * @returns {number} 调整后的阈值
   */
  calculateDynamicThreshold(baseThreshold, riskAssessment, gridCount, tradeDirection) {
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
    }
    
    // 根据网格数量进一步调整
    const gridAdjustment = Math.min(Math.abs(gridCount) * 0.1, 1.0);
    if (tradeDirection === 'OPEN') {
      multiplier += gridAdjustment; // 开仓时网格越多阈值越高
    } else {
      multiplier = Math.max(multiplier - gridAdjustment, 0.1); // 平仓时网格越多阈值越低
    }
    
    // 限制阈值范围
    multiplier = Math.max(this.minThresholdMultiplier, 
                         Math.min(this.maxThresholdMultiplier, multiplier));
    
    return baseThreshold * multiplier;
  }

  /**
   * 计算交易数量调整
   * @param {number} baseTradeCount 基础交易数量
   * @param {object} riskAssessment 风险评估结果
   * @param {string} tradeDirection 交易方向
   * @returns {number} 调整后的交易数量
   */
  calculateTradeCountAdjustment(baseTradeCount, riskAssessment, tradeDirection) {
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
      }
    }
    
    return Math.max(0.1, baseTradeCount * adjustment);
  }

  /**
   * 检查是否需要强制平仓
   * @param {object} riskAssessment 风险评估结果
   * @param {number} currentPosition 当前持仓
   * @returns {object} 强制平仓建议
   */
  checkForceClose(riskAssessment, currentPosition) {
    if (riskAssessment.shouldEmergencyClose) {
      return {
        shouldForceClose: true,
        closeRatio: 0.8, // 紧急平仓80%
        reason: '紧急风险控制',
        priority: 'EMERGENCY'
      };
    }
    
    if (riskAssessment.shouldForceClose) {
      return {
        shouldForceClose: true,
        closeRatio: 0.5, // 强制平仓50%
        reason: '持仓风险过高',
        priority: 'HIGH'
      };
    }
    
    return {
      shouldForceClose: false,
      closeRatio: 0,
      reason: '',
      priority: 'NORMAL'
    };
  }
}