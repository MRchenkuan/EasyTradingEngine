import { getAccountBalance } from '../api.js';
import { LocalVariable } from '../LocalVariable.js';
import { monitorServer } from '../server.js';
import { RiskControl } from '../../config.js';
import { Liquidator } from './Liquidator.js';

/**
 * 账户风控监控器（余额/回撤/杠杆）
 *
 * 从 TradeEngine 抽出，专注账户总权益的拉取、跳变防护、极值/回撤率计算与实际账户杠杆，
 * 并把结果推送到监控面板。TradeEngine 通过静态门面委托调用，外部零改动。
 *
 * 设计文档见 docs/drawdown-liquidation-design.md（口径/模式选型/清仓模板/反模式/多级风控占位）
 */
export class AccountRiskMonitor {
  /**
   * @param {typeof import('./TradeEngine.js').TradeEngine} engine - TradeEngine 类引用，
   *   用于访问 _position_list / _instrument_info / getRealtimePrice 等共享状态
   */
  constructor(engine) {
    this.engine = engine;
    this._account_balance = null; // 账户余额数据（含 totalEq 总权益，回撤控制口径）
    this._balance_timer = null; // 账户余额定时器
    this._balance_refresh_interval = RiskControl.balance_refresh_interval; // 账户余额刷新间隔
    this._balance_started = false; // 余额定时拉取是否已启动（幂等保护，避免 start() 重入时重复启动）
    // 总权益历史极值（持久化，重启不丢失；用于回撤控制基准）
    // 结构：{ maxEq, minEq, maxEqTs, minEqTs, lastConfirmedEq }
    this._account_eq_stats = new LocalVariable('TradeEngine/accountEqStats');
    // 内存备份：LocalVariable proxy 在某些场景下读取不可靠，用普通对象做双保险
    this._eq_mem = {};
    // 跳变防护阈值（从 config.js RiskControl 读取）
    this._balance_jump_threshold = RiskControl.balance_jump_threshold;
    this._balance_pending_jump = null; // 待确认的跳变值（内存，重启重置）
    // 回撤控制阈值（从 config.js RiskControl 读取）
    this._drawdown_liquidation_threshold = RiskControl.drawdown_liquidation_threshold;
    this._drawdown_warn_threshold = RiskControl.drawdown_warn_threshold;
    // 实际账户杠杆等级阈值（从 config.js RiskControl 读取）
    this._leverage_warn_threshold = RiskControl.leverage_warn_threshold;
    this._leverage_danger_threshold = RiskControl.leverage_danger_threshold;
    this._account_leverage = { lever: 0, level: 0, notional: 0, ts: null }; // 缓存（内存，每次持仓或余额刷新重算）
    this._lev_logged = new Set(); // notionalUsd fallback 日志按 assetName 节流
    this._peak_reset_pending = false; // 清仓后标记：等下一次余额刷新再用真实权益重置峰谷
    this._balance_first_logged = false; // 余额首次拉取成功已打印
  }

  /**
   * 启动账户余额定时拉取（幂等：已启动则直接返回，避免 start() 重入时重复启动）
   * 拉取 OKX /api/v5/account/balance 的 totalEq 作为账户总权益口径，用于回撤控制
   *
   * 跳变防护：raw（本次 API 原始值）与 confirmed（稳定值）偏差超阈值视为可疑，
   * 需连续两次相近异常值才采纳（识别真实充值/提取/大波动），单次 API 异常被过滤；
   * 极值 maxEq/minEq 只用 confirmed 更新，单次异常永不污染极值，避免错误清仓。
   */
  start() {
    if (this._balance_started) return;
    this._balance_started = true;

    // 修复卡死状态：liquidationTriggered=true 但峰谷未重置（清仓异常导致 maxEq 仍为旧峰值）
    // 重启后回撤率仍 ≥ 清仓线，但 liquidationTriggered=true 既不触发也不自动复位 → 卡死
    // 注意：如果 peakResetPending=true，说明是清仓后正常等待余额刷新，不算卡死
    const stats = this._account_eq_stats;
    if (
      stats.liquidationTriggered &&
      !stats.peakResetPending &&
      stats.maxEq != null &&
      stats.lastConfirmedEq != null &&
      stats.maxEq > stats.lastConfirmedEq
    ) {
      const ddRatio = (stats.maxEq - stats.lastConfirmedEq) / stats.maxEq;
      if (ddRatio >= this._drawdown_liquidation_threshold) {
        const eq = stats.lastConfirmedEq;
        const oldMax = stats.maxEq;
        stats.maxEq = eq;
        stats.minEq = eq;
        stats.maxEqTs = Date.now();
        stats.minEqTs = stats.maxEqTs;
        this._eq_mem.maxEq = eq;
        this._eq_mem.minEq = eq;
        this._eq_mem.maxEqTs = stats.maxEqTs;
        this._eq_mem.minEqTs = stats.minEqTs;
        console.warn(
          `[Liquidation] 检测到卡死状态（liquidationTriggered=true 但 maxEq=${oldMax} 未重置），峰谷已重置为 ${eq}`
        );
      }
    }

    const updateBalance = async () => {
      try {
        const balance = await getAccountBalance();
        // API 失败或空数据：保持上次稳定值，不更新任何状态，仅重推上次 confirmed
        if (!balance) {
          this.pushBalance(null);
          return;
        }
        const raw = parseFloat(balance.totalEq);
        // raw 无效（NaN/0/负）：视为数据获取异常，不更新稳定值/极值，仅重推上次 confirmed
        if (!(raw > 0)) {
          this.pushBalance(null);
          return;
        }
        const stats = this._account_eq_stats;
        const mem = this._eq_mem;
        const threshold = this._balance_jump_threshold;
        // 优先从 mem（普通对象，无 proxy 坑）读 confirmed
        let confirmed = mem.lastConfirmedEq;
        if (confirmed == null) confirmed = stats.lastConfirmedEq;
        if (confirmed == null) {
          // 首次拉取，直接采纳
          confirmed = raw;
          stats.lastConfirmedEq = confirmed;
          mem.lastConfirmedEq = confirmed;
          this._balance_pending_jump = null;
        } else {
          const changeRate = Math.abs(raw - confirmed) / confirmed;
          if (changeRate <= threshold) {
            // 正常波动，采纳
            confirmed = raw;
            stats.lastConfirmedEq = confirmed;
            mem.lastConfirmedEq = confirmed;
            this._balance_pending_jump = null;
          } else if (
            this._balance_pending_jump != null &&
            Math.abs(raw - this._balance_pending_jump) / this._balance_pending_jump <= threshold
          ) {
            // 连续两次相近的跳变值，确认为真实变化（充值/提取/大波动），延迟一个周期采纳
            confirmed = raw;
            stats.lastConfirmedEq = confirmed;
            mem.lastConfirmedEq = confirmed;
            this._balance_pending_jump = null;
          } else {
            // 首次跳变，暂存待确认，本次不更新稳定值/极值，仅重推上次 confirmed
            this._balance_pending_jump = raw;
          }
        }
        // 极值 & 回撤率 只基于 confirmed 更新（待确认状态跳过，避免异常值污染）
        if (this._balance_pending_jump == null) {
          // 首次 confirmed 落地 → 打一条就绪日志
          if (!this._balance_first_logged) {
            this._balance_first_logged = true;
            const dd = this._calcDrawdown();
            console.log(
              `[Balance] ✅ 账户余额已就绪: totalEq=$${confirmed.toFixed(2)} 回撤=${dd.pct.toFixed(2)}% 杠杆=${this._account_leverage.lever.toFixed(2)}x`
            );
          }
          // 清仓后延迟重置峰谷：用清仓后的真实权益（而非清仓前含未实现盈亏的旧值）
          // 避免人造回撤导致反复清仓
          if (this._peak_reset_pending || stats.peakResetPending || mem.peakResetPending) {
            stats.maxEq = confirmed;
            stats.minEq = confirmed;
            stats.maxEqTs = Date.now();
            stats.minEqTs = stats.maxEqTs;
            mem.maxEq = confirmed;
            mem.minEq = confirmed;
            mem.maxEqTs = stats.maxEqTs;
            mem.minEqTs = stats.minEqTs;
            stats.peakResetPending = false;
            mem.peakResetPending = false;
            this._peak_reset_pending = false;
            console.warn(`[Liquidation] 峰谷已重置（清仓后真实权益）：maxEq=minEq=${confirmed}`);
          }
          this._updateExtremes(confirmed);
          const drawdownResult = this._calcDrawdown();
          // === 回撤清仓触发（设计文档 §3）===
          // 入口必用离散化 drawdownLevel >= 2，不比浮点 drawdownPct >= 20，防浮点尾差漏触发
          // liquidationTriggered 持久化在 _account_eq_stats，重启后仍记住"已触发过"，绝不自动复位
          if (
            drawdownResult.level >= 2 &&
            !stats.liquidationTriggered &&
            !mem.liquidationTriggered
          ) {
            stats.liquidationTriggered = true;
            stats.liquidationTriggeredTs = Date.now();
            stats.liquidationTriggeredMax = mem.maxEq ?? stats.maxEq;
            stats.liquidationTriggeredEq = confirmed;
            mem.liquidationTriggered = true;
            mem.liquidationTriggeredTs = stats.liquidationTriggeredTs;
            console.warn(
              `[Liquidation] 触发清仓！drawdownPct=${drawdownResult.pct}%, maxEq=${mem.maxEq ?? stats.maxEq}, confirmedEq=${confirmed}`
            );
            // 同步执行清仓：await 让余额定时器暂停，避免清仓过程中再次触发；
            // liquidationTriggered=true 已防止重复触发，await 仅为让定时器节奏更清晰
            try {
              await Liquidator.liquidate(this.engine);
            } catch (e) {
              console.error(`[Liquidation] 清仓执行异常: ${e.message}`);
            } finally {
              // 不在此处重置峰谷！confirmed 是清仓前的值（含未实现盈亏），
              // 清仓实现亏损后实际权益更低，用旧值重置会产生人造回撤，极端情况导致反复清仓。
              // 标记 _peak_reset_pending，等下一次余额刷新拿到真实权益后再重置。
              stats.peakResetPending = true;
              mem.peakResetPending = true;
              this._peak_reset_pending = true;
              console.warn(`[Liquidation] 峰谷重置已延迟，等待下一次余额刷新获取真实权益`);
            }
          }
          // === 自动复位：清仓后峰谷已重置，下一轮回撤率归零后自动恢复交易 ===
          // 触发轮 drawdownResult 仍是旧值（level≥2），不会同轮复位；
          // 下一轮基于重置后峰谷重算，level<2 时自动复位，策略恢复交易
          if (stats.liquidationTriggered && drawdownResult.level < 2) {
            stats.liquidationTriggered = false;
            mem.liquidationTriggered = false;
            console.warn('[Liquidation] 回撤已恢复（< 清仓线），自动复位，策略恢复交易');
          }
          // confirmedEq 刚变（分母变）→ 重算实际杠杆（Σ|notional| / confirmedEq）
          this.calcLeverage();
        } else {
          // 即使 confirmed 这次没更新（待确认状态），持仓名义可能变了也得重算；
          // 这里轻量补一次，避免等到下一轮持仓刷新才反映
          this.calcLeverage();
        }
        this.pushBalance(balance);
      } catch (e) {
        this.pushBalance(null);
      } finally {
        this._balance_timer = setTimeout(updateBalance, this._balance_refresh_interval);
      }
    };
    updateBalance();
  }

  /**
   * 更新总权益历史最大值/最小值（只接受 confirmed 调用）
   * 峰值 maxEq 是回撤率公式的分母，必须只反映真实、经过确认的最高值——
   * 否则单次异常大值会拉高 maxEq，让后续正常值都被计算为"回撤"，导致回撤率虚高误清仓。
   * @param {number} confirmed - 经过跳变防护确认后的稳定权益值
   */
  _updateExtremes(confirmed) {
    const stats = this._account_eq_stats;
    const mem = this._eq_mem;
    if (stats.maxEq == null || confirmed > stats.maxEq) {
      stats.maxEq = confirmed;
      stats.maxEqTs = Date.now();
      mem.maxEq = confirmed;
      mem.maxEqTs = stats.maxEqTs;
    }
    if (stats.minEq == null || confirmed < stats.minEq) {
      stats.minEq = confirmed;
      stats.minEqTs = Date.now();
      mem.minEq = confirmed;
      mem.minEqTs = stats.minEqTs;
    }
  }

  /**
   * 计算回撤率并存入持久化 stats
   * 口径统一（参考教训：分子分母口径必须明确固化）：
   * - drawdownRatio = (maxEq - confirmedEq) / maxEq
   * - 分母固定为 maxEq（历史峰值，回撤控制唯一基准）
   * - 结果范围：≥0；无峰值或当前值≥峰值时为 0（无回撤）
   * - drawdownPct：百分比形式（×100，2 位小数），用于展示 & 阈值比较
   * - drawdownLevel：0=正常 / 1=预警(≥10%) / 2=清仓(≥20%)
   */
  _calcDrawdown() {
    const stats = this._account_eq_stats;
    const mem = this._eq_mem;
    // 优先从 mem 读（普通对象，无 proxy 不确定性）
    const confirmed = mem.lastConfirmedEq ?? stats.lastConfirmedEq;
    const maxEq = mem.maxEq ?? stats.maxEq;
    let ratio = 0;
    if (maxEq != null && maxEq > 0 && confirmed != null && confirmed < maxEq) {
      ratio = (maxEq - confirmed) / maxEq;
    }
    if (ratio < 0) ratio = 0;
    stats.drawdownRatio = ratio;
    stats.drawdownPct = +(ratio * 100).toFixed(2);
    mem.drawdownPct = stats.drawdownPct;
    mem.drawdownRatio = ratio;
    if (ratio >= this._drawdown_liquidation_threshold) {
      stats.drawdownLevel = 2;
    } else if (ratio >= this._drawdown_warn_threshold) {
      stats.drawdownLevel = 1;
    } else {
      stats.drawdownLevel = 0;
    }
    mem.drawdownLevel = stats.drawdownLevel;
    stats.drawdownTs = Date.now();
    mem.drawdownTs = stats.drawdownTs;
    return { ratio, pct: stats.drawdownPct, level: stats.drawdownLevel };
  }

  /**
   * 计算实际账户杠杆：Σ|持仓名义 USD| / confirmedEq（总权益）
   * 这是仓位杠杆倍数 × 资金使用率 的综合结果——真实反映账户整体风险敞口：
   *   若单仓 20x 杠杆但你只用了 1/5 资金 → 实际杠杆≈4x（不是 20x）
   * 调用点：持仓刷新成功后（分子变）/ confirmedEq 确认更新后（分母变）
   * 结果写进 _account_leverage 缓存，pushBalance 时随消息一起推送到前端
   */
  calcLeverage() {
    const confirmed = this._account_eq_stats.lastConfirmedEq;
    let notional = 0;
    let netDirectionUsd = 0; // ΣnotionalUsd 带符号：正=净多，负=净空，0=对冲
    let longNotional = 0;
    let shortNotional = 0;
    for (const name of Object.keys(this.engine._position_list)) {
      const p = this.engine._position_list[name];
      if (!p) continue;
      const posSz = parseFloat(p.pos); // 持仓张数（带符号：正=多/负=空）
      // 优先用 OKX positions 接口返回的 notionalUsd（绝对值），方向从 pos 符号获取
      let n = parseFloat(p.notionalUsd);
      if (isFinite(n) && n !== 0 && isFinite(posSz) && posSz !== 0) {
        const signedN = posSz > 0 ? n : -n; // 用 pos 符号决定方向
        notional += n;
        netDirectionUsd += signedN;
        if (signedN > 0) longNotional += signedN;
        else shortNotional += Math.abs(signedN);
        continue;
      }
      // Fallback：如果 notionalUsd 缺失/为 0/为 NaN，自己从 pos × ctVal × ctMult × 价格 计算
      if (!isFinite(posSz) || posSz === 0) continue; // 没仓位 → 无名义
      const inst = this.engine._instrument_info[name]; // instrument info 缓存（含 ctVal/ctMult）
      const ctVal = inst ? parseFloat(inst.ctVal) : NaN;
      const ctMult = inst ? parseFloat(inst.ctMult) : NaN;
      // 价格优先级：position 的 markPx > 实时价格缓存 > 持仓均价
      const markPx = parseFloat(p.markPx);
      const lastPx = parseFloat(this.engine.getRealtimePrice(name) || NaN);
      const avgPx = parseFloat(p.avgPx);
      const price = isFinite(markPx)
        ? markPx
        : isFinite(lastPx)
          ? lastPx
          : isFinite(avgPx)
            ? avgPx
            : NaN;
      if (isFinite(ctVal) && isFinite(ctMult) && isFinite(price)) {
        const perContractValueUsd = ctVal * ctMult * price; // 每张合约的 USD 名义
        const n2 = Math.abs(posSz) * perContractValueUsd;
        const signedN2 = posSz * perContractValueUsd; // 带符号
        notional += n2;
        netDirectionUsd += signedN2;
        if (signedN2 > 0) longNotional += signedN2;
        else shortNotional += Math.abs(signedN2);
        // 仅在 notionalUsd 缺失时打印一次，方便后续定位字段缺失原因（按 assetName 节流）
        if (!this._lev_logged.has(name)) {
          this._lev_logged.add(name);
          console.warn(
            `[Leverage] ${name}: notionalUsd 字段无效(${p.notionalUsd})，已 fallback 用 pos×ctVal×ctMult×price 计算：|${posSz}| × ${ctVal}×${ctMult} × $${price.toFixed(
              4
            )} = $${n2.toFixed(2)}`
          );
        }
      }
    }
    let lever = 0;
    if (confirmed && confirmed > 0) {
      lever = notional / confirmed;
    }
    if (lever < 0) lever = 0;
    let level = 0;
    if (lever >= this._leverage_danger_threshold) level = 2;
    else if (lever >= this._leverage_warn_threshold) level = 1;
    this._account_leverage = {
      lever: +lever.toFixed(2),
      level,
      notional: +notional.toFixed(2),
      ts: Date.now(),
      // 多空方向聚合：ΣnotionalUsd 带符号
      netDirectionUsd: +netDirectionUsd.toFixed(2), // 正=净多，负=净空，0=对冲
      longNotional: +longNotional.toFixed(2),
      shortNotional: +shortNotional.toFixed(2),
    };
    return this._account_leverage;
  }

  /**
   * 统一推送账户余额到监控面板
   * totalEq 始终用 confirmed（稳定值），不用 raw，避免前端显示跳变
   * @param {Object|null} rawBalance - 本次 API 原始返回（用于补充 upl/marginRatio 等非关键字段）；null 表示本次无新数据
   */
  /**
   * 汇总当前策略持仓的已实现/未实现收益
   * 口径与资产卡片一致：仅统计有仓位的品种（pos≠0），空仓记录不计
   * @returns {{realized: number, unrealized: number, total: number}}
   */
  calcTotalPnl() {
    let realized = 0;
    let unrealized = 0;
    for (const name of Object.keys(this.engine._position_list)) {
      const p = this.engine._position_list[name];
      if (!p) continue;
      const posSz = parseFloat(p.pos);
      if (!isFinite(posSz) || posSz === 0) continue; // 空仓记录不计
      const r = parseFloat(p.realizedPnl);
      const u = parseFloat(p.upl);
      if (isFinite(r)) realized += r;
      if (isFinite(u)) unrealized += u;
    }
    return { realized, unrealized, total: realized + unrealized };
  }

  pushBalance(rawBalance) {
    const stats = this._account_eq_stats;
    const mem = this._eq_mem;
    // 优先从 mem 读（普通对象，无 proxy 不确定性），fallback 到 stats
    const confirmed = mem.lastConfirmedEq ?? stats.lastConfirmedEq;
    // 还没有任何确认值时不推送，避免推送 null/0 造成前端跳变
    if (confirmed == null) return;
    const lev = this._account_leverage || {};
    const prev = this._account_balance || {};
    // 极值也优先从 mem 读
    const maxEq = mem.maxEq ?? (stats.maxEq != null ? stats.maxEq : null);
    const minEq = mem.minEq ?? (stats.minEq != null ? stats.minEq : null);
    // 清仓线对应的权益值 = 历史峰值 × (1 - 20%清仓线)
    const liquidationEq =
      maxEq != null ? +(maxEq * (1 - this._drawdown_liquidation_threshold)).toFixed(4) : null;
    // 条图可视范围下限：取 min(minEq, liquidationEq)
    let rangeMin = minEq;
    if (liquidationEq != null && (rangeMin == null || liquidationEq < rangeMin)) {
      rangeMin = liquidationEq;
    }
    if (maxEq != null && rangeMin != null) {
      const rangeSpan = maxEq - rangeMin;
      const bufferedMin = +(rangeMin - rangeSpan * 0.03).toFixed(4);
      if (bufferedMin < rangeMin) rangeMin = bufferedMin >= 0 ? bufferedMin : 0;
    }
    // 收益率口径：分子=当前总权益，分母=总权益扣除已实现+未实现盈亏（即"本金"）
    // yieldRate = totalEq / (totalEq - pnl) - 1 = pnl / 本金
    // 本金 <= 0（盈亏亏损超过权益，理论上不应出现）时置 null，前端显示 '-'
    const pnl = this.calcTotalPnl();
    const principal = confirmed - pnl.total;
    const yieldRate = principal > 0 ? pnl.total / principal : null;
    this._account_balance = {
      totalEq: confirmed,
      upl: rawBalance ? parseFloat(rawBalance.upl || 0) : (prev.upl ?? 0),
      marginRatio: rawBalance ? parseFloat(rawBalance.marginRatio || 0) : (prev.marginRatio ?? 0),
      frozenBal: rawBalance ? parseFloat(rawBalance.frozenBal || 0) : (prev.frozenBal ?? 0),
      maxEq,
      minEq,
      maxEqTs: mem.maxEqTs || stats.maxEqTs || null,
      minEqTs: mem.minEqTs || stats.minEqTs || null,
      drawdownRatio: mem.drawdownRatio ?? 0,
      drawdownPct: mem.drawdownPct ?? 0,
      drawdownLevel: mem.drawdownLevel ?? 0,
      drawdownTs: mem.drawdownTs || null,
      liquidationEq,
      rangeMin: rangeMin != null ? +rangeMin : null,
      rangeMax: maxEq,
      liquidationTriggered: mem.liquidationTriggered ?? stats.liquidationTriggered ?? false,
      liquidationTriggeredTs: mem.liquidationTriggeredTs || stats.liquidationTriggeredTs || null,
      lever: lev.lever ?? 0,
      leverLevel: lev.level ?? 0,
      leverNotional: lev.notional ?? 0,
      leverTs: lev.ts || null,
      netDirectionUsd: lev.netDirectionUsd ?? 0, // 净方向：正=净多，负=净空
      longNotional: lev.longNotional ?? 0,
      shortNotional: lev.shortNotional ?? 0,
      realizedPnl: +pnl.realized.toFixed(4),
      unrealizedPnl: +pnl.unrealized.toFixed(4),
      totalPnl: +pnl.total.toFixed(4),
      principal: principal > 0 ? +principal.toFixed(4) : null,
      yieldRate: yieldRate != null ? +yieldRate.toFixed(6) : null,
      lastUpdateTime: Date.now(),
    };
    monitorServer.updateAccountBalance(this._account_balance);
  }

  /**
   * 获取账户余额（含 totalEq 总权益）
   * @returns {Object|null} 账户余额数据
   */
  getBalance() {
    return this._account_balance;
  }

  /**
   * 清仓是否已触发（回撤恢复后自动复位，见 start() 中的自动复位逻辑）
   * @returns {boolean}
   */
  isLiquidationTriggered() {
    const stats = this._account_eq_stats;
    const mem = this._eq_mem;
    return !!(mem.liquidationTriggered ?? stats.liquidationTriggered);
  }
}
