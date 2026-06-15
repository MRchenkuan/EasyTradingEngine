window.TradingApp = window.TradingApp || {};
window.TradingApp.ChartPlugins = {
  createCandlestickPlugin: function (self, assetName, chartData, latestPrice, gridLines) {
    return {
      id: 'candlestick',
      afterDraw: function (chart) {
        const ctx = chart.ctx;
        const xScale = chart.scales.x;
        const yScale = chart.scales.y;
        const cached = self.chartDataCache[assetName];
        if (!cached) return;

        // 绘制长按模式的十字竖线
        const chartArea = chart.chartArea;
        const longPressIdx = self.longPressIndex?.[assetName];
        if (longPressIdx !== undefined && longPressIdx !== null) {
          const xPixel = xScale.getPixelForValue(longPressIdx);
          if (xPixel >= chartArea.left && xPixel <= chartArea.right) {
            ctx.save();
            ctx.beginPath();
            ctx.setLineDash([4, 4]);
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
            ctx.lineWidth = 1;
            ctx.moveTo(xPixel, chartArea.top);
            ctx.lineTo(xPixel, chartArea.bottom);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.restore();
          }
        }

        const visibleBodyData = cached.bodyData;
        const visibleLabels = cached.labels;
        const { start: viewStart, end: viewEnd } = self.getVisibleRange(assetName);
        const visibleBuyPoints = cached.allBuyPoints.slice(viewStart, viewEnd);
        const visibleSellPoints = cached.allSellPoints.slice(viewStart, viewEnd);

        // 在图表内部绘制 y 轴刻度
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
          gridLines.forEach(gridPrice => {
            const y = yScale.getPixelForValue(gridPrice);
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
        const position = chartData.position;
        const gridParams = chartData.gridParams;
        if (position && position.avgPx && position.bePx) {
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
          const notionalUsd = Math.abs(parseFloat(position.notionalUsd));
          const posContracts = Math.abs(parseFloat(position.pos));
          const gridWidth = parseFloat(gridParams?.grid_width) || 0;
          const baseAmount = parseFloat(gridParams?.base_amount) || 30;
          const lastTradePrice = parseFloat(gridParams?.last_trade_price);
          const gridBasePrice = parseFloat(gridParams?.grid_base_price);
          if (notionalUsd > 0 && gridWidth > 0 && baseAmount > 0 && posContracts > 0) {
            const basePrice = lastTradePrice || gridBasePrice || avgPx;
            const gridSpan = notionalUsd / baseAmount;
            const totalSpan = gridSpan * gridWidth;
            const closePrice = basePrice * (1 + posSign * totalSpan);
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

          // 绘制强平线（来自 OKX API liqPx）
          const liqPx = parseFloat(position.liqPx) || 0;
          if (liqPx > 0) {
            const liqY = yScale.getPixelForValue(liqPx);
            if (liqY >= chartArea.top && liqY <= chartArea.bottom) {
              drawPriceLine(liqPx, '#12b942', '强平', posSign > 0 ? 10 : -10);
            } else {
              const edgeY = liqY < chartArea.top ? chartArea.top + 4 : chartArea.bottom - 4;
              ctx.font = '10px Arial';
              ctx.textAlign = 'right';
              ctx.textBaseline = liqY < chartArea.top ? 'top' : 'bottom';
              ctx.fillStyle = '#12b942';
              ctx.fillText(
                `强平 ${self.formatPrice(liqPx)} ${liqY < chartArea.top ? '↑' : '↓'}`,
                chartArea.right - 4,
                edgeY
              );
            }
          }
        }

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
            const labelY = y + 60;

            ctx.beginPath();
            ctx.setLineDash([3, 3]);
            ctx.strokeStyle = '#ec7063';
            ctx.lineWidth = 1;
            ctx.moveTo(x, y);
            ctx.lineTo(x, labelY);
            ctx.stroke();
            ctx.setLineDash([]);

            const boxSize = 10;
            const boxX = x - boxSize / 2;
            const boxY = labelY - boxSize / 2;
            ctx.fillStyle = '#ec7063';
            roundRect(boxX, boxY, boxSize, boxSize, 2);
            ctx.fill();

            ctx.fillStyle = '#ffffff';
            ctx.fillText('B', x, labelY);
          }
        });

        // 卖出点 - 显示 S（在上方）
        visibleSellPoints.forEach((price, index) => {
          if (price !== null) {
            const x = xScale.getPixelForValue(index);
            const y = yScale.getPixelForValue(price);
            const labelY = y - 60;

            ctx.beginPath();
            ctx.setLineDash([3, 3]);
            ctx.strokeStyle = '#52be80';
            ctx.lineWidth = 1;
            ctx.moveTo(x, y);
            ctx.lineTo(x, labelY);
            ctx.stroke();
            ctx.setLineDash([]);

            const boxSize = 10;
            const boxX = x - boxSize / 2;
            const boxY = labelY - boxSize / 2;
            ctx.fillStyle = '#52be80';
            roundRect(boxX, boxY, boxSize, boxSize, 2);
            ctx.fill();

            ctx.fillStyle = '#ffffff';
            ctx.fillText('S', x, labelY);
          }
        });
      },
    };
  },
};
