import { ChartJSNodeCanvas } from 'chartjs-node-canvas';
import { LocalVariable } from '../../LocalVariable.js';
import { createCollisionAvoidance } from '../../paint.js';
import { getGridTradeOrders } from '../../recordTools.js';
import { formatTimestamp, getFormattedTimeString, shortDcm } from '../../tools.js';
import { GridTradingProcessor } from '../processors/GridTradingProcessor.js';
import { TradeEngine } from '../TradeEngine.js';
import path from 'path';
import { AbstractPainter } from './AbstractPainter.js';

export class GridTradingSlice extends AbstractPainter {
  static width = 3840;
  static height = 2160;
  static vol_erea_height = 0.15;
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

  static graph_position = {
    top: 100,
    bottom: 120,
    left: 60,
    right: 360,
  };

  static chip_distribution_compare_with = 60 * 60 * 24 * 7 * 1000;

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
    ctx.lineWidth = 1;

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
    ctx.font = `22px ${this.font_style}`;
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

    const findDistribution = (data, ts) => {
      if (data.length === 0) return null;

      let minDiff = Infinity;
      let closestElement = null;

      for (let i = 0; i < data.length; i++) {
        const diff = Math.abs(data[i].ts - ts);

        // 遇到完全匹配时提前退出
        if (diff === 0) return data[i];

        if (diff < minDiff) {
          minDiff = diff;
          closestElement = data[i];
        }
      }
      return closestElement;
    };

    assets.forEach(instId => {
      const group_orders = groupedOrders[instId];
      const color = engine.getThemes()[instId] || '#666666';

      const { prices, id, ts } = TradeEngine.getMarketData(instId) || {};
      const candle_data = (TradeEngine.getCandleData(instId) || [])
        .map(it => [
          parseFloat(it.open),
          parseFloat(it.close),
          parseFloat(it.low),
          parseFloat(it.high),
          parseFloat(it.vol),
        ])
        .slice(-MAX_CANDLE);
      const candle_max_price = candle_data
        .slice(-MAX_CANDLE)
        .reduce((a, b) => Math.max(a, b[3]), -Infinity);
      const candle_min_price = candle_data
        .slice(-MAX_CANDLE)
        .reduce((a, b) => Math.min(a, b[2]), Infinity);
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

      const {
        distribution: chip_distribution,
        min_price: chip_min_price,
        max_price: chip_max_price,
        min_volume,
        max_volume,
        allPeriods,
        turnover,
        volume: period_volume,
        open_interest: market_open_interest,
        step: chip_step,
      } = TradeEngine.getChipDistribution(instId);

      const chip_distribution_before = findDistribution(
        allPeriods,
        Date.now() - this.constructor.chip_distribution_compare_with
      );

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

      const max_vol = candle_data.slice(-MAX_CANDLE).reduce((acc, cur) => Math.max(acc, cur[4]), 0);

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
              data: candle_data,
              backgroundColor: ctx => {
                // 根据涨跌动态设置颜色（阳线绿色，阴线红色）
                const [open, close, low, hight] = ctx.dataset.data[ctx.dataIndex];
                return close < open ? '#52be80' : '#ec7063';
              },
              borderWidth: 0,
              barThickness: 3, // 默认宽度
            },
            // 高点
            {
              ...styles,
              type: 'bar',
              data: candle_data.map(it => [Math.max(it[0], it[1]), it[3], it[0], it[1]]),
              borderWidth: 0,
              backgroundColor: ctx => {
                // 根据涨跌动态设置颜色（阳线绿色，阴线红色）
                const [start, end, open, close] = ctx.dataset.data[ctx.dataIndex];
                return close < open ? '#52be80' : '#ec7063';
                // return '#aeaeae';
              },
              barThickness: 1,
            },
            // 低点
            {
              ...styles,
              type: 'bar',
              data: candle_data.map(it => [Math.min(it[0], it[1]), it[2], it[0], it[1]]),
              borderWidth: 0,
              backgroundColor: ctx => {
                // 根据涨跌动态设置颜色（阳线绿色，阴线红色）
                const [start, end, open, close] = ctx.dataset.data[ctx.dataIndex];
                return close < open ? '#52be80' : '#ec7063';
                // return '#aeaeae';
              },
              barThickness: 1,
            },
            // 换手率
            {
              ...styles_2,
              type: 'line',
              data: allPeriods.slice(-MAX_CANDLE).map(it => ({
                x: formatTimestamp(it.ts, TradeEngine._bar_type),
                y: (it.turnover - it.min_turnover) / (it.max_turnover - it.min_turnover),
              })),
              borderWidth: 1,
              borderColor: '#3498DB',
              yAxisID: 'turnover',
            },
            // 成交量
            {
              ...styles,
              type: 'bar',
              data: candle_data.map(it => [
                0,
                (it[4] / max_vol) * this.constructor.vol_erea_height,
                it[0],
                it[1],
              ]),
              borderWidth: 0,
              backgroundColor: ctx => {
                // 根据涨跌动态设置颜色（阳线绿色，阴线红色）
                const [start, end, open, close] = ctx.dataset.data[ctx.dataIndex];
                return close < open ? '#52be80' : '#ec7063';
                // return '#aeaeae';
              },
              barThickness: 3,
              yAxisID: 'vol',
            },
            // 筹码分布
            {
              ...styles,
              type: 'bar',
              indexAxis: 'y', // 关键！仅此数据集横向显示
              data: chip_distribution.map(it => {
                return {
                  x: it.volume / max_volume, // X轴（横向长度）
                  y: it.price, // Y轴（价格位置）
                };
              }),
              borderWidth: 0,
              backgroundColor: ctx => {
                // 根据涨跌动态设置颜色（阳线绿色，阴线红色）
                const { y } = ctx.dataset.data[ctx.dataIndex];
                return y > current_price ? '#52be80' : '#ec7063';
              },
              barThickness: 1,
              yAxisID: 'chipY', // 关联分类轴
              xAxisID: 'chipX',
            },
            // 筹码分布- prev-period
            {
              ...styles,
              type: 'bar',
              indexAxis: 'y', // 关键！仅此数据集横向显示
              data: chip_distribution_before.distribution.map(it => {
                return {
                  x: it.volume / max_volume, // X轴（横向长度）
                  y: it.price, // Y轴（价格位置）
                };
              }),
              borderWidth: 0,
              backgroundColor: ctx => {
                // 根据涨跌动态设置颜色（阳线绿色，阴线红色）
                // const { y } = ctx.dataset.data[ctx.dataIndex];
                return '#85C1E9';
                // return '#85929E';
              },
              barThickness: 1,
              yAxisID: 'chipY', // 关联分类轴
              xAxisID: 'chipX',
            },
            // 绘制布林线
            {
              ...styles_2,
              type: 'line',
              data: boll.upperArray.slice(-MAX_CANDLE),
            },
            {
              ...styles_2,
              type: 'line',
              data: boll.lowerArray.slice(-MAX_CANDLE),
            },
            {
              ...styles_2,
              type: 'line',
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
              min: candle_min_price * 0.98,
              max: candle_max_price * 1.02,
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
            vol: {
              position: 'right',
              suggestedMin: 0,
              suggestedMax: 1,
              display: false,
            },

            chipY: {
              // 分类轴（实际是价格轴）
              type: 'linear',
              position: 'left', // 显示在右侧
              min: candle_min_price * 0.98,
              max: candle_max_price * 1.02,
              ticks: {
                stepSize: chip_step * 10,
              },
              grid: { display: false, drawOnChartArea: false }, // 仅显示主轴网格线
            },
            chipX: {
              // 数值轴（成交量比例）
              type: 'linear',
              position: 'top', // 显示在顶部
              min: 0,
              max: 10,
              display: false, // 可隐藏刻度
            },
            turnover: {
              position: 'right',
              suggestedMin: 0,
              suggestedMax: 10,
              display: false,
            },
          },
          layout: {
            padding: {
              top: 100,
              bottom: 120,
              left: 60,
              right: 360,
            },
          },
          plugins: {
            title: {
              display: true,
              text: `${instId} @ ${getFormattedTimeString()}`,
              align: 'start',
              color: color,
              font: {
                size: 60,
                // weight: 'bold',
                lineHeight: 1.2,
              },
              padding: { top: 20, left: 0, right: 0, bottom: 40 },
            },
            legend: false,
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

              this.drawText(
                chart,
                `换手率: ${(turnover * 100).toFixed(4)}% (${parseFloat(period_volume).toFixed(0)} 量/${parseFloat(market_open_interest).toFixed(0)} 持仓)`,
                chart.chartArea.right,
                chart.chartArea.top,
                color,
              );

              const {notionalUsd, pos, mgnRatio} = TradeEngine.getPositionList(instId)
              this.drawText(
                chart,
                `持仓：${(Math.sign(pos) * notionalUsd).toFixed(2)} USD（${pos} 张） 维持保证金：${(Math.round(mgnRatio*100))}%`,
                chart.chartArea.right,
                chart.chartArea.top + 40,
                color
              );
              
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

  drawText(chart, text, x, y, color = '#52be80') {
    chart.ctx.save();
    chart.ctx.font = '36px "Fira Sans"';
    chart.ctx.fillStyle = color;
    chart.ctx.textAlign = 'right';
    chart.ctx.textBaseline = 'top';
    chart.ctx.fillText(text, x, y);
    chart.ctx.restore();
  }
}
