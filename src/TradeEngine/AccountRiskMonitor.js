import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getAccountBalance } from '../api.js';
import { LocalVariable } from '../LocalVariable.js';
import { monitorServer } from '../server.js';
import { RiskControl, initialEquity } from '../../config.js';
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
    // 再平衡线阈值（纯展示刻度，实际再平衡逻辑后续实现）
    this._rebalance_threshold = RiskControl.rebalance_threshold ?? 0.1;
    // 实际账户杠杆等级阈值（从 config.js RiskControl 读取）
    this._leverage_warn_threshold = RiskControl.leverage_warn_threshold;
    this._leverage_danger_threshold = RiskControl.leverage_danger_threshold;
    this._account_leverage = { lever: 0, level: 0, notional: 0, ts: null }; // 缓存（内存，每次持仓或余额刷新重算）
    this._lev_logged = new Set(); // notionalUsd fallback 日志按 assetName 节流
    this._peak_reset_pending = false; // 清仓后标记：等下一次余额刷新再用真实权益重置峰谷
    this._balance_first_logged = false; // 余额首次拉取成功已打印
    // 小时级权益历史（独立 JSON 文件，避免撑大 local-variables.json）
    // 格式：[{ ts: number（整点毫秒戳）, equity: number }, ...] 按 ts 升序
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    this._history_file = path.join(__dirname, '../../records/equity-history.json');
    this._hourly_history = this._loadHourlyHistory();
    // 启动时已有 history 必须先置 dirty → 第一次 pushBalance 推给前端初始化走势图
    this._history_dirty = this._hourly_history.length > 0;
    // 一次性清理：旧的每日快照 LocalVariable key（已迁移到独立文件）
    this._cleanupOrphanedDailySnapshots();
  }

  /** 从 LocalVariable 删除已迁移的 TradeEngine/dailyEqSnapshots key（幂等） */
  _cleanupOrphanedDailySnapshots() {
    try {
      const root = new LocalVariable('TradeEngine');
      if (root && root.dailyEqSnapshots != null && Object.keys(root.dailyEqSnapshots).length > 0) {
        console.log('[Balance] 清理已迁移的旧每日快照 LocalVariable key');
        delete root.dailyEqSnapshots; // 触发 deleteProperty handler
      }
    } catch (_) {
      // 清理失败不影响主流程
    }
  }

  /** 从独立 JSON 文件加载小时级权益历史；文件不存在/损坏则返回空数组 */
  _loadHourlyHistory() {
    try {
      const dir = path.dirname(this._history_file);
      fs.mkdirSync(dir, { recursive: true });
      if (!fs.existsSync(this._history_file)) return [];
      const raw = fs.readFileSync(this._history_file, 'utf8');
      if (!raw.trim()) return [];
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) {
        // 校验并清洗：只保留合法条目
        return arr
          .filter(
            e => e && typeof e.ts === 'number' && typeof e.equity === 'number' && e.equity > 0
          )
          .sort((a, b) => a.ts - b.ts);
      }
      return [];
    } catch (e) {
      console.warn(`[Balance] 加载权益历史文件失败（将重置为空）: ${e.message}`);
      return [];
    }
  }

  /** 将小时级权益历史写回独立 JSON 文件（同步写入，fs-extra 风格） */
  _saveHourlyHistory() {
    try {
      const dir = path.dirname(this._history_file);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this._history_file, JSON.stringify(this._hourly_history, null, 2), 'utf8');
    } catch (e) {
      console.error(`[Balance] 保存权益历史文件失败: ${e.message}`);
    }
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
        // 小时级权益历史记录（独立 JSON 文件）
        // 移到 confirmed 分支外：每 10s 都会调用一次，但内部有保护——
        // 同小时戳已存在就跳过，新整点才追加 + 置 dirty
        this._tryRecordHourlySnapshot(mem.lastConfirmedEq ?? stats.lastConfirmedEq);
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
    const now = Date.now();
    let peakUpdated = false;
    if (stats.maxEq == null || confirmed > stats.maxEq) {
      stats.maxEq = confirmed;
      stats.maxEqTs = now;
      mem.maxEq = confirmed;
      mem.maxEqTs = now;
      peakUpdated = true;
    }
    if (peakUpdated) {
      // 峰值被刷新 → 谷值重置为当前值（新的统计周期起点）
      stats.minEq = confirmed;
      stats.minEqTs = now;
      mem.minEq = confirmed;
      mem.minEqTs = now;
    } else if (stats.minEq == null || confirmed < stats.minEq) {
      stats.minEq = confirmed;
      stats.minEqTs = now;
      mem.minEq = confirmed;
      mem.minEqTs = now;
    }
  }

  /**
   * 每小时整点（或首次启动时）记录一次 confirmed 权益到独立 JSON 文件。
   * - 取当前小时的整点戳 `Math.floor(now / 3600000) * 3600000`
   * - 如果该小时已有记录 → 更新为最新 confirmed（不重复追加）
   * - 首次启动（history 为空）也会记录一条锚点，保证走势图有起点
   * - 限制最多 24 个月 ≈ 17520 条，防止文件无限增长
   */
  _tryRecordHourlySnapshot(confirmed) {
    const now = Date.now();
    const hourTs = Math.floor(now / 3600000) * 3600000;
    const history = this._hourly_history;

    // 首次启动空 history → 记录整点锚点 + 当前实时点（2 条保证走势图可画）
    if (history.length === 0) {
      history.push({ ts: hourTs, equity: +confirmed.toFixed(4) });
      // 再追加一条当前时间戳（非整点）作为实时端点，让 history ≥ 2 条 → 走势图立即可见
      history.push({ ts: now, equity: +confirmed.toFixed(4) });
      this._history_dirty = true;
      this._saveHourlyHistory();
      console.log(
        `[Balance] Equity history anchor (first boot): hour=$${confirmed.toFixed(
          2
        )} now=$${confirmed.toFixed(2)}`
      );
      return;
    }

    // 检查最后一条记录的小时桶（按小时取整，允许锚点第二条用 now 时间戳）
    const last = history[history.length - 1];
    const lastHourTs = Math.floor(last.ts / 3600000) * 3600000;
    if (lastHourTs === hourTs) {
      // 同一小时桶：更新为最新 confirmed（更准确的值），但不置 dirty
      const newEq = +confirmed.toFixed(4);
      if (Math.abs(newEq - last.equity) > 0.001) {
        last.equity = newEq;
      }
      // 如果只有 1 条记录（旧锚点场景），补一条当前 hourTs 让 history 有 2 条
      if (history.length === 1) {
        history.push({ ts: hourTs, equity: newEq });
        this._history_dirty = true;
      }
      return;
    }
    if (lastHourTs > hourTs) {
      // 时间倒退（NTP 校时/手动改系统时间）→ 跳过，不破坏时序
      return;
    }

    // 新小时 → 追加
    history.push({ ts: hourTs, equity: +confirmed.toFixed(4) });
    this._history_dirty = true;

    // 限制最多 24 个月（~17520 条），超出则截断最早的
    const MAX_HOURS = 24 * 30 * 24; // 24 个月
    if (history.length > MAX_HOURS) {
      history.splice(0, history.length - MAX_HOURS);
    }

    this._saveHourlyHistory();
  }

  /**
   * 取今日收益率基准权益（今天 8:00 那个小时的快照）。
   * 扫描 history：找到今天 8 点（本地时区）对应的整点小时戳，返回该条 equity。
   * 若今天 8 点快照还没记录到（服务在 8 点后刚启动），则回退到"今天第一条小时快照"。
   * @returns {number|null} 今日基准权益；history 为空时返回 null
   */
  _getTodayBaseline() {
    if (!this._hourly_history || this._hourly_history.length === 0) return null;
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const day = now.getDate();
    // 今天 8:00 本地时区 → UTC 毫秒戳
    const today8 = new Date(year, month, day, 8, 0, 0, 0).getTime();
    // 今天 0:00 本地时区
    const today0 = new Date(year, month, day, 0, 0, 0, 0).getTime();

    // 先尝试精确匹配 8 点那条
    const h8 = this._hourly_history.find(e => e.ts === today8);
    if (h8) return +h8.equity;

    // 回退：取今天 0:00 之后的第一条小时快照
    const firstToday = this._hourly_history.find(e => e.ts >= today0);
    if (firstToday) return +firstToday.equity;

    return null;
  }

  /**
   * 构建完整小时级权益历史数组（按 ts 升序）。
   * 每次都返回 history 数组（如果 ≥2 条）——前端收到即渲染，无缓存等待。
   * hourly 粒度增长慢（24 条/天），每 10s 推一次几 KB 完全可接受。
   */
  _buildEquityHistoryIfDirty() {
    if (this._hourly_history.length < 2) return null;
    return this._hourly_history.slice();
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
    const positionBreakdown = []; // [{ name, notionalUsd, isLong }] 按金额降序
    for (const name of Object.keys(this.engine._position_list)) {
      const p = this.engine._position_list[name];
      if (!p) continue;
      const posSz = parseFloat(p.pos); // 持仓张数（带符号：正=多/负=空）
      // 优先用 OKX positions 接口返回的 notionalUsd（绝对值），方向从 pos 符号获取
      let n = parseFloat(p.notionalUsd);
      if (isFinite(n) && n !== 0 && isFinite(posSz) && posSz !== 0) {
        // 直接用 OKX 的 notionalUsd
      } else {
        // Fallback：自己从 pos × ctVal × ctMult × 价格 计算
        n = NaN;
        if (!isFinite(posSz) || posSz === 0) continue; // 没仓位 → 跳过
        const inst = this.engine._instrument_info[name];
        const ctVal = inst ? parseFloat(inst.ctVal) : NaN;
        const ctMult = inst ? parseFloat(inst.ctMult) : NaN;
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
        if (!isFinite(ctVal) || !isFinite(ctMult) || !isFinite(price)) continue;
        n = Math.abs(posSz) * ctVal * ctMult * price;
        if (!this._lev_logged.has(name)) {
          this._lev_logged.add(name);
          console.warn(
            `[Leverage] ${name}: notionalUsd 字段无效(${p.notionalUsd})，已 fallback 用 pos×ctVal×ctMult×price 计算：|${posSz}| × ${ctVal}×${ctMult} × $${price.toFixed(
              4
            )} = $${n.toFixed(2)}`
          );
        }
      }
      const signedN = posSz > 0 ? n : -n; // 用 pos 符号决定方向
      notional += n;
      netDirectionUsd += signedN;
      if (signedN > 0) longNotional += signedN;
      else shortNotional += Math.abs(signedN);
      positionBreakdown.push({
        name,
        notionalUsd: +Math.abs(n).toFixed(2),
        isLong: posSz > 0,
      });
    }
    // 按金额降序，前端渲染更有序
    positionBreakdown.sort((a, b) => b.notionalUsd - a.notionalUsd);
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
      positionBreakdown, // [{ name, notionalUsd, isLong }] 按金额降序
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
    // 清仓线对应的权益值 = 历史峰值 × (1 - 清仓阈值)
    const liquidationEq =
      maxEq != null ? +(maxEq * (1 - this._drawdown_liquidation_threshold)).toFixed(4) : null;
    // 再平衡线对应的权益值 = 历史峰值 × (1 - 再平衡阈值)
    const rebalanceEq =
      maxEq != null ? +(maxEq * (1 - this._rebalance_threshold)).toFixed(4) : null;
    // 条图可视范围下限：取 min(minEq, rebalanceEq, liquidationEq)
    let rangeMin = minEq;
    for (const v of [rebalanceEq, liquidationEq]) {
      if (v != null && (rangeMin == null || v < rangeMin)) rangeMin = v;
    }
    if (maxEq != null && rangeMin != null) {
      const rangeSpan = maxEq - rangeMin;
      const bufferedMin = +(rangeMin - rangeSpan * 0.03).toFixed(4);
      if (bufferedMin < rangeMin) rangeMin = bufferedMin >= 0 ? bufferedMin : 0;
    }
    // 收益率口径优先级：
    //   1. 今日 8 点快照基准（每日重置收益率）
    //   2. config.json initial_equity（固定初始本金）
    //   3. 原逻辑 fallback：本金 = 总权益 - 已实现 - 未实现
    const pnl = this.calcTotalPnl();
    let principal,
      totalReturn,
      yieldRate,
      dailyBaseline = null;
    const todaySnap = this._getTodayBaseline();
    if (todaySnap != null) {
      dailyBaseline = todaySnap;
      principal = todaySnap;
      totalReturn = confirmed - todaySnap;
      yieldRate = totalReturn / todaySnap;
    } else if (initialEquity > 0) {
      principal = initialEquity;
      totalReturn = confirmed - initialEquity;
      yieldRate = totalReturn / initialEquity;
    } else {
      principal = confirmed - pnl.total;
      totalReturn = pnl.total;
      yieldRate = principal > 0 ? pnl.total / principal : null;
    }
    // equityHistory：仅在有新快照时携带（避免每 10s 推一次），前端收到 null 保持原缓存
    const equityHistory = this._buildEquityHistoryIfDirty();
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
      rebalanceEq,
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
      positionBreakdown: lev.positionBreakdown ?? [], // 每资产 notional 分解
      realizedPnl: +pnl.realized.toFixed(4),
      unrealizedPnl: +pnl.unrealized.toFixed(4),
      totalPnl: +pnl.total.toFixed(4),
      principal: principal > 0 ? +principal.toFixed(4) : null,
      yieldRate: yieldRate != null ? +yieldRate.toFixed(6) : null,
      dailyBaseline: dailyBaseline != null ? +dailyBaseline.toFixed(4) : null,
      equityHistory, // null=无变化，array=有新快照
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
