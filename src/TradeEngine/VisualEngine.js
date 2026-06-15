import fs from 'fs';
import { blendColors, createMapFrom, formatTimestamp, hashString, shortDcm } from '../tools.js';
import { calculateCorrelationMatrix } from '../mathmatic.js';
import { getOpeningTransaction } from '../recordTools.js';
import { createCollisionAvoidance, paintLine, simpAssetName } from '../paint.js';
import { TradeEngine } from './TradeEngine.js';
import path from 'path';
import { LocalVariable } from '../LocalVariable.js';
import { calculateBOLL } from '../indicators/BOLL.js';
import { GridTradingSlice } from './painters/GridTradingSlice.js';
import { MainGraph } from './painters/MainGraph.js';
import { Env } from '../../config.js';
import { TradeEnv } from '../enum.js';

export class VisualEngine {
  static width = 3840;
  static height = 2160;
  static charts = [];
  static _timer = {};
  static _asset_themes = [];
  static _asset_names = [];
  static _show_order_his = [];
  static _painting_interval = Env === TradeEnv.MIMIC ? 1000 : 10000; //
  static _boll_cache = new Map(); // 每一个滑动窗口的布林带
  static _boll_timer = null;
  static font_style = 'Monaco, Menlo, Consolas, monospace';

  chart_id = hashString(`${Date.now()}${Math.random()}`);
  static _config = new LocalVariable('config');
  static modules = new Map();

  static createChart(...args) {
    this.charts.push(new this(...args));
  }

  /**
   * 设置引擎基本信息
   * @param {*} param0
   */
  static setMetaInfo({ assets, show_order_his }) {
    if (show_order_his) this._show_order_his = show_order_his;
    if (assets) {
      this._asset_names = assets.map(it => it.id);
      this._asset_themes = assets.map(it => it.theme);
    }
    return this;
    // dosmt
  }

  static getThemes() {
    return createMapFrom(this._asset_names, this._asset_themes);
  }

  /**
   * 注册模块
   * @param {*} moduleClass
   */
  static use(moduleClass) {
    this.modules.set(moduleClass.name, new moduleClass(this));
  }

  static start() {
    const status = TradeEngine.checkEngine();
    if (status == 2) {
      this.modules.forEach(it => {
        it.draw();
      });
    }
    clearTimeout(this._timer.start);
    this._timer.start = setTimeout(() => {
      this.start();
    }, this._painting_interval);
  }

  static stop() {
    clearTimeout(this._timer.start);
  }

  static getBOLL(instId) {
    const candles = TradeEngine.getCandleData(instId);
    // const cacheKey = JSON.stringify(candles.at(-1));

    const cacheKey = `${candles.at(-1).ts}:${instId}`;
    if (this._boll_cache.has(cacheKey)) {
      return this._boll_cache.get(cacheKey);
    }

    // 限制缓存大小
    if (this._boll_cache.size > 20) {
      const firstKey = this._boll_cache.keys().next().value;
      this._boll_cache.delete(firstKey);
    }

    const result = calculateBOLL(candles, 20);
    this._boll_cache.set(cacheKey, result);

    return result;
  }

  static _drawTrendArrow(chart, x, y, trend, style = 'default') {
    if (!trend && trend !== 0) return;

    const ctx = chart.ctx;
    const styles = {
      default: {
        arrowLength: 20,
        arrowWidth: 6,
        offset: 30,
        colors: {
          up: '#229954',
          down: '#c0392b',
          neutral: '#808b96',
        },
      },
      thin: {
        arrowLength: 15,
        arrowWidth: 4,
        offset: 25,
        colors: {
          up: '#27ae60',
          down: '#e74c3c',
          neutral: '#95a5a6',
        },
      },
      bold: {
        arrowLength: 25,
        arrowWidth: 8,
        offset: 35,
        colors: {
          up: '#145a32',
          down: '#922b21',
          neutral: '#566573',
        },
      },
    };

    const currentStyle = styles[style] || styles.default;
    const { arrowLength, arrowWidth, offset, colors } = currentStyle;
    ctx.arc(x, y, 1.5, 0, 2 * Math.PI);
    // 保存当前上下文状态
    ctx.save();

    // 设置箭头样式
    ctx.beginPath();
    ctx.strokeStyle = trend > 0 ? colors.up : trend < 0 ? colors.down : colors.neutral;
    ctx.fillStyle = ctx.strokeStyle;
    ctx.lineWidth = style === 'bold' ? 2 : 1;

    if (trend === 0) {
      // 水平箭头
      ctx.moveTo(x, y);
      ctx.lineTo(x + offset, y);
      // 箭头头部
      ctx.moveTo(x + offset, y);
      ctx.lineTo(x + offset - arrowLength, y - arrowWidth);
      ctx.moveTo(x + offset, y);
      ctx.lineTo(x + offset - arrowLength, y + arrowWidth);
    } else {
      // 垂直箭头
      const endY = y + (trend > 0 ? -offset : offset);
      ctx.moveTo(x, y);
      ctx.lineTo(x, endY);

      if (trend > 0) {
        ctx.moveTo(x - arrowWidth, endY + arrowLength);
        ctx.lineTo(x, endY);
        ctx.lineTo(x + arrowWidth, endY + arrowLength);
      } else {
        ctx.moveTo(x - arrowWidth, endY - arrowLength);
        ctx.lineTo(x, endY);
        ctx.lineTo(x + arrowWidth, endY - arrowLength);
      }
    }

    // 描边
    ctx.stroke();

    // 恢复上下文状态
    ctx.restore();
  }

  /**
   * 绘制水平参考线
   */
  static drawHorizontalLine(chart, value, options = {}) {
    const {
      dash = null,
      color = '#aaaaaa',
      width = 1,
      label,
      font = `28px "Fira Sans"`,
      textAlign = 'right',
      textOffsetX = chart.chartArea.right - 100,
      textOffsetY = -5,
    } = options;

    const ctx = chart.ctx;
    const y = chart.scales.y.getPixelForValue(value);

    ctx.save();
    ctx.beginPath();
    ctx.setLineDash(dash);
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.moveTo(chart.chartArea.left, y);
    ctx.lineTo(chart.chartArea.right, y);
    ctx.stroke();
    ctx.setLineDash([]);

    if (label) {
      ctx.fillStyle = color;
      ctx.font = font;
      ctx.textAlign = textAlign;
      ctx.fillText(
        `${label}: ${Number.isFinite(value) ? value.toFixed(2) : value}`,
        chart.chartArea.left + textOffsetX,
        y + textOffsetY
      );
    }
    ctx.restore();
  }

  /**
   * 绘制单个订单点位及标签
   * @private
   */
  static _paintSingleOrder(ctx, fx, fy, labels, side, collisionAvoidance, ghost = null) {
    const fx_offset = {
      buy: fx - 10,
      sell: fx + 10,
    }[side];

    const fx_offset_label = {
      buy: fx - 20,
      sell: fx + 20,
    }[side];

    // 绘制圆点
    ctx.beginPath();
    ctx.arc(fx, fy, 1.5, 0, 2 * Math.PI);
    ctx.fillStyle = {
      buy: 'red',
      sell: 'green',
    }[side];
    ctx.fill();

    // 买单向下(1)，卖单向上(-1)
    const lineLength = 60;
    const lineDirection = side === 'buy' ? 1 : -1;
    const corner_drop = side === 'buy' ? 10 : -10;
    const fy_label = fy + lineDirection * lineLength;

    // 绘制垂直虚线
    ctx.beginPath();
    ctx.setLineDash([5, 3]);
    ctx.lineWidth = 1;
    ctx.strokeStyle = ctx.fillStyle;
    ctx.moveTo(fx_offset, fy + corner_drop);
    ctx.lineTo(fx_offset, fy_label - corner_drop);
    ctx.stroke();
    // 设置横向虚线
    ctx.beginPath();
    ctx.moveTo(fx_offset, fy + corner_drop);
    ctx.lineTo(fx, fy);
    ctx.stroke();
    // 设置横向虚线指向文字
    ctx.beginPath();
    ctx.moveTo(fx_offset_label, fy_label);
    ctx.lineTo(fx_offset, fy_label - corner_drop);
    ctx.stroke();
    ctx.setLineDash([]);

    if (ghost) {
      ctx.save();
      const { y: ghost_y, label: ghost_label } = ghost;
      ctx.beginPath();
      ctx.lineWidth = 0.5;
      ctx.strokeStyle = '#8b32a8';
      ctx.setLineDash([5, 3]);
      ctx.moveTo(fx, ghost_y);
      ctx.lineTo(fx_offset, ghost_y + corner_drop);
      ctx.lineTo(fx_offset, fy + corner_drop);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(fx, ghost_y, 1.5, 0, 2 * Math.PI);
      ctx.fillStyle = '#8b32a8';
      ctx.fill();
      ctx.restore();
    }

    // 绘制文字标签
    ctx.font = `100 12px ${this.font_style}`;
    ctx.textAlign = 'center';
    const lines = labels.split('/');
    const lineHeight = 14;
    const totalHeight = lines.length * lineHeight;
    const maxWidth = Math.max(...lines.map(line => ctx.measureText(line).width));
    // 添加一些padding，使文本不会太贴近边缘
    const textBoxWidth = maxWidth + 10;
    // sell 方向需要向上偏移文本总高度
    const labelOffset = side === 'sell' ? -totalHeight : 15;
    const fx_label =
      side === 'sell' ? fx_offset_label + textBoxWidth * 0.5 : fx_offset_label - textBoxWidth * 0.5;
    const { x: labelX, y: labelY } = collisionAvoidance(
      fx_label,
      fy_label + labelOffset,
      textBoxWidth,
      totalHeight
    );

    // 分行绘制标签
    lines.forEach((text, index) => {
      ctx.fillText(text, labelX, labelY + index * lineHeight);
    });
    ctx.textAlign = 'start';
  }

  /**
   * 绘制历史订单
   * @param {*} chart
   * @param {*} beta_map
   * @param {*} collisionAvoidance
   */
  static _paintOrders(chart, asset_names, beta_map, collisionAvoidance) {
    const ctx = chart.ctx;
    const xScale = chart.scales.x;
    const yScale = chart.scales.y;
    const xCoordOrders = new Map();
    const labels = TradeEngine.getMainAssetLabels();

    // 先收集所有资产的订单
    for (const asset_name of asset_names) {
      // 不在历史订单中显示的资产不处理
      if (!this._show_order_his.includes(asset_name)) continue;
      const data = TradeEngine.getOrderHistory({
        instType: 'SPOT',
        instId: asset_name,
        state: 'filled',
        limit: '100',
      });
      if (data && data.length) {
        // 直接处理订单数据
        data.forEach(order => {
          const { fillTime, instId } = order;
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
              buy: { orders: [], totalAmount: 0, avgPrice: 0, accFillSz: 0 },
              sell: { orders: [], totalAmount: 0, avgPrice: 0, accFillSz: 0 },
            });
          }
          const sideData = xCoordOrders.get(formattedTime).get(instId)[order.side];
          const amount = order.accFillSz * order.avgPx;
          sideData.orders.push(order);
          sideData.accFillSz += parseFloat(order.accFillSz);
          sideData.totalAmount += amount;
          sideData.avgPrice =
            sideData.totalAmount /
            sideData.orders.reduce((sum, o) => parseFloat(sum) + parseFloat(o.accFillSz), 0);
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
          const labels = [
            `${{ buy: '[B]', sell: '[S]' }[side]}${sideData.totalAmount.toFixed(2)}(${sideData.accFillSz.toFixed(2)})`,
            `[${sideData.orders.length}]${sideData.avgPrice.toFixed(2)}`,
          ].join('/');
          this._paintSingleOrder(ctx, fx, fy, labels, side, collisionAvoidance);
        }
      }
    }
  }

  /**
   * 绘制实时价差信息
   * @param {*} chart
   * @param {*} tradeId
   * @param {*} collisionAvoidance
   * @returns
   */
  static _drawRealtimeDistance(chart, tradeId, collisionAvoidance) {
    const ctx = chart.ctx;
    const xScale = chart.scales.x;
    const yScale = chart.scales.y;

    const SIDE_SYMBOL = { buy: '+', sell: '-' };

    const labels = TradeEngine.getMainAssetLabels();

    const transaction = getOpeningTransaction(tradeId);

    const [order1, order2] = transaction.orders;
    const {
      instId: instId1,
      avgPx: px1,
      sz: sz1,
      side: side1,
      tgtCcy: tgtCcy1,
      beta: beta1,
    } = order1;
    const {
      instId: instId2,
      avgPx: px2,
      sz: sz2,
      side: side2,
      tgtCcy: tgtCcy2,
      beta: beta2,
    } = order2;

    //已平仓的不展示
    if (transaction.closed) return;

    let color = '#7b1fa2';

    // 转换时间戳和计算坐标
    if (xScale && yScale) {
    } else {
      return;
    }
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
    const diffRate = TradeEngine._calcPriceGapProfit(sr_px1, sr_px2, (sr_px1 + sr_px2) / 2);

    // 将价格单位都转为USDT
    const format2USDT = (sz, price, tgtCcy) => {
      if (tgtCcy === 'base_ccy') return (sz * price).toFixed(2);
      if (tgtCcy === 'quote_ccy') return sz;
      throw ('未知货币单位: ', tgtCcy);
    };

    // 生成标签内容
    const valueFormatter = (sz, side, price, tgtCcy) =>
      `${SIDE_SYMBOL[side]}${format2USDT(sz, price, tgtCcy)}`;

    // 生成标签文本
    const rateTag = `${(diffRate * 100).toFixed(2)}%`;

    const profit = transaction.profit || 0;
    const profit_text = (profit >= 0 ? '+' : '-') + `${Math.abs(profit.toFixed(2))}`;
    const tag2 = `$${profit_text}`;
    const v1 = `(${valueFormatter(sz1, side1, px1, tgtCcy1)})/${parseFloat(r_px1).toFixed(2)}`;
    const v2 = `(${valueFormatter(sz2, side2, px2, tgtCcy2)})/${parseFloat(r_px2).toFixed(2)}`;

    // 绘制连接线
    fspx1 > fspx2
      ? paintLine(
          ctx,
          [x1, y1, `${v1}/${tag2}/${rateTag}`],
          [x2, y2, v2],
          color,
          collisionAvoidance
        )
      : paintLine(
          ctx,
          [x2, y2, `${v2}/${tag2}/${rateTag}`],
          [x1, y1, v1],
          color,
          collisionAvoidance
        );
  }

  /**
   * 绘制历史价差信息
   * @param {*} chart
   * @param {*} transactions
   * @param {*} betaMap
   * @param {*} collisionAvoidance
   */
  static _drawTransactions(chart, transactions, betaMap, collisionAvoidance, show_closed = false) {
    const bar_type = TradeEngine._bar_type;
    const ctx = chart.ctx;
    const xScale = chart.scales.x;
    const yScale = chart.scales.y;

    const OPEN_COLOR = '#d61c3c';
    const CLOSE_COLOR = 'green';
    const SIDE_SYMBOL = { buy: '+', sell: '-' };
    const labels = TradeEngine.getMainAssetLabels();

    transactions.forEach(({ orders, profit, closed, side: transaction_side, tradeId }) => {
      const [order1, order2] = orders;
      const {
        ts: ts1,
        avgPx: px1,
        instId: instId1,
        sz: sz1,
        side: side1,
        tgtCcy: tgtCcy1,
        beta: beta1,
      } = order1;
      const {
        ts: ts2,
        avgPx: px2,
        instId: instId2,
        sz: sz2,
        side: side2,
        tgtCcy: tgtCcy2,
        beta: beta2,
      } = order2;

      //已平仓的不展示
      if (!show_closed && (transaction_side === 'closing' || closed)) return;

      let color = {
        opening: OPEN_COLOR,
        closing: CLOSE_COLOR,
      }[transaction_side];

      if (closed) {
        color = '#ff000090';
      }

      // 转换时间戳和计算坐标
      const label_1 = formatTimestamp(ts1, bar_type);
      const label_2 = formatTimestamp(ts2, bar_type);
      if (!labels.includes(label_1) || !labels.includes(label_2)) {
        return;
      }
      if (xScale && yScale) {
      } else {
        return;
      }
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
      const diffRate = TradeEngine._calcPriceGapProfit(spx1, spx2, (spx1 + spx2) / 2);

      // 将价格单位都转为USDT
      const format2USDT = (sz, price, tgtCcy) => {
        if (tgtCcy === 'base_ccy') return (sz * price).toFixed(2);
        if (tgtCcy === 'quote_ccy') return sz;
        throw ('未知货币单位: ', tgtCcy);
      };

      // 生成标签内容
      const valueFormatter = (sz, side, price, tgtCcy) =>
        `${SIDE_SYMBOL[side]}${format2USDT(sz, price, tgtCcy)}`;

      // 生成标签文本
      const rateTag = `${(diffRate * 100).toFixed(2)}%`;

      profit = profit || 0;
      const profit_text = (profit >= 0 ? '+' : '-') + `${Math.abs(profit.toFixed(2))}`;
      const tag =
        transaction_side === 'opening'
          ? `${rateTag}/开仓${closed ? '(已平)' : ''}`
          : `${rateTag}/平仓`;
      const tag2 = `$${profit_text}`;
      const v1 = `(${valueFormatter(sz1, side1, px1, tgtCcy1)})/${parseFloat(px1).toFixed(2)}`;
      const v2 = `(${valueFormatter(sz2, side2, px2, tgtCcy2)})/${parseFloat(px2).toFixed(2)}`;

      // 绘制连接线
      spx1 > spx2
        ? paintLine(
            ctx,
            [x1, y1, `${v1}/${tag2}/${tag}`],
            [x2, y2, v2 + `/#${tradeId}`],
            color,
            collisionAvoidance
          )
        : paintLine(
            ctx,
            [x2, y2, `${v2}/${tag2}/${tag}`],
            [x1, y1, v1 + `/#${tradeId}`],
            color,
            collisionAvoidance
          );
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

    const ctx = chart.ctx;
    const headers = assetIds;
    data = assetIds.map(astId1 => {
      return assetIds.map(astId2 => {
        const series = data[`${astId1}:${astId2}`] || data[`${astId2}:${astId1}`];
        if (series) {
          return series;
        } else {
          return 0;
        }
      });
    });

    // 存在对冲的资产在矩阵中标出来
    const all_exist_hedges = TradeEngine.processors
      .filter(p => p.type === 'HedgeProcessor')
      .map(it => it.asset_names);

    const left = this.width * 0.7;
    const top = this.height * 0.01;
    const cellWidth = 80; // 单元格宽度
    const cellHeight = 20; // 单元格高度
    const padding = 5; // 单元格内边距
    ctx.fillStyle = '#808b96';
    ctx.font = '14px ' + this.font_style;
    ctx.fillText('利润空间', left + padding, top + cellHeight / 2 + 5);
    // 绘制表头文本
    ctx.fillStyle = 'black';
    ctx.font = '12px ' + this.font_style;
    headers.forEach((header, index) => {
      ctx.fillStyle = themes[index];
      ctx.fillText(
        simpAssetName(header),
        (index + 1) * cellWidth + padding + left,
        top + cellHeight / 2 + 5
      );
    });

    // 绘制数据单元格
    data.forEach((row, rowIndex) => {
      const yOffset = (rowIndex + 1) * cellHeight;

      // 绘制首列文本
      ctx.fillStyle = 'black';
      ctx.font = '12px ' + this.font_style;
      ctx.fillStyle = themes[rowIndex];
      ctx.fillText(
        simpAssetName(headers[rowIndex]),
        padding + left,
        yOffset + top + cellHeight / 2 + 5
      );

      // 绘制数据单元格内容
      row.forEach((cell, colIndex) => {
        ctx.fillStyle = cell > 0 ? (cell == Math.max(...row) ? 'red' : 'green') : '#808b96';
        ctx.fillText(
          (cell * 100).toFixed(2) + '%',
          (colIndex + 1) * cellWidth + padding + left,
          yOffset + top + cellHeight / 2 + 5
        );

        const a = headers[rowIndex];
        const b = headers[colIndex];
        if (all_exist_hedges.some(it => it.join('') === a + b || it.join('') === b + a)) {
          ctx.setLineDash([5, 3]);
          ctx.lineWidth = 1;
          ctx.strokeStyle = '#eb984e';
          ctx.strokeRect(
            (colIndex + 1) * cellWidth - padding + left,
            yOffset + 1.2 * padding + top,
            cellWidth - padding * 5,
            0.85 * cellHeight
          );
          ctx.rect();
        }
      });
    });
  }

  /**
   * 绘制价格、对冲比信息表格
   */
  static _drawInfoTable(chart, left = this.width * 0.35, top = this.height * 0.01) {
    const ctx = chart.ctx;
    const headers = ['β(对冲比)', '价格', '涨跌幅'];
    const themes = this._asset_themes;
    const assetIds = TradeEngine._asset_names;
    const beta_map = TradeEngine._beta_map;

    const data = assetIds.map((assetId, i_info) => {
      // 价格
      const { prices, ts } = TradeEngine.getMarketData(assetId);
      const start_price = prices[0];
      const price = prices.at(-1);
      const rate = (price - start_price) / start_price;
      return [beta_map[assetId][0].toFixed(6), price, rate];
    });

    const cellWidth = 90; // 单元格宽度
    const cellHeight = 20; // 单元格高度
    const padding = 5; // 单元格内边距
    ctx.fillStyle = '#808b96';
    ctx.font = '12px ' + this.font_style;
    // 绘制表头文本
    headers.forEach((header, index) => {
      ctx.fillText(header, (index + 1) * cellWidth + padding + left, top + cellHeight / 2 + 5);
    });

    // 绘制数据单元格
    data.forEach((row, rowIndex) => {
      const yOffset = (rowIndex + 1) * cellHeight;

      // 绘制首列文本
      ctx.font = '12px ' + this.font_style;
      ctx.fillStyle = themes[rowIndex];
      ctx.fillText(assetIds[rowIndex], padding + left, yOffset + top + cellHeight / 2 + 5);
      // 绘制数据单元格内容
      row.forEach((cell, colIndex) => {
        if (colIndex == row.length - 1) {
          ctx.fillStyle = cell > 0 ? '#229954' : cell === 0 ? '#212f3c' : '#e74c3c';
          cell = `${(100 * cell).toFixed(2)}%`;
        } else {
          ctx.fillStyle = themes[rowIndex];
        }
        ctx.fillText(
          cell,
          (colIndex + 1) * cellWidth + padding + left,
          yOffset + top + cellHeight / 2 + 5
        );
      });
    });
  }

  /**
   * 绘制相关性表格
   * @param {*} chart
   */
  static _drawRhoTable(chart) {
    const ctx = chart.ctx;
    const klines = Object.values(TradeEngine.getAllMarketData());
    const headers = TradeEngine._asset_names;
    const themes = this._asset_themes;
    const data = calculateCorrelationMatrix(klines.map(it => it.prices));

    const left = this.width * 0.01;
    const top = this.height * 0.01;
    const cellWidth = 80; // 单元格宽度
    const cellHeight = 20; // 单元格高度
    const padding = 5; // 单元格内边距
    ctx.fillStyle = '#808b96';
    ctx.font = '18px ' + this.font_style;
    ctx.fillText('-- ρ --', left + padding, top + cellHeight / 2 + 5);
    // 绘制表头文本
    ctx.fillStyle = 'black';
    ctx.font = '12px ' + this.font_style;
    headers.forEach((header, index) => {
      ctx.fillStyle = themes[index];
      ctx.fillText(header, (index + 1) * cellWidth + padding + left, top + cellHeight / 2 + 5);
    });

    // 绘制数据单元格
    data.forEach((row, rowIndex) => {
      const yOffset = (rowIndex + 1) * cellHeight;

      // 绘制首列文本
      ctx.fillStyle = 'black';
      ctx.font = '12px ' + this.font_style;
      ctx.fillStyle = themes[rowIndex];
      ctx.fillText(headers[rowIndex], padding + left, yOffset + top + cellHeight / 2 + 5);

      // 绘制数据单元格内容
      row.forEach((cell, colIndex) => {
        ctx.fillStyle = '#808b96';
        ctx.fillText(
          cell,
          (colIndex + 1) * cellWidth + padding + left,
          yOffset + top + cellHeight / 2 + 5
        );
      });
    });
  }

  /**
   * 绘制时间戳
   * @param {} chart
   */
  static _drawDateTime(chart) {
    const ctx = chart.ctx;

    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0'); // 月份从0开始计算
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');

    const stamp = `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;

    const left = chart.width * 0.95;
    const top = chart.height * 0.98;

    ctx.fillStyle = '#808b96';
    ctx.font = '22px' + this.font_style;
    ctx.fillText(stamp, left, top);
  }

  /**
   * 生成文件
   * @param {*} dir
   * @param {*} image
   * @returns
   */
  static async writeChartFile(dir, image) {
    const fullPath = path.join('./chart', dir);
    const dirPath = path.dirname(fullPath);
    await fs.promises.mkdir(dirPath, { recursive: true });
    await fs.promises.writeFile(fullPath, image);
  }

  /**
   * 检查文件
   * @param {*} dir
   * @returns
   */
  static existChartFile(dir) {
    return fs.existsSync(`./chart/${dir}`);
  }

  /**
   * 删除文件
   * @param {*} dir
   * @returns
   */
  static deleteChartFile(dir) {
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

// 网格交易绘制模块
VisualEngine.use(GridTradingSlice);
VisualEngine.use(MainGraph);
// VisualEngine.use(HedgeTransactionSlice);
// VisualEngine.use(HedgeProfitDistance);
