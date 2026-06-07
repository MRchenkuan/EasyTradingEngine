window.TradingApp = window.TradingApp || {};
window.TradingApp.Assets = {
  getChartDataHash: function (chartData) {
    if (!chartData || !chartData.candleData) return '';
    const lastCandles = chartData.candleData.slice(-5);
    return lastCandles.map(c => c.ts).join(',');
  },

  renderAssetCard: function (assetName, assetData) {
    if (!assetData) {
      return `<div class="asset-card" data-asset="${assetName}"><div class="asset-title">${assetName}</div><div class="no-data">暂无数据</div></div>`;
    }

    const indicators = assetData.indicators || assetData;
    let html = `
      <div class="asset-card" data-asset="${assetName}">
        <div class="asset-title">${assetName}</div>
        <div class="metrics-grid">
    `;

    const metrics = this.buildMetrics(indicators);

    metrics.forEach(metric => {
      const spanClass = metric.span === 2 ? 'metric-item span-2' : 'metric-item';
      html += `
        <div class="${spanClass}">
          <span class="metric-label">${metric.label}</span>
          <span class="metric-value">${metric.value}</span>
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
        label: '💰价格',
        value: indicators.price !== undefined ? parseFloat(indicators.price.toFixed(3)) : '-',
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
        label: '📈ATR(6/22/120)',
        value: `${atr6}/${atr22}/${atr120}`,
        span: 2,
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
