import { ChartJSNodeCanvas } from 'chartjs-node-canvas'
import fs from 'fs';
import { blendColors, formatTimestamp, getTsOfStartOfToday } from './tools.js';
import { calculateCorrelationMatrix } from './mathmatic.js';
import { getClosingTransaction, getLastTransactions, getOpeningTransaction } from './recordTools.js';

const width = 2200, height = 800;
const chartJSNodeCanvas = new ChartJSNodeCanvas({ width, height, backgroundColour:'#fff' });
const font_style = "Monaco, Menlo, Consolas, monospace";

const styles = {
  borderWidth: 1,
  fill: false,  // 不填充颜色
  pointRadius: 0.5, // 设置点的大小
  tension: 0.2  // 设置曲线平滑度 (0 为折线)
}

export function paint(assetIds, scaled_prices, themes, labels, gate, klines, beta_map, bar_type){  
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
          top: 140,
          bottom: 60,
          left: 60,
          right:60
        }
      },
    },
    plugins:[{
      afterDraw: function(chart) {
        const ctx = chart.ctx;
        // 为了避免标签重叠先搞个位置收集器
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
          return [beta_map[assetId][0].toFixed(6), price, rate]
        })
        // 信息表格绘制
        drawInfoTable(ctx, info_data, assetIds, ['β(对冲比)','价格','涨跌幅'], themes);

        // // 交易信号绘制
        const profit = {};
        for (let i = 0; i < scaled_prices.length - 1; i++) {
          for (let j = i + 1; j < scaled_prices.length; j++) {
            profit[`${assetIds[i]}:${assetIds[j]}`] = paintTradingSignal(chart, scaled_prices[i], scaled_prices[j], gate, klines, collisionAvoidance);
          }
        }

        // 绘制实时利润空间表格
        drawProfitTable(chart, assetIds, themes, profit);

        // ctx.fillText(`${graph.key}: ${(diff_rate*100).toFixed(2)}%`, width*0.8, 20+20*graph.index);
        // 开平仓信息绘制
        const transactions = [...getLastTransactions(100, 'opening'),...getLastTransactions(100, 'closing')]
        paintTransactions(transactions, chart, beta_map, bar_type, labels, collisionAvoidance);

        // 实时利润绘制
        paintProfit(profit, labels, assetIds, themes);
      }
    }]
  };

  (async () => {
    const image = await chartJSNodeCanvas.renderToBuffer(configuration);
    fs.writeFileSync('./chart/candle_chart.jpg', image);
  })();
}


function drawProfitTable(chart, assetIds, themes, data) {
  const ctx= chart.ctx;
  const headers = assetIds;
  data = assetIds.map(astId1=>{
    return assetIds.map(astId2=>{
      const series = data[`${astId1}:${astId2}`]||data[`${astId2}:${astId1}`]
      if(series){
        return series.slice(-1) || 0;
      } else {
        return 0
      }
    })
  })


  const left = width*0.75;
  const top = height*0.01
  const cellWidth = 80; // 单元格宽度
  const cellHeight = 20; // 单元格高度
  const padding = 5; // 单元格内边距
  ctx.fillStyle = '#808b96';
  ctx.font = '14px '+font_style;
  ctx.fillText('利润空间', left+padding, top+cellHeight / 2 + 5);
  // 绘制表头文本
  ctx.fillStyle = 'black';
  ctx.font = '12px '+font_style;
  headers.forEach((header, index) => {
    ctx.fillStyle = themes[index];
    ctx.fillText(simpAssetName(header), (index + 1) * cellWidth + padding+left, top+cellHeight / 2 + 5);
  });

  // 绘制数据单元格
  data.forEach((row, rowIndex) => {
    const yOffset = (rowIndex + 1) * cellHeight;
    
    // 绘制首列文本
    ctx.fillStyle = 'black';
    ctx.font = '12px '+font_style;
    ctx.fillStyle = themes[rowIndex];
    ctx.fillText(simpAssetName(headers[rowIndex]), padding+left, yOffset + top+cellHeight / 2 + 5);

    // 绘制数据单元格内容
    row.forEach((cell, colIndex) => {
      ctx.fillStyle = cell > 0 ? (cell==Math.max(...row)?"red":"green") : '#808b96';
      ctx.fillText((cell*100).toFixed(2)+"%", (colIndex + 1) * cellWidth + padding + left, yOffset + top + cellHeight / 2 + 5);
    });
  });
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
function paintTradingSignal(chart, yData1, yData2, gate, klines, collisionAvoidance){
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
    // if(i===lables.length-1){
    //   ctx.font = '16px '+font_style;
    //   ctx.fillText(`${graph.key}: ${(diff_rate*100).toFixed(2)}%`, width*0.8, 20+20*graph.index);
    // }

    profit.push(diff_rate)

    if(!gate)continue;
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
      const v = (diff_rate*100).toFixed(2)+"%";
      const start = [x, y1, klines[0].prices[i].toFixed(2)+`/${v}`];
      const end = [x, y2, klines[1].prices[i].toFixed(2)+`/${v}`];
      ;y1<y2
      ? paintLine(ctx, start, end, '#607d8b', collisionAvoidance)
      : paintLine(ctx, end, start, '#607d8b', collisionAvoidance)
    } catch(e){
      console.warn(e);
      console.log('klines.prices',klines[0].prices)
      console.log('klines.prices',klines[1].prices)
      console.log('klines[0].prices[i]',klines[0].prices.slice()[i])
      console.log('i',i)
    }
  }
  return profit;
}

function paintTransactions(transaction, chart, betaMap, bar_type, labels, collisionAvoidance) {
  const ctx = chart.ctx;
  const xScale = chart.scales.x;
  const yScale = chart.scales.y;

  const OPEN_COLOR = 'red';
  const CLOSE_COLOR = 'green';
  const SIDE_SYMBOL = { buy: "+", sell: '-' };

  transaction.forEach(({ orders, profit, closed, side: transaction_side }) => {
    const [order1, order2] = orders;
    const { ts: ts1, avgPx: px1, instId: instId1, sz: sz1, side: side1, tgtCcy:tgtCcy1 } = order1;
    const { ts: ts2, avgPx: px2, instId: instId2, sz: sz2, side: side2, tgtCcy:tgtCcy2 } = order2;

    //已平仓的不展示
    // if(transaction_side==='opening' && closed) return 

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
    if(xScale && yScale){}else{return};
    let x1 = xScale.getPixelForValue(formatTimestamp(ts1, bar_type));
    let x2 = xScale.getPixelForValue(formatTimestamp(ts2, bar_type));
    
    // 计算标准化价格
    const spx1 = px1 * betaMap[instId1][0];
    const spx2 = px2 * betaMap[instId2][0];
    
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

    // 生成标签文本
    const rateTag = `${(diffRate * 100).toFixed(2)}%`;
    profit = profit || 0;
    const profit_text = (profit >=0 ? "+":"-") + `${Math.abs(profit.toFixed(2))}`
    const tag = transaction_side === 'opening' 
      ? `${rateTag}/开仓${closed?"(已平)":""}` 
      : `${rateTag}/平仓`;
    const tag2 = `$${profit_text}`;
    const v1 = `(${valueFormatter(sz1, side1, px1, tgtCcy1)})/${px1}`;
    const v2 = `(${valueFormatter(sz2, side2, px2, tgtCcy2)})/${px2}`;

    // 绘制连接线
    ;spx1>spx2
    ? paintLine(ctx, [x1, y1, `${v1}/${tag2}/${tag}`], [x2, y2, v2], color, collisionAvoidance)
    : paintLine(ctx, [x2, y2, `${v2}/${tag2}/${tag}`], [x1, y1, v1], color, collisionAvoidance)

  });
}


function paintLine(ctx,[x1, y1, v1], [x2, y2, v2],color, collisionAvoidance){

  const vertical_offset = 10;

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
  ctx.arc(x1,y1, 2,0, Math.PI*2);
  ctx.arc(x2,y2, 2,0, Math.PI*2);
  ctx.fill();

  // 绘制差值文本
  ctx.fillStyle = color;
  ctx.font = 'bold 12px '+font_style;

  // const {width:w_t} = ctx.measureText(text);
  // const {width:w_v1} = ctx.measureText(v1);


  const v_arr1 = v1.split("/").reverse();
  const v_w_arr1 = v_arr1.map(v=>ctx.measureText(v).width);
  const max_v_w1 = Math.max(...v_w_arr1);

  const v_arr2 = v2.split("/");
  const v_w_arr2 = v_arr2.map(v=>ctx.measureText(v).width);
  const max_v_w2 = Math.max(...v_w_arr2);

  
  // 防止重叠，转换坐标
  ;({x:x1, y:y1} = collisionAvoidance(x1 - max_v_w1 / 2, y1 - 15 - v_arr1.length*15, max_v_w1, v_arr1.length*15));
  ;({x:x2, y:y2} = collisionAvoidance(x2 - max_v_w2 / 2, y2 - 15 + v_arr2.length*15, max_v_w2, v_arr2.length*15));

  // ctx.beginPath();
  // ctx.rect(x1,y1,max_v_w1, v_arr1.length*15)
  // ctx.rect(x2,y2,max_v_w2, v_arr2.length*15)
  // ctx.stroke();

  // 绘制上边沿
  v_arr1.map((v,i)=>{
    ctx.fillText(v, x1 + (max_v_w1 - v_w_arr1[i])/2, y1+i*15 + vertical_offset);
  })  // 绘制下边沿
  v_arr2.map((v,i)=>{
    ctx.fillText(v, x2 + (max_v_w2 - v_w_arr2[i])/2, y2+i*15 + vertical_offset);
  })
  
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
        totalDy += 1.2*dy * force * forceFactor;
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



// 打印切片
export function paintTransactionSlice( tradeId, themes_map, labels, klines, bar_type){ 
  const open_transaction = getOpeningTransaction(tradeId);
  const close_transaction = getClosingTransaction(tradeId);

  const orders_open = open_transaction.orders
  const orders_close = close_transaction ? close_transaction.orders: [];

  const orders = [...orders_open, ...orders_close];

  const order_map = {};
  let assetIds = []
  const beta_map = {};

  ;orders.forEach(({beta,instId,avgPx,accFillSz, sz, ts}, index)=>{
    order_map[instId] = {beta,instId,avgPx,accFillSz, sz, ts}
    assetIds[index] = instId;
    beta_map[instId] = beta
  })

  assetIds = [...new Set(assetIds)];

  const scaled_prices = klines.filter(({id, price, ts})=>orders.find(it=>it.instId === id)).map(({id, prices, ts})=>{
    return {
      prices: prices.map(it=>it*order_map[id].beta[0]),
      id,
      color:themes_map[id]
    }
  })

  // 计算差值并添加注释
  const configuration = {
    // type: 'scatter',
    type:'line',
    data: {
      labels,
      datasets: scaled_prices.map((it,id)=>{
        return {
          label:assetIds[id],
          data: it.prices,
          borderColor: it.color,
          pointBackgroundColor:it.color,
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
          top: 140,
          bottom: 60,
          left: 60,
          right:60
        }
      },
    },
    plugins:[{
      afterDraw: function(chart) {
        const ctx = chart.ctx;
        // 为了避免标签重叠先搞个位置收集器
        const collisionAvoidance = createCollisionAvoidance();

        // // 交易信号绘制
        const profit = {};
        for (let i = 0; i < scaled_prices.length - 1; i++) {
          for (let j = i + 1; j < scaled_prices.length; j++) {
            profit[`${assetIds[i]}:${assetIds[j]}`] = paintTradingSignal(chart, scaled_prices[i].prices, scaled_prices[j].prices, null, klines, collisionAvoidance);
          }
        }

        listenOpenSignal();
        // 计算当前diffrate有没有超
        // 读取所有未平仓的开仓信息
        // 计算同一个品种是否已经有头寸
        // 判断当前的diff是否超过前一个diff的1.5倍
        // 如果没有之前的开仓记录则开仓，如果没有超过1.5则继续等

            // TODO 开仓信号 paintTradingSignal
            // TODO 开仓信号 paintTradingSignal
            // TODO 开仓信号 paintTradingSignal
            // TODO 开仓信号 paintTradingSignal
            // TODO 开仓信号 paintTradingSignal
            // TODO 开仓信号 paintTradingSignal
            // TODO 开仓信号 paintTradingSignal
            // TODO 开仓信号 paintTradingSignal
            // TODO 开仓信号 paintTradingSignal
            // TODO 开仓信号 paintTradingSignal
            // TODO 开仓信号 paintTradingSignal
            // TODO 开仓信号 paintTradingSignal
            // TODO 开仓信号 paintTradingSignal
            // TODO 开仓信号 paintTradingSignal

        // 绘制实时利润空间表格
        drawProfitTable(chart, assetIds, assetIds.map(it=>themes_map[it]), profit);

        // 开平仓信息绘制
        paintTransactions([open_transaction, close_transaction].filter(t=>t), chart, beta_map, bar_type, labels, collisionAvoidance);


        // TODO 平仓信号在此判断
        
      }
    }]
  };

  (async () => {
    const image = await chartJSNodeCanvas.renderToBuffer(configuration);
    fs.writeFileSync(`./chart/slices/candle_chart_${tradeId}.jpg`, image);
  })();
}


/**
 * 根据当前的两个序列算利差
 * @param {*} chart 
 * @param {*} yData1 
 * @param {*} yData2 
 * @param {*} gate 
 * @param {*} klines 
 * @param {*} collisionAvoidance 
 * @returns 
 */
function listenOpenSignal(prices1, prices2, gate){
  return
  let prev_diff_rate = 0;

  const profit = [];
  // 遍历每个数据点，绘制竖线并标注差值
  for (let i = 0; i < prices1.length; i++) {
    const diff_rate = Math.abs((prices2[i] - prices1[i])/Math.min(prices2[i],prices1[i]))
    profit.push(diff_rate)

    if(!gate)continue;
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
  }
  return profit;
}