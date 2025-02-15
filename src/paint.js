import { ChartJSNodeCanvas } from 'chartjs-node-canvas'
import fs from 'fs';
import { formatTimestamp, getTsOfStartOfToday } from './tools.js';

const width = 1800, height = 800;
const chartJSNodeCanvas = new ChartJSNodeCanvas({ width, height, backgroundColour:'#fff' });

const styles = {
  borderWidth: 1,
  fill: false,  // 不填充颜色
  pointRadius: 1, // 设置点的大小
  tension: 0.2  // 设置曲线平滑度 (0 为折线)
}

export function paint(assetIds, scaled_prices, themes, labels, gate, klines){
  
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
        padding: 60
      },
    },
    plugins:[{
      afterDraw: function(chart) {
        const ctx = chart.ctx;
        const xScale = chart.scales.x;
        const yScale = chart.scales.y;

        let prev_diff_rate = 0;
        ;((yData1, yData2)=>{
          klines.map((it, id)=>{
            const {prices, ts} = it;
            const keys = formatTimestamp(getTsOfStartOfToday());
            const index = labels.indexOf(keys);
            const start_price = prices[prices.length - index -1] || prices[prices.length - 1];
            console.log(keys, start_price)
            const price= prices[0],color=themes[id],assetId = assetIds[id];
            ctx.font = '16px Arial';
            ctx.fillStyle = color;
            ctx.fillText(`[${assetId}]: ${price}(${(100*(price-start_price)/start_price).toFixed(2)}%)`, width*0.8, height*0.15+(id+1)*20);
          })

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
              ctx.fillText(`最新偏差值: ${(diff_rate*100).toFixed(2)}%`, width*0.8, height*0.15 - 5);
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
            const color = yData1[i]>yData2[i]?'green':'red'
            ctx.strokeStyle = color;
            ctx.lineWidth = 1;
            ctx.stroke();

            // 绘制差值文本
            ctx.fillStyle = color;
            ctx.font = '12px Arial';
            ctx.fillText((diff_rate*100).toFixed(2)+"%", x + 5, (y1 + y2) / 2);
            ctx.fillText(Math.max(yData2[i], yData1[i]).toFixed(2), x -10, Math.min(y1, y2)-20);
            ctx.fillText(Math.min(yData2[i], yData1[i]).toFixed(2), x -10, Math.max(y1, y2)+20);
            // 重置虚线样式（恢复为实线）
            ctx.setLineDash([]); 
          }

          paintProfit(profit,labels);
        })(scaled_prices[0], scaled_prices[1]);
      }
    }]
  };

  (async () => {
    const image = await chartJSNodeCanvas.renderToBuffer(configuration);
    fs.writeFileSync('./chart/candle_chart.jpg', image);
    console.log('图片已生成: candle_chart.jpg');
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
          label: '背离距离',
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
        padding: 60
      },
    },
  };

  (async () => {
    const image = await chartJSNodeCanvas.renderToBuffer(configuration);
    fs.writeFileSync('./chart/distance.jpg', image);
    console.log('图片已生成: distance.jpg');
  })();
}