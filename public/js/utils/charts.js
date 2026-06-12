window.TradingApp = window.TradingApp || {};
window.TradingApp.Charts = {
  charts: {},
  chartDataCache: {}, // 缓存图表数据用于实时更新
  viewports: {}, // 每个资产的视口偏移量（从右侧算起的偏移量，0=最新数据）
  visibleCounts: {}, // 每个资产的可见K线数量
  DEFAULT_VISIBLE_COUNT: 200,
  MIN_VISIBLE_COUNT: 20,
  MAX_VISIBLE_COUNT: 500,
  // 拖拽状态改为按资产独立存储
  dragStates: {},

  // 格式化价格，整数位+小数位最多4位，超过则只保留整数位
  formatPrice: function (price) {
    const intDigits = Math.floor(Math.abs(price)).toString().length;
    if (intDigits >= 4) return Math.round(price);
    const decimals = 4 - intDigits;
    return parseFloat(price.toFixed(decimals));
  },

  // 获取当前可见的数据范围
  getVisibleRange: function (assetName) {
    const cachedData = this.chartDataCache[assetName];
    if (!cachedData) return { start: 0, end: 0 };
    const totalCount = cachedData.allBodyData.length;
    const offset = this.viewports[assetName] || 0;
    const visibleCount = this.visibleCounts[assetName] || this.DEFAULT_VISIBLE_COUNT;
    const end = totalCount - offset;
    const start = Math.max(0, end - visibleCount);
    return { start, end };
  },

  // 更新最后一根K线的收盘价
  updateLastCandleClose: function (assetName, currentPrice) {
    const chart = this.charts[assetName];
    const cachedData = this.chartDataCache[assetName];
    if (!chart || !cachedData) return;

    const lastIndex = cachedData.allBodyData.length - 1;
    if (lastIndex < 0) return;

    // 更新缓存数据
    cachedData.allBodyData[lastIndex].c = currentPrice;

    // 如果视口在最新位置，更新图表
    const offset = this.viewports[assetName] || 0;
    if (offset === 0) {
      this.refreshViewport(assetName);
    }
  },

  // 更新最后一根K线的 tick 数据（candle + boll）
  updateTick: function (assetName, tick) {
    const chart = this.charts[assetName];
    const cachedData = this.chartDataCache[assetName];
    if (!chart || !cachedData) return;

    const lastIndex = cachedData.allBodyData.length - 1;
    if (lastIndex < 0) return;

    // 更新最后一根K线
    if (tick.candle) {
      cachedData.allBodyData[lastIndex].c = tick.candle.close;
      cachedData.allBodyData[lastIndex].h = tick.candle.high;
      cachedData.allBodyData[lastIndex].l = tick.candle.low;
      cachedData.allCandleData[lastIndex] = tick.candle;
      if (tick.candle.vol != null) {
        cachedData.allVolData[lastIndex] = tick.candle.vol;
      }
    }

    // 更新最后一根 boll
    if (tick.boll) {
      if (tick.boll.upper != null) cachedData.allBollUpper[lastIndex] = tick.boll.upper;
      if (tick.boll.middle != null) cachedData.allBollMiddle[lastIndex] = tick.boll.middle;
      if (tick.boll.lower != null) cachedData.allBollLower[lastIndex] = tick.boll.lower;
    }

    // 如果视口在最新位置，更新图表
    const offset = this.viewports[assetName] || 0;
    if (offset === 0) {
      this.refreshViewport(assetName);
    }
  },

  // 刷新视口显示
  refreshViewport: function (assetName) {
    const chart = this.charts[assetName];
    const cachedData = this.chartDataCache[assetName];
    if (!chart || !cachedData) return;

    const { start, end } = this.getVisibleRange(assetName);
    const visibleBodyData = cachedData.allBodyData.slice(start, end);
    const visibleLabels = cachedData.allLabels.slice(start, end);
    const visibleCandleData = cachedData.allCandleData.slice(start, end);
    const visibleBollUpper = cachedData.allBollUpper.slice(start, end);
    const visibleBollMiddle = cachedData.allBollMiddle.slice(start, end);
    const visibleBollLower = cachedData.allBollLower.slice(start, end);
    const visibleBuyPoints = cachedData.allBuyPoints.slice(start, end);
    const visibleSellPoints = cachedData.allSellPoints.slice(start, end);
    const visibleVolData = cachedData.allVolData.slice(start, end);

    // 计算可见区域的Y轴范围
    const prices = visibleCandleData.flatMap(d => [d.high, d.low]);
    const priceMin = Math.min(...prices);
    const priceMax = Math.max(...prices);
    const priceRange = priceMax - priceMin;
    const padding = priceRange * 0.15;

    // 更新图表数据
    chart.data.labels = visibleLabels;
    chart.data.datasets[0].data = visibleCandleData.map(d => d.close);
    chart.data.datasets[1].data = visibleBollUpper;
    chart.data.datasets[2].data = visibleBollMiddle;
    chart.data.datasets[3].data = visibleBollLower;
    chart.data.datasets[4].data = visibleBuyPoints;
    chart.data.datasets[5].data = visibleSellPoints;
    chart.options.scales.y.min = priceMin - padding;
    chart.options.scales.y.max = priceMax + padding;

    // 更新缓存中的可见数据引用
    cachedData.bodyData = visibleBodyData;
    cachedData.labels = visibleLabels;
    cachedData.candleData = visibleCandleData;
    cachedData.volData = visibleVolData;

    chart.update('none');
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
    const allCandleData = chartData.candleData;
    const allLabels = chartData.labels;

    // 缓存所有数据
    const allBodyData = allCandleData.map((d, i) => ({
      x: i,
      o: d.open,
      c: d.close,
      h: d.high,
      l: d.low,
    }));

    const allBollUpper = chartData.boll?.upper || [];
    const allBollMiddle = chartData.boll?.middle || [];
    const allBollLower = chartData.boll?.lower || [];
    const allVolData = allCandleData.map(d => d.vol || 0);
    const orders = chartData.orders || [];
    const gridLines = chartData.gridParams?.grid || [];

    // 构建买卖点数据 - 使用与K线相同长度的数组，null表示无买卖点
    const allBuyPoints = new Array(allCandleData.length).fill(null);
    const allSellPoints = new Array(allCandleData.length).fill(null);
    const orderInfoMap = {}; // 存储买卖点详细信息用于tooltip

    if (orders && orders.length > 0) {
      orders.forEach(order => {
        const orderTs = parseInt(order.ts);
        if (isNaN(orderTs)) return;
        const orderTsMinute = Math.round(orderTs / 60000) * 60000;

        // 订单时间不在K线范围内，跳过
        if (
          orderTsMinute < allCandleData[0].ts ||
          orderTsMinute > allCandleData[allCandleData.length - 1].ts + 60000
        )
          return;

        // 尝试精确匹配（1分钟内）
        let orderIndex = allCandleData.findIndex(d => Math.abs(d.ts - orderTsMinute) <= 60000);

        // 如果精确匹配失败，找最接近的K线（仅在范围内）
        if (orderIndex === -1) {
          let closestIndex = -1;
          let minDiff = Infinity;
          allCandleData.forEach((d, i) => {
            const diff = Math.abs(d.ts - orderTsMinute);
            if (diff < minDiff) {
              minDiff = diff;
              closestIndex = i;
            }
          });
          // 只接受5分钟内的匹配
          if (minDiff <= 5 * 60000) {
            orderIndex = closestIndex;
          }
        }

        if (orderIndex >= 0) {
          const info = {
            price: order.avgPx,
            amount: order.accFillSz,
            gridCount: order.grid_count,
          };
          orderInfoMap[orderIndex] = orderInfoMap[orderIndex] || [];
          orderInfoMap[orderIndex].push({ side: order.side, ...info });

          if (order.side === 'buy') {
            allBuyPoints[orderIndex] = order.avgPx;
          } else if (order.side === 'sell') {
            allSellPoints[orderIndex] = order.avgPx;
          }
        }
      });
    }

    // 缓存所有数据
    this.chartDataCache[assetName] = {
      allBodyData,
      allLabels,
      allCandleData,
      allBollUpper,
      allBollMiddle,
      allBollLower,
      allBuyPoints,
      allSellPoints,
      allVolData,
      orderInfoMap,
      bodyData: [],
      labels: [],
      candleData: [],
      volData: [],
    };

    // 初始化视口偏移（0=最新数据）
    this.viewports[assetName] = 0;
    this.visibleCounts[assetName] = this.DEFAULT_VISIBLE_COUNT;

    // 获取初始可见数据
    const { start, end } = this.getVisibleRange(assetName);
    const candleData = allCandleData.slice(start, end);
    const labels = allLabels.slice(start, end);
    const bodyData = allBodyData.slice(start, end);
    const bollUpper = allBollUpper.slice(start, end);
    const bollMiddle = allBollMiddle.slice(start, end);
    const bollLower = allBollLower.slice(start, end);
    const buyPointsData = allBuyPoints.slice(start, end);
    const sellPointsData = allSellPoints.slice(start, end);
    const volData = allVolData.slice(start, end);

    // 更新缓存中的可见数据引用
    this.chartDataCache[assetName].bodyData = bodyData;
    this.chartDataCache[assetName].labels = labels;
    this.chartDataCache[assetName].candleData = candleData;
    this.chartDataCache[assetName].volData = volData;

    const prices = candleData.flatMap(d => [d.high, d.low]);
    const priceMin = Math.min(...prices);
    const priceMax = Math.max(...prices);
    const priceRange = priceMax - priceMin;
    const padding = priceRange * 0.15;
    const yMin = priceMin - padding;
    const yMax = priceMax + padding;

    // 使用最新K线的收盘价作为当前价格（用于价格线颜色计算，不随视口变化）
    const latestPrice = allBodyData.length > 0 ? allBodyData[allBodyData.length - 1].c : 0;

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

              // 成交量
              const vol = cached.volData ? cached.volData[visibleIndex] : null;
              if (vol != null) {
                const volStr =
                  vol >= 1000000
                    ? (vol / 1000000).toFixed(2) + 'M'
                    : vol >= 1000
                      ? (vol / 1000).toFixed(1) + 'K'
                      : vol.toFixed(0);
                innerHtml += `<tr><td style="padding:2px 0; font-size:11px; color:#8b949e;">量: <span style="color:#c9d1d9;">${volStr}</span></td></tr>`;
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
                const cached = self.chartDataCache[assetName];
                const label = cached ? cached.labels[index] : '';
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
            display: false,
            min: yMin,
            max: yMax,
            beginAtZero: false,
            grid: { display: false },
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
            const cached = self.chartDataCache[assetName];
            if (!cached) return;

            const visibleBodyData = cached.bodyData;
            const visibleLabels = cached.labels;
            const { start: viewStart, end: viewEnd } = self.getVisibleRange(assetName);
            const visibleBuyPoints = cached.allBuyPoints.slice(viewStart, viewEnd);
            const visibleSellPoints = cached.allSellPoints.slice(viewStart, viewEnd);

            // 在图表内部绘制 y 轴刻度
            const chartArea = chart.chartArea;
            const yTicks = yScale.getTicks();
            if (yTicks && yTicks.length > 0) {
              ctx.font = '9px Arial';
              ctx.textAlign = 'left';
              ctx.textBaseline = 'middle';
              ctx.fillStyle = 'rgba(139, 148, 158, 0.6)';
              yTicks.forEach(tick => {
                const y = yScale.getPixelForValue(tick.value);
                if (y >= chartArea.top && y <= chartArea.bottom) {
                  ctx.fillText(self.formatPrice(tick.value), chartArea.left + 4, y);
                }
              });
            }

            visibleBodyData.forEach((data, index) => {
              const xCenter = xScale.getPixelForValue(index);
              const wickTop = yScale.getPixelForValue(data.h);
              const wickBottom = yScale.getPixelForValue(data.l);
              const bodyTop = yScale.getPixelForValue(Math.max(data.o, data.c));
              const bodyBottom = yScale.getPixelForValue(Math.min(data.o, data.c));

              const isUp = data.c >= data.o;
              const color = isUp ? '#ec7063' : '#52be80';

              const barWidthPx = (xScale.width / visibleLabels.length) * 0.8;
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

            // 绘制成交量柱状图（底部，最高不超过图表10%高度）
            const visibleVolData = cached.volData;
            if (visibleVolData && visibleVolData.length > 0) {
              const maxVol = Math.max(...visibleVolData);
              if (maxVol > 0) {
                const volMaxHeight = (chartArea.bottom - chartArea.top) * 0.1;
                visibleBodyData.forEach((data, index) => {
                  const xCenter = xScale.getPixelForValue(index);
                  const barWidthPx = (xScale.width / visibleLabels.length) * 0.8;
                  const halfWidth = barWidthPx / 2;
                  const isUp = data.c >= data.o;
                  const volHeight = (visibleVolData[index] / maxVol) * volMaxHeight;
                  const volY = chartArea.bottom - volHeight;

                  ctx.fillStyle = isUp ? 'rgba(236, 112, 99, 0.4)' : 'rgba(82, 190, 128, 0.4)';
                  ctx.fillRect(xCenter - halfWidth, volY, barWidthPx, volHeight);
                });
              }
            }

            // 绘制网格水平线
            if (gridLines.length > 0) {
              const chartArea = chart.chartArea;
              gridLines.forEach(gridPrice => {
                const y = yScale.getPixelForValue(gridPrice);
                // 只绘制在图表可见区域内的网格线
                if (y >= chartArea.top && y <= chartArea.bottom) {
                  ctx.beginPath();
                  ctx.setLineDash([4, 4]);
                  ctx.strokeStyle = 'rgba(100, 149, 237, 0.3)';
                  ctx.lineWidth = 0.5;
                  ctx.moveTo(chartArea.left, y);
                  ctx.lineTo(chartArea.right, y);
                  ctx.stroke();
                  ctx.setLineDash([]);
                }
              });
            }

            // 绘制开仓均价、盈亏平衡价和完全平仓价水平线
            // 使用最新K线收盘价计算颜色，不随视口变化
            const position = chartData.position;
            const gridParams = chartData.gridParams;
            if (position && position.avgPx && position.bePx) {
              const chartArea = chart.chartArea;
              const posSign = Math.sign(position.pos);

              const calcColor = (price, avgPx, posSign) => {
                const isOver = price > avgPx ? 1 : -1;
                const profitSign = isOver * posSign;
                return profitSign > 0 ? '#ec7063' : '#52be80';
              };

              const drawPriceLine = (price, color, label, textOffsetY) => {
                const y = yScale.getPixelForValue(price);
                if (y >= chartArea.top && y <= chartArea.bottom) {
                  ctx.beginPath();
                  ctx.setLineDash([4, 3]);
                  ctx.strokeStyle = color;
                  ctx.lineWidth = 0.5;
                  ctx.moveTo(chartArea.left, y);
                  ctx.lineTo(chartArea.right, y);
                  ctx.stroke();
                  ctx.setLineDash([]);

                  // 绘制标签
                  ctx.font = '10px Arial';
                  ctx.textAlign = 'right';
                  ctx.textBaseline = 'middle';
                  ctx.fillStyle = color;
                  ctx.fillText(
                    `${label} ${self.formatPrice(price)}`,
                    chartArea.right - 4,
                    y + textOffsetY
                  );
                }
              };

              const avgPx = parseFloat(position.avgPx);
              const bePx = parseFloat(position.bePx);
              const isAvgPxLarger = avgPx > bePx;

              drawPriceLine(
                avgPx,
                calcColor(latestPrice, avgPx, posSign),
                '开仓均价',
                isAvgPxLarger ? -10 : 10
              );
              drawPriceLine(
                bePx,
                calcColor(latestPrice, bePx, posSign),
                '盈亏平衡',
                isAvgPxLarger ? 10 : -10
              );

              // 绘制完全平仓线
              const pos = parseFloat(position.notionalUsd);
              const gridWidth = parseFloat(gridParams?.grid_width) || 0;
              const baseAmount = parseFloat(gridParams?.base_amount) || 30;
              if (pos !== 0 && gridWidth > 0 && baseAmount > 0) {
                const gridSpan = Math.abs(pos) / baseAmount;
                const totalSpan = gridSpan * gridWidth;
                const closePrice = avgPx * (1 + posSign * totalSpan);
                const chartArea = chart.chartArea;
                const closeY = yScale.getPixelForValue(closePrice);

                if (closeY >= chartArea.top && closeY <= chartArea.bottom) {
                  drawPriceLine(
                    closePrice,
                    calcColor(latestPrice, closePrice, -posSign),
                    '完全平仓',
                    posSign > 0 ? -10 : 10
                  );
                } else {
                  // 超出图表区域，绘制在边缘
                  const edgeY = closeY < chartArea.top ? chartArea.top + 4 : chartArea.bottom - 4;
                  const edgeColor = calcColor(latestPrice, closePrice, -posSign);
                  ctx.font = '10px Arial';
                  ctx.textAlign = 'right';
                  ctx.textBaseline = closeY < chartArea.top ? 'top' : 'bottom';
                  ctx.fillStyle = edgeColor;
                  ctx.fillText(
                    `完全平仓 ${self.formatPrice(closePrice)} ${closeY < chartArea.top ? '↑' : '↓'}`,
                    chartArea.right - 4,
                    edgeY
                  );
                }
              }
            }

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
            visibleBuyPoints.forEach((price, index) => {
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
            visibleSellPoints.forEach((price, index) => {
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

    // ===== 拖拽平移 + 滚轮/双指缩放交互 =====
    const chartInstance = this.charts[assetName];
    const canvasEl = canvas;

    // 初始化该资产的独立拖拽状态
    this.dragStates[assetName] = {
      isDragging: false,
      startX: 0,
      startOffset: 0,
    };

    // 计算每根K线占用的像素宽度
    const getBarPixelWidth = () => {
      const xScale = chartInstance.scales.x;
      const visibleCount = chartInstance.data.labels.length;
      return visibleCount > 0 ? xScale.width / visibleCount : 10;
    };

    // 鼠标拖动（仅平移，不缩放）
    canvasEl.addEventListener('mousedown', function (e) {
      self.dragStates[assetName].isDragging = true;
      self.dragStates[assetName].startX = e.clientX;
      self.dragStates[assetName].startOffset = self.viewports[assetName] || 0;
      canvasEl.style.cursor = 'grabbing';
      e.preventDefault(); // 防止选中文本
    });

    // mousemove 和 mouseup 绑定在 canvas 上，避免影响其他图表
    canvasEl.addEventListener('mousemove', function (e) {
      const ds = self.dragStates[assetName];
      if (!ds || !ds.isDragging) return;
      const dx = e.clientX - ds.startX;
      const barWidth = getBarPixelWidth();
      if (barWidth <= 0) return;
      const barShift = Math.round(dx / barWidth);
      const cached = self.chartDataCache[assetName];
      if (!cached) return;
      const totalCount = cached.allBodyData.length;
      let newOffset = ds.startOffset + barShift;
      newOffset = Math.max(0, Math.min(totalCount - self.MIN_VISIBLE_COUNT, newOffset));
      if (newOffset !== self.viewports[assetName]) {
        self.viewports[assetName] = newOffset;
        self.refreshViewport(assetName);
      }
    });

    canvasEl.addEventListener('mouseup', function () {
      const ds = self.dragStates[assetName];
      if (ds && ds.isDragging) {
        ds.isDragging = false;
        canvasEl.style.cursor = 'grab';
      }
    });

    canvasEl.addEventListener('mouseleave', function () {
      const ds = self.dragStates[assetName];
      if (ds && ds.isDragging) {
        ds.isDragging = false;
        canvasEl.style.cursor = 'grab';
      }
    });

    // PC端：触控板双指缩放（ctrlKey+wheel）或鼠标滚轮缩放
    canvasEl.addEventListener(
      'wheel',
      function (e) {
        // 仅在 ctrlKey 时缩放（触控板双指捏合）
        if (!e.ctrlKey) return;
        e.preventDefault();
        const cached = self.chartDataCache[assetName];
        if (!cached) return;

        const currentCount = self.visibleCounts[assetName] || self.DEFAULT_VISIBLE_COUNT;
        // pinch in = 放大（看更少K线），pinch out = 缩小（看更多K线）
        const delta = e.deltaY > 0 ? 20 : -20;
        let newCount = currentCount + delta;
        newCount = Math.max(self.MIN_VISIBLE_COUNT, Math.min(self.MAX_VISIBLE_COUNT, newCount));

        if (newCount !== currentCount) {
          self.visibleCounts[assetName] = newCount;
          self.refreshViewport(assetName);
        }
      },
      { passive: false }
    );

    // 触摸拖动 + 双指缩放（移动端）
    let touchStartX = 0;
    let touchStartOffset = 0;
    let pinchStartDist = 0;
    let pinchStartCount = 0;

    canvasEl.addEventListener(
      'touchstart',
      function (e) {
        if (e.touches.length === 1) {
          touchStartX = e.touches[0].clientX;
          touchStartOffset = self.viewports[assetName] || 0;
        } else if (e.touches.length === 2) {
          // 双指缩放开始
          const dx = e.touches[0].clientX - e.touches[1].clientX;
          const dy = e.touches[0].clientY - e.touches[1].clientY;
          pinchStartDist = Math.sqrt(dx * dx + dy * dy);
          pinchStartCount = self.visibleCounts[assetName] || self.DEFAULT_VISIBLE_COUNT;
        }
        // 同时保留原有的tooltip交互
        if (e.touches.length === 1) {
          const touch = e.touches[0];
          const rect = canvasEl.getBoundingClientRect();
          const x = touch.clientX - rect.left;
          const y = touch.clientY - rect.top;
          chartInstance._eventHandler({ type: 'mousemove', x: x, y: y, native: e });
        }
      },
      { passive: true }
    );

    canvasEl.addEventListener(
      'touchmove',
      function (e) {
        if (e.touches.length === 1) {
          // 单指拖动平移
          const dx = e.touches[0].clientX - touchStartX;
          const barWidth = getBarPixelWidth();
          if (barWidth <= 0) return;
          const barShift = Math.round(dx / barWidth);
          const cached = self.chartDataCache[assetName];
          if (!cached) return;
          const totalCount = cached.allBodyData.length;
          let newOffset = touchStartOffset + barShift;
          newOffset = Math.max(0, Math.min(totalCount - self.MIN_VISIBLE_COUNT, newOffset));
          if (newOffset !== self.viewports[assetName]) {
            self.viewports[assetName] = newOffset;
            self.refreshViewport(assetName);
          }
        } else if (e.touches.length === 2) {
          // 双指缩放
          const dx = e.touches[0].clientX - e.touches[1].clientX;
          const dy = e.touches[0].clientY - e.touches[1].clientY;
          const currentDist = Math.sqrt(dx * dx + dy * dy);
          if (pinchStartDist > 0) {
            const scale = pinchStartDist / currentDist;
            let newCount = Math.round(pinchStartCount * scale);
            newCount = Math.max(self.MIN_VISIBLE_COUNT, Math.min(self.MAX_VISIBLE_COUNT, newCount));
            if (newCount !== self.visibleCounts[assetName]) {
              self.visibleCounts[assetName] = newCount;
              self.refreshViewport(assetName);
            }
          }
        }
        // 同时保留原有的tooltip交互
        if (e.touches.length === 1) {
          const touch = e.touches[0];
          const rect = canvasEl.getBoundingClientRect();
          const x = touch.clientX - rect.left;
          const y = touch.clientY - rect.top;
          chartInstance._eventHandler({ type: 'mousemove', x: x, y: y, native: e });
        }
      },
      { passive: true }
    );

    canvasEl.addEventListener(
      'touchend',
      function () {
        // 松开时隐藏tooltip
        const el = document.getElementById('chartjs-tooltip');
        if (el) el.style.opacity = '0';
        chartInstance._eventHandler({ type: 'mouseout', x: 0, y: 0, native: null });
      },
      { passive: true }
    );

    // 设置初始光标
    canvasEl.style.cursor = 'grab';
  },
};
