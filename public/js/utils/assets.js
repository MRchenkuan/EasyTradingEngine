window.TradingApp = window.TradingApp || {};
window.TradingApp.Assets = {
  // 格式化价距格数：█=1格，░=小数，最多显示10格
  _formatGridCount: function (count) {
    if (count === 0) return '0';
    const abs = Math.abs(count);
    const sign = count < 0 ? '-' : '';
    const maxDisplay = 10;
    const full = Math.min(Math.floor(abs), maxDisplay);
    const hasDecimal = abs - Math.floor(abs) > 0 && full < maxDisplay;
    const overflow = Math.floor(abs) > maxDisplay ? `+${Math.floor(abs) - maxDisplay}` : '';
    return `${sign}${'█'.repeat(full)}${hasDecimal ? '░' : ''}${overflow} ${count}`;
  },

  // 格式化价差格数：█=1格，░=小数，最多显示10格
  _formatPriceSpan: function (span) {
    const abs = Math.abs(span);
    const full = Math.floor(abs);
    const hasDecimal = abs - full > 0;
    const maxDisplay = 10;
    const displayFull = Math.min(full, maxDisplay);
    const overflow = full > maxDisplay ? '+' : '';
    return `${'█'.repeat(displayFull)}${hasDecimal && displayFull < maxDisplay ? '░' : ''}${overflow} ${span.toFixed(2)}`;
  },

  getChartDataHash: function (chartData) {
    if (!chartData || !chartData.candleData) return '';
    const lastCandles = chartData.candleData.slice(-5);
    return lastCandles.map(c => c.ts).join(',');
  },

  _buildTradeConditionTooltip: function (frq_rest) {
    if (!frq_rest) return '';

    const renderRow = (label, value) => {
      if (value === undefined) return '';
      const pass = value;
      const statusClass = pass ? 'tooltip-value pass' : 'tooltip-value fail';
      const statusText = pass ? '✓' : '✗';
      return `<div class="tooltip-row"><span class="tooltip-label">${label}</span><span class="${statusClass}">${statusText}</span></div>`;
    };

    let html = '<div class="trade-forbid-tooltip">';
    html += '<div class="tooltip-title">交易条件</div>';

    // 第一层：通用放行条件（OR 逻辑）
    const anyBypass =
      frq_rest.passNotSerialTrade ||
      frq_rest.passOverThrottleResetTime ||
      frq_rest.passOverThrottleDistance;
    html += '<div class="tooltip-section">';
    html += `<div class="tooltip-section-title">放行条件 <span class="tooltip-hint">${anyBypass ? '(已满足)' : '(任一满足即放行)'}</span></div>`;
    html += renderRow('非连续交易', frq_rest.passNotSerialTrade);
    html += renderRow('超重置时间', frq_rest.passOverThrottleResetTime);
    html += renderRow('超节流距离', frq_rest.passOverThrottleDistance);
    html += '</div>';

    // 第二层：节流条件（仅当通用条件全不满足时才展示）
    if (!anyBypass) {
      html += '<div class="tooltip-divider"></div>';

      if (frq_rest.passOpenLowRiskSpan !== undefined) {
        html += '<div class="tooltip-section">';
        html +=
          '<div class="tooltip-section-title">开仓节流 <span class="tooltip-hint">(按风险等级递进)</span></div>';
        html += renderRow('紧急风险 · 距离≥2倍', frq_rest.passOpenEmergencySpan);
        html += renderRow('高风险 · 距离≥1.5倍', frq_rest.passOpenHighRiskSpan);
        html += renderRow('低风险 · 距离≥1.25倍', frq_rest.passOpenLowRiskSpan);
        html += '</div>';
      }

      if (frq_rest.passCloseLowRiskSpan !== undefined) {
        html += '<div class="tooltip-section">';
        html +=
          '<div class="tooltip-section-title">平仓节流 <span class="tooltip-hint">(紧急避险优先)</span></div>';
        html += renderRow('紧急避险放行', frq_rest.passCloseEmergencyNoThrottle);
        html += renderRow('高风险 · 距离≥1.5倍', frq_rest.passCloseHighRiskSpan);
        html += renderRow('低风险 · 距离≥1.25倍', frq_rest.passCloseLowRiskSpan);
        html += '</div>';
      }
    }

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
      const itemClass = metric.tooltip ? `${spanClass} has-trade-tooltip` : spanClass;
      html += `
        <div class="${itemClass}">
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
          indicators.price_grid_count !== undefined
            ? this._formatGridCount(Math.round(indicators.price_grid_count))
            : '-',
      },
      {
        label: '📊价差格数',
        value:
          indicators.price_span !== undefined ? this._formatPriceSpan(indicators.price_span) : '-',
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
        className:
          indicators.stopLossLevel !== undefined
            ? `metric-stop-loss metric-stop-loss-${indicators.stopLossLevel.toLowerCase()}`
            : 'metric-stop-loss',
      },
      {
        label: '🔔交易状态',
        value:
          indicators.shouldTrade !== undefined ? (indicators.shouldTrade ? '允许' : '禁止') : '-',
        className:
          indicators.shouldTrade !== undefined
            ? indicators.shouldTrade
              ? 'metric-trade-allow'
              : 'metric-trade-forbid'
            : '',
        tooltip: indicators.frq_rest ? this._buildTradeConditionTooltip(indicators.frq_rest) : null,
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
      // 当前 = (current/initial)*100%，最大100%
      const finalPercent = final >= initial ? 100 : (final / initial) * 100;
      const currentPercent = Math.min((current / initial) * 100, 100);

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
        if (metric) {
          if (valueEl.textContent !== metric.value) {
            valueEl.textContent = metric.value;
          }
          // 更新className
          valueEl.className = metric.className
            ? `metric-value ${metric.className}`
            : 'metric-value';
          // 更新tooltip
          const oldTooltip = item.querySelector('.trade-forbid-tooltip');
          if (oldTooltip) oldTooltip.remove();
          if (metric.tooltip) {
            item.classList.add('has-trade-tooltip');
            valueEl.insertAdjacentHTML('afterend', metric.tooltip);
          } else {
            item.classList.remove('has-trade-tooltip');
          }
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
      // 当前 = (current/initial)*100%，最大100%
      const finalPercent = final >= initial ? 100 : (final / initial) * 100;
      const currentPercent = Math.min((current / initial) * 100, 100);

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
