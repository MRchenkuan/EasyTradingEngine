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
  document.getElementById('assetCount').textContent = Object.keys(assets).length;
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

TradingApp.Time.startTimeUpdater();
TradingApp.WebSocket.connect(
  onIndicatorsUpdate,
  onChartUpdate,
  onTickUpdate,
  TradingApp.Logs.addLog
);
