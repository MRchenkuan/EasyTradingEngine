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

function onAssetsUpdate(newAssets) {
  assets = newAssets;
  renderAssets();
  document.getElementById('assetCount').textContent = Object.keys(assets).length;
}

TradingApp.Time.startTimeUpdater();
TradingApp.WebSocket.connect(onAssetsUpdate, TradingApp.Logs.addLog);
