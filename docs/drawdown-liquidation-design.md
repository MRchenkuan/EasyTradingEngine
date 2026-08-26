# 回撤清仓设计文档

> 位置标记：与实现代码同在 [TradeEngine.js](../src/TradeEngine/TradeEngine.js) 常量区（`_drawdown_*_threshold` 附近）。实现时先看本文档。

---

## 1. 数据口径（已固化，**不得修改**）

```
drawdownRatio = (maxEq - confirmedEq) / maxEq
```

| 字段 | 含义 | 约束 |
|---|---|---|
| `maxEq` | 历史权益峰值（回撤率唯一分母基准） | 持久化在 `_account_eq_stats.maxEq`，仅由 `_updateEqExtremes(confirmed)` 更新，绝不接受 raw |
| `confirmedEq` | 经过跳变防护确认的**稳定值** | 存于 `_account_eq_stats.lastConfirmedEq` |
| `drawdownRatio` | 回撤比例（0~1） | ≥ 0；无峰值或当前值≥峰值时为 0（不显示负回撤） |
| `drawdownPct` | 百分比形式（= ratio × 100，2 位小数） | 用于展示 & 阈值比较 |
| `drawdownLevel` | 离散化等级：**0=正常 / 1=预警(≥10%) / 2=清仓(≥20%)** | **判断入口必须用它**，避免浮点尾差 |

> **判定入口**：`if (stats.drawdownLevel >= 2)` — 不要直接比 `drawdownPct >= 20` 或 `drawdownRatio >= 0.2`，防止 `0.199999999999` 这种浮点尾差漏触发。

---

## 2. 实现模式选型（已决策）

### ✅ 方案 1：轮询（Polling）——**起步方案**

复用现有 `TradeEngine.startAccountBalanceUpdate()` 的 30s 自调度定时器：

```
updateBalance（每 30s）
  └─ getAccountBalance → raw
      └─ raw → pending_jump 跳变确认 → confirmed
          └─ _updateEqExtremes(confirmed)      // 更新 maxEq/minEq
              └─ _calcDrawdown()               // 计算 drawdownRatio/Pct/Level
                  └─ 【插入点】检查 drawdownLevel >= 2 ？
                      └─ 是 → 触发清仓流程
                      └─ 否 → 继续
                      └─ _pushBalance()        // 推送到前端
```

**优点**：

- 与现有 `startAccountBalanceUpdate → _calcDrawdown` 流水线完全一致，**零额外工程**
- 决策入口**唯一**（同一处触发），无事件竞争 / 多处触发重复清仓问题
- 所有决策必经 confirmed 跳变防护层 → **误触发概率最低**
- 30s 最坏延迟对 **20% 清仓线完全可接受**（20% 回撤不可能 30s 内跨过又回来）

**缺点**：

- 不是"到达阈值瞬间"触发。但 OKX totalEq 的唯一来源就是 REST 拉取，**不接 WS 的前提下，"事件驱动"是伪命题**（见方案 2）。

---

### ❌ 方案 2：伪事件驱动（在定时器里 emit 事件）——**不推荐**

触发源仍然是同一台定时器，与方案 1 的延迟**完全相同**，但引入了：

- EventEmitter（本项目未使用，风格不一致）
- 事件注册 / 注销 / 防抖 / 去重 的复杂度

没有任何新增价值，纯粹增加出错面。

---

### ⚠️ 方案 3：真正事件驱动（OKX 私有 WebSocket `account` 频道）——**延迟敏感时升级**

订阅 OKX 私有 WebSocket：

```
wss://ws.okx.com:8443/ws/v5/private
  └─ 登录（签名鉴权）
      └─ 订阅 { "channel": "account", "ccy": "USDT" }
          └─ 账户变动 → OKX 主动推送（毫秒级）
```

**优点**：

- **真·低延迟**：毫秒级触发
- 不占 REST 配额，不会触发 rate limit

**缺点**：

- 新增一条需要**鉴权**的 WebSocket（签名 + 登录 + 心跳 60s 超时 + 重连，可复用现有 `MESSAGE_TIMEOUT` 模板）
- 静默 TCP 断连（已知问题，与 `ws_business` 一样需要心跳+重连）

#### ⚠️ 不可逾越的约束：WS 推送的 raw 值必须先送进 confirmed 流水线

**不得**直接拿 WS 推送的 raw 值计算回撤或触发清仓。正确流程：

```
WS 推送 raw
  └─ 【必须】送进 raw → pending_jump → confirmed（与 REST 同一条流水线）
      └─ confirmed → _updateEqExtremes → _calcDrawdown → 等级判断 → 清仓
```

否则一次异常推送直接误清仓。

#### 何时升级到方案 3

当且仅当出现**明确的延迟敏感需求**，例如：

- 把清仓线从 20% 提到 10%（区间更窄，30s 延迟可能过阈值再回来）
- 增加"5% 减一半"等**多级风控**（中间状态需及时响应）
- 杠杆极高，价格剧烈波动存在 **30s 内穿仓**风险

---

## 3. 清仓流程·实现模板（方案 1 轮询）

插入位置：`TradeEngine.startAccountBalanceUpdate` 中，`_calcDrawdown()` 之后、`_pushBalance()` 之前。

```js
if (this._balance_pending_jump == null) {
  this._updateEqExtremes(confirmed);
  this._calcDrawdown();

  /* ===== 以下为清仓触发（复制到此位置） ===== */
  if (stats.drawdownLevel >= 2 && !stats.liquidationTriggered) {
    // —— 触发标志（持久化！不得放内存）——
    stats.liquidationTriggered    = true;           // 进程重启后仍记住"已触发过"，防止重复
    stats.liquidationTriggeredTs  = Date.now();     // 触发时间戳（日志/复盘）
    stats.liquidationTriggeredMax = stats.maxEq;    // 触发时的峰值（分母）
    stats.liquidationTriggeredEq  = confirmed;      // 触发时的稳定权益值

    // —— 执行清仓 ——
    await this._executeLiquidation(stats);
  }
  /* ===== 清仓触发结束 ===== */
}

this._pushBalance(balance);
```

### 复位方式（调试 / 人工确认后再启用）

```
把 _account_eq_stats.liquidationTriggered 置 false
```

**绝对禁止自动复位**：即使平仓后 totalEq 回升（涨了），也不得自动重新开仓，必须显式人工确认后复位。

---

## 4. `_executeLiquidation()` 实现要点

```
TradeEngine._executeLiquidation(stats)
  ├─ 1. 对所有挂单走 /api/v5/trade/cancel-all（按 instId 批量撤单）
  │      → 防止挂单继续成交干扰平仓
  ├─ 2. 遍历 Strategies / processors 中所有 Slice：
  │      对每个 GridTradingSlice / MarketMakerSlice：
  │        ├─ 获取当前持仓方向+数量
  │        ├─ 发反向市价单平多/平空（用市价保证成交）
  │        └─ 把 Slice 状态置为 "liquidated" → 内部状态机禁止再开仓
  ├─ 3. 记录审计日志：清仓原因、触发时 maxEq、confirmedEq、drawdownPct
  └─ 4. 通过 monitorServer 推送到前端：liquidation event（用于告警横幅）
```

- **清仓是一次性动作**：即使下一个 30s 继续跌，有 `liquidationTriggered=true` 保护，不会重复触发。
- **市价单**：只成交不计价，保证穿仓边缘时能迅速成交。
- **Slice 独立状态**：即使人工重置了 `liquidationTriggered`，各 Slice 自己的 `liquidated` 状态也能防止误开仓，双重保险。

---

## 5. 绝不允许的反模式

| 编号 | 反模式 | 后果 |
|---|---|---|
| ❌ 1 | **用 raw（getAccountBalance 直接返回的 totalEq）算回撤或极值** | 单次 API 异常返回 `0 / NaN / 超大值`，直接污染 `maxEq`，后续正常值都被算为"回撤" → 回撤率虚高 **误清仓** |
| ❌ 2 | **绕开 `_balance_pending_jump` 直接赋值 `lastConfirmedEq` / `maxEq`** | 跳变防护形同虚设，同上 |
| ❌ 3 | **阈值比较用浮点数 `if (drawdownPct >= 20)`**（非等级判断） | `20%` 在浮点中可能是 `19.999999999999%` → 漏触发，应比较离散化的 `drawdownLevel >= 2` |
| ❌ 4 | **把 `liquidationTriggered` 放内存而非 `_account_eq_stats`（LocalVariable）** | 进程重启后：若回撤仍在 2 级 → 再次触发清仓（残留仓位重复平仓还能接受）；更严重的是**已平完仓又开始新一轮开仓**，这才是必须持久化 flag 的真正原因 |

---

## 6. 多级风控（未来扩展，不实现先占位）

`drawdownLevel` 0 → 1 → 2 对应「正常 → 预警 → 清仓」。将来可以在中间插入子等级（仍然是离散整数，不要写百分比区间 if/else）：

| 目标等级 | 阈值 | 动作 |
|---|---|---|
| 1 | ≥ 10% | 前端高亮（已有 `drawdown-warn` 样式）+ 禁止新建策略 + 降低 `grid_span`（缩小风险敞口） |
| 1.5 | ≥ 15% | 平掉一半仓位（分级减仓），避免等到 20% 时再一次性清仓导致滑点过大 |
| 2 | ≥ 20% | 全清 |

实现时必须在 `_calcDrawdown` 的等级判断处加离散子等级，不得在 `updateBalance` 外面写裸的 `if (pct >= 15 && pct < 20)`，避免口径分散。

---

## 7. 相关代码锚点

| 功能 | 文件 & 位置 |
|---|---|
| 阈值常量 / 入口引用 | [TradeEngine.js](../src/TradeEngine/TradeEngine.js) `_drawdown_*_threshold` |
| confirmed 确认流水线 | [startAccountBalanceUpdate](../src/TradeEngine/TradeEngine.js) — raw/pending_jump/confirmed 分支 |
| 极值更新 | [_updateEqExtremes](../src/TradeEngine/TradeEngine.js) — 只接受 confirmed |
| 回撤计算 | [_calcDrawdown](../src/TradeEngine/TradeEngine.js) — ratio / pct / level 三合一 |
| 推送出口 | [_pushBalance](../src/TradeEngine/TradeEngine.js) — 给前端字段含 drawdown 五项 |
| 前端接收 | [onAccountBalanceUpdate](../public/js/app.js) — 按 drawdownLevel 切换 class 染色 |
| 持久化载体 | `_account_eq_stats` = `LocalVariable('TradeEngine/accountEqStats')` — 落盘 `records/local-variables.json` |
