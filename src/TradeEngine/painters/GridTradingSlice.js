import { ChartJSNodeCanvas } from 'chartjs-node-canvas';
import { LocalVariable } from '../../LocalVariable.js';
import { createCollisionAvoidance } from '../../paint.js';
import { getGridTradeOrders } from '../../recordTools.js';
import { formatTimestamp, shortDcm } from '../../tools.js';
import { GridTradingProcessor } from '../processors/GridTradingProcessor.js';
import { TradeEngine } from '../TradeEngine.js';
import path from 'path';
import { AbstractPainter } from './AbstractPainter.js';

export class GridTradingSlice extends AbstractPainter {
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
    const width = this.constructor.width;
    const height = this.constructor.height;
    const engine = this.engine;
    const MAX_CANDLE = this.constructor.MAX_CANDLE;
    const styles = this.constructor.styles;
    const styles_2 = this.constructor.styles_2;

    let orders = [];
    const assets = engine._asset_names;
    assets.forEach(instId => (orders = orders.concat(getGridTradeOrders(instId))));
    // .filter(order => order.order_status === 'confirmed');
    // 先对order按照instId进行分组
    const groupedOrders = orders.reduce((acc, orderGroup) => {
      const instId = orderGroup.instId; // 使用第一个订单的instId作为key
      if (!acc[instId]) {
        acc[instId] = [];
      }
      acc[instId].push(orderGroup); // 保持订单组的完整性
      return acc;
    }, {});

    assets.forEach(instId => {
      const group_orders = groupedOrders[instId];
      const color = engine.getThemes()[instId] || '#666666';

      const { prices, id, ts } = TradeEngine.getMarketData(instId) || {};
      const candle_data = (TradeEngine.getCandleData(instId) || []).map(it => [
        parseFloat(it.open),
        parseFloat(it.close),
        parseFloat(it.low),
        parseFloat(it.high),
      ]);
      const {
        _grid_base_price,
        _grid_base_price_ts,
        last_lower_turning_price_ts,
        last_lower_turning_price,
        last_upper_turning_price_ts,
        last_upper_turning_price,
        current_price,
        current_price_ts,
        last_trade_price,
        last_trade_price_ts,
        tendency,
        direction,
        _max_price,
        _min_price,
        _grid_width,
        _threshold,
      } = new LocalVariable(`GridTradingProcessor/${instId}`) || {};

      if (!(_grid_base_price && _min_price && _max_price && _grid_width)) return;
      const grid_lines = GridTradingProcessor._initPriceGrid(
        _grid_base_price,
        _min_price,
        _max_price,
        _grid_width
      );

      const labels = ts.map(it => formatTimestamp(it, TradeEngine._bar_type));
      const file_path = path.join('grid', `/${instId}.jpg`);

      const boll = engine.getBOLL(instId);

      // 计算差值并添加注释
      const configuration = {
        // type: 'scatter',
        type: 'line',
        data: {
          labels: labels.slice(-MAX_CANDLE),
          datasets: [
            // 低到高
            {
              ...styles,
              type: 'bar',
              label: instId,
              data: candle_data.slice(-MAX_CANDLE),
              backgroundColor: ctx => {
                // 根据涨跌动态设置颜色（阳线绿色，阴线红色）
                const [open, close, low, hight] = ctx.dataset.data[ctx.dataIndex];
                return close < open ? '#52be80' : '#ec7063';
              },
              borderWidth: 0,
              barThickness: 1.5, // 默认宽度
            },
            // 高点
            {
              ...styles,
              type: 'bar',
              label: instId,
              data: candle_data
                .map(it => [Math.max(it[0], it[1]), it[3], it[0], it[1]])
                .slice(-MAX_CANDLE),
              borderWidth: 0,
              backgroundColor: ctx => {
                // 根据涨跌动态设置颜色（阳线绿色，阴线红色）
                const [start, end, open, close] = ctx.dataset.data[ctx.dataIndex];
                return close < open ? '#52be80' : '#ec7063';
                // return '#aeaeae';
              },
              barThickness: 0.5,
            },
            // 低点
            {
              ...styles,
              type: 'bar',
              label: instId,
              data: candle_data
                .map(it => [Math.min(it[0], it[1]), it[2], it[0], it[1]])
                .slice(-MAX_CANDLE),
              borderWidth: 0,
              backgroundColor: ctx => {
                // 根据涨跌动态设置颜色（阳线绿色，阴线红色）
                const [start, end, open, close] = ctx.dataset.data[ctx.dataIndex];
                return close < open ? '#52be80' : '#ec7063';
                // return '#aeaeae';
              },
              barThickness: 0.5,
            },
            // 绘制布林线
            {
              ...styles_2,
              type: 'line',
              label: 'BOLL',
              data: boll.upperArray.slice(-MAX_CANDLE),
            },
            {
              ...styles_2,
              type: 'line',
              label: 'BOLL',
              data: boll.lowerArray.slice(-MAX_CANDLE),
            },
            {
              ...styles_2,
              type: 'line',
              label: 'BOLL',
              data: boll.middleArray.slice(-MAX_CANDLE),
            },
          ],
        },
        options: {
          responsive: true, // 确保响应式布局
          maintainAspectRatio: false, // 允许自定义宽高比例
          plugins: {
            legend: {
              display: false,
              labels: { color: 'black' },
            },
          },
          scales: {
            y: {
              // type: 'logarithmic',
              beginAtZero: false,
              ticks: {
                callback: function (value) {
                  const baseValue = prices[0];
                  return (((value - baseValue) / baseValue) * 100).toFixed(2) + '%';
                },
                stepSize: value => {
                  const baseValue = prices[0];
                  return baseValue * 0.025; // 2.5% 的实际价格变化值
                },
              },
            },
            x: {
              stacked: true,
            },
          },
          layout: {
            padding: {
              top: 140,
              bottom: 60,
              left: 60,
              right: 200,
            },
          },
        },
        plugins: [
          {
            afterDraw: chart => {
              const yAxias = chart.scales.y;
              const xAxias = chart.scales.x;
              // 绘制转折点 - 下
              if (last_lower_turning_price) {
                this._drawIndicator(
                  chart,
                  last_lower_turning_price_ts,
                  last_lower_turning_price,
                  '下拐点',
                  -1
                );
              }
              // 绘制转折点 - 上
              if (last_upper_turning_price) {
                this._drawIndicator(
                  chart,
                  last_upper_turning_price_ts,
                  last_upper_turning_price,
                  '上拐点',
                  1
                );
              }
              // 绘制基准点
              if (_grid_base_price) {
                this._drawIndicator(chart, chart.chartArea.right, _grid_base_price, '基准点');
              }
              // 绘制最近成交点
              if (last_trade_price) {
                this._drawIndicator(chart, last_trade_price_ts, last_trade_price, '最近成交点');
              }

              // 绘制当前价格
              if (current_price) {
                this._drawIndicator(chart, current_price_ts, current_price, '当前价格');
              }

              // 绘制回撤位置
              if (_threshold) {
                if (tendency > 0) {
                  this._drawIndicator(
                    chart,
                    current_price_ts,
                    last_upper_turning_price * (1 - _threshold),
                    `回踩点：${(_threshold * 100).toFixed(2)}%`,
                    0,
                    'style2'
                  );
                } else if (tendency < 0) {
                  this._drawIndicator(
                    chart,
                    current_price_ts,
                    last_lower_turning_price * (1 + _threshold),
                    `回踩点：${(_threshold * 100).toFixed(2)}%`,
                    0,
                    'style2'
                  );
                }
              }

              const current_point_y = yAxias.getPixelForValue(current_price);
              const current_point_x = xAxias.getPixelForValue(
                formatTimestamp(current_price_ts, TradeEngine._bar_type)
              );
              // 绘制趋势箭头
              engine._drawTrendArrow(
                chart,
                current_point_x + 20,
                current_point_y,
                tendency,
                'bold'
              );
              engine._drawTrendArrow(
                chart,
                current_point_x + 20,
                current_point_y,
                direction,
                'thin'
              );

              // 绘制零基准线
              const baseValue = prices[0];
              // 绘制起点基线
              engine._drawHorizontalLine(chart, baseValue);

              // 为了避免标签重叠先搞个位置收集器
              const collisionAvoidance = createCollisionAvoidance();

              // 绘制信息表格
              engine._drawInfoTable(chart, width * 0.01, height * 0.01);

              engine._drawDateTime(chart);

              // 绘制交易信息
              TradeEngine.processors
                .find(it => it.type === 'GridTradingProcessor' && it.asset_name === instId)
                ?.display(chart);

              // 绘制历史订单信息
              if (group_orders && group_orders.length)
                group_orders.forEach(order => {
                  const { ts, avgPx, accFillSz, side, grid_count, order_status, target_price } =
                    order;
                  const time = formatTimestamp(ts, TradeEngine._bar_type);
                  // 超出时间范围的订单不绘制
                  const labels = chart.data.labels;
                  if (!labels.includes(time)) {
                    return; // 跳过超出范围的订单
                  }
                  const price = parseFloat(avgPx);
                  const xCoord = chart.scales.x.getPixelForValue(time);
                  const yCoord = chart.scales.y.getPixelForValue(price);

                  let ghost = null;
                  if (target_price) {
                    const ghost_price = parseFloat(target_price);
                    const ghost_yCoord = chart.scales.y.getPixelForValue(ghost_price);
                    const ghost_label = `${shortDcm(ghost_price, 3)}`;
                    ghost = {
                      y: ghost_yCoord,
                      label: ghost_label,
                    };
                  }

                  // 绘制订单标签
                  const label = `${side === 'buy' ? '[B]' : '[S]'} ${shortDcm(accFillSz, 4)} 份/(${shortDcm(price, 3)})/${-grid_count} 倍/[${order_status}]`;

                  engine._paintSingleOrder(
                    chart.ctx,
                    xCoord,
                    yCoord,
                    label,
                    side,
                    collisionAvoidance,
                    ghost
                  );
                });

              // 绘制网格线
              grid_lines.forEach((grid, index) => {
                // 绘制网格线，但不能超过图表区域
                const yCoord = yAxias.getPixelForValue(grid);
                if (yCoord >= chart.chartArea.top && yCoord <= chart.chartArea.bottom) {
                  // 绘制网格线
                  engine._drawHorizontalLine(chart, grid, [2, 5]);
                }
              });
            },
          },
        ],
      };
      this.flush(file_path, configuration);
    });
  }
}
