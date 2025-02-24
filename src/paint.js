import { ChartJSNodeCanvas } from 'chartjs-node-canvas'
import fs from 'fs';
import { blendColors, formatTimestamp, getTsOfStartOfToday } from './tools.js';
import { calculateCorrelationMatrix } from './mathmatic.js';
import { getLastTransactions, readLastNBeta } from './recordTools.js';

const width = 2200, height = 800;
const chartJSNodeCanvas = new ChartJSNodeCanvas({ width, height, backgroundColour:'#fff' });
const font_style = "Monaco, Menlo, Consolas, monospace";

const styles = {
  borderWidth: 1,
  fill: false,  // 不填充颜色
  pointRadius: 1, // 设置点的大小
  tension: 0.2  // 设置曲线平滑度 (0 为折线)
}

export function paint(assetIds, scaled_prices, themes, labels, gate, klines, beta_arr, bar_type){  
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
        const collisionAvoidance = createCollisionAvoidance();

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
        // 信息表格绘制
        drawInfoTable(ctx, info_data, assetIds, ['β(对冲比)','价格','涨跌幅'], themes);
        const s = simpAssetName;
        // 交易信号绘制
        const profit = {};
        let k=0
        for (let i = 0; i < scaled_prices.length - 1; i++) {
          for (let j = i + 1; j < scaled_prices.length; j++) {
            profit[`${assetIds[i]}:${assetIds[j]}`] = paintTradingSignal(chart, scaled_prices[i], scaled_prices[j], gate, klines, {
              key: `${s(assetIds[i])}:${s(assetIds[j])}`,
              index: k++,
            }, collisionAvoidance);
          }
        }

        // 开平仓信息绘制
        const beta_map = {};
        assetIds.map((assid, index) => beta_map[assid] = beta_arr[index]);
        // 为了避免标签重叠先搞个位置收集器
        paintTransactions(chart, beta_map, bar_type, labels, collisionAvoidance);

        // 实时利润绘制
        paintProfit(profit, labels, assetIds, themes);

        // beta值绘制
        paintBetaValue();
      }
    }]
  };

  (async () => {
    const image = await chartJSNodeCanvas.renderToBuffer(configuration);
    fs.writeFileSync('./chart/candle_chart.jpg', image);
  })();
}


/**
 * 打印开平仓信号
 * @param {*} chart 
 * @param {*} yData1 
 * @param {*} yData2 
 * @param {*} gate 
 * @param {*} klines 
 * @param {*} graph 
 * @returns 
 */
function paintTradingSignal(chart, yData1, yData2, gate, klines, graph, collisionAvoidance){
  const ctx = chart.ctx;
  const xScale = chart.scales.x;
  const yScale = chart.scales.y;

  let prev_diff_rate = 0;

  const lables = yData2.map((it,id)=>id);
  const profit = [];
  // 遍历每个数据点，绘制竖线并标注差值
  for (let i = 0; i < lables.length; i++) {
    const x = xScale.getPixelForValue(lables[i]);
    const y1 = yScale.getPixelForValue(yData1[i]);
    const y2 = yScale.getPixelForValue(yData2[i]);
    const diff_rate = Math.abs((yData2[i] - yData1[i])/Math.min(yData2[i],yData1[i]))
    if(i===lables.length-1){
      ctx.font = '16px '+font_style;
      ctx.fillText(`${graph.key}: ${(diff_rate*100).toFixed(2)}%`, width*0.8, 20+20*graph.index);
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
    try{   
      const start = [x, y1, klines[0].prices.slice().reverse()[i].toFixed(2)];
      const end = [x, y2, klines[1].prices.slice().reverse()[i].toFixed(2)];
      const v = (diff_rate*100).toFixed(2)+"%";
      y1<y2
      ? paintLine(ctx, start, end, v, null,'#607d8b', collisionAvoidance)
      : paintLine(ctx, end, start, v, null,'#607d8b', collisionAvoidance)
    } catch(e){
      console.warn(e);
      console.log('klines.prices',klines[0].prices)
      console.log('klines.prices',klines[1].prices)
      console.log('klines[0].prices.slice().reverse()[i]',klines[0].prices.slice().reverse()[i])
      console.log('i',i)
    }
  }
  return profit;
}

function paintTransactions(chart, betaMap, bar_type, labels, collisionAvoidance) {
  const ctx = chart.ctx;
  const xScale = chart.scales.x;
  const yScale = chart.scales.y;

  const OPEN_COLOR = 'red';
  const CLOSE_COLOR = 'green';
  const SIDE_SYMBOL = { buy: "+", sell: '-' };

  // 通用处理函数
  const processTransaction = (transaction, type) => {
    
    transaction.forEach(({ orders, profit, closed, side: transaction_side }) => {
      const [order1, order2] = orders;
      const { ts: ts1, avgPx: px1, instId: instId1, sz: sz1, side: side1, tgtCcy:tgtCcy1 } = order1;
      const { ts: ts2, avgPx: px2, instId: instId2, sz: sz2, side: side2, tgtCcy:tgtCcy2 } = order2;

      //已平仓的不展示
      if(type==='opening' && closed) return 

      let color = {
        'opening':OPEN_COLOR,
        'closing':CLOSE_COLOR,
      }[transaction_side];
      
      if(closed){
        color = "#ff000090"
      }

      // 转换时间戳和计算坐标
      const label_1 = formatTimestamp(ts1, bar_type);
      const label_2 = formatTimestamp(ts2, bar_type);
      if(!labels.includes(label_1) || !labels.includes(label_2)){
        console.warn('开平仓记号已经超出图标的绘制范围',label_1,label_2)
        return;
      }
      let x1 = xScale.getPixelForValue(formatTimestamp(ts1, bar_type));
      let x2 = xScale.getPixelForValue(formatTimestamp(ts2, bar_type));
      
      // 计算标准化价格
      const spx1 = px1 * betaMap[instId1];
      const spx2 = px2 * betaMap[instId2];
      
      // 获取Y轴坐标
      let y1 = yScale.getPixelForValue(spx1);
      let y2 = yScale.getPixelForValue(spx2);

      // 计算价差比率
      const diffRate = Math.abs((spx2 - spx1) / Math.min(spx2, spx1));
      
      // 将价格单位都转为USDT
      const format2USDT = (sz, price,tgtCcy) => {
        if(tgtCcy==='base_ccy') return (sz * price).toFixed(2);
        if(tgtCcy==='quote_ccy') return sz;
        throw("未知货币单位: ",tgtCcy)
      }

      // 生成标签内容
      const valueFormatter = (sz, side, price, tgtCcy) => `${SIDE_SYMBOL[side]}${(format2USDT(sz, price, tgtCcy))}`;

      const v1 = `(${valueFormatter(sz1, side1, px1, tgtCcy1)})/${px1}`;
      const v2 = `(${valueFormatter(sz2, side2, px2, tgtCcy2)})/${px2}`;

      // 生成标签文本
      const rateTag = `${(diffRate * 100).toFixed(2)}%`;
      profit = profit || 0;
      const profit_text = (profit >=0 ? "+":"-") + `${Math.abs(profit.toFixed(2))}`
      const tag = type === 'opening' 
        ? `${rateTag} 开仓${closed?"(已平)":""}` 
        : `${rateTag} 平仓`;
      const tag2 = type === 'opening' ? `${profit_text}$`:`${profit_text}$`
      
      // 绘制连接线
      ;spx1>spx2
      ? paintLine(ctx, [x1, y1, v1], [x2, y2, v2], tag, tag2, color, collisionAvoidance)
      : paintLine(ctx, [x2, y2, v2], [x1, y1, v1], tag, tag2, color, collisionAvoidance)

    });
  };

  // 处理开仓和平仓交易
  processTransaction(getLastTransactions(100, 'opening'), 'opening', OPEN_COLOR);
  processTransaction(getLastTransactions(100, 'closing'), 'closing', CLOSE_COLOR);
}


function paintLine(ctx,[x1, y1, v1], [x2, y2, v2], text, text2, color, collisionAvoidance){
  ctx.setLineDash([5, 3]);
  // 绘制竖线
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = color;
  ctx.stroke();

  // 绘制圆点
  ctx.beginPath();
  ctx.fillStyle = color;
  ctx.arc(x1,y1, 3,0, Math.PI*2);
  ctx.arc(x2,y2, 3,0, Math.PI*2);
  ctx.fill();

  // 绘制差值文本
  ctx.fillStyle = color;
  ctx.font = 'bold 12px '+font_style;

  const {width:w_t} = ctx.measureText(text);
  const {width:w_v1} = ctx.measureText(v1);
  const {width:w_v2} = ctx.measureText(v2);

  // 防止重叠，转换坐标
  ;({x:x1, y:y1} = collisionAvoidance(x1 - w_v1 / 2, y1 - 20, w_v1, 40));
  ;({x:x2, y:y2} = collisionAvoidance(x2 - w_v2 / 2, y2 + 20, w_v2, 10));

  // 绘制标签
  if(text2) {
    const w_t2 = ctx.measureText(text2).width
    ctx.fillText(`${text2}`, x1+(w_v1-w_t2)/2,  Math.min(y1, y2) - 24)
  }
  ctx.fillText(`${text}`, x1+(w_v1-w_t)/2,  Math.min(y1, y2) - 12);
  // 绘制上边沿
  ctx.fillText(v1, x1, y1);
  // 绘制下边沿
  ctx.fillText(v2, x2, y2);
  // 重置虚线样式（恢复为实线）
  ctx.setLineDash([]);
}

function paintProfit (profits,labels, assetIds, themes){
  // 计算差值并添加注释
  const configuration = {
    // type: 'scatter',
    type:'line',
    data: {
        labels,
        datasets: Object.values(profits).map((profit,id)=>{
          const label = Object.keys(profits)[id];
          const [assetId1,assetId2] = label.split(':');
          const color1 = themes[assetIds.indexOf(assetId1)];
          const color2 = themes[assetIds.indexOf(assetId2)];
          const color = blendColors(color1,color2);
          return {
            label: Object.keys(profits)[id],
            data: profit.map(it=>it*100),
            borderColor: color,
            pointBackgroundColor:color,
            borderWidth: 1.2,
            fill: false,  // 不填充颜色
            pointRadius: 1.2, // 设置点的大小
            tension: 0.2  // 设置曲线平滑度 (0 为折线)
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
function paintBetaValue (){
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
  ctx.font = '18px '+font_style;
  ctx.fillText('-- ρ --', left+padding, top+cellHeight / 2 + 5);
  // 绘制表头文本
  ctx.fillStyle = 'black';
  ctx.font = '12px '+font_style;
  headers.forEach((header, index) => {
    ctx.fillStyle = themes[index];
    ctx.fillText(header, (index + 1) * cellWidth + padding+left, top+cellHeight / 2 + 5);
  });

  // 绘制数据单元格
  data.forEach((row, rowIndex) => {
    const yOffset = (rowIndex + 1) * cellHeight;
    
    // 绘制首列文本
    ctx.fillStyle = 'black';
    ctx.font = '12px '+font_style;
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
  ctx.font = '12px '+font_style;
  // 绘制表头文本
  headers.forEach((header, index) => {
    ctx.fillText(header, (index + 1) * cellWidth + padding+left, top+cellHeight / 2 + 5);
  });
  
  // 绘制数据单元格
  data.forEach((row, rowIndex) => {
    const yOffset = (rowIndex + 1) * cellHeight;
    
    // 绘制首列文本
    ctx.font = '12px '+font_style;
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

function simpAssetName(name){
  return name.split('-')[0]
}



function createCollisionAvoidance() {
  const placed = []; // 存储已放置的标签信息

  // 检测两个矩形是否重叠
  function checkOverlap(rect1, rect2) {
    return (
      rect1.x < rect2.x + rect2.w &&
      rect1.x + rect1.w > rect2.x &&
      rect1.y < rect2.y + rect2.h &&
      rect1.y + rect1.h > rect2.y
    );
  }

  // 计算排斥力方向
  function calculateForce(current, target) {
    const dx = current.x + current.w/2 - (target.x + target.w/2);
    const dy = current.y + current.h/2 - (target.y + target.h/2);
    const distance = Math.sqrt(dx*dx + dy*dy) || 1; // 避免除零
    return { dx: dx/distance, dy: dy/distance };
  }

  return (x, y, w, h) => {
    let current = { x, y, w, h };
    const maxIterations = 100;    // 最大迭代次数
    const forceFactor = 0.2;      // 力反馈系数
    let iterations = 0;

    while (iterations++ < maxIterations) {
      let totalDx = 0;
      let totalDy = 0;
      let hasCollision = false;

      // 检查与所有已放置标签的碰撞
      for (const placedLabel of placed) {
        if (!checkOverlap(current, placedLabel)) continue;

        hasCollision = true;
        // 计算重叠区域
        const overlapX = Math.min(current.x + w, placedLabel.x + placedLabel.w) 
                       - Math.max(current.x, placedLabel.x);
        const overlapY = Math.min(current.y + h, placedLabel.y + placedLabel.h)
                       - Math.max(current.y, placedLabel.y);
        
        // 计算排斥力方向
        const { dx, dy } = calculateForce(current, placedLabel);
        
        // 根据重叠量计算力度
        const force = Math.sqrt(overlapX * overlapX + overlapY * overlapY);
        totalDx += dx * force * forceFactor;
        totalDy += dy * force * forceFactor;
      }

      // 无碰撞时退出循环
      if (!hasCollision) break;

      // 应用力反馈调整位置
      current.x += totalDx;
      current.y += totalDy;
    }

    // 记录最终位置
    placed.push({ ...current });
    return { x: current.x, y: current.y };
  };
}