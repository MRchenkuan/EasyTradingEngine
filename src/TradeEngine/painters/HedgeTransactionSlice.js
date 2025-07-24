import { ChartJSNodeCanvas } from 'chartjs-node-canvas';
import { LocalVariable } from '../../LocalVariable.js';
import { createCollisionAvoidance } from '../../paint.js';
import { getClosingTransaction, getGridTradeOrders, getLastTransactions, getOpeningTransaction } from '../../recordTools.js';
import { formatTimestamp, shortDcm } from '../../tools.js';
import { GridTradingProcessor } from '../processors/GridTradingProcessor.js';
import { TradeEngine } from '../TradeEngine.js';
import path from 'path';
import { AbstractPainter } from './AbstractPainter.js';

export class HedgeTransactionSlice extends AbstractPainter {
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

  /**
   * 绘制指示器
   * @param {*} chart Chart对象
   * @param {number} y 拐点的Y轴坐标
   * @private
   */
  _drawIndicator(chart, ts, price, label, direction = 0, style = 'style1') {
    const ctx = chart.ctx;
    const yAxias = chart.scales.y;
    const xAxias = chart.scales.x;
    const y = yAxias.getPixelForValue(price);
    const x = xAxias.getPixelForValue(formatTimestamp(ts, TradeEngine._bar_type));
    // 保存当前上下文状态
    ctx.save();

    // 设置指示器样式
    ctx.beginPath();
    ctx.strokeStyle = '#8b32a8';
    ctx.lineWidth = 0.5;

    if (style === 'style2') {
      ctx.setLineDash([5, 5]);
      ctx.strokeStyle = 'red';
    }

    // 在图表右侧绘制指示线
    ctx.moveTo(x, y);
    ctx.lineTo(chart.chartArea.right + 40, y);
    if (direction === 0) {
      ctx.lineTo(chart.chartArea.right + 40 + 5, y - 10 * direction);
    } else {
      ctx.lineTo(chart.chartArea.right + 40 + 10, y - 10 * direction);
    }
    ctx.stroke();

    // 显示拐点数值
    const value = chart.scales.y.getValueForPixel(y);
    ctx.font = `12px ${this.font_style}`;
    ctx.fillStyle = '#8b32a8';
    ctx.textAlign = 'right';
    if (style === 'style2') {
      ctx.fillStyle = 'red';
    }
    // 测试文字宽度
    const textWidth = ctx.measureText(`${label}(${shortDcm(value, 2)})`).width;
    ctx.fillText(
      `${label}(${shortDcm(value, 2)})`,
      chart.chartArea.right + 40 + 10 + textWidth,
      y - direction * 10
    );
    // 恢复上下文状态
    ctx.restore();
  }

  draw() {
    // 绘制每次开仓的截图
    const opening_transactions = [...getLastTransactions(100, 'opening')];
    opening_transactions.map(({ tradeId, closed }) => {
      // if(!closed){
      this._paintTransactionSlice(tradeId);
      // }
    });
  }

  /**
   * 绘制每一笔交易的切片
   * @param {*} tradeId
   */
  static _paintTransactionSlice(tradeId) {
    const styles = this.constructor.styles;
    const open_transaction = getOpeningTransaction(tradeId);
    const close_transaction = getClosingTransaction(tradeId);
    const klines = Object.values(TradeEngine.getAllMarketData());
    const labels = TradeEngine.getMainAssetLabels();

    const orders_open = open_transaction.orders;
    const orders_close = close_transaction ? close_transaction.orders : [];

    const orders = [...orders_open, ...orders_close];

    const isClosed = open_transaction.closed && close_transaction;
    const slug = orders_open
      .sort((a, b) => a.instId.localeCompare(b.instId))
      .map(o => o.instId.split('-')[0].toLowerCase())
      .join('-');
    const file_path = `hedges/${slug}/${isClosed ? 'closed/' : ''}${tradeId}.jpg`;
    if (isClosed && this.engine.existChartFile(file_path)) {
      // 已关闭的不重复绘制
      if (this.engine.existChartFile(`hedges/${slug}/${tradeId}.jpg`)) {
        this.engine.deleteChartFile(`hedges/${slug}/${tradeId}.jpg`);
      }
      return;
    }

    const order_map = {};
    const beta_map = {};
    orders_open.forEach(({ beta, instId, avgPx, accFillSz, sz, ts }) => {
      order_map[instId] = { beta, instId, avgPx, accFillSz, sz, ts };
      beta_map[instId] = beta;
    });

    const scaled_prices = klines
      .filter(({ id }) => orders.find(it => it.instId === id))
      .map(({ id, prices, ts }) => {
        const [a, b] = beta_map[id];
        const beta = p => a * p + b;
        return {
          color: this.engine.getThemes()[id],
          prices: prices.map(it => beta(it)),
          id,
        };
      });

    if (!scaled_prices.length) return;

    // 计算差值并添加注释
    const configuration = {
      // type: 'scatter',
      type: 'line',
      data: {
        labels,
        datasets: scaled_prices.map((it, id) => {
          return {
            label: it.id,
            data: it.prices,
            borderColor: it.color,
            pointBackgroundColor: it.color,
            ...styles,
          };
        }),
      },
      options: {
        responsive: true, // 确保响应式布局
        maintainAspectRatio: false, // 允许自定义宽高比例
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { labels: { color: 'black' } },
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
            top: 140,
            bottom: 60,
            left: 60,
            right: 60,
          },
        },
      },
      plugins: [
        {
          afterDraw: chart => {
            // 绘制零基准线
            const baseValue = scaled_prices[0].prices[0];
            this.engine._drawHorizontalLine(chart, baseValue);

            // 为了避免标签重叠先搞个位置收集器
            const collisionAvoidance = createCollisionAvoidance();

            // 绘制实时利润空间表格
            this.engine._drawProfitTable(chart);

            // 开平仓信息绘制
            const transactions = [open_transaction, close_transaction].filter(it => it);
            this.engine._drawTransactions(chart, transactions, beta_map, collisionAvoidance, true);

            // 绘制实时距离
            this.engine._drawRealtimeDistance(chart, tradeId, collisionAvoidance);

            // 绘制信息表格
            this.engine._drawInfoTable(chart);

            this.engine._drawRhoTable(chart);

            this.engine._drawDateTime(chart);

            // 绘制历史订单信息
            const asset_names = transactions.flatMap(it => it.orders.map(o => o.instId));
            this.engine._paintOrders(chart, asset_names, beta_map, collisionAvoidance);
          },
        },
      ],
    };

    this.flush(file_path, configuration);
  }
}
