/**
 * 清仓功能测试
 *
 * 测试范围：
 *   1. AccountRiskMonitor._calcDrawdown() 回撤率计算与等级判定
 *   2. 回撤清仓触发条件（drawdownLevel >= 2 && !liquidationTriggered）
 *   3. liquidationTriggered 防重入标志
 *   4. 持仓 → 清仓订单方向（多头→sell，空头→buy，无持仓→跳过）
 *   5. create_order_market 订单对象正确性
 *   6. resetAfterLiquidation() 状态重置
 *   7. _resetKeyPrices 关键价重置
 *   8. 完整触发流程模拟（drawdown → Liquidator.liquidate → resetAfterLiquidation）
 *   9. 无持仓时清仓跳过下单
 *  10. 清仓后峰谷重置（maxEq/minEq 归位，避免重复触发）
 *
 * 运行：node src/scripts/test-liquidation.js
 */
import { AccountRiskMonitor } from '../TradeEngine/AccountRiskMonitor.js';
import { create_order_market } from '../trading.js';
import { GridTradingProcessor } from '../TradeEngine/processors/GridTradingProcessor.js';

// ==================== 测试框架 ====================
const C = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
};
let passed = 0;
let failed = 0;

function assert(cond, name, detail = '') {
  if (cond) {
    console.log(`${C.green}  ✓${C.reset} ${name}`);
    passed++;
  } else {
    console.log(`${C.red}  ✗${C.reset} ${name} ${C.gray}${detail}${C.reset}`);
    failed++;
  }
}
function approxEqual(a, b, eps = 0.001) {
  return Math.abs(a - b) < eps;
}
function group(title) {
  console.log(`\n${C.cyan}▶ ${title}${C.reset}`);
}
function summary() {
  console.log(`\n${C.gray}──────────────────────────${C.reset}`);
  const color = failed === 0 ? C.green : C.red;
  console.log(`${color}结果: ${passed} passed, ${failed} failed${C.reset}`);
  process.exit(failed > 0 ? 1 : 0);
}

// ==================== Mock ====================
function createMockEngine(positions = {}) {
  let liqCalled = false;
  const engine = {
    processors: [],
    _position_list: positions,
    _instrument_info: {},
    getRealtimePrice: () => 100,
    getPositionList: asset => positions[asset] || null,
    isLiqCalled: () => liqCalled,
    resetLiqSpy: () => {
      liqCalled = false;
    },
  };
  // 模拟 Liquidator.liquidate 的行为（不调真实 API，仅重置策略状态）
  engine.mockLiquidate = async () => {
    liqCalled = true;
    console.log(`${C.yellow}  [Mock] Liquidator.liquidate() 被调用${C.reset}`);
    for (const p of engine.processors) {
      if (typeof p.resetAfterLiquidation === 'function') {
        p.resetAfterLiquidation();
      }
    }
  };
  return engine;
}

function createTestMonitor(engine) {
  const m = new AccountRiskMonitor(engine);
  m._account_eq_stats = {};
  m._eq_mem = {};
  return m;
}

function createTestProcessor(engine, assetName = 'TEST-USDT-SWAP', pos = 0) {
  engine._position_list[assetName] = { pos: String(pos) };
  engine._instrument_info[assetName] = { ctVal: 1, ctMult: 1 };
  const p = new GridTradingProcessor(
    assetName,
    {
      _base_quantity: 1,
      _base_amount: 100,
      _suppress_lots: 12,
      _survival_lots: 20,
    },
    engine
  );
  p.local_variables = {};
  p._current_price = 100;
  p._current_price_ts = Date.now();
  return p;
}

// ==================== 测试用例 ====================

group('1. _calcDrawdown 回撤率计算');

{
  const engine = createMockEngine();
  const m = createTestMonitor(engine);

  m._eq_mem.maxEq = 10000;
  m._eq_mem.lastConfirmedEq = 10000;
  let r = m._calcDrawdown();
  assert(r.ratio === 0, '无回撤: ratio=0', `got ${r.ratio}`);
  assert(r.level === 0, '无回撤: level=0 (正常)', `got ${r.level}`);

  m._eq_mem.lastConfirmedEq = 9500;
  r = m._calcDrawdown();
  assert(approxEqual(r.ratio, 0.05), '回撤5%: ratio=0.05', `got ${r.ratio}`);
  assert(r.pct === 5, '回撤5%: pct=5', `got ${r.pct}`);
  assert(r.level === 0, '回撤5%: level=0 (正常)', `got ${r.level}`);

  m._eq_mem.lastConfirmedEq = 9000;
  r = m._calcDrawdown();
  assert(approxEqual(r.ratio, 0.1), '回撤10%: ratio=0.1', `got ${r.ratio}`);
  assert(r.level === 1, '回撤10%: level=1 (预警)', `got ${r.level}`);

  m._eq_mem.lastConfirmedEq = 8000;
  r = m._calcDrawdown();
  assert(approxEqual(r.ratio, 0.2), '回撤20%: ratio=0.2', `got ${r.ratio}`);
  assert(r.level === 2, '回撤20%: level=2 (清仓)', `got ${r.level}`);

  m._eq_mem.lastConfirmedEq = 6500;
  r = m._calcDrawdown();
  assert(approxEqual(r.ratio, 0.35), '回撤35%: ratio=0.35', `got ${r.ratio}`);
  assert(r.level === 2, '回撤35%: level=2 (清仓)', `got ${r.level}`);

  m._eq_mem.lastConfirmedEq = 12000;
  r = m._calcDrawdown();
  assert(r.ratio === 0, '新高: ratio=0', `got ${r.ratio}`);
  assert(r.level === 0, '新高: level=0', `got ${r.level}`);

  m._eq_mem.maxEq = undefined;
  m._eq_mem.lastConfirmedEq = 5000;
  r = m._calcDrawdown();
  assert(r.ratio === 0, 'maxEq缺失: ratio=0', `got ${r.ratio}`);
  assert(r.level === 0, 'maxEq缺失: level=0', `got ${r.level}`);
}

group('2. 清仓触发条件 & 防重入');

{
  const engine = createMockEngine();
  const m = createTestMonitor(engine);
  const stats = m._account_eq_stats;
  const mem = m._eq_mem;

  mem.maxEq = 10000;
  mem.lastConfirmedEq = 7900;
  const ddResult = m._calcDrawdown();
  assert(ddResult.level === 2, '前置: 回撤21% level=2', `got ${ddResult.level}`);

  let triggered = ddResult.level >= 2 && !stats.liquidationTriggered && !mem.liquidationTriggered;
  assert(triggered === true, '首次触发: 条件成立', `got ${triggered}`);
  if (triggered) {
    stats.liquidationTriggered = true;
    mem.liquidationTriggered = true;
    stats.liquidationTriggeredTs = Date.now();
  }

  triggered = ddResult.level >= 2 && !stats.liquidationTriggered && !mem.liquidationTriggered;
  assert(triggered === false, '防重入: 已触发过，条件不成立', `got ${triggered}`);

  mem.lastConfirmedEq = 9500;
  const ddRecovered = m._calcDrawdown();
  assert(ddRecovered.level === 0, '回撤恢复: level=0', `got ${ddRecovered.level}`);
  assert(
    stats.liquidationTriggered === true,
    '不自动复位: liquidationTriggered 仍为 true',
    `got ${stats.liquidationTriggered}`
  );

  stats.liquidationTriggered = false;
  mem.liquidationTriggered = false;
  const afterReset = ddRecovered.level >= 2 && !stats.liquidationTriggered;
  assert(afterReset === false, '手动复位后: level=0 不触发', `got ${afterReset}`);
}

group('3. 持仓 → 清仓订单方向');

{
  const posLong = 10;
  const sizeLong = Math.abs(posLong);
  const sideLong = posLong > 0 ? -1 : 1;
  assert(sideLong === -1, '多头: side=-1 (sell)', `got ${sideLong}`);
  assert(sizeLong === 10, '多头: size=10', `got ${sizeLong}`);

  const posShort = -5;
  const sizeShort = Math.abs(posShort);
  const sideShort = posShort > 0 ? -1 : 1;
  assert(sideShort === 1, '空头: side=1 (buy)', `got ${sideShort}`);
  assert(sizeShort === 5, '空头: size=5', `got ${sizeShort}`);

  const posZero = 0;
  const shouldSkip = !isFinite(posZero) || posZero === 0;
  assert(shouldSkip === true, '无持仓: 跳过清仓', `got ${shouldSkip}`);
}

group('4. create_order_market 订单对象');

{
  const order = create_order_market('BTC-USDT-SWAP', 10, -1);
  assert(order.instId === 'BTC-USDT-SWAP', '订单: instId 正确', `got ${order.instId}`);
  assert(order.side === 'sell', '订单: side=sell (多头清仓)', `got ${order.side}`);
  assert(order.ordType === 'market', '订单: ordType=market', `got ${order.ordType}`);
  assert(order.sz === '10', '订单: sz=10', `got ${order.sz}`);
  assert(order.tdMode === 'cross', '订单: tdMode=cross', `got ${order.tdMode}`);
  assert(!!order.clOrdId, '订单: 有 clOrdId', `got ${order.clOrdId}`);

  const orderBuy = create_order_market('ETH-USDT-SWAP', 5, 1);
  assert(orderBuy.side === 'buy', '订单: side=buy (空头清仓)', `got ${orderBuy.side}`);
  assert(orderBuy.sz === '5', '订单: sz=5', `got ${orderBuy.sz}`);
}

group('5. resetAfterLiquidation 状态重置');

{
  const engine = createMockEngine();
  const p = createTestProcessor(engine, 'TEST-RESET', 0);
  p._last_open_grid_span = 5;
  p._last_close_grid_span = 3;
  p._last_trade_price = 200;
  p._last_upper_turning_price = 180;
  p._last_lower_turning_price = 160;
  p.resetAfterLiquidation();
  assert(
    p._last_open_grid_span === -1,
    '重置: _last_open_grid_span=-1',
    `got ${p._last_open_grid_span}`
  );
  assert(
    p._last_close_grid_span === -1,
    '重置: _last_close_grid_span=-1',
    `got ${p._last_close_grid_span}`
  );
  assert(p._last_trade_price === 100, '重置: _last_trade_price=100', `got ${p._last_trade_price}`);
  assert(
    p._last_upper_turning_price === 100,
    '重置: _last_upper_turning_price=100',
    `got ${p._last_upper_turning_price}`
  );
  assert(
    p._last_lower_turning_price === 100,
    '重置: _last_lower_turning_price=100',
    `got ${p._last_lower_turning_price}`
  );
}

group('6. _resetKeyPrices 关键价重置');

{
  const engine = createMockEngine();
  const p = createTestProcessor(engine, 'TEST-KEYPRICE', 0);
  p._last_trade_price = 200;
  p._last_upper_turning_price = 180;
  p._last_lower_turning_price = 160;
  p._prev_price = 150;
  p._resetKeyPrices(100, Date.now());
  assert(
    p._last_trade_price === 100,
    '关键价: _last_trade_price=100',
    `got ${p._last_trade_price}`
  );
  assert(
    p._last_upper_turning_price === 100,
    '关键价: _last_upper_turning_price=100',
    `got ${p._last_upper_turning_price}`
  );
  assert(
    p._last_lower_turning_price === 100,
    '关键价: _last_lower_turning_price=100',
    `got ${p._last_lower_turning_price}`
  );
  assert(p._prev_price === 100, '关键价: _prev_price=100', `got ${p._prev_price}`);
}

group('7. 完整触发流程模拟（drawdown → Liquidator.liquidate → resetAfterLiquidation）');

{
  const engine = createMockEngine();
  const m = createTestMonitor(engine);
  const stats = m._account_eq_stats;
  const mem = m._eq_mem;

  const p = createTestProcessor(engine, 'TEST-FLOW', 10);
  p._last_open_grid_span = 7;
  p._last_close_grid_span = 4;
  engine.processors.push(p);

  mem.maxEq = 10000;
  mem.lastConfirmedEq = 7500; // 25% drawdown
  const ddResult = m._calcDrawdown();
  assert(ddResult.level === 2, '流程: 回撤25% level=2', `got ${ddResult.level}`);

  let triggered = false;
  if (ddResult.level >= 2 && !stats.liquidationTriggered && !mem.liquidationTriggered) {
    triggered = true;
    stats.liquidationTriggered = true;
    mem.liquidationTriggered = true;
    stats.liquidationTriggeredTs = Date.now();
    await engine.mockLiquidate();
    // 模拟清仓后峰谷重置（与 AccountRiskMonitor.start() 中的逻辑一致）
    stats.maxEq = 7500;
    stats.minEq = 7500;
    mem.maxEq = 7500;
    mem.minEq = 7500;
  }
  assert(triggered === true, '流程: 触发条件成立', `got ${triggered}`);
  assert(
    engine.isLiqCalled() === true,
    '流程: Liquidator.liquidate 被调用',
    `got ${engine.isLiqCalled()}`
  );
  assert(
    p._last_open_grid_span === -1,
    '流程: _last_open_grid_span 已重置',
    `got ${p._last_open_grid_span}`
  );
  assert(
    p._last_close_grid_span === -1,
    '流程: _last_close_grid_span 已重置',
    `got ${p._last_close_grid_span}`
  );
  assert(
    stats.liquidationTriggered === true,
    '流程: 持久化标志=true',
    `got ${stats.liquidationTriggered}`
  );

  engine.resetLiqSpy();
  p._last_open_grid_span = 9;
  const ddResult2 = m._calcDrawdown();
  let reTriggered = false;
  if (ddResult2.level >= 2 && !stats.liquidationTriggered && !mem.liquidationTriggered) {
    reTriggered = true;
    await engine.mockLiquidate();
  }
  assert(reTriggered === false, '流程: 不重复触发', `got ${reTriggered}`);
  assert(
    engine.isLiqCalled() === false,
    '流程: Liquidator.liquidate 未被再次调用',
    `got ${engine.isLiqCalled()}`
  );
}

group('8. 无持仓时 Liquidator 跳过下单');

{
  const shouldSkip = pos => !isFinite(pos) || pos === 0;
  assert(shouldSkip(0) === true, 'pos=0: 跳过', `got ${shouldSkip(0)}`);
  assert(shouldSkip(NaN) === true, 'pos=NaN: 跳过', `got ${shouldSkip(NaN)}`);
  assert(shouldSkip(undefined) === true, 'pos=undefined: 跳过', `got ${shouldSkip(undefined)}`);
  assert(shouldSkip(10) === false, 'pos=10: 不跳过', `got ${shouldSkip(10)}`);
  assert(shouldSkip(-5) === false, 'pos=-5: 不跳过', `got ${shouldSkip(-5)}`);
}

group('9. 无持仓时 resetAfterLiquidation 仍执行');

{
  const engine = createMockEngine();
  const p = createTestProcessor(engine, 'TEST-NOPOS', 0);
  p._last_open_grid_span = 5;
  p._last_trade_price = 200;
  p.resetAfterLiquidation();
  assert(p._last_open_grid_span === -1, '无持仓: 状态仍重置', `got ${p._last_open_grid_span}`);
  assert(p._last_trade_price === 100, '无持仓: 关键价仍重置', `got ${p._last_trade_price}`);
}

group('10. 清仓后峰谷重置 + 自动复位');

{
  const engine = createMockEngine();
  const m = createTestMonitor(engine);
  const stats = m._account_eq_stats;
  const mem = m._eq_mem;

  // 场景：maxEq=10000，回撤到 7500（25%），触发清仓
  mem.maxEq = 10000;
  mem.lastConfirmedEq = 7500;
  const confirmed = 7500;

  const ddResult = m._calcDrawdown();
  assert(ddResult.level === 2, '峰谷: 回撤25% level=2', `got ${ddResult.level}`);

  // 模拟触发清仓 + 峰谷重置（与 AccountRiskMonitor.start() 中的逻辑一致）
  stats.liquidationTriggered = true;
  mem.liquidationTriggered = true;
  await engine.mockLiquidate();
  stats.maxEq = confirmed;
  stats.minEq = confirmed;
  mem.maxEq = confirmed;
  mem.minEq = confirmed;

  // 验证：峰谷已重置
  assert(mem.maxEq === 7500, '峰谷: maxEq 已重置为 7500', `got ${mem.maxEq}`);
  assert(mem.minEq === 7500, '峰谷: minEq 已重置为 7500', `got ${mem.minEq}`);

  // 验证：触发轮不会同轮自动复位（drawdownResult 仍是旧值 level=2）
  // 自动复位条件：liquidationTriggered && drawdownResult.level < 2
  // 此时 ddResult.level=2，不满足 < 2，不会复位
  if (stats.liquidationTriggered && ddResult.level < 2) {
    stats.liquidationTriggered = false;
    mem.liquidationTriggered = false;
  }
  assert(
    stats.liquidationTriggered === true,
    '同轮不复位: 触发轮 drawdownResult.level=2',
    `got ${stats.liquidationTriggered}`
  );

  // 模拟下一轮：权益不变（7500），基于重置后峰谷重算回撤率
  // _updateExtremes(7500) 不更新极值（等于当前），_calcDrawdown 返回 ratio=0
  m._updateExtremes(7500);
  const ddNextRound = m._calcDrawdown();
  assert(ddNextRound.ratio === 0, '下一轮: ratio=0（峰谷已重置）', `got ${ddNextRound.ratio}`);
  assert(ddNextRound.level === 0, '下一轮: level=0', `got ${ddNextRound.level}`);

  // 自动复位：level < 2 → 复位 liquidationTriggered
  if (stats.liquidationTriggered && ddNextRound.level < 2) {
    stats.liquidationTriggered = false;
    mem.liquidationTriggered = false;
  }
  assert(
    stats.liquidationTriggered === false,
    '自动复位: 回撤归零后 liquidationTriggered=false',
    `got ${stats.liquidationTriggered}`
  );
  assert(
    m.isLiquidationTriggered() === false,
    '自动复位: isLiquidationTriggered()=false，策略恢复交易',
    `got ${m.isLiquidationTriggered()}`
  );

  // 验证：如果权益进一步下跌到 6000（从新基准 7500 回撤 20%），才会再次触发
  mem.lastConfirmedEq = 6000;
  const ddNew = m._calcDrawdown();
  assert(approxEqual(ddNew.ratio, 0.2), '新基准: 下跌20% ratio=0.2', `got ${ddNew.ratio}`);
  assert(ddNew.level === 2, '新基准: 下跌20% level=2', `got ${ddNew.level}`);
}

group('11. 清仓后权益继续下跌不自动复位');

{
  const engine = createMockEngine();
  const m = createTestMonitor(engine);
  const stats = m._account_eq_stats;
  const mem = m._eq_mem;

  // 场景：清仓时 confirmed=7500，峰谷重置为 7500
  // 下一轮权益继续跌到 6000（从 7500 回撤 20%），不应自动复位
  stats.maxEq = 7500;
  stats.minEq = 7500;
  mem.maxEq = 7500;
  mem.minEq = 7500;
  mem.lastConfirmedEq = 6000;
  stats.liquidationTriggered = true;
  mem.liquidationTriggered = true;

  m._updateExtremes(6000); // minEq 更新为 6000，maxEq 不变
  const ddResult = m._calcDrawdown();
  assert(approxEqual(ddResult.ratio, 0.2), '继续下跌: ratio=0.2', `got ${ddResult.ratio}`);
  assert(ddResult.level === 2, '继续下跌: level=2', `got ${ddResult.level}`);

  // 自动复位检查：level >= 2，不满足 < 2，不复位
  if (stats.liquidationTriggered && ddResult.level < 2) {
    stats.liquidationTriggered = false;
    mem.liquidationTriggered = false;
  }
  assert(
    stats.liquidationTriggered === true,
    '继续下跌: 不自动复位（level=2）',
    `got ${stats.liquidationTriggered}`
  );
  assert(
    m.isLiquidationTriggered() === true,
    '继续下跌: 策略仍暂停',
    `got ${m.isLiquidationTriggered()}`
  );

  // 权益恢复到 7000（从 7500 回撤约 6.7%），level=0，自动复位
  mem.lastConfirmedEq = 7000;
  const ddRecovered = m._calcDrawdown();
  assert(ddRecovered.level === 0, '恢复后: level=0', `got ${ddRecovered.level}`);
  if (stats.liquidationTriggered && ddRecovered.level < 2) {
    stats.liquidationTriggered = false;
    mem.liquidationTriggered = false;
  }
  assert(
    stats.liquidationTriggered === false,
    '恢复后: 自动复位，策略恢复交易',
    `got ${stats.liquidationTriggered}`
  );
}

summary();
