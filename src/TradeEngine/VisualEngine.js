import { ChartJSNodeCanvas } from 'chartjs-node-canvas'
import fs from 'fs';
import { blendColors, calcProfit, createMapFrom, formatTimestamp, getTsOfStartOfToday, hashString, toTrickTimeMark } from '../tools.js';
import { calculateCorrelationMatrix } from '../mathmatic.js';
import { getClosingTransaction, getLastTransactions, getOpeningTransaction } from '../recordTools.js';
import { createCollisionAvoidance, paintLine, simpAssetName } from '../paint.js';
import { TradeEngine } from './TradeEngine.js';

const width = 1800, height = 800;
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
    }){
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
      const assetIds = TradeEngine._asset_names;
      const themes = this._asset_themes;


    // 计算差值并添加注释
    const configuration = {
      type:'line',
      data: {
        labels:x_label,
        datasets: scaled_prices.map((it,id)=>{
          return {
            label:assetIds[id],
            data: it.prices,
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
        afterDraw: (chart) => {
          const ctx = chart.ctx;
          // 为了避免标签重叠先搞个位置收集器
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
        }
      }]
    };

    (async () => {
      const image = await chartJSNodeCanvas.renderToBuffer(configuration);
      fs.writeFileSync('./chart/candle_chart.jpg', image);
    })();
      
    }catch(e){
      console.log(e);
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
      fs.writeFileSync('./chart/distance.jpg', image);
    })();
  }


  /**
   * 绘制已开仓头寸的实时价差
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

    let profit = transaction.profit || 0;
    const profit_text = (profit >=0 ? "+":"-") + `${Math.abs(profit.toFixed(2))}`
    const tag2 = `$${profit_text}`;
    const v1 = `(${valueFormatter(sz1, side1, px1, tgtCcy1)})/${parseFloat(px1).toFixed(2)}`;
    const v2 = `(${valueFormatter(sz2, side2, px2, tgtCcy2)})/${parseFloat(px2).toFixed(2)}`;

    // 绘制连接线
    ;fspx1>fspx2
    ? paintLine(ctx, [x1, y1, `${v1}/${tag2}/${rateTag}`], [x2, y2, v2], color, collisionAvoidance)
    : paintLine(ctx, [x2, y2, `${v2}/${tag2}/${rateTag}`], [x1, y1, v1], color, collisionAvoidance)
  }

  static _drawTransactions(chart, transactions, betaMap, collisionAvoidance){
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
      
      // 计算实时标准化价格
      const spx1 = px1 * betaMap[instId1][0] + betaMap[instId1][1];
      const spx2 = px2 * betaMap[instId2][0] + betaMap[instId2][1];

      // 计算开仓时标准化价格
      const fspx1 = px1 * beta1[0] + beta1[1];
      const fspx2 = px2 * beta2[0] + beta2[1];

      
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
      ? paintLine(ctx, [x1, y1, `${v1}/${tag2}/${tag}`], [x2, y2, v2], color, collisionAvoidance)
      : paintLine(ctx, [x2, y2, `${v2}/${tag2}/${tag}`], [x1, y1, v1], color, collisionAvoidance)
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


  static _paintTransactionSlice(tradeId){ 
    const open_transaction = getOpeningTransaction(tradeId);
    const close_transaction = getClosingTransaction(tradeId);
    const klines = Object.values(TradeEngine.getAllMarketData());
    const labels = TradeEngine.getMainAssetLabels();
  
    const orders_open = open_transaction.orders
    const orders_close = close_transaction ? close_transaction.orders: [];
  
    const orders = [...orders_open, ...orders_close];
  
  
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
        afterDraw: (chart) => {
          const ctx = chart.ctx;
          // 为了避免标签重叠先搞个位置收集器
          const collisionAvoidance = createCollisionAvoidance();

  
          // 绘制实时利润空间表格
          this._drawProfitTable(chart);
  
          // 开平仓信息绘制
          const transactions = [open_transaction, close_transaction].filter(it=>it);
          this._drawTransactions(chart, transactions, beta_map, collisionAvoidance) 

          // 绘制实时距离
          this._drawRealtimeDistance(chart, tradeId, collisionAvoidance)

          // 绘制信息表格
          this._drawInfoTable(chart);

          this._drawRhoTable(chart);
            
        }
      }]
    };
  
    (async () => {
      const image = await chartJSNodeCanvas.renderToBuffer(configuration);
      fs.writeFileSync(`./chart/slices/candle_chart_${tradeId}.jpg`, image);
    })();
  }
  
}