window.TradingApp = window.TradingApp || {};
window.TradingApp.Assets = {
  getChartDataHash: function (chartData) {
    if (!chartData || !chartData.candleData) return '';
    const lastCandles = chartData.candleData.slice(-5);
    return lastCandles.map(c => c.ts).join(',');
  },

  _buildTradeForbidTooltip: function (frq_rest) {
    if (!frq_rest) return '';

    const items = [];

    // 通用条件
    items.push({ label: '非连续交易', value: !frq_rest.isNotSerialTrade });
    items.push({ label: '超重置时间', value: !frq_rest.isOverThrottleResetTime });
    items.push({ label: '超节流距离', value: !frq_rest.isOverThrottleDistance });

    if (frq_rest.isOpen) {
      // 开仓相关
      items.push({ label: '开仓-紧急风险-高度节流', value: !frq_rest.isOpenEmergencyRiskThrottle });
      items.push({ label: '开仓-高风险-中度节流', value: !frq_rest.isOpenHighRiskWithThrottle });
      items.push({ label: '开仓-低风险-低度节流', value: !frq_rest.isOpenLowRiskWithThrottle });
    }

    if (frq_rest.isClose) {
      // 平仓相关
      items.push({
        label: '平仓避险',
        value: frq_rest.isCloseEmergencyRiskWithoutThrottle,
      });
      items.push({ label: '平仓-高风险-低度节流', value: !frq_rest.isCloseHighRiskWithThrottle });
      items.push({ label: '平仓-低风险-中度节流', value: !frq_rest.isCloseLowRiskWithThrottle });
    }

    let html = '<div class="trade-forbid-tooltip">';
    html += '<div class="tooltip-title">禁止交易原因</div>';

    items.forEach(item => {
      if (item.value !== undefined) {
        const statusClass = item.value ? 'tooltip-value' : 'tooltip-value pass';
        const statusText = item.value ? '❌' : '✓';
        html += `<div class="tooltip-row">`;
        html += `<span class="tooltip-label">${item.label}</span>`;
        html += `<span class="${statusClass}">${statusText}</span>`;
        html += `</div>`;
      }
    });

    html += '</div>';
    return html;
  },

  renderAssetCard: function (assetName, assetData) {
    if (!assetData) {
      return `<div class="asset-card" data-asset="${assetName}"><div class="asset-title"><span class="asset-name">${assetName}</span><span class="asset-price">-</span></div><div class="no-data">暂无数据</div></div>`;
    }

    const indicators = assetData.indicators || assetData;
    const price = indicators.price !== undefined ? parseFloat(indicators.price.toFixed(3)) : '-';

    let html = `
      <div class="asset-card" data-asset="${assetName}">
        <div class="asset-title">
          <span class="asset-name">${assetName}</span>
          <span class="asset-price" data-price="${price}">${price}</span>
        </div>
        <div class="metrics-grid">
    `;

    const metrics = this.buildMetrics(indicators);

    metrics.forEach(metric => {
      const spanClass = metric.span === 2 ? 'metric-item span-2' : 'metric-item';
      const valueClass = metric.className ? `metric-value ${metric.className}` : 'metric-value';
      const tooltipHtml = metric.tooltip || '';
      html += `
        <div class="${spanClass}">
          <span class="metric-label">${metric.label}</span>
          <span class="${valueClass}">${metric.value}</span>${tooltipHtml}
        </div>
      `;
    });

    html += '</div>';

    if (indicators.factors) {
      html += this.renderFactors(indicators.factors);
    }

    html += this.renderSummary(indicators);
    html += `<div class="chart-container"><canvas id="chart-${assetName}" class="chart-canvas"></canvas></div>`;
    html += '</div>';

    return html;
  },

  buildMetrics: function (indicators) {
    // 将三个ATR指标合并到一行显示
    const atr6 = indicators.atr_6 !== undefined ? (indicators.atr_6 * 100).toFixed(2) + '%' : '-';
    const atr22 =
      indicators.atr_22 !== undefined ? (indicators.atr_22 * 100).toFixed(2) + '%' : '-';
    const atr120 =
      indicators.atr_120 !== undefined ? (indicators.atr_120 * 100).toFixed(2) + '%' : '-';

    return [
      {
        label: '📈ATR(6/22/120)',
        value: `${atr6}/${atr22}/${atr120}`,
        span: 2,
      },
      {
        label: '📏价距格数',
        value:
          indicators.price_grid_count !== undefined ? Math.round(indicators.price_grid_count) : '-',
      },
      {
        label: '📊价差格数',
        value: indicators.price_span !== undefined ? indicators.price_span.toFixed(2) : '-',
      },
      {
        label: '⚡瞬时波动',
        value:
          indicators.volatility !== undefined
            ? (indicators.volatility * 100).toFixed(2) + '%'
            : '-',
      },
      {
        label: '🔶布林带宽',
        value:
          indicators.boll_bandwidth !== undefined
            ? (indicators.boll_bandwidth * 100).toFixed(2) + '%'
            : '-',
      },

      {
        label: '🔋量能因子',
        value:
          indicators.vol_power !== undefined ? (indicators.vol_power * 100).toFixed(2) + '%' : '-',
      },
      {
        label: '📊RSI(f/s)',
        value:
          indicators.rsi_fast !== undefined && indicators.rsi_slow !== undefined
            ? `${Math.round(indicators.rsi_fast)}/${Math.round(indicators.rsi_slow)}`
            : '-',
      },
      {
        label: '🛡止损等级',
        value: indicators.stopLossLevel !== undefined ? indicators.stopLossLevel : '-',
        className: 'metric-stop-loss',
      },
      {
        label: '🔔交易状态',
        value:
          indicators.shouldTrade !== undefined ? (indicators.shouldTrade ? '允许' : '禁止') : '-',
        className: indicators.shouldTrade ? 'metric-trade-allow' : 'metric-trade-forbid',
        tooltip: indicators.shouldTrade ? null : this._buildTradeForbidTooltip(indicators.frq_rest),
      },
    ];
  },

  renderFactors: function (factors) {
    let html = '<div class="signal-section">';

    if (factors.boll_factor !== undefined) {
      html += `<div class="signal-item"><strong>布林:</strong> ${factors.boll_factor.toFixed(2)} ${factors.boll_msg || ''}</div>`;
    } else if (factors.boll_msg) {
      html += `<div class="signal-item"><strong>boll:</strong> ${factors.boll_msg}</div>`;
    }
    if (factors.grid_factor !== undefined) {
      html += `<div class="signal-item"><strong>网格:</strong> ${factors.grid_factor.toFixed(2)} ${factors.grid_msg || ''}</div>`;
    } else if (factors.grid_msg) {
      html += `<div class="signal-item"><strong>grid:</strong> ${factors.grid_msg}</div>`;
    }
    if (factors.rsi_factor !== undefined) {
      html += `<div class="signal-item"><strong>RSI:</strong> ${factors.rsi_factor.toFixed(2)} ${factors.rsi_msg || ''}</div>`;
    } else if (factors.rsi_msg) {
      html += `<div class="signal-item"><strong>rsi:</strong> ${factors.rsi_msg}</div>`;
    }
    if (factors.time_factor !== undefined) {
      html += `<div class="signal-item"><strong>时间:</strong> ${factors.time_factor.toFixed(2)}</div>`;
    }

    html += '</div>';
    return html;
  },

  renderSummary: function (indicators) {
    let html = '<div class="summary-section">';

    // 使用进度条展示阈值
    if (indicators.initial_threshold !== undefined) {
      const initial = indicators.initial_threshold * 100;
      const final =
        indicators.final_threshold !== undefined ? indicators.final_threshold * 100 : initial;
      const current = indicators.diff_rate !== undefined ? Math.abs(indicators.diff_rate * 100) : 0;

      // 计算百分比
      // 初始 = 100%（固定）
      // 最终 = 如果 final >= initial 则100%，否则 (final/initial)*100%
      // 当前 = (current/final)*100%，最大100%
      const finalPercent = final >= initial ? 100 : (final / initial) * 100;
      const currentPercent = Math.min((current / final) * 100, 100);

      html += '<div class="threshold-bar">';
      html += '<div class="threshold-bar-track">';
      html += `<div class="threshold-bar-fill threshold-bar-final" style="width: ${finalPercent}%;" data-key="final-fill"></div>`;
      html += `<div class="threshold-bar-fill threshold-bar-current" style="width: ${currentPercent}%;" data-key="current-fill"></div>`;
      html += '</div>';
      html += '<div class="threshold-bar-labels">';
      html += `<span>初始阈值 ${initial.toFixed(2)}%</span>`;
      html += `<span>最终阈值 ${final.toFixed(2)}%</span>`;
      html += `<span>当前回撤 ${current.toFixed(2)}%</span>`;
      html += '</div>';
      html += '</div>';
    }

    html += '</div>';
    return html;
  },

  updateAssetCard: function (assetName, assetData) {
    const card = document.querySelector(`.asset-card[data-asset="${assetName}"]`);
    if (!card || !assetData) return;

    const indicators = assetData.indicators || assetData;
    const metrics = this.buildMetrics(indicators);

    // 更新标题中的价格
    if (indicators.price !== undefined) {
      const priceEl = card.querySelector('.asset-price');
      if (priceEl) {
        const price = parseFloat(indicators.price.toFixed(3));
        priceEl.textContent = price;
        priceEl.dataset.price = price;
      }
    }

    const metricItems = card.querySelectorAll('.metric-item');
    metricItems.forEach(item => {
      const labelEl = item.querySelector('.metric-label');
      const valueEl = item.querySelector('.metric-value');
      if (labelEl && valueEl) {
        const label = labelEl.textContent;
        const metric = metrics.find(m => m.label === label);
        if (metric && valueEl.textContent !== metric.value) {
          valueEl.textContent = metric.value;
        }
      }
    });

    // 实时更新最后一根K线的收盘价
    if (indicators.price !== undefined) {
      TradingApp.Charts.updateLastCandleClose(assetName, indicators.price);
    }

    // 更新进度条
    if (indicators.initial_threshold !== undefined) {
      const initial = indicators.initial_threshold * 100;
      const final =
        indicators.final_threshold !== undefined ? indicators.final_threshold * 100 : initial;
      const current = indicators.diff_rate !== undefined ? Math.abs(indicators.diff_rate * 100) : 0;

      // 计算百分比
      // 初始 = 100%（固定）
      // 最终 = 如果 final >= initial 则100%，否则 (final/initial)*100%
      // 当前 = (current/final)*100%，最大100%
      const finalPercent = final >= initial ? 100 : (final / initial) * 100;
      const currentPercent = Math.min((current / final) * 100, 100);

      // 更新进度条宽度
      const finalFill = card.querySelector('[data-key="final-fill"]');
      const currentFill = card.querySelector('[data-key="current-fill"]');

      if (finalFill) finalFill.style.width = finalPercent + '%';
      if (currentFill) currentFill.style.width = currentPercent + '%';

      // 更新标签值
      const labels = card.querySelector('.threshold-bar-labels');
      if (labels) {
        const spans = labels.querySelectorAll('span');
        if (spans[0]) spans[0].textContent = `初始阈值 ${initial.toFixed(2)}%`;
        if (spans[1]) spans[1].textContent = `最终阈值 ${final.toFixed(2)}%`;
        if (spans[2]) spans[2].textContent = `当前回撤 ${current.toFixed(2)}%`;
      }
    }
  },
};
