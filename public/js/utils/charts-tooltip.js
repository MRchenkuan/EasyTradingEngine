window.TradingApp = window.TradingApp || {};
window.TradingApp.ChartTooltip = {
  createExternalHandler: function (self, assetName) {
    return function (context) {
      // 获取或创建tooltip元素
      let tooltipEl = document.getElementById('chartjs-tooltip');
      if (!tooltipEl) {
        tooltipEl = document.createElement('div');
        tooltipEl.id = 'chartjs-tooltip';
        tooltipEl.innerHTML = '<table></table>';
        document.body.appendChild(tooltipEl);
      }

      // 非长按模式下不显示tooltip
      if (!self.longPressActive?.[assetName]) {
        tooltipEl.style.opacity = '0';
        return;
      }

      // 隐藏tooltip
      const tooltipModel = context.tooltip;
      if (tooltipModel.opacity === 0) {
        tooltipEl.style.opacity = '0';
        return;
      }

      // 只处理K线数据集
      if (!tooltipModel.dataPoints || tooltipModel.dataPoints.length === 0) return;
      const dataPoint = tooltipModel.dataPoints.find(dp => dp.dataset.label === 'K线');
      if (!dataPoint) {
        tooltipEl.style.opacity = '0';
        return;
      }

      const visibleIndex = dataPoint.dataIndex;
      const cached = self.chartDataCache[assetName];
      const candle = cached.candleData[visibleIndex];
      if (!candle) {
        tooltipEl.style.opacity = '0';
        return;
      }

      const label = cached.labels[visibleIndex] || '';

      // 构建tooltip内容
      let innerHtml = '<thead>';
      innerHtml += `<tr><th style="text-align:left; padding:4px 0; font-size:12px; color:#a5d6ff;">${label}</th></tr>`;
      innerHtml += '</thead><tbody>';

      // K线价格信息
      innerHtml += `<tr><td style="padding:2px 0; font-size:11px; color:#8b949e;">开: <span style="color:#c9d1d9;">${self.formatPrice(candle.open)}</span> 高: <span style="color:#ec7063;">${self.formatPrice(candle.high)}</span></td></tr>`;
      innerHtml += `<tr><td style="padding:2px 0; font-size:11px; color:#8b949e;">低: <span style="color:#52be80;">${self.formatPrice(candle.low)}</span> 收: <span style="color:${candle.close >= candle.open ? '#ec7063' : '#52be80'};">${self.formatPrice(candle.close)}</span></td></tr>`;

      // 成交额
      const vol = cached.volData ? cached.volData[visibleIndex] : null;
      if (vol != null) {
        const volStr =
          vol >= 1000000
            ? (vol / 1000000).toFixed(2) + 'M'
            : vol >= 1000
              ? (vol / 1000).toFixed(1) + 'K'
              : vol.toFixed(0);
        innerHtml += `<tr><td style="padding:2px 0; font-size:11px; color:#8b949e;">额: <span style="color:#c9d1d9;">$${volStr}</span></td></tr>`;
      }

      // 计算全局索引查找买卖点
      const { start: viewStart } = self.getVisibleRange(assetName);
      const globalIndex = viewStart + visibleIndex;
      const orders = cached.orderInfoMap[globalIndex];
      if (orders && orders.length > 0) {
        innerHtml += `<tr><td style="padding:6px 0 2px 0; border-top:1px solid #30363d;"></td></tr>`;
        orders.forEach(order => {
          const isBuy = order.side === 'buy';
          const color = isBuy ? '#ec7063' : '#52be80';
          const orderLabel = isBuy ? '买入' : '卖出';
          innerHtml += `<tr><td style="padding:3px 0; font-size:11px;">`;
          innerHtml += `<span style="color:${color}; font-weight:bold;">${orderLabel}</span>`;
          innerHtml += ` <span style="color:#c9d1d9;">${self.formatPrice(order.price)}</span>`;
          innerHtml += ` <span style="color:#8b949e;">×${order.amount}</span>`;
          innerHtml += ` <span style="color:#8b949e;">(${order.gridCount > 0 ? '+' : ''}${order.gridCount}格)</span>`;
          innerHtml += `</td></tr>`;
        });
      }

      innerHtml += '</tbody>';

      // 设置tooltip内容和样式
      const tableRoot = tooltipEl.querySelector('table');
      tableRoot.innerHTML = innerHtml;

      tooltipEl.style.opacity = '1';
      tooltipEl.style.position = 'absolute';
      tooltipEl.style.backgroundColor = 'rgba(22, 27, 34, 0.95)';
      tooltipEl.style.border = '1px solid #30363d';
      tooltipEl.style.borderRadius = '6px';
      tooltipEl.style.padding = '8px 12px';
      tooltipEl.style.pointerEvents = 'none';
      tooltipEl.style.zIndex = '1000';
      tooltipEl.style.boxShadow = '0 4px 12px rgba(0,0,0,0.3)';

      // 定位tooltip
      const position = context.chart.canvas.getBoundingClientRect();
      const caretX = tooltipModel.caretX;
      const caretY = tooltipModel.caretY;
      let tooltipX = position.left + window.pageXOffset + caretX;
      let tooltipY = position.top + window.pageYOffset + caretY - 10;

      tooltipEl.style.left = tooltipX + 'px';
      tooltipEl.style.top = tooltipY + 'px';
      tooltipEl.style.minWidth = '160px'; // 保持最小宽度

      // 确保tooltip不超出屏幕
      const tooltipRect = tooltipEl.getBoundingClientRect();
      if (tooltipRect.right > window.innerWidth) {
        tooltipX = position.left + window.pageXOffset + caretX - tooltipRect.width - 10;
        tooltipEl.style.left = tooltipX + 'px';
      }
      if (tooltipRect.bottom > window.innerHeight) {
        tooltipY = position.top + window.pageYOffset + caretY - tooltipRect.height - 20;
        tooltipEl.style.top = tooltipY + 'px';
      }
      if (tooltipRect.left < 0) {
        tooltipEl.style.left = position.left + window.pageXOffset + 10 + 'px';
      }
    };
  },
};
