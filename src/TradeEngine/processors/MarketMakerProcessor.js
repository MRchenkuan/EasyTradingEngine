import { recordMarketMakerTransactions } from '../../recordTools.js';
import { calcProfit, hashString } from '../../tools.js';
import { createOrder_limit, executeOrders, mergeOrder2Result } from '../../trading.js';
import { generateCounterBasedId } from '../../uuid.js';
import { AbstractProcessor } from './AbstractProcessor.js';

export class MarketMakerProcessor extends AbstractProcessor {
  asset_name;
  size;
  distance;
  engine;
  id;
  _position_size;
  distance;
  /**
   * @override
   */
  type = 'MarketMakerProcessor';

  constructor(asset_name, size, distance, engine) {
    super();
    this.asset_name = asset_name;
    this.engine = engine;
    this.id = hashString(`${Date.now()}${asset_names.join('')}`);
    this._position_size = size; // 头寸规模
    this.distance = distance; // 头寸规模
    this.local_variables = new LocalVariable('MarketMakerProcessor');

    // 轮询本地头寸
    this.refreshOpeningTrasactions();
  }

  async bid(assetId, price, size, dir) {
    // TODO
    const tradeId = hashString(generateCounterBasedId());
    let p1 = 0,
      p2 = 0;
    if (dir > 0) {
      p2 = price * 1.005;
      p1 = price * 1;
    }
    if (dir < 0) {
      p2 = price * 1;
      p1 = price * 0.995;
    }

    if (dir == 0) {
      p2 = price * 1.005;
      p1 = price * 0.995;
    }

    const order_short = createOrder_limit(assetId, p2, size / p2, 0);
    const order_long = createOrder_limit(assetId, p1, size / p1, 1);

    // 下单
    let result = await executeOrders([order_long, order_short]);
    result = mergeOrder2Result([order_short, order_long, ...result]);
    recordMarketMakerTransactions(tradeId, result);
    let order_details = await fetchOrders(result);
    order_details = mergeOrder2Result([...result, ...order_details]);
    recordMarketMakerTransactions(tradeId, order_details);
    const profit = calcProfit(order_details);
    return profit;
  }

  /**
   * 时间触发器
   * @param {*} args 引擎的上下文
   */
  tick(args) {}
}
