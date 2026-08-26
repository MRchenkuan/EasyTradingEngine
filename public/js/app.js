let assets = {};
let lastChartData = {};

function renderAssets() {
  const container = document.getElementById('assetsContainer');
  const assetNames = Object.keys(assets);

  if (assetNames.length === 0) {
    container.innerHTML = '<div class="no-data">暂无资产数据</div>';
    return;
  }

  const existingCards = container.querySelectorAll('.asset-card');
  const existingAssets = Array.from(existingCards).map(card => card.dataset.asset);

  const needsFullRebuild =
    existingAssets.length !== assetNames.length ||
    !assetNames.every(name => existingAssets.includes(name));

  if (needsFullRebuild) {
    let html = '';
    assetNames.forEach(assetName => {
      const assetData = assets[assetName];
      html += TradingApp.Assets.renderAssetCard(assetName, assetData);
    });
    container.innerHTML = html;

    assetNames.forEach(assetName => {
      const assetData = assets[assetName];
      if (assetData && assetData.chartData) {
        TradingApp.Charts.renderChart(assetName, assetData.chartData);
        lastChartData[assetName] = TradingApp.Assets.getChartDataHash(assetData.chartData);
      }
    });
  } else {
    assetNames.forEach(assetName => {
      const assetData = assets[assetName];
      TradingApp.Assets.updateAssetCard(assetName, assetData);

      if (assetData && assetData.chartData) {
        const newHash = TradingApp.Assets.getChartDataHash(assetData.chartData);
        if (lastChartData[assetName] !== newHash) {
          TradingApp.Charts.renderChart(assetName, assetData.chartData);
          lastChartData[assetName] = newHash;
        }
      }
    });
  }
}

// indicators 数据更新（轻量：position, gridParams, shouldTrade 等）
function onIndicatorsUpdate(payload) {
  for (const [name, data] of Object.entries(payload)) {
    if (!assets[name]) {
      assets[name] = data;
    } else {
      const { chartData, ...indicators } = data;
      Object.assign(assets[name], indicators);
    }
  }
  renderAssets();
  const n = Object.keys(assets).length;
  const small = document.getElementById('assetCount');
  if (small) small.textContent = n;
  const big = document.getElementById('assetCountBig');
  if (big) big.textContent = n;
}

// chart 数据更新（完整K线数据，低频）
function onChartUpdate(payload) {
  for (const [name, data] of Object.entries(payload)) {
    if (!assets[name]) {
      assets[name] = data;
    } else {
      if (data.chartData) {
        assets[name].chartData = data.chartData;
      }
    }
  }
  renderAssets();
}

// tick 数据更新（最后一根K线，高频）
function onTickUpdate(payload) {
  for (const [name, tick] of Object.entries(payload)) {
    // 更新本地缓存的 chartData 最后一根K线
    if (assets[name] && assets[name].chartData) {
      const chart = assets[name].chartData;
      if (tick.candle && chart.candleData && chart.candleData.length > 0) {
        chart.candleData[chart.candleData.length - 1] = tick.candle;
      }
      if (tick.boll && chart.boll) {
        if (tick.boll.upper != null)
          chart.boll.upper[chart.boll.upper.length - 1] = tick.boll.upper;
        if (tick.boll.middle != null)
          chart.boll.middle[chart.boll.middle.length - 1] = tick.boll.middle;
        if (tick.boll.lower != null)
          chart.boll.lower[chart.boll.lower.length - 1] = tick.boll.lower;
      }
    }
    // 轻量更新图表，不重建
    TradingApp.Charts.updateTick(name, tick);
  }
}

// 账户总权益更新（OKX totalEq，回撤控制口径）
// 呈现：左（数值+高/低）/ 中（区间占位条图：current 在 [minEq,maxEq] 位置）/ 右（回撤%）
/**
 * 把"权益值 v"映射到 [rangeMin, rangeMax] 可视区间的百分比位置
 * 统一用于：填充层、当前 marker、基准 marker、清仓线 marker
 * 约定：range=0 时返回 100（全部贴右端）；结果 clamp 到 [0,100]
 */
function _posPct(v, rangeMin, rangeMax) {
  if (!isFinite(v) || !isFinite(rangeMin) || !isFinite(rangeMax)) return null;
  const range = rangeMax - rangeMin;
  if (range <= 0) return 100;
  let p = ((v - rangeMin) / range) * 100;
  if (p < 0) p = 0;
  if (p > 100) p = 100;
  return p;
}

function _setTextIfChanged(el, next) {
  if (el && el.textContent !== next) el.textContent = next;
}

function onAccountBalanceUpdate(payload) {
  if (!payload) return;
  const el = document.getElementById('totalEquity');
  const val = document.getElementById('totalEquityValue');
  const totalEq = parseFloat(payload.totalEq);
  if (payload.totalEq !== undefined && isFinite(totalEq)) {
    el.style.display = '';
    val.textContent = '$ ' + totalEq.toFixed(2);
  }

  // ===== 极值 =====
  const maxEq = payload.maxEq != null ? parseFloat(payload.maxEq) : NaN;
  const minEq = payload.minEq != null ? parseFloat(payload.minEq) : NaN;
  const liqEq = payload.liquidationEq != null ? parseFloat(payload.liquidationEq) : NaN;
  // 条图轴边界（后端已经取 min(minEq, liqEq) 并加了 3% buffer）
  const rMin = payload.rangeMin != null ? parseFloat(payload.rangeMin) : NaN;
  const rMax = payload.rangeMax != null ? parseFloat(payload.rangeMax) : NaN;

  // 上方刻度标签：谷/峰（峰恒在 100% 右端，谷按刻度定位到 minEq 位置）
  const hLabel = document.getElementById('eqHLabel');
  const lLabel = document.getElementById('eqLLabel');
  const hlRow = hLabel && hLabel.parentElement;
  const minEl = document.getElementById('eqMarkerMin'); // 谷值刻度线

  // 轴用后端 rangeMin/rangeMax（保证清仓线/谷值永远落在可视区内）
  const haveRange = isFinite(rMin) && isFinite(rMax);

  if (lLabel) {
    if (isFinite(minEq)) {
      lLabel.textContent = '$ ' + minEq.toFixed(0);
      lLabel.style.display = '';
      if (haveRange) {
        const pct = _posPct(minEq, rMin, rMax);
        if (pct != null) lLabel.style.left = pct + '%';
      }
    } else {
      lLabel.style.display = 'none';
    }
  }
  // 谷值刻度线
  if (minEl && haveRange && isFinite(minEq)) {
    const pct = _posPct(minEq, rMin, rMax);
    if (pct != null) minEl.style.left = pct + '%';
    minEl.style.display = '';
  } else if (minEl) {
    minEl.style.display = 'none';
  }
  if (hLabel) {
    if (isFinite(maxEq)) {
      hLabel.textContent = '$ ' + maxEq.toFixed(0);
      hLabel.style.display = '';
    } else {
      hLabel.style.display = 'none';
    }
  }
  if (hlRow) {
    hlRow.style.display =
      (hLabel && hLabel.style.display !== 'none') || (lLabel && lLabel.style.display !== 'none')
        ? ''
        : 'none';
  }

  // ===== 区间条图：填充层 + 当前标记 =====
  const fillEl = document.getElementById('eqRangeFill');
  const curEl = document.getElementById('eqRangeMarker'); // 当前值白圆点
  const liqEl = document.getElementById('eqMarkerLiq'); // 清仓线刻度线
  const liqLabel = document.getElementById('eqLiqLabel');
  const subLegend = document.getElementById('eqSublegend');

  // 填充 + 当前标记
  if (fillEl && curEl && haveRange && isFinite(totalEq)) {
    const pct = _posPct(totalEq, rMin, rMax);
    if (pct != null) {
      fillEl.style.width = pct + '%';
      curEl.style.left = pct + '%';
    }
  }

  // 清仓线刻度线 + 标签（按刻度定位到 liqEq 位置）
  let hasLiq = false;
  if (liqEl && haveRange && isFinite(liqEq)) {
    const pct = _posPct(liqEq, rMin, rMax);
    if (pct != null) {
      liqEl.style.left = pct + '%';
      if (liqLabel) liqLabel.style.left = pct + '%';
    }
    liqEl.style.display = '';
    _setTextIfChanged(liqLabel, '清仓线 $ ' + liqEq.toFixed(0));
    if (liqLabel) liqLabel.style.display = '';
    hasLiq = true;
  } else {
    if (liqEl) liqEl.style.display = 'none';
    if (liqLabel) liqLabel.style.display = 'none';
  }

  // sublegend 整行：无清仓线标签时隐藏避免占行
  if (subLegend) {
    subLegend.style.display = hasLiq ? '' : 'none';
  }

  // ===== 回撤率 =====
  const ddEl = document.getElementById('drawdownPctValue');
  if (ddEl && payload.drawdownPct != null) {
    const pct = parseFloat(payload.drawdownPct);
    ddEl.textContent = (isFinite(pct) ? pct : 0).toFixed(2) + '%';
    const level = payload.drawdownLevel || 0;
    ddEl.classList.remove('drawdown-normal', 'drawdown-warn', 'drawdown-danger');
    if (level >= 2) ddEl.classList.add('drawdown-danger');
    else if (level === 1) ddEl.classList.add('drawdown-warn');
    else ddEl.classList.add('drawdown-normal');
  }

  // ===== 实际账户杠杆 =====
  const levEl = document.getElementById('leverValue');
  if (levEl && payload.lever != null) {
    const v = parseFloat(payload.lever);
    levEl.textContent = (isFinite(v) ? v : 0).toFixed(2) + 'x';
    const level = payload.leverLevel || 0;
    levEl.classList.remove('lever-normal', 'lever-warn', 'lever-danger');
    if (level >= 2) levEl.classList.add('lever-danger');
    else if (level === 1) levEl.classList.add('lever-warn');
    else levEl.classList.add('lever-normal');
  }

  // ===== 总头寸规模（Σ|持仓名义 USD|） =====
  const notEl = document.getElementById('notionalValue');
  if (notEl && payload.leverNotional != null) {
    const n = parseFloat(payload.leverNotional);
    notEl.textContent = isFinite(n) ? _formatNotional(n) : '$ 0';
  }
}

// 把 USD 名义值压成紧凑形式：<1K 用原值，<1M 用 K，≥1M 用 M
function _formatNotional(v) {
  if (v < 1000) return '$ ' + v.toFixed(2);
  if (v < 1000000) return '$ ' + (v / 1000).toFixed(2) + 'K';
  return '$ ' + (v / 1000000).toFixed(2) + 'M';
}

// 禁止移动端页面级缩放，避免干扰图表双指缩放
document.addEventListener('gesturestart', e => e.preventDefault());
document.addEventListener('gesturechange', e => e.preventDefault());
document.addEventListener('gestureend', e => e.preventDefault());
document.addEventListener(
  'touchmove',
  e => {
    if (e.touches.length > 1) e.preventDefault();
  },
  { passive: false }
);

TradingApp.Time.startTimeUpdater();
TradingApp.WebSocket.connect(
  onIndicatorsUpdate,
  onChartUpdate,
  onTickUpdate,
  TradingApp.Logs.addLog,
  onAccountBalanceUpdate
);
