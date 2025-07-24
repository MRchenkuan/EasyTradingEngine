import { ChartJSNodeCanvas } from 'chartjs-node-canvas';
import { TradeEngine } from '../TradeEngine.js';
import { AbstractPainter } from './AbstractPainter.js';

export class HedgeProfitDistance extends AbstractPainter {
  static chartJSNodeCanvas = new ChartJSNodeCanvas({
    width: 2560,
    height: 1440,
    backgroundColour: '#fff',
  });

  draw() {
    const labels = TradeEngine.getMainAssetLabels();
    let profits = TradeEngine.getAllHistoryProfits();
    const themes_map = this.engine.getThemes();

    // 计算差值并添加注释
    const configuration = {
      // type: 'scatter',
      type: 'line',
      data: {
        labels,
        datasets: Object.keys(profits).map(key => {
          const label = key;
          const [assetId1, assetId2] = label.split(':');
          const color1 = themes_map[assetId1];
          const color2 = themes_map[assetId2];
          const color = blendColors(color1, color2);
          return {
            label: label
              .split(':')
              .map(k => simpAssetName(k))
              .join(':'),
            data: profits[key].map(it => it * 100),
            borderColor: color,
            pointBackgroundColor: color,
            borderWidth: 1,
            fill: false, // 不填充颜色
            pointRadius: 0.5, // 设置点的大小
            tension: 0.3, // 设置曲线平滑度 (0 为折线)
          };
        }),
      },
      options: {
        responsive: true, // 确保响应式布局
        maintainAspectRatio: false, // 允许自定义宽高比例
        plugins: {
          legend: { labels: { color: 'black' } },
        },
        layout: {
          padding: 40,
        },
      },
    };

    this.flush('distance.jpg', configuration);
  }
}
