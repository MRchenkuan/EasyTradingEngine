window.TradingApp = window.TradingApp || {};
window.TradingApp.Charts = {
  charts: {},
  chartDataCache: {}, // 缓存图表数据用于实时更新

  // 格式化价格，最多保留3位小数
  formatPrice: function (price) {
    return parseFloat(price.toFixed(3));
  },

  // 更新最后一根K线的收盘价
  updateLastCandleClose: function (assetName, currentPrice) {
    const chart = this.charts[assetName];
    const cachedData = this.chartDataCache[assetName];
    if (!chart || !cachedData) return;

    const lastIndex = cachedData.bodyData.length - 1;
    if (lastIndex < 0) return;

    // 更新缓存数据
    cachedData.bodyData[lastIndex].c = currentPrice;

    // 更新图表数据
    const dataset = chart.data.datasets.find(ds => ds.label === 'K线数据');
    if (dataset) {
      dataset.data[lastIndex].c = currentPrice;
      // 更新高低价范围
      const prices = cachedData.bodyData.flatMap(d => [d.h, d.l]);
      const priceMin = Math.min(...prices);
      const priceMax = Math.max(...prices);
      const priceRange = priceMax - priceMin;
      const padding = priceRange * 0.1;
      chart.options.scales.y.min = priceMin - padding;
      chart.options.scales.y.max = priceMax + padding;
    }

    chart.update('none'); // 不使用动画更新
  },

  renderChart: function (assetName, chartData) {
    const self = this;
    const canvas = document.getElementById(`chart-${assetName}`);
    if (!canvas || !chartData.candleData || chartData.candleData.length === 0) {
      return;
    }

    if (this.charts[assetName]) {
      this.charts[assetName].destroy();
      delete this.charts[assetName];
    }

    const ctx = canvas.getContext('2d');
    const candleData = chartData.candleData;
    const labels = chartData.labels;

    const prices = candleData.flatMap(d => [d.high, d.low]);
    const priceMin = Math.min(...prices);
    const priceMax = Math.max(...prices);
    const priceRange = priceMax - priceMin;
    const padding = priceRange * 0.15;
    const yMin = priceMin - padding;
    const yMax = priceMax + padding;

    const bodyData = candleData.map((d, i) => ({
      x: i,
      o: d.open,
      c: d.close,
      h: d.high,
      l: d.low,
    }));

    // 缓存数据用于实时更新
    this.chartDataCache[assetName] = { bodyData, labels };

    const bollUpper = chartData.boll?.upper || [];
    const bollMiddle = chartData.boll?.middle || [];
    const bollLower = chartData.boll?.lower || [];
    const orders = chartData.orders || [];

    // 构建买卖点数据 - 使用与K线相同长度的数组，null表示无买卖点
    const buyPointsData = new Array(candleData.length).fill(null);
    const sellPointsData = new Array(candleData.length).fill(null);
    const orderInfoMap = {}; // 存储买卖点详细信息用于tooltip

    if (orders && orders.length > 0) {
      orders.forEach(order => {
        const orderTs = parseInt(order.ts);
        if (isNaN(orderTs)) return;
        const orderTsMinute = Math.round(orderTs / 60000) * 60000;
        const orderIndex = candleData.findIndex(d => Math.abs(d.ts - orderTsMinute) <= 60000);
        if (orderIndex >= 0) {
          const info = {
            price: order.avgPx,
            amount: order.accFillSz,
            gridCount: order.grid_count,
          };
          orderInfoMap[orderIndex] = orderInfoMap[orderIndex] || [];
          orderInfoMap[orderIndex].push({ side: order.side, ...info });

          if (order.side === 'buy') {
            buyPointsData[orderIndex] = order.avgPx;
          } else if (order.side === 'sell') {
            sellPointsData[orderIndex] = order.avgPx;
          }
        }
      });
    }

    this.charts[assetName] = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [
          {
            // 虚拟数据集用于触发K线tooltip
            type: 'bar',
            label: 'K线',
            data: candleData.map(d => d.close),
            backgroundColor: 'transparent',
            borderColor: 'transparent',
            borderWidth: 0,
            order: 3,
          },
          {
            type: 'line',
            label: '布林上轨',
            data: bollUpper,
            borderColor: 'rgba(243, 156, 18, 0.35)',
            borderWidth: 0.5,
            pointRadius: 0,
            order: 2,
          },
          {
            type: 'line',
            label: '布林中轨',
            data: bollMiddle,
            borderColor: 'rgba(243, 156, 18, 0.25)',
            borderWidth: 0.5,
            pointRadius: 0,
            order: 2,
          },
          {
            type: 'line',
            label: '布林下轨',
            data: bollLower,
            borderColor: 'rgba(243, 156, 18, 0.35)',
            borderWidth: 0.5,
            pointRadius: 0,
            order: 2,
          },
          {
            type: 'line',
            label: '买入',
            data: buyPointsData,
            borderColor: '#ffffff',
            borderWidth: 1,
            backgroundColor: '#ec7063',
            pointRadius: 3,
            pointHoverRadius: 5,
            showLine: false,
            order: 0,
          },
          {
            type: 'line',
            label: '卖出',
            data: sellPointsData,
            borderColor: '#ffffff',
            borderWidth: 1,
            backgroundColor: '#52be80',
            pointRadius: 3,
            pointHoverRadius: 5,
            showLine: false,
            order: 0,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        interaction: {
          intersect: false,
          mode: 'index',
        },
        plugins: {
          legend: {
            display: false,
          },
          tooltip: {
            enabled: false, // 禁用默认tooltip，使用自定义
            external: function (context) {
              // 获取或创建tooltip元素
              let tooltipEl = document.getElementById('chartjs-tooltip');
              if (!tooltipEl) {
                tooltipEl = document.createElement('div');
                tooltipEl.id = 'chartjs-tooltip';
                tooltipEl.innerHTML = '<table></table>';
                document.body.appendChild(tooltipEl);
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

              const index = dataPoint.dataIndex;
              const candle = candleData[index];
              if (!candle) {
                tooltipEl.style.opacity = '0';
                return;
              }

              // 构建tooltip内容
              let innerHtml = '<thead>';
              innerHtml += `<tr><th style="text-align:left; padding:4px 0; font-size:12px; color:#a5d6ff;">${labels[index] || ''}</th></tr>`;
              innerHtml += '</thead><tbody>';

              // K线价格信息
              innerHtml += `<tr><td style="padding:2px 0; font-size:11px; color:#8b949e;">开: <span style="color:#c9d1d9;">${self.formatPrice(candle.open)}</span> 高: <span style="color:#ec7063;">${self.formatPrice(candle.high)}</span></td></tr>`;
              innerHtml += `<tr><td style="padding:2px 0; font-size:11px; color:#8b949e;">低: <span style="color:#52be80;">${self.formatPrice(candle.low)}</span> 收: <span style="color:${candle.close >= candle.open ? '#ec7063' : '#52be80'};">${self.formatPrice(candle.close)}</span></td></tr>`;

              // 买卖点信息
              const orders = orderInfoMap[index];
              if (orders && orders.length > 0) {
                innerHtml += `<tr><td style="padding:6px 0 2px 0; border-top:1px solid #30363d;"></td></tr>`;
                orders.forEach(order => {
                  const isBuy = order.side === 'buy';
                  const color = isBuy ? '#ec7063' : '#52be80';
                  const label = isBuy ? '买入' : '卖出';
                  innerHtml += `<tr><td style="padding:3px 0; font-size:11px;">`;
                  innerHtml += `<span style="color:${color}; font-weight:bold;">${label}</span>`;
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
              const tooltipX = position.left + window.pageXOffset + tooltipModel.caretX;
              const tooltipY = position.top + window.pageYOffset + tooltipModel.caretY - 10;

              tooltipEl.style.left = tooltipX + 'px';
              tooltipEl.style.top = tooltipY + 'px';

              // 确保tooltip不超出屏幕
              const tooltipRect = tooltipEl.getBoundingClientRect();
              if (tooltipRect.right > window.innerWidth) {
                tooltipEl.style.left = tooltipX - tooltipRect.width + 'px';
              }
              if (tooltipRect.bottom > window.innerHeight) {
                tooltipEl.style.top = tooltipY - tooltipRect.height - 20 + 'px';
              }
            },
          },
        },
        scales: {
          x: {
            type: 'category',
            display: true,
            ticks: {
              maxTicksLimit: 8,
              maxRotation: 0,
              font: { size: 9 },
              callback: function (_val, index) {
                const label = labels[index];
                if (!label) return '';
                const parts = label.split(' ');
                if (parts.length >= 2) {
                  return parts[1].substring(0, 5);
                }
                return label.substring(0, 5);
              },
            },
          },
          y: {
            type: 'linear',
            position: 'left',
            display: true,
            min: yMin,
            max: yMax,
            beginAtZero: false,
            grid: { color: 'rgba(48, 54, 61, 0.5)' },
            ticks: {
              font: { size: 9 },
              maxTicksLimit: 6,
              callback: function (value) {
                return self.formatPrice(value);
              },
            },
          },
        },
        animation: { duration: 0 },
      },
      plugins: [
        {
          id: 'candlestick',
          afterDraw: function (chart) {
            const ctx = chart.ctx;
            const xScale = chart.scales.x;
            const yScale = chart.scales.y;

            bodyData.forEach((data, index) => {
              const xCenter = xScale.getPixelForValue(index);
              const wickTop = yScale.getPixelForValue(data.h);
              const wickBottom = yScale.getPixelForValue(data.l);
              const bodyTop = yScale.getPixelForValue(Math.max(data.o, data.c));
              const bodyBottom = yScale.getPixelForValue(Math.min(data.o, data.c));

              const isUp = data.c >= data.o;
              const color = isUp ? '#ec7063' : '#52be80';

              const barWidthPx = (xScale.width / labels.length) * 0.8;
              const halfWidth = barWidthPx / 2;

              ctx.beginPath();
              ctx.strokeStyle = color;
              ctx.lineWidth = 1;
              ctx.moveTo(xCenter, wickTop);
              ctx.lineTo(xCenter, wickBottom);
              ctx.stroke();

              ctx.fillStyle = color;
              ctx.fillRect(xCenter - halfWidth, bodyTop, barWidthPx, bodyBottom - bodyTop);
            });

            // 绘制买卖点文字标识 B/S（带圆角方框和虚线）
            ctx.font = 'bold 10px Arial';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';

            // 绘制圆角矩形函数
            const roundRect = (x, y, width, height, radius) => {
              ctx.beginPath();
              ctx.moveTo(x + radius, y);
              ctx.lineTo(x + width - radius, y);
              ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
              ctx.lineTo(x + width, y + height - radius);
              ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
              ctx.lineTo(x + radius, y + height);
              ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
              ctx.lineTo(x, y + radius);
              ctx.quadraticCurveTo(x, y, x + radius, y);
              ctx.closePath();
            };

            // 买入点 - 显示 B（在下方）
            buyPointsData.forEach((price, index) => {
              if (price !== null) {
                const x = xScale.getPixelForValue(index);
                const y = yScale.getPixelForValue(price);
                const labelY = y + 60; // 文字位置

                // 绘制虚线连接点位和标签
                ctx.beginPath();
                ctx.setLineDash([3, 3]);
                ctx.strokeStyle = '#ec7063';
                ctx.lineWidth = 1;
                ctx.moveTo(x, y);
                ctx.lineTo(x, labelY);
                ctx.stroke();
                ctx.setLineDash([]);

                // 绘制圆角矩形背景
                const boxSize = 10;
                const boxX = x - boxSize / 2;
                const boxY = labelY - boxSize / 2;
                ctx.fillStyle = '#ec7063';
                roundRect(boxX, boxY, boxSize, boxSize, 2);
                ctx.fill();

                // 绘制文字
                ctx.fillStyle = '#ffffff';
                ctx.fillText('B', x, labelY);
              }
            });

            // 卖出点 - 显示 S（在上方）
            sellPointsData.forEach((price, index) => {
              if (price !== null) {
                const x = xScale.getPixelForValue(index);
                const y = yScale.getPixelForValue(price);
                const labelY = y - 60; // 文字位置

                // 绘制虚线连接点位和标签
                ctx.beginPath();
                ctx.setLineDash([3, 3]);
                ctx.strokeStyle = '#52be80';
                ctx.lineWidth = 1;
                ctx.moveTo(x, y);
                ctx.lineTo(x, labelY);
                ctx.stroke();
                ctx.setLineDash([]);

                // 绘制圆角矩形背景
                const boxSize = 10;
                const boxX = x - boxSize / 2;
                const boxY = labelY - boxSize / 2;
                ctx.fillStyle = '#52be80';
                roundRect(boxX, boxY, boxSize, boxSize, 2);
                ctx.fill();

                // 绘制文字
                ctx.fillStyle = '#ffffff';
                ctx.fillText('S', x, labelY);
              }
            });
          },
        },
      ],
    });
  },
};
