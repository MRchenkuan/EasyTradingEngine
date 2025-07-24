import { ChartJSNodeCanvas } from 'chartjs-node-canvas';
import { LocalVariable } from '../../LocalVariable.js';
import { createCollisionAvoidance } from '../../paint.js';
import { getGridTradeOrders, getLastTransactions } from '../../recordTools.js';
import { formatTimestamp, shortDcm } from '../../tools.js';
import { GridTradingProcessor } from '../processors/GridTradingProcessor.js';
import { TradeEngine } from '../TradeEngine.js';
import path from 'path';
import { AbstractPainter } from './AbstractPainter.js';

export class MainGraph extends AbstractPainter {
  static width = 2560;
  static height = 1440;
  static chartJSNodeCanvas = new ChartJSNodeCanvas({
    width: this.width,
    height: this.height,
    backgroundColour: '#fff',
  });
  static MAX_CANDLE = 800;
  static styles = {
    borderWidth: 1,
    pointRadius: 0, // 设置点的大小
    tension: 0, // 设置曲线平滑度 (0 为折线)
  };
  static styles_2 = {
    borderWidth: 0.5,
    tension: 0.2, // 设置曲线平滑度 (0 为折线)
    pointRadius: 0, // 设置点的大小
    borderColor: '#f39c12', // 设置边框颜色
    pointBackgroundColor: '#f39c12',
  };

  draw() {
    const styles = this.constructor.styles;

    try {
      const refer_kline = TradeEngine.getMainAsset();
      if (!refer_kline) return;
      const x_label = refer_kline.ts.map(it => formatTimestamp(it, TradeEngine._bar_type));
      const scaled_prices = TradeEngine.getAllScaledPrices();
      const file_path = path.join(`main.jpg`);

      // 计算差值并添加注释
      const configuration = {
        type: 'line', // 改回折线图
        data: {
          labels: x_label,
          datasets: scaled_prices.map((it, id) => {
            return {
              label: this.engine._asset_names[id],
              data: it.prices,
              borderColor: this.engine._asset_themes[id],
              pointBackgroundColor: this.engine._asset_themes[id],
              ...styles,
            };
          }),
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              // position: 'bottom',
              // display: false,
            },
          },
          scales: {
            y: {
              ticks: {
                callback: function (value) {
                  const baseValue = scaled_prices[0].prices[0];
                  return (((value - baseValue) / baseValue) * 100).toFixed(2) + '%';
                },
                stepSize: value => {
                  const baseValue = scaled_prices[0].prices[0];
                  return baseValue * 0.025; // 2.5% 的实际价格变化值
                },
              },
            },
          },
          layout: {
            padding: {
              top: 180,
              bottom: 60,
              left: 60,
              right: 60,
            },
          },
        },
        plugins: [
          {
            afterDraw: async chart => {
              const baseValue = scaled_prices[0].prices[0];

              this.engine._drawHorizontalLine(chart, baseValue);
              const collisionAvoidance = createCollisionAvoidance();

              // 绘制相关性表格
              this.engine._drawRhoTable(chart);

              // 信息表格绘制
              this.engine._drawInfoTable(chart);

              // 绘制实时利润空间表格
              this.engine._drawProfitTable(chart);

              const beta_map = TradeEngine._beta_map;
              if (this.engine._config.show_transactions !== false) {
                // 开平仓信息绘制, 在主图中过滤掉关闭的头寸
                const transactions = [
                  ...getLastTransactions(100, 'opening'),
                  ...getLastTransactions(100, 'closing'),
                ].filter(it => !it.closed);
                this.engine._drawTransactions(chart, transactions, beta_map, collisionAvoidance);
              }

              // 绘制时间
              this.engine._drawDateTime(chart);

              // 绘制历史订单信息
              this.engine._config.show_orders !== false &&
                this.engine._paintOrders(
                  chart,
                  TradeEngine._asset_names,
                  beta_map,
                  collisionAvoidance
                );

              // 绘制各个品种的成本线
              this._addCostLines(chart);
            },
          },
        ],
      };

      this.flush(file_path, configuration);
    } catch (e) {
      console.log(e);
    }
  }


    /**
   * 绘制成本线
   * @private
   */
  _addCostLines(chart) {
    this.engine._show_order_his.forEach(it => {
      const { position, totalCost, avgCost, updateTime, instId } = TradeEngine.getPositionCost(it);
      const themes_map = this.engine.getThemes();
      // 只在有持仓时显示成本线
      if (position !== 0 && avgCost !== 0) {
        const [a, b] = TradeEngine._beta_map[instId] || [1, 0];
        const scaledCost = avgCost * a + b;

        const ctx = chart.ctx;
        const yPixel = chart.scales.y.getPixelForValue(scaledCost);

        // 绘制 0% 参考线
        ctx.beginPath();
        ctx.setLineDash([5, 5]);
        ctx.strokeStyle = themes_map[instId] || '#666666';
        ctx.lineWidth = 1;
        ctx.moveTo(chart.chartArea.left, yPixel);
        ctx.lineTo(chart.chartArea.right, yPixel);
        ctx.stroke();
        ctx.setLineDash([]);

        // 添加成本标签
        ctx.font = `12px ${this.font_style}`;
        ctx.fillStyle = themes_map[instId] || '#666666';
        ctx.textAlign = 'left';
        ctx.fillText(
          `${simpAssetName(instId)} 成本: ${avgCost.toFixed(2)}`,
          chart.chartArea.left + 10,
          yPixel - 5
        );
      }
    });
  }
}
