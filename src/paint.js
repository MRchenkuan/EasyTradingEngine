import { ChartJSNodeCanvas } from 'chartjs-node-canvas'
import fs from 'fs';
import { formatTimestamp, getTsOfStartOfToday } from './tools.js';
import { calculateCorrelationMatrix } from './mathmatic.js';
import { getLastTransactions, readLastNBeta } from './recordTools.js';

const width = 2200, height = 800;
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
              ctx.fillText(`最新偏差值: ${(diff_rate*100).toFixed(2)}%`, width*0.85, 20);
            }

            profit.push(diff_rate)

            // 交易信号生成
            if(diff_rate < gate){
              //没有达到门限
              if(prev_diff_rate){
                // 有前次门限
                if(diff_rate<=0.005){
                  // 如果当前距离足够小，则认为已经收敛，重置门限，重新开仓
                  prev_diff_rate=0;
                }
              }
              continue
            } else {
              // 达到门限
              if(prev_diff_rate){
                // 再次达到门限，超上次 n 倍
                if(diff_rate > prev_diff_rate*1.5){
                  prev_diff_rate = diff_rate;
                }else{
                  // 没超则过
                  continue                  
                }
              }else{
                // 首次达到门限
                prev_diff_rate = diff_rate
              }
            }
            prev_diff_rate = diff_rate
            
            const start = [x, Math.min(y1, y2), klines[0].prices.slice().reverse()[i].toFixed(2)];
            const end = [x, Math.max(y1, y2), klines[1].prices.slice().reverse()[i].toFixed(2)];
            paintLine(ctx, start, end, (diff_rate*100).toFixed(2)+"%", yData1[i]>yData2[i]?'green':'red')
          }

          const beta_map = {};
          assetIds.map((assid, index) => beta_map[assid] = beta_arr[index]);
          paintTransactions(ctx, xScale, yScale, beta_map);
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


function paintTransactions(ctx, xScale, yScale, beta_map){
  // 读取所有的开仓信息,并打印
  const opening = getLastTransactions(100, 'opening');
  const closing = getLastTransactions(100, 'closing');

  const side_symbol = {
    'buy': "+",
    'sell': '-'
  }

  // 读取所有开仓信息并打印
  opening.map(({orders})=>{
    const {ts:ts1, avgPx:px1, instId: instId1, sz:sz1, side: side1} = orders[0]
    const {ts:ts2, avgPx:px2, instId: instId2, sz:sz2, side: side2} = orders[1]

    const ts_label_1 = formatTimestamp(ts1);
    const ts_label_2 = formatTimestamp(ts2);

    // const index = labels.indexOf(keys);

    const x1 = xScale.getPixelForValue(ts_label_1);
    const x2 = xScale.getPixelForValue(ts_label_2);

    const beta1 = beta_map[instId1]
    const beta2 = beta_map[instId2]

    const spx1 = px1*beta1;
    const spx2 = px2*beta2;

    const y1 = yScale.getPixelForValue(spx1);
    const y2 = yScale.getPixelForValue(spx2);
    const diff_rate = Math.abs((spx2 - spx1)/Math.min(spx2, spx1));
    
    const v1 = `(${side_symbol[side1]}${sz1})/${px1}`;
    const v2 = `(${side_symbol[side2]}${sz2})/${px2}`;
    const tag = `${(diff_rate*100).toFixed(2)}%`
    paintLine(ctx,[x1,y1,v1], [x2,y2,v2], tag,'#b03a2e',1)
  })

  // 读取所有平仓信息并打印
  closing.map(({ orders, profit })=>{
    const {ts:ts1, avgPx:px1, instId: instId1, sz:sz1, side: side1} = orders[0]
    const {ts:ts2, avgPx:px2, instId: instId2, sz:sz2, side: side2} = orders[1]

    const ts_label_1 = formatTimestamp(ts1);
    const ts_label_2 = formatTimestamp(ts2);

    const x1 = xScale.getPixelForValue(ts_label_1);
    const x2 = xScale.getPixelForValue(ts_label_2);

    const beta1 = beta_map[instId1]
    const beta2 = beta_map[instId2]

    const spx1 = px1*beta1;
    const spx2 = px2*beta2;

    const y1 = yScale.getPixelForValue(spx1);
    const y2 = yScale.getPixelForValue(spx2);
    const diff_rate = Math.abs((spx2 - spx1)/Math.min(spx2, spx1));

    const v1 = `(${side_symbol[side1]}${(sz1*px1).toFixed(2)})/${px1}`;
    const v2 = `(${side_symbol[side2]}${(sz2*px2).toFixed(2)})/${px2}`;
    const tag = `(${profit.toFixed(2)})${(diff_rate*100).toFixed(2)}%`

    paintLine(ctx,[x1,y1,v1], [x2,y2,v2], tag,'#2874a6')

  })

}

function paintLine(ctx,[x1, y1, v1], [x2, y2, v2], text, color, side){
  ctx.setLineDash([5, 3]);
  // 绘制竖线
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.lineWidth = 1;
  ctx.strokeStyle = color;
  ctx.stroke();

  const offset = (x)=> side?x+20:x

  // 绘制差值文本
  ctx.fillStyle = color;
  ctx.font = '12px Arial';

  const {width:w_t} = ctx.measureText(text);
  const {width:w_v1} = ctx.measureText(v1);
  const {width:w_v2} = ctx.measureText(v2);

  ctx.fillText(`${text}`, (x1+x2) / 2 - w_t/2, Math.min(y1,y2) - 35);
  // 绘制上边沿
  ctx.fillText(v1, (x1+x2) / 2 - w_v1/2, y1 - 20);
  // 绘制下边沿
  ctx.fillText(v2, (x1+x2) / 2 - w_v2/2, y2 + 20);
  // 重置虚线样式（恢复为实线）
  ctx.setLineDash([]);
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
  const data = readLastNBeta(1000);
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
