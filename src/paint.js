import { ChartJSNodeCanvas } from 'chartjs-node-canvas'
import fs from 'fs';
import { formatTimestamp, getTsOfStartOfToday } from './tools.js';
import { calculateCorrelationMatrix } from './mathmatic.js';
import { readLastNKeyValues } from './recordBeta.js';
import { debug } from 'console';

const width = 1800, height = 800;
const chartJSNodeCanvas = new ChartJSNodeCanvas({ width, height, backgroundColour:'#fff' });

const styles = {
  borderWidth: 1,
  fill: false,  // 不填充颜色
  pointRadius: 1, // 设置点的大小
  tension: 0.2  // 设置曲线平滑度 (0 为折线)
}

export function paint(assetIds, scaled_prices, themes, labels, gate, klines, beta_arr){  
  // 计算差值并添加注释
  const configuration = {
    // type: 'scatter',
    type:'line',
    data: {
      labels,
      datasets: scaled_prices.map((it,id)=>{
        return {
          label:assetIds[id],
          data: it,
          borderColor: themes[id],
          pointBackgroundColor:themes[id],
          ...styles
        }
      })
    },
    options: {
      responsive: true, // 确保响应式布局
      maintainAspectRatio: false, // 允许自定义宽高比例
      plugins: {
        legend: { labels: { color: 'black' } }
      },
      layout: {
        padding: {
          top: 120,
          bottom: 60,
          left: 60,
          right:60
        }
      },
    },
    plugins:[{
      afterDraw: function(chart) {
        const ctx = chart.ctx;
        const xScale = chart.scales.x;
        const yScale = chart.scales.y;
        drawTable(ctx, calculateCorrelationMatrix(klines.map(it=>it.prices)), assetIds, themes);
        const info_data = assetIds.map((assetId, i_info)=>{
          // 价格
          const {prices, ts} = klines[i_info];
          const keys = formatTimestamp(getTsOfStartOfToday());
          const index = labels.indexOf(keys);
          const start_price = prices[prices.length - index -1] || prices[prices.length - 1];
          const price= prices[0];
          const rate = (price-start_price)/start_price;
          return [beta_arr[i_info].toFixed(6), price, rate]
        })
        drawInfoTable(ctx, info_data, assetIds, ['β(对冲比)','价格','涨跌幅'], themes);
        let prev_diff_rate = 0;
        ;((yData1, yData2)=>{

          const lables = yData2.map((it,id)=>id);
          const profit = [];
          // 遍历每个数据点，绘制竖线并标注差值
          for (let i = 0; i < lables.length; i++) {
            const x = xScale.getPixelForValue(lables[i]);
            const y1 = yScale.getPixelForValue(yData1[i]);
            const y2 = yScale.getPixelForValue(yData2[i]);
            const diff_rate = Math.abs((yData2[i] - yData1[i])/Math.min(yData2[i],yData1[i]))
            if(i===lables.length-1){
              ctx.font = '22px Arial';
              ctx.fillText(`最新偏差值: ${(diff_rate*100).toFixed(2)}%`, width*0.8, height*0.05 - 5);
            }

            profit.push(diff_rate)

            if(diff_rate < gate){
              prev_diff_rate = diff_rate;
              continue
            }

            if(diff_rate <= prev_diff_rate*1.25){
              prev_diff_rate = diff_rate;
              continue
            }

            prev_diff_rate = diff_rate;

            ctx.setLineDash([5, 3]);
            // 绘制竖线
            ctx.beginPath();
            ctx.moveTo(x, y1);
            ctx.lineTo(x, y2);
            const color = yData1[i]>yData2[i]?'#229954':'#e74c3c'
            ctx.strokeStyle = color;
            ctx.lineWidth = 1;
            ctx.stroke();

            // 绘制差值文本
            ctx.fillStyle = color;
            ctx.font = '12px Arial';
            ctx.fillText((diff_rate*100).toFixed(2)+"%", x + 5, (y1 + y2) / 2);

            if(yData2[i] < yData1[i]){
              ctx.fillText(klines[0].prices.slice().reverse()[i].toFixed(2), x -10, Math.min(y1, y2)-20);
              ctx.fillText(klines[1].prices.slice().reverse()[i].toFixed(2), x -10, Math.max(y1, y2)+20);
            } else {
              ctx.fillText(klines[0].prices.slice().reverse()[i].toFixed(2), x -10, Math.max(y1, y2)+20);
              ctx.fillText(klines[1].prices.slice().reverse()[i].toFixed(2), x -10, Math.min(y1, y2)-20);
            }
            
            // 重置虚线样式（恢复为实线）
            ctx.setLineDash([]);
          }

          paintProfit(profit,labels);
          paintBetaValue();
        })(scaled_prices[0], scaled_prices[1]);
      }
    }]
  };

  (async () => {
    const image = await chartJSNodeCanvas.renderToBuffer(configuration);
    fs.writeFileSync('./chart/candle_chart.jpg', image);
  })();
}


function paintProfit (profit,labels){
  // 计算差值并添加注释
  const configuration = {
    // type: 'scatter',
    type:'line',
    data: {
        labels,
        datasets: [{
          label: '套利空间',
          data: profit.map(it=>it*100),
          borderColor: '#ad85e9',
          pointBackgroundColor:'#ad85e9',
          borderWidth: 1.2,
          fill: false,  // 不填充颜色
          pointRadius: 1.2, // 设置点的大小
          tension: 0.2  // 设置曲线平滑度 (0 为折线)
        }
      ]
    },
    options: {
      responsive: true, // 确保响应式布局
      maintainAspectRatio: false, // 允许自定义宽高比例
      plugins: {
        legend: { labels: { color: 'black' } }
      },
      layout: {
        padding: 40
      },
    },
  };

  (async () => {
    const image = await chartJSNodeCanvas.renderToBuffer(configuration);
    fs.writeFileSync('./chart/distance.jpg', image);
  })();
}

// 打印实时对冲比例
function paintBetaValue (profit,labels){
  const data = readLastNKeyValues(1000);
  // 计算差值并添加注释
  const configuration = {
    // type: 'scatter',
    type:'line',
    data: {
        labels:Object.keys(data),
        datasets: [{
          label: 'β值',
          data: Object.values(data),
          borderColor: '#ad85e9',
          pointBackgroundColor:'#ad85e9',
          borderWidth: 1.2,
          fill: false,  // 不填充颜色
          pointRadius: 1.2, // 设置点的大小
          tension: 0.2  // 设置曲线平滑度 (0 为折线)
        }
      ]
    },
    options: {
      responsive: true, // 确保响应式布局
      maintainAspectRatio: false, // 允许自定义宽高比例
      plugins: {
        legend: { labels: { color: 'black' } }
      },
      layout: {
        padding: 40
      },
    },
  };

  (async () => {
    const image = await chartJSNodeCanvas.renderToBuffer(configuration);
    fs.writeFileSync('./chart/β.jpg', image);
  })();
}



function drawTable(ctx, data, headers, themes) {
  const left = width*0.01;
  const top = height*0.01
  const cellWidth = 80; // 单元格宽度
  const cellHeight = 20; // 单元格高度
  const padding = 5; // 单元格内边距
  ctx.fillStyle = '#808b96';
  ctx.font = '18px Arial';
  ctx.fillText('-- ρ --', left+padding, top+cellHeight / 2 + 5);
  // 绘制表头文本
  ctx.fillStyle = 'black';
  ctx.font = '12px Arial';
  headers.forEach((header, index) => {
    ctx.fillStyle = themes[index];
    ctx.fillText(header, (index + 1) * cellWidth + padding+left, top+cellHeight / 2 + 5);
  });

  // 绘制数据单元格
  data.forEach((row, rowIndex) => {
    const yOffset = (rowIndex + 1) * cellHeight;
    
    // 绘制首列文本
    ctx.fillStyle = 'black';
    ctx.font = '12px Arial';
    ctx.fillStyle = themes[rowIndex];
    ctx.fillText(headers[rowIndex], padding+left, yOffset + top+cellHeight / 2 + 5);

    // 绘制数据单元格内容
    row.forEach((cell, colIndex) => {
      ctx.fillStyle = '#808b96';
      ctx.fillText(cell, (colIndex + 1) * cellWidth + padding + left, yOffset + top + cellHeight / 2 + 5);
    });
  });
}


function drawInfoTable(ctx, data, first_col, headers, themes) {
  const left = width*0.25;
  const top = height*0.01;
  const cellWidth = 90; // 单元格宽度
  const cellHeight = 20; // 单元格高度
  const padding = 5; // 单元格内边距
  ctx.fillStyle = '#808b96';
  ctx.font = '12px Arial';
  // 绘制表头文本
  headers.forEach((header, index) => {
    ctx.fillText(header, (index + 1) * cellWidth + padding+left, top+cellHeight / 2 + 5);
  });
  
  // 绘制数据单元格
  data.forEach((row, rowIndex) => {
    const yOffset = (rowIndex + 1) * cellHeight;
    
    // 绘制首列文本
    ctx.font = '12px Arial';
    ctx.fillStyle = themes[rowIndex];
    ctx.fillText(first_col[rowIndex], padding+left, yOffset + top+cellHeight / 2 + 5);
    // 绘制数据单元格内容
    row.forEach((cell, colIndex) => {      
      if(colIndex == row.length - 1){
        ctx.fillStyle = cell>0?'#229954':cell===0?'#212f3c':'#e74c3c';
        cell = `${(100*cell).toFixed(2)}%`;
      } else {
        ctx.fillStyle = themes[rowIndex];
      }
      ctx.fillText(cell, (colIndex + 1) * cellWidth + padding + left, yOffset + top + cellHeight / 2 + 5);
    });
  });
}


// 打印拟合权重
export function paintRegressionWeight (weights){
  // 计算差值并添加注释
  const configuration = {
    // type: 'scatter',
    type:'line',
    data: {
        labels:weights.map((it,id)=>id),
        datasets: [{
          label: '拟合权重',
          data: weights.slice().reverse(),
          borderColor: '#ad85e9',
          pointBackgroundColor:'#ad85e9',
          borderWidth: 1.2,
          fill: false,  // 不填充颜色
          pointRadius: 1.2, // 设置点的大小
          tension: 0.2  // 设置曲线平滑度 (0 为折线)
        }
      ]
    },
    options: {
      responsive: true, // 确保响应式布局
      maintainAspectRatio: false, // 允许自定义宽高比例
      plugins: {
        legend: { labels: { color: 'black' } }
      },
      layout: {
        padding: 40
      },
    },
  };

  (async () => {
    const image = await chartJSNodeCanvas.renderToBuffer(configuration);
    fs.writeFileSync('./chart/weights.jpg', image);
  })();
}
