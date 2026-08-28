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
    return `${sign}${'█'.repeat(full)}${hasDecimal ? '░' : ''} ${count}`;
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
        html += renderRow('紧急风险 · 距离≥1+2倍', frq_rest.passOpenEmergencySpan);
        html += renderRow('高风险 · 距离≥1+1.5倍', frq_rest.passOpenHighRiskSpan);
        html += renderRow('低风险 · 距离≥1+1.25倍', frq_rest.passOpenLowRiskSpan);
        html += '</div>';
      }

      if (frq_rest.passCloseLowRiskSpan !== undefined) {
        html += '<div class="tooltip-section">';
        html +=
          '<div class="tooltip-section-title">平仓节流 <span class="tooltip-hint">(紧急避险优先)</span></div>';
        html += renderRow('紧急避险放行', frq_rest.passCloseEmergencyNoThrottle);
        html += renderRow('高风险 · 距离≥1+1倍', frq_rest.passCloseHighRiskSpan);
        html += renderRow('低风险 · 距离≥1+1.25倍', frq_rest.passCloseLowRiskSpan);
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
      const vizHtml = metric.viz
        ? `<span class="metric-viz">${this.renderViz(metric.viz)}</span>`
        : '';
      const valueHtml =
        metric.value !== null && metric.value !== undefined
          ? `<span class="${valueClass}">${metric.value}</span>`
          : '';
      html += `
        <div class="${itemClass}"${metric.title ? ` title="${metric.title}"` : ''}>
          <span class="metric-label">${metric.label}</span>${vizHtml}${valueHtml}${tooltipHtml}
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

  // ---------- 迷你可视化 helpers ----------
  // 通用条形：value/cap 映射为 0-100% 宽度
  _bar: function (value, cap, color) {
    const pct = cap > 0 ? (value / cap) * 100 : 0;
    return { type: 'bar', pct: Math.max(0, Math.min(100, pct)), color: color || '' };
  },

  // 止损等级 → 严重度（1-4 点）+ 颜色
  _stopLossSeverity: function (level) {
    const l = String(level || '').toLowerCase();
    if (l.includes('emergency') || l.includes('dual_high')) return { level: 4, color: 'c-red' };
    if (l.includes('high') || l.includes('hight')) return { level: 3, color: 'c-orange' };
    if (l.includes('notice')) return { level: 2, color: 'c-yellow' };
    return { level: 1, color: 'c-green' };
  },

  // 止损等级 → 汉字短标签（避免英文长等级溢出）
  _stopLossLabel: function (level) {
    const map = {
      NORMAL: '正常',
      NOTICE: '关注',
      HIGHT: '高风险',
      HIGH: '高风险',
      EMERGENCY: '紧急',
      CROSS_HIGH: '全仓高',
      CROSS_HIGHT: '全仓高',
      CROSS_EMERGENCY: '全仓急',
      ISOLATE_HIGH: '逐仓高',
      ISOLATE_HIGHT: '逐仓高',
      ISOLATE_EMERGENCY: '逐仓急',
      DUAL_HIGH: '双高',
      DUAL_EMERGENCY: '双急',
    };
    const key = String(level || '').toUpperCase();
    return map[key] || level;
  },

  // 渲染迷你可视化元素
  renderViz: function (viz) {
    if (!viz) return '';
    switch (viz.type) {
      case 'bar':
        return `<span class="m-bar"><span class="m-fill ${viz.color}" style="width:${viz.pct}%"></span>${viz.marker != null ? `<span class="m-marker" style="left:${viz.marker}%"></span>` : ''}</span>`;
      case 'atr':
        return viz.items
          .map(
            it =>
              `<span class="atr-group"><span class="m-bar"><span class="m-fill" style="width:${it.pct}%"></span></span><span class="atr-num">${it.text}</span></span>`
          )
          .join('');
      case 'rsi':
        return `<span class="m-bar rsi-bar"><span class="rsi-zone z-low"></span><span class="rsi-zone z-high"></span><span class="m-fill" style="width:${viz.fast}%"></span><span class="rsi-marker" style="left:${viz.slow}%"></span></span>`;
      case 'dots': {
        let dots = '';
        for (let i = 0; i < 4; i++) {
          dots += `<i class="${i < viz.level ? 'on ' + viz.color : ''}"></i>`;
        }
        return `<span class="level-dots">${dots}</span>`;
      }
      case 'dot':
        return `<span class="status-dot ${viz.color}"></span>`;
      default:
        return '';
    }
  },

  buildMetrics: function (indicators) {
    const has = v => v !== undefined && v !== null && isFinite(parseFloat(v));
    const pos = indicators.position || {};
    const posNum = parseFloat(pos.pos);

    // ATR 三联条（各自量程：6→1.5% / 22→3% / 120→6%）
    const atrItems = [
      ['atr_6', 1.5],
      ['atr_22', 3],
      ['atr_120', 6],
    ].map(([key, cap]) => {
      const v = indicators[key];
      return {
        pct: has(v) ? Math.min((v * 100) / cap, 1) * 100 : 0,
        text: has(v) ? (v * 100).toFixed(2) : '-',
      };
    });

    return [
      {
        label: '📈ATR(6/22/120)',
        value: null,
        viz: { type: 'atr', items: atrItems },
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
        viz: has(indicators.volatility) ? this._bar(indicators.volatility * 100, 1) : null, // 量程 1%
      },
      {
        label: '🔶布林带宽',
        value:
          indicators.boll_bandwidth !== undefined
            ? (indicators.boll_bandwidth * 100).toFixed(2) + '%'
            : '-',
        viz: has(indicators.boll_bandwidth) ? this._bar(indicators.boll_bandwidth * 100, 5) : null, // 量程 5%
      },
      {
        label: '🔋量能因子',
        value:
          indicators.vol_power !== undefined ? (indicators.vol_power * 100).toFixed(2) + '%' : '-',
        viz: has(indicators.vol_power)
          ? (() => {
              const v = indicators.vol_power;
              // 量程 200%（满条封顶），灰色标记线 = 100%（快慢量能平衡点）
              // 配色分级：<100% 绿（萎缩）/ 100~150% 蓝（温和放大）/ 150~200% 橙（显著放大）/ ≥200% 红色满条（异常放量）
              const color = v >= 2 ? 'c-red' : v >= 1.5 ? 'c-orange' : v >= 1 ? '' : 'c-green';
              return { ...this._bar(v * 100, 200, color), marker: 50 };
            })()
          : null,
        title:
          '量能因子 = 快/慢量能均线比；灰线为 100% 平衡点；>150% 显著放大，≥200% 红色满条（异常放量）',
      },
      {
        label: '📊RSI(f/s)',
        value:
          indicators.rsi_fast !== undefined && indicators.rsi_slow !== undefined
            ? `${Math.round(indicators.rsi_fast)}/${Math.round(indicators.rsi_slow)}`
            : '-',
        viz:
          indicators.rsi_fast !== undefined && indicators.rsi_slow !== undefined
            ? {
                type: 'rsi',
                fast: Math.round(indicators.rsi_fast),
                slow: Math.round(indicators.rsi_slow),
              }
            : null,
      },
      {
        label: '🛡止损等级',
        value:
          indicators.stopLossLevel !== undefined
            ? this._stopLossLabel(indicators.stopLossLevel)
            : '-',
        className:
          indicators.stopLossLevel !== undefined
            ? `metric-stop-loss metric-stop-loss-${indicators.stopLossLevel.toLowerCase()}`
            : 'metric-stop-loss',
        viz:
          indicators.stopLossLevel !== undefined
            ? { type: 'dots', ...this._stopLossSeverity(indicators.stopLossLevel) }
            : null,
        title: indicators.stopLossLevel !== undefined ? indicators.stopLossLevel : '',
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
        viz:
          indicators.shouldTrade !== undefined
            ? { type: 'dot', color: indicators.shouldTrade ? 'c-green' : 'c-red' }
            : null,
        tooltip: indicators.frq_rest ? this._buildTradeConditionTooltip(indicators.frq_rest) : null,
      },
      {
        label: '📦持仓金额',
        value:
          pos.pos !== undefined
            ? (() => {
                if (posNum === 0) return '空仓';
                const n = parseFloat(pos.notionalUsd);
                return isFinite(n) ? '$ ' + (posNum > 0 ? '+' : '-') + n.toFixed(2) : '-';
              })()
            : '-',
        className:
          posNum > 0
            ? 'metric-long'
            : posNum < 0
              ? 'metric-short'
              : posNum === 0
                ? 'metric-empty'
                : '',
      },
      {
        label: '🛡维持保证金',
        value: (() => {
          const r = parseFloat(pos.mgnRatio);
          return isFinite(r) && r > 0 ? Math.round(r * 100) + '%' : '空仓';
        })(),
        className: (() => {
          const r = parseFloat(pos.mgnRatio);
          if (!(isFinite(r) && r > 0)) return 'metric-empty';
          // 对齐后端 PositionController 阈值（×100 后）：4000% 止损 / 6000% 抑制 / 10000% 关注
          return r < 40 ? 'metric-danger' : r < 100 ? 'metric-warning' : '';
        })(),
        viz: (() => {
          const r = parseFloat(pos.mgnRatio);
          if (!(isFinite(r) && r > 0)) return null; // 无持仓不渲染空进度条
          // mgnRatio 为倍率，×100 = 百分比；清仓线 100%（即 r=1）
          // 配色对齐后端阈值：<40 红(低于4000%止损线) / <60 橙 / <100 黄 / ≥100 绿
          const color = r < 40 ? 'c-red' : r < 60 ? 'c-orange' : r < 100 ? 'c-yellow' : 'c-green';
          return this._bar(r, 100, color); // 量程 10000%（r=100 满条）
        })(),
        title: '维持保证金率 = raw×100；清仓线 100%；配色对齐后端风控阈值 4000%/6000%/10000%',
      },
      {
        label: '💰已实现收益',
        value:
          pos.realizedPnl !== undefined && posNum !== 0
            ? (() => {
                const p = pos.realizedPnl * 1;
                return '$ ' + (p >= 0 ? '+' : '-') + Math.abs(p).toFixed(2);
              })()
            : posNum === 0
              ? '空仓'
              : '-',
        className:
          pos.realizedPnl !== undefined && posNum !== 0
            ? pos.realizedPnl * 1 >= 0
              ? 'metric-long'
              : 'metric-short'
            : posNum === 0
              ? 'metric-empty'
              : '',
      },
      {
        label: '📊未实现收益',
        value:
          pos.upl !== undefined && posNum !== 0
            ? (() => {
                const p = pos.upl * 1;
                return '$ ' + (p >= 0 ? '+' : '-') + Math.abs(p).toFixed(2);
              })()
            : posNum === 0
              ? '空仓'
              : '-',
        className:
          pos.upl !== undefined && posNum !== 0
            ? pos.upl * 1 >= 0
              ? 'metric-long'
              : 'metric-short'
            : posNum === 0
              ? 'metric-empty'
              : '',
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

      // 刻度线在两端时调整标签对齐，避免溢出卡片
      const finalLabelTransform =
        finalPercent > 85
          ? 'translateX(-100%)'
          : finalPercent < 15
            ? 'translateX(0)'
            : 'translateX(-50%)';

      html += '<div class="threshold-bar">';
      html += '<div class="threshold-bar-track">';
      html += `<div class="threshold-bar-fill threshold-bar-current" style="width: ${currentPercent}%;" data-key="current-fill"></div>`;
      html += '</div>';
      html += `<div class="threshold-bar-mark" style="left: ${finalPercent}%;" data-key="final-mark"></div>`;
      html += `<div class="threshold-bar-final-label" style="left: ${finalPercent}%; transform: ${finalLabelTransform};" data-key="final-label">最终阈值 ${final.toFixed(2)}%</div>`;
      html += '<div class="threshold-bar-labels">';
      html += `<span>当前回撤 ${current.toFixed(2)}%</span>`;
      html += `<span>初始阈值 ${initial.toFixed(2)}%</span>`;
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
      if (!labelEl) return;
      const label = labelEl.textContent;
      const metric = metrics.find(m => m.label === label);
      if (!metric) return;

      // 同步 title 提示
      if (item.title !== (metric.title || '')) {
        item.title = metric.title || '';
      }

      // 更新 value（可能不存在，如 ATR 三联条）
      if (metric.value !== null && metric.value !== undefined) {
        if (valueEl) {
          if (valueEl.textContent !== String(metric.value)) {
            valueEl.textContent = metric.value;
          }
          valueEl.className = metric.className
            ? `metric-value ${metric.className}`
            : 'metric-value';
        }
      } else if (valueEl) {
        valueEl.remove();
      }

      // 同步 viz
      const vizWrap = item.querySelector('.metric-viz');
      if (metric.viz) {
        const vizHtml = this.renderViz(metric.viz);
        if (vizWrap) {
          if (vizWrap.innerHTML !== vizHtml) vizWrap.innerHTML = vizHtml;
        } else {
          labelEl.insertAdjacentHTML('afterend', `<span class="metric-viz">${vizHtml}</span>`);
        }
      } else if (vizWrap) {
        vizWrap.remove();
      }

      // 更新tooltip
      const oldTooltip = item.querySelector('.trade-forbid-tooltip');
      if (oldTooltip) oldTooltip.remove();
      if (metric.tooltip) {
        item.classList.add('has-trade-tooltip');
        (item.querySelector('.metric-value') || labelEl).insertAdjacentHTML(
          'afterend',
          metric.tooltip
        );
      } else {
        item.classList.remove('has-trade-tooltip');
      }
    });

    // 更新 factors 信号区
    if (indicators.factors) {
      const signalSection = card.querySelector('.signal-section');
      const newHtml = this.renderFactors(indicators.factors);
      if (signalSection) {
        signalSection.outerHTML = newHtml;
      } else {
        const summarySection = card.querySelector('.summary-section');
        if (summarySection) {
          summarySection.insertAdjacentHTML('beforebegin', newHtml);
        }
      }
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

      // 更新进度条宽度和刻度线位置
      const finalMark = card.querySelector('[data-key="final-mark"]');
      const currentFill = card.querySelector('[data-key="current-fill"]');

      if (finalMark) finalMark.style.left = finalPercent + '%';
      if (currentFill) currentFill.style.width = currentPercent + '%';

      // 更新标签值
      const labels = card.querySelector('.threshold-bar-labels');
      if (labels) {
        const spans = labels.querySelectorAll('span');
        if (spans[0]) spans[0].textContent = `当前回撤 ${current.toFixed(2)}%`;
        if (spans[1]) spans[1].textContent = `初始阈值 ${initial.toFixed(2)}%`;
      }
      const finalLabel = card.querySelector('[data-key="final-label"]');
      if (finalLabel) {
        finalLabel.style.left = finalPercent + '%';
        finalLabel.style.transform =
          finalPercent > 85
            ? 'translateX(-100%)'
            : finalPercent < 15
              ? 'translateX(0)'
              : 'translateX(-50%)';
        finalLabel.textContent = `最终阈值 ${final.toFixed(2)}%`;
      }
    }
  },
};
