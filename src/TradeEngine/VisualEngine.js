import { ChartJSNodeCanvas } from 'chartjs-node-canvas'
import fs from 'fs';
import { blendColors, createMapFrom, formatTimestamp, hashString } from '../tools.js';
import { calculateCorrelationMatrix } from '../mathmatic.js';
import { getClosingTransaction, getLastTransactions, getOpeningTransaction } from '../recordTools.js';
import { createCollisionAvoidance, paintLine, simpAssetName } from '../paint.js';
import { TradeEngine } from './TradeEngine.js';
import path from 'path';

const width = 1600, height = 900;
const chartJSNodeCanvas = new ChartJSNodeCanvas({ width, height, backgroundColour:'#fff' });
const font_style = "Monaco, Menlo, Consolas, monospace";

const styles = {
  borderWidth: 1,
  fill: false,  // 不填充颜色
  pointRadius: 0.5, // 设置点的大小
  tension: 0.1  // 设置曲线平滑度 (0 为折线)
}

export class VisualEngine{

  static charts = [];
  static _timer = {};
  static _asset_themes = []
  static _asset_names = []
  static _show_order_his = []


  chart_id = hashString(`${Date.now()}${Math.random()}`)

  static createChart(...args){
    this.charts.push(new this(...args))
  }

  constructor(){

  }

    /**
   * 设置引擎基本信息
   * @param {*} param0 
   */
    static setMetaInfo({
      assets,
      show_order_his
    }){
      if(show_order_his) this._show_order_his = show_order_his;
      if(assets){
        this._asset_names = assets.map(it=>it.id);
        this._asset_themes = assets.map(it=>it.theme);
      }
      return this;
      // dosmt
    }

  static getThemes(){
    return createMapFrom(this._asset_names, this._asset_themes);
  }
  
  static start(){
    const status = TradeEngine.checkEngine();
    if(status == 2){
      this.drawMainGraph();
      this.drawTransctionSlices();
    }
    clearTimeout(this._timer.start);
    this._timer.start = setTimeout(()=>{
      this.start();
    }, 1000)
  }

  static stop(){
    clearTimeout(this._timer.start)
  }
  
  /**
   * 单独绘制每个头寸的分片
   */
  static drawTransctionSlices(){
    // 绘制每次开仓的截图
    const opening_transactions = [...getLastTransactions(100,'opening')];
    opening_transactions.map(({tradeId, closed})=>{
      // if(!closed){
        this._paintTransactionSlice(tradeId);
      // }
    })
  }

  /**
   * 渲染图片
   * @param {*} duration 
   */
  static drawMainGraph(){
    try{
      const refer_kline = TradeEngine.getMainAsset();
      if(!refer_kline) return;
      const x_label = refer_kline.ts.map(it=>formatTimestamp(it, TradeEngine._bar_type));
      const scaled_prices = TradeEngine.getAllScaledPrices();
      
      // 计算差值并添加注释
      const configuration = {
        type: 'line',  // 改回折线图
        data: {
          labels: x_label,
          datasets: scaled_prices.map((it, id) => {
            return {
              label: this._asset_names[id],
              data: it.prices,
              borderColor: this._asset_themes[id],
              pointBackgroundColor: this._asset_themes[id],
              ...styles
            }
          })
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { labels: { color: 'black' } }
          },
          scales: {
            y: {
              ticks: {
                callback: function(value) {
                  const baseValue = scaled_prices[0].prices[0];
                  return ((value - baseValue) / baseValue * 100).toFixed(2) + '%';
                },
                stepSize: (value) => {
                  const baseValue = scaled_prices[0].prices[0];
                  return baseValue * 0.025; // 2.5% 的实际价格变化值
                }
              },
            }
          },
          layout: {
            padding: {
              top: 140,
              bottom: 60,
              left: 60,
              right:60
            }
          }
        },
        plugins:[{
          afterDraw: async (chart) => {
            const baseValue = scaled_prices[0].prices[0];

            this._drawZeroLine(chart, baseValue);
            const collisionAvoidance = createCollisionAvoidance();

            // 绘制相关性表格
            this._drawRhoTable(chart);

            // 信息表格绘制
            this._drawInfoTable(chart);

            // 绘制实时利润空间表格
            this._drawProfitTable(chart);

            // 开平仓信息绘制, 在主图中过滤掉关闭的头寸
            const transactions = [...getLastTransactions(100, 'opening'),...getLastTransactions(100, 'closing')].filter(it=>!it.closed);
            const beta_map = TradeEngine._beta_map;
            this._drawTransactions(chart, transactions, beta_map,collisionAvoidance)
            
            // 实时利润绘制
            this._paintProfit();
            this._drawDateTime(chart);

            // 绘制历史订单信息
            this._paintOrders(chart, TradeEngine._asset_names, beta_map, collisionAvoidance);
          }
        }]
      };

    (async () => {
      const image = await chartJSNodeCanvas.renderToBuffer(configuration);
      this.writeChartFile('main_chart.jpg',image);
    })();
      
    }catch(e){
      console.log(e);
    }
  }

  /**
   * 绘制0%参考线
   * @private
   */
  static _drawZeroLine(chart, baseValue) {
    const ctx = chart.ctx;
    const yPixel = chart.scales.y.getPixelForValue(baseValue);
    
    // 绘制 0% 参考线
    ctx.beginPath();
    ctx.setLineDash([5, 5]);
    ctx.strokeStyle = '#666666';
    ctx.lineWidth = 1;
    ctx.moveTo(chart.chartArea.left, yPixel);
    ctx.lineTo(chart.chartArea.right, yPixel);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  /**
   * 绘制历史订单
   * @param {*} chart 
   * @param {*} beta_map 
   * @param {*} collisionAvoidance 
   */
  static _paintOrders(chart, asset_names, beta_map, collisionAvoidance){
    const ctx = chart.ctx;
    const xScale = chart.scales.x;
    const yScale = chart.scales.y;
    const xCoordOrders = new Map();
    const labels = TradeEngine.getMainAssetLabels();

    // 先收集所有资产的订单
    for(const asset_name of asset_names) {
      // 不在历史订单中显示的资产不处理
      if(!this._show_order_his.includes(asset_name)) continue;
      const data = TradeEngine.getOrderHistory({
        instType: 'SPOT',
        instId: asset_name,
        state: 'filled',
        limit: '100'
      });
      if(data && data.length) {
        // 直接处理订单数据
        data.forEach((order) => {
          const {fillTime, instId} = order;
          const formattedTime = formatTimestamp(fillTime, TradeEngine._bar_type);
          // 检查时间戳是否在图表范围内
          if (!labels.includes(formattedTime)) {
            return;
          }
          if (!xCoordOrders.has(formattedTime)) {
            xCoordOrders.set(formattedTime, new Map());
          }
          if (!xCoordOrders.get(formattedTime).has(instId)) {
            xCoordOrders.get(formattedTime).set(instId, {
              buy: { orders: [], totalAmount: 0, avgPrice: 0,accFillSz:0  },
              sell: { orders: [], totalAmount: 0, avgPrice: 0, accFillSz:0 }
            });
          }
          const sideData = xCoordOrders.get(formattedTime).get(instId)[order.side];
          const amount = order.accFillSz * order.avgPx;
          sideData.orders.push(order);
          sideData.accFillSz += parseFloat(order.accFillSz);
          sideData.totalAmount += amount;
          sideData.avgPrice = sideData.totalAmount / sideData.orders.reduce((sum, o) => parseFloat(sum) + parseFloat(o.accFillSz), 0);
        });
      }
    }

    // 绘制所有订单
    for (const [formattedTime, instIdMap] of xCoordOrders.entries()) {
      const fx = xScale.getPixelForValue(formattedTime);
      for (const [instId, data] of instIdMap.entries()) {
        if (!beta_map[instId]) continue;
        
        for (const side of ['buy', 'sell']) {
          const sideData = data[side];
          if (sideData.orders.length === 0) continue;

          const [a, b] = beta_map[instId];
          const srt_px = sideData.avgPrice * a + b;
          const fy = yScale.getPixelForValue(srt_px);
          
          // 绘制圆点
          ctx.beginPath();
          ctx.arc(fx, fy, 3, 0, 2 * Math.PI);
          ctx.fillStyle = {
            buy: 'red',
            sell: 'green'
          }[side];
          ctx.fill();

          // 买单向下(1)，卖单向上(-1)
          const lineLength = 60;
          const lineDirection = side === 'buy' ? 1 : -1;
          
          // 绘制垂直虚线
          ctx.beginPath();
          ctx.setLineDash([5, 3]);
          ctx.moveTo(fx, fy);
          ctx.lineTo(fx, fy + lineDirection * lineLength);
          ctx.strokeStyle = ctx.fillStyle;
          ctx.stroke();
          ctx.setLineDash([]);

          // 绘制文字标签
          ctx.font = `12px bold ${font_style}`;
          ctx.textAlign = 'center';
          const label = [
            `${{'buy':'[B]','sell':'[S]'}[side]}${sideData.totalAmount.toFixed(2)}(${sideData.accFillSz.toFixed(2)})`,
            `[${sideData.orders.length}]${sideData.avgPrice.toFixed(2)}`
          ].join('/');
          const lines = label.split('/');
          const lineHeight = 14;
          const totalHeight = lines.length * lineHeight;
          
          // sell 方向需要向上偏移文本总高度
          const labelOffset = side === 'sell' ? -totalHeight : 10;
          const {x: labelX, y: labelY} = collisionAvoidance(
            fx, 
            fy + lineDirection * (lineLength + 5) + labelOffset, 
            100, 
            totalHeight
          );
          
          // 分行绘制标签
          lines.forEach((text, index) => {
            ctx.fillText(text, labelX, labelY + index * lineHeight);
          });
          ctx.textAlign = 'start';
        }
      }
    }
  }

  static _paintProfit (){
    const labels = TradeEngine.getMainAssetLabels();
    let profits =  TradeEngine.getAllHistoryProfits();
    const themes_map = this.getThemes();

    // 计算差值并添加注释
    const configuration = {
      // type: 'scatter',
      type:'line',
      data: {
          labels,
          datasets: Object.keys(profits).map((key)=>{
            const label = key;
            const [assetId1,assetId2] = label.split(':');
            const color1 = themes_map[assetId1];
            const color2 = themes_map[assetId2];
            const color = blendColors(color1,color2);
            return {
              label: label.split(":").map(k=>simpAssetName(k)).join(":"),
              data: profits[key].map(it=>it*100),
              borderColor: color,
              pointBackgroundColor:color,
              borderWidth: 1,
              fill: false,  // 不填充颜色
              pointRadius: .5, // 设置点的大小
              tension: .3  // 设置曲线平滑度 (0 为折线)
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
      this.writeChartFile(`distance.jpg`,image);
    })();
  }


  /**
   * 绘制实时价差信息
   * @param {*} chart 
   * @param {*} tradeId 
   * @param {*} collisionAvoidance 
   * @returns 
   */
  static _drawRealtimeDistance(chart, tradeId, collisionAvoidance){
    const ctx = chart.ctx;
    const xScale = chart.scales.x;
    const yScale = chart.scales.y;
  
    const SIDE_SYMBOL = { buy: "+", sell: '-' };

    const labels = TradeEngine.getMainAssetLabels();

    const transaction = getOpeningTransaction(tradeId);
  
    const [order1, order2] = transaction.orders;
    const { instId:instId1, avgPx: px1, sz: sz1, side: side1, tgtCcy:tgtCcy1, beta:beta1, } = order1;
    const { instId:instId2, avgPx: px2, sz: sz2, side: side2, tgtCcy:tgtCcy2, beta:beta2, } = order2;

    //已平仓的不展示
    if(transaction.closed) return 

    let color = '#7b1fa2';

    // 转换时间戳和计算坐标
    if(xScale && yScale){}else{return};
    let x1 = xScale.getPixelForValue(labels.at(-1));
    let x2 = xScale.getPixelForValue(labels.at(-1));
    
    // 获取市价
    const r_px1 = TradeEngine.getRealtimePrice(instId1);
    const r_px2 = TradeEngine.getRealtimePrice(instId2);
    
    // 按开仓时标准化计算当前市价
    const sr_px1 = r_px1 * beta1[0] + beta1[1];
    const sr_px2 = r_px2 * beta2[0] + beta2[1];

    // 计算开仓时标准化价格
    const fspx1 = px1 * beta1[0] + beta1[1];
    const fspx2 = px2 * beta2[0] + beta2[1];

    // 获取Y轴坐标
    let y1 = yScale.getPixelForValue(sr_px1);
    let y2 = yScale.getPixelForValue(sr_px2);

    // 计算价差比率
    const diffRate = TradeEngine._calcPriceGapProfit(sr_px1, sr_px2, (sr_px1+sr_px2)/2);

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

    const profit = transaction.profit || 0;
    const profit_text = (profit >=0 ? "+":"-") + `${Math.abs(profit.toFixed(2))}`
    const tag2 = `$${profit_text}`;
    const v1 = `(${valueFormatter(sz1, side1, px1, tgtCcy1)})/${parseFloat(r_px1).toFixed(2)}`;
    const v2 = `(${valueFormatter(sz2, side2, px2, tgtCcy2)})/${parseFloat(r_px2).toFixed(2)}`;

    // 绘制连接线
    ;fspx1>fspx2
    ? paintLine(ctx, [x1, y1, `${v1}/${tag2}/${rateTag}`], [x2, y2, v2], color, collisionAvoidance)
    : paintLine(ctx, [x2, y2, `${v2}/${tag2}/${rateTag}`], [x1, y1, v1], color, collisionAvoidance)
  }


  /**
   * 绘制历史价差信息
   * @param {*} chart 
   * @param {*} transactions 
   * @param {*} betaMap 
   * @param {*} collisionAvoidance 
   */
  static _drawTransactions(chart, transactions, betaMap, collisionAvoidance, show_closed=false){
    const bar_type = TradeEngine._bar_type;
    const ctx = chart.ctx;
    const xScale = chart.scales.x;
    const yScale = chart.scales.y;
  
    const OPEN_COLOR = 'red';
    const CLOSE_COLOR = 'green';
    const SIDE_SYMBOL = { buy: "+", sell: '-' };
    const labels = TradeEngine.getMainAssetLabels();
  
    transactions.forEach(({ orders, profit, closed, side: transaction_side, tradeId }) => {
      const [order1, order2] = orders;
      const { ts: ts1, avgPx: px1, instId: instId1, sz: sz1, side: side1, tgtCcy:tgtCcy1, beta:beta1, } = order1;
      const { ts: ts2, avgPx: px2, instId: instId2, sz: sz2, side: side2, tgtCcy:tgtCcy2, beta:beta2, } = order2;
  
      //已平仓的不展示
      if(!show_closed && (transaction_side==="closing" || closed)) return
  
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
      
      // 计算实时标准化价格
      const spx1 = px1 * betaMap[instId1][0] + betaMap[instId1][1];
      const spx2 = px2 * betaMap[instId2][0] + betaMap[instId2][1];

      // 计算开仓时标准化价格
      // const fspx1 = px1 * beta1[0] + beta1[1];
      // const fspx2 = px2 * beta2[0] + beta2[1];

      
      // 获取Y轴坐标
      let y1 = yScale.getPixelForValue(spx1);
      let y2 = yScale.getPixelForValue(spx2);
  

      // 计算价差比率
      const diffRate = TradeEngine._calcPriceGapProfit(spx1, spx2, (spx1+spx2)/2)
      

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
      const v1 = `(${valueFormatter(sz1, side1, px1, tgtCcy1)})/${parseFloat(px1).toFixed(2)}`;
      const v2 = `(${valueFormatter(sz2, side2, px2, tgtCcy2)})/${parseFloat(px2).toFixed(2)}`;
  
      // 绘制连接线
      ;spx1>spx2
      ? paintLine(ctx, [x1, y1, `${v1}/${tag2}/${tag}`], [x2, y2, v2+`/#${tradeId}`], color, collisionAvoidance)
      : paintLine(ctx, [x2, y2, `${v2}/${tag2}/${tag}`], [x1, y1, v1+`/#${tradeId}`], color, collisionAvoidance)
    });
  }

  /**
   * 实时利润矩阵绘制
   * @param {*} chart 
   * @param {*} assetIds 
   * @param {*} themes 
   * @param {*} data 
   */
  static _drawProfitTable(chart) {
    // 实时利润矩阵计算
    let data = TradeEngine.getRealtimeProfits();
    const themes = this._asset_themes;
    const assetIds = TradeEngine._asset_names;

    const ctx= chart.ctx;
    const headers = assetIds;
    data = assetIds.map(astId1=>{
      return assetIds.map(astId2=>{
        const series = data[`${astId1}:${astId2}`]||data[`${astId2}:${astId1}`]
        if(series){
          return series;
        } else {
          return 0
        }
      })
    })
  
    // 存在对冲的资产在矩阵中标出来
    const all_exist_hedges = TradeEngine.processors.filter(p=>p.type==="HedgeProcessor").map(it=>it.asset_names);
  
    const left = width*0.70;
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

        const a = headers[rowIndex];
        const b = headers[colIndex];
        if(all_exist_hedges.some(it=>(it.join("")===a+b || it.join("")===b+a))){
          ctx.setLineDash([5, 3]);
          ctx.lineWidth = 2;
          ctx.strokeStyle = '#eb984e';
          ctx.strokeRect((colIndex + 1) * cellWidth - padding + left, yOffset + 1.2*padding + top, cellWidth-padding*5, 0.85* cellHeight); 
          ctx.rect()
        }
      });
    });
  }

  /**
   * 绘制价格、对冲比信息表格
   */
  static _drawInfoTable(chart) {

    const ctx = chart.ctx
    const headers = ['β(对冲比)','价格','涨跌幅'];
    const themes = this._asset_themes;
    const assetIds = TradeEngine._asset_names;
    const beta_map = TradeEngine._beta_map;

    const data = assetIds.map((assetId, i_info)=>{
      // 价格
      const {prices, ts} = TradeEngine.getMarketData(assetId);
      const start_price = prices[0];
      const price= prices.at(-1);
      const rate = (price-start_price)/start_price;
      return [beta_map[assetId][0].toFixed(6), price, rate]
    })

    
    const left = width*0.35;
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
      ctx.fillText(assetIds[rowIndex], padding+left, yOffset + top+cellHeight / 2 + 5);
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


  /**
   * 绘制相关性表格
   * @param {*} chart 
   */
  static _drawRhoTable(chart) {
    const ctx = chart.ctx
    const klines = Object.values(TradeEngine.getAllMarketData());
    const headers = TradeEngine._asset_names;
    const themes = this._asset_themes;
    const data = calculateCorrelationMatrix(klines.map(it=>it.prices));

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


  /**
   * 绘制每一笔交易的切片
   * @param {*} tradeId 
   */
  static _paintTransactionSlice(tradeId){ 
    const open_transaction = getOpeningTransaction(tradeId);
    const close_transaction = getClosingTransaction(tradeId);
    const klines = Object.values(TradeEngine.getAllMarketData());
    const labels = TradeEngine.getMainAssetLabels();


    const orders_open = open_transaction.orders
    const orders_close = close_transaction ? close_transaction.orders: [];
  
    const orders = [...orders_open, ...orders_close];

    const isClosed = open_transaction.closed && close_transaction;
    const slug = orders_open.sort((a, b) => a.instId.localeCompare(b.instId)).map(o=>o.instId.split('-')[0].toLowerCase()).join("-");
    const file_path = `slices/${slug}/${isClosed?'closed/':""}${tradeId}.jpg`;
    if(isClosed && this.existChartFile(file_path)){
      // 已关闭的不重复绘制
      if(this.existChartFile(`slices/${slug}/${tradeId}.jpg`)){
        this.deleteChartFile(`slices/${slug}/${tradeId}.jpg`)
      }
      return;
    }
  
    const order_map = {};
    const beta_map = {};
    ;orders_open.forEach(({beta, instId,avgPx,accFillSz, sz, ts})=>{
      order_map[instId] = {beta, instId,avgPx, accFillSz, sz, ts};
      beta_map[instId] = beta;
    })
  
    const scaled_prices = klines.filter(({id})=>orders.find(it=>it.instId === id)).map(({id, prices, ts})=>{
      const [a,b] = beta_map[id];
      const beta = p=> a*p+b;
      return {
        color:this.getThemes()[id],
        prices: prices.map(it=>beta(it)),
        id,
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
            label:it.id,
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
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { labels: { color: 'black' } }
        },
        scales: {
          y: {
            ticks: {
              callback: function(value) {
                const baseValue = scaled_prices[0].prices[0];
                return ((value - baseValue) / baseValue * 100).toFixed(2) + '%';
              },
              stepSize: (value) => {
                const baseValue = scaled_prices[0].prices[0];
                return baseValue * 0.025; // 2.5% 的实际价格变化值
              }
            },
          }
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
        afterDraw: (chart) => {
          // 绘制零基准线
          const baseValue = scaled_prices[0].prices[0];
          this._drawZeroLine(chart, baseValue);
          
          // 为了避免标签重叠先搞个位置收集器
          const collisionAvoidance = createCollisionAvoidance();

  
          // 绘制实时利润空间表格
          this._drawProfitTable(chart);
  
          // 开平仓信息绘制
          const transactions = [open_transaction, close_transaction].filter(it=>it);
          this._drawTransactions(chart, transactions, beta_map, collisionAvoidance, true) 

          // 绘制实时距离
          this._drawRealtimeDistance(chart, tradeId, collisionAvoidance)

          // 绘制信息表格
          this._drawInfoTable(chart);

          this._drawRhoTable(chart);

          this._drawDateTime(chart);

          // 绘制历史订单信息
          const asset_names = transactions.flatMap(it=>it.orders.map(o=>o.instId));
          this._paintOrders(chart, asset_names, beta_map, collisionAvoidance);
            
        }
      }]
    };
  
    (async () => {
      const image = await chartJSNodeCanvas.renderToBuffer(configuration);
      this.writeChartFile(file_path,image);
    })();
  }


  /**
   * 绘制时间戳
   * @param {} chart 
   */
  static _drawDateTime(chart) {
    const ctx = chart.ctx
    
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0'); // 月份从0开始计算
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');

    const stamp = `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;

    const left = width*0.9;
    const top = height*0.97

    ctx.fillStyle = '#808b96';
    ctx.font = '12px'+font_style;
    ctx.fillText(stamp, left, top);
  }

  /**
   * 生成文件
   * @param {*} dir 
   * @param {*} image 
   * @returns 
   */
  static writeChartFile(dir, image){
    const fullPath = path.join('./chart', dir);
    const dirPath = path.dirname(fullPath);
    fs.mkdirSync(dirPath, { recursive: true });
    return fs.writeFileSync(fullPath, image);
  }

  /**
   * 检查文件
   * @param {*} dir 
   * @returns 
   */
  static existChartFile(dir){
    return fs.existsSync(`./chart/${dir}`)
  }

  /**
   * 删除文件
   * @param {*} dir 
   * @returns 
   */
  static deleteChartFile(dir){
    const filePath = path.join('./chart', dir);
    try {
      fs.unlinkSync(filePath);
      return true;
    } catch (error) {
      if (error.code === 'ENOENT') {
        console.log(`文件 ${filePath} 不存在`);
        return false;
      }
      throw error; // 非"文件不存在"错误继续抛出
    }
  }

  /**
   * 圆角框绘制方法
   * @param {*} x 
   * @param {*} y 
   * @param {*} width 
   * @param {*} height 
   * @param {*} radius 
   */
  static drawRoundedRect(ctx, x, y, width, height, radius) {
    ctx.beginPath();
    // 左上角 → 右上角
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.arcTo(x + width, y, x + width, y + radius, radius);
    // 右上角 → 右下角
    ctx.lineTo(x + width, y + height - radius);
    ctx.arcTo(x + width, y + height, x + width - radius, y + height, radius);
    // 右下角 → 左下角
    ctx.lineTo(x + radius, y + height);
    ctx.arcTo(x, y + height, x, y + height - radius, radius);
    // 左下角 → 左上角
    ctx.lineTo(x, y + radius);
    ctx.arcTo(x, y, x + radius, y, radius);
    ctx.closePath();
  }
  
}