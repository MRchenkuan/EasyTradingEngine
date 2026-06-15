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

    cachedData.allBodyData[lastIndex].c = currentPrice;

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

    if (tick.candle) {
      cachedData.allBodyData[lastIndex].c = tick.candle.close;
      cachedData.allBodyData[lastIndex].h = tick.candle.high;
      cachedData.allBodyData[lastIndex].l = tick.candle.low;
      cachedData.allCandleData[lastIndex] = tick.candle;
      if (tick.candle.vol != null) {
        cachedData.allVolData[lastIndex] =
          tick.candle.vol * ((tick.candle.open + tick.candle.close) / 2);
      }
    }

    if (tick.boll) {
      if (tick.boll.upper != null) cachedData.allBollUpper[lastIndex] = tick.boll.upper;
      if (tick.boll.middle != null) cachedData.allBollMiddle[lastIndex] = tick.boll.middle;
      if (tick.boll.lower != null) cachedData.allBollLower[lastIndex] = tick.boll.lower;
    }

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

    const prices = visibleCandleData.flatMap(d => [d.high, d.low]);
    const priceMin = Math.min(...prices);
    const priceMax = Math.max(...prices);
    const priceRange = priceMax - priceMin;
    const padding = priceRange * 0.15;

    chart.data.labels = visibleLabels;
    chart.data.datasets[0].data = visibleCandleData.map(d => d.close);
    chart.data.datasets[1].data = visibleBollUpper;
    chart.data.datasets[2].data = visibleBollMiddle;
    chart.data.datasets[3].data = visibleBollLower;
    chart.data.datasets[4].data = visibleBuyPoints;
    chart.data.datasets[5].data = visibleSellPoints;
    chart.options.scales.y.min = priceMin - padding;
    chart.options.scales.y.max = priceMax + padding;

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
    const allVolData = allCandleData.map(d => (d.vol || 0) * ((d.open + d.close) / 2));
    const orders = chartData.orders || [];
    const gridLines = chartData.gridParams?.grid || [];

    // 构建买卖点数据
    const allBuyPoints = new Array(allCandleData.length).fill(null);
    const allSellPoints = new Array(allCandleData.length).fill(null);
    const orderInfoMap = {};

    if (orders && orders.length > 0) {
      orders.forEach(order => {
        const orderTs = parseInt(order.ts);
        if (isNaN(orderTs)) return;
        const orderTsMinute = Math.round(orderTs / 60000) * 60000;

        if (
          orderTsMinute < allCandleData[0].ts ||
          orderTsMinute > allCandleData[allCandleData.length - 1].ts + 60000
        )
          return;

        let orderIndex = allCandleData.findIndex(d => Math.abs(d.ts - orderTsMinute) <= 60000);

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

    // 初始化视口偏移
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

    const latestPrice = allBodyData.length > 0 ? allBodyData[allBodyData.length - 1].c : 0;

    this.charts[assetName] = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [
          {
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
            enabled: false,
            external: TradingApp.ChartTooltip.createExternalHandler(self, assetName),
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
        TradingApp.ChartPlugins.createCandlestickPlugin(
          self,
          assetName,
          chartData,
          latestPrice,
          gridLines
        ),
      ],
    });

    // 设置交互（拖拽、缩放、长按）
    TradingApp.ChartInteraction.setupInteractions(self, assetName, this.charts[assetName], canvas);
  },
};
