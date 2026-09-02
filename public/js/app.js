let assets = {};
let lastChartData = {};

/* ===== 迷你权益走势图：状态 ===== */
let equityHistory = []; // 每日快照缓存：[{ date, equity, ts }, ...] 按 ts 升序
let miniEqChart = null; // Chart.js 实例
let miniGran = 'day'; // 当前粒度
let miniToggleBound = false;

/**
 * 按时间窗口过滤小时级权益历史（粒度恒为小时，不聚合）。
 * @param {Array} history [{ ts: number, equity: number }, ...] 按 ts 升序
 * @param {'day'|'week'|'month'|'year'|'all'} gran 时间窗口
 * @returns {Array.<{label:string, equity:number, ts:number}>}
 */
function _filterHistoryByWindow(history, gran) {
  if (!history || history.length === 0) return [];
  const sorted = history.slice().sort((a, b) => a.ts - b.ts);
  let cutoff = 0;
  const HOUR = 3600000;
  const DAY = 24 * HOUR;
  switch (gran) {
    case 'day':
      cutoff = Date.now() - DAY;
      break;
    case 'week':
      cutoff = Date.now() - 7 * DAY;
      break;
    case 'month':
      cutoff = Date.now() - 30 * DAY;
      break;
    case 'year':
      cutoff = Date.now() - 365 * DAY;
      break;
    case 'all':
    default:
      return sorted.map(h => _formatPoint(h));
  }
  return sorted.filter(h => h.ts >= cutoff).map(_formatPoint);
}

/** 把原始小时历史条目转为 Chart.js 可用点（label 按粒度智能格式化） */
function _formatPoint(h) {
  const d = new Date(h.ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hr = String(d.getHours()).padStart(2, '0');
  // 今日 → 只显示 HH:mm；今年 → MM/DD HH:mm；跨年 → YYYY/MM/DD
  let label;
  if (sameDay) {
    label = `${hr}:00`;
  } else if (d.getFullYear() === now.getFullYear()) {
    label = `${m}/${day} ${hr}:00`;
  } else {
    label = `${d.getFullYear()}/${m}/${day}`;
  }
  return { label, equity: h.equity, ts: h.ts };
}

/** 销毁并重建迷你 Chart.js 线图 */
function _renderMiniEqChart(gran) {
  const canvas = document.getElementById('equityMiniCanvas');
  if (!canvas || !window.Chart) return;
  const aggregated = _filterHistoryByWindow(equityHistory, gran);
  const container = document.getElementById('miniEqChart');
  if (!container) return;

  // 历史点 < 2 不画图
  if (aggregated.length < 2) {
    container.style.display = 'none';
    if (miniEqChart) {
      miniEqChart.destroy();
      miniEqChart = null;
    }
    return;
  }
  container.style.display = '';

  const labels = aggregated.map(p => p.label);
  const values = aggregated.map(p => p.equity);
  const first = values[0];
  const last = values[values.length - 1];
  const color = last >= first ? '#ec7063' : '#52be80'; // 红涨绿跌（OKX 风格）

  // 渐变 fill
  const ctx = canvas.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 0, 56);
  grad.addColorStop(0, color + '44'); // alpha ~0.27
  grad.addColorStop(1, color + '04'); // 近乎透明

  if (miniEqChart) {
    miniEqChart.destroy();
    miniEqChart = null;
  }
  miniEqChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          data: values,
          borderColor: color,
          backgroundColor: grad,
          borderWidth: 1.2,
          pointRadius: 0,
          pointHoverRadius: 4,
          pointHoverBackgroundColor: color,
          pointHoverBorderColor: '#fff',
          pointHoverBorderWidth: 1,
          tension: 0.25,
          fill: true,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: 'rgba(20, 28, 40, 0.92)',
          titleColor: '#c9d1d9',
          bodyColor: '#fff',
          borderColor: 'rgba(255,255,255,0.12)',
          borderWidth: 1,
          padding: 6,
          titleFont: { size: 10, weight: '500' },
          bodyFont: { size: 11, weight: '600' },
          displayColors: false,
          callbacks: {
            title: items => {
              // 用原始 ts 构建完整日期时间，而不是简化后的 label
              const idx = items[0]?.dataIndex ?? 0;
              const ts = aggregated[idx]?.ts;
              if (!ts) return items[0]?.label || '';
              const d = new Date(ts);
              const mm = String(d.getMonth() + 1).padStart(2, '0');
              const dd = String(d.getDate()).padStart(2, '0');
              const hh = String(d.getHours()).padStart(2, '0');
              return `${mm}/${dd} ${hh}:00`;
            },
            label: ctx => '$ ' + (+ctx.parsed.y).toFixed(2),
          },
        },
      },
      scales: {
        x: {
          display: false,
        },
        y: {
          display: false,
          min: Math.min(...values) * 0.995,
          max: Math.max(...values) * 1.005,
        },
      },
      elements: { line: { borderJoinStyle: 'round' } },
    },
  });
}

/** 绑定一次 toggle button click handler */
function _bindMiniEqToggles() {
  if (miniToggleBound) return;
  miniToggleBound = true;
  document.querySelectorAll('.mini-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const gran = btn.dataset.gran;
      if (!gran || gran === miniGran) return;
      miniGran = gran;
      document.querySelectorAll('.mini-toggle').forEach(b => {
        b.classList.toggle('active', b === btn);
      });
      _renderMiniEqChart(miniGran);
    });
  });
}

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
    // 先销毁所有 Chart 实例，避免 innerHTML 替换 canvas 后 Chart.js 注册表残留
    TradingApp.Charts.destroyAllCharts();
    lastChartData = {};

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
        const lastCandle = chart.candleData[chart.candleData.length - 1];
        if (tick.candle.ts > lastCandle.ts) {
          // 新 K 线周期开始，追加
          chart.candleData.push(tick.candle);
          // BOLL 也需追加，保持长度一致
          if (tick.boll && chart.boll) {
            for (const key of ['upper', 'middle', 'lower']) {
              if (chart.boll[key]) chart.boll[key].push(tick.boll[key] ?? null);
            }
          }
        } else {
          // 同周期，更新最后一根
          chart.candleData[chart.candleData.length - 1] = tick.candle;
          // BOLL 同周期覆盖
          if (tick.boll && chart.boll) {
            for (const key of ['upper', 'middle', 'lower']) {
              if (tick.boll[key] != null && chart.boll[key]) {
                chart.boll[key][chart.boll[key].length - 1] = tick.boll[key];
              }
            }
          }
        }
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

// 设置标签位置（translateX 自适应边缘，防止移动端溢出）
function _setLabelPos(el, pct) {
  if (!el || pct == null) return;
  el.style.left = pct + '%';
  if (pct < 8) el.style.transform = 'translateX(0)';
  else if (pct > 92) el.style.transform = 'translateX(-100%)';
  else el.style.transform = 'translateX(-50%)';
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

  // ===== 收益率（盈亏/本金，本金 = 总权益 - 已实现 - 未实现） =====
  const yEl = document.getElementById('totalEquityYield');
  if (yEl) {
    const yr = parseFloat(payload.yieldRate);
    if (payload.yieldRate != null && isFinite(yr)) {
      yEl.style.display = '';
      yEl.textContent = (yr >= 0 ? '+' : '') + (yr * 100).toFixed(2) + '%';
      yEl.className = 'balance-yield ' + (yr >= 0 ? 'pos' : 'neg');
    } else {
      yEl.style.display = 'none';
    }
  }

  // ===== 迷你每日权益走势图 =====
  // equityHistory: null = 后端无新快照，保留前端缓存；array = 有新快照，更新缓存并重建
  // 无论是否有新 history，只要缓存有数据就尝试渲染（处理首次加载/重启场景）
  let shouldRender = false;
  if (payload.equityHistory != null && Array.isArray(payload.equityHistory)) {
    equityHistory = payload.equityHistory;
    shouldRender = true;
  } else if (equityHistory.length >= 2) {
    // 没新数据但缓存已有 ≥2 条（比如重启后第一次收到 null 前的缓存）→ 确保容器可见
    shouldRender = true;
  }
  if (shouldRender) {
    _bindMiniEqToggles();
    _renderMiniEqChart(miniGran);
  }

  // ===== 头寸方向堆叠条（极简版：只有 track+中线）=====
  const splitBar = document.getElementById('posSplitBar');
  const shortsBox = document.getElementById('posSplitShorts');
  const longsBox = document.getElementById('posSplitLongs');
  if (splitBar && shortsBox && longsBox) {
    const breakdown = Array.isArray(payload.positionBreakdown) ? payload.positionBreakdown : [];
    const totalNotional =
      parseFloat(payload.longNotional || 0) + parseFloat(payload.shortNotional || 0);
    if (breakdown.length > 0 && totalNotional > 0) {
      splitBar.style.display = '';
      const maxHalfPct = 50;
      const shortsTotal = parseFloat(payload.shortNotional || 0);
      const longsTotal = parseFloat(payload.longNotional || 0);

      // track 整体 tooltip（鼠标悬停显示空/多百分比）
      const trackTitle =
        shortsTotal > 0 && longsTotal > 0
          ? `空 ${Math.round((shortsTotal / totalNotional) * 100)}% | 多 ${Math.round((longsTotal / totalNotional) * 100)}%`
          : shortsTotal > 0
            ? `空 ${Math.round((shortsTotal / totalNotional) * 100)}%`
            : `多 ${Math.round((longsTotal / totalNotional) * 100)}%`;
      const trackEl = splitBar.querySelector('.pos-split-track');
      if (trackEl) trackEl.title = trackTitle;

      // 半区宽度
      const shortsHalfPct = Math.min((shortsTotal / totalNotional) * 100, maxHalfPct);
      const longsHalfPct = Math.min((longsTotal / totalNotional) * 100, maxHalfPct);

      // shorts：每个段按空头半区内部比例分配宽度
      // segPctHalf = 段在半区内%；segPctFull = 段在全 track%（用于决定是否显示文字）
      const SHORTS_W = shortsTotal / totalNotional; // 0~0.5
      const LONGS_W = longsTotal / totalNotional;
      const shortsHtml =
        shortsTotal > 0
          ? breakdown
              .filter(p => !p.isLong)
              .map(p => {
                const segPctHalf = (p.notionalUsd / shortsTotal) * 100; // 半区内 %
                const segPctFull = segPctHalf * SHORTS_W; // 全 track 内 %
                const label = p.name.replace('-USDT-SWAP', '').replace('-SWAP', '');
                // 段宽度占全 track ≥ 6% 才显示缩写名
                const showLabel = segPctFull >= 6 ? ' pos-split-label-visible' : '';
                return `<div class="pos-split-seg short${showLabel}" style="width:${segPctHalf}%" title="空 ${label} $${p.notionalUsd.toFixed(2)} (${Math.round((p.notionalUsd / totalNotional) * 100)}%)">${label}</div>`;
              })
              .join('')
          : '';
      // longs：每个段按多头半区内部比例分配宽度
      const longsHtml =
        longsTotal > 0
          ? breakdown
              .filter(p => p.isLong)
              .map(p => {
                const segPctHalf = (p.notionalUsd / longsTotal) * 100;
                const segPctFull = segPctHalf * LONGS_W;
                const label = p.name.replace('-USDT-SWAP', '').replace('-SWAP', '');
                const showLabel = segPctFull >= 6 ? ' pos-split-label-visible' : '';
                return `<div class="pos-split-seg long${showLabel}" style="width:${segPctHalf}%" title="多 ${label} $${p.notionalUsd.toFixed(2)} (${Math.round((p.notionalUsd / totalNotional) * 100)}%)">${label}</div>`;
              })
              .join('')
          : '';

      shortsBox.innerHTML = shortsHtml;
      longsBox.innerHTML = longsHtml;
      shortsBox.style.width = shortsHalfPct + '%';
      longsBox.style.width = longsHalfPct + '%';
    } else {
      splitBar.style.display = 'none';
    }
  }

  // ===== 极值 =====
  const maxEq = payload.maxEq != null ? parseFloat(payload.maxEq) : NaN;
  const minEq = payload.minEq != null ? parseFloat(payload.minEq) : NaN;
  const liqEq = payload.liquidationEq != null ? parseFloat(payload.liquidationEq) : NaN;
  const rebalEq = payload.rebalanceEq != null ? parseFloat(payload.rebalanceEq) : NaN;
  // 条图轴边界（后端已经取 min(minEq, rebalanceEq, liqEq) 并加了 3% buffer）
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
        _setLabelPos(lLabel, pct);
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
  const rebalEl = document.getElementById('eqMarkerRebal'); // 再平衡线刻度线
  const rebalLabel = document.getElementById('eqRebalLabel');
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

  // 再平衡线刻度线 + 标签（按刻度定位到 rebalEq 位置）
  let hasRebal = false;
  if (rebalEl && haveRange && isFinite(rebalEq)) {
    const pct = _posPct(rebalEq, rMin, rMax);
    if (pct != null) {
      rebalEl.style.left = pct + '%';
      _setLabelPos(rebalLabel, pct);
    }
    rebalEl.style.display = '';
    _setTextIfChanged(rebalLabel, '再平衡 $ ' + rebalEq.toFixed(0));
    if (rebalLabel) rebalLabel.style.display = '';
    hasRebal = true;
  } else {
    if (rebalEl) rebalEl.style.display = 'none';
    if (rebalLabel) rebalLabel.style.display = 'none';
  }

  // 清仓线刻度线 + 标签（按刻度定位到 liqEq 位置）
  let hasLiq = false;
  if (liqEl && haveRange && isFinite(liqEq)) {
    const pct = _posPct(liqEq, rMin, rMax);
    if (pct != null) {
      liqEl.style.left = pct + '%';
      _setLabelPos(liqLabel, pct);
    }
    liqEl.style.display = '';
    _setTextIfChanged(liqLabel, '止损线 $ ' + liqEq.toFixed(0));
    if (liqLabel) liqLabel.style.display = '';
    hasLiq = true;
  } else {
    if (liqEl) liqEl.style.display = 'none';
    if (liqLabel) liqLabel.style.display = 'none';
  }

  // sublegend 整行：无任何刻度标签时隐藏避免占行
  if (subLegend) {
    subLegend.style.display = hasRebal || hasLiq ? '' : 'none';
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

  // 方向徽章：净多 / 净空 / 对冲
  const dirBadge = document.getElementById('assetDirBadge');
  if (dirBadge) {
    const totalN = parseFloat(payload.longNotional || 0) + parseFloat(payload.shortNotional || 0);
    const net = parseFloat(payload.netDirectionUsd || 0);
    if (totalN > 0) {
      dirBadge.style.display = '';
      const netPct = Math.abs(net) / totalN; // 0~1
      const dirPct = Math.round(netPct * 100);
      if (net > 0.01) {
        dirBadge.textContent = `多 ${dirPct}%`;
        dirBadge.className = 'metric-dir-badge long';
      } else if (net < -0.01) {
        dirBadge.textContent = `空 ${dirPct}%`;
        dirBadge.className = 'metric-dir-badge short';
      } else {
        dirBadge.textContent = '对冲';
        dirBadge.className = 'metric-dir-badge hedge';
      }
    } else {
      dirBadge.style.display = 'none';
    }
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
