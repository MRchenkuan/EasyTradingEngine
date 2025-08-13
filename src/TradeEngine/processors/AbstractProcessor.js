/**
 * @abstract
 * @param {TradeEngine} engine
 * @param {string} asset_name
 */
export class AbstractProcessor {
  type = 'AbstractProcessor';
  engine = null;
  asset_name = '';

  constructor(engine, asset_name) {
    if (new.target === AbstractProcessor) {
      throw new Error('抽象类不能直接实例化');
    }
    // 运行时检查是否实现了必要的方法
    if (typeof this.tick !== 'function') {
      throw new Error('子类必须实现 tick 方法');
    }
    if (typeof this.display !== 'function') {
      throw new Error('子类必须实现 display 方法');
    }

    // 设置基础属性
    this.engine = engine;
    this.asset_name = asset_name;

    // 验证必要参数
    if (!engine) {
      throw new Error('engine 参数不能为空');
    }
    if (!asset_name) {
      throw new Error('asset_name 参数不能为空');
    }
  }

  /**
   * @abstract
   * @param {number} deltaTime
   */
  tick() {
    throw new Error(`${this.constructor.name} 必须实现 tick 方法`);
  } // 抽象方法占位

  /**
   * @abstract
   * @returns {string} 返回处理器的状态信息
   */
  display() {
    throw new Error(`${this.constructor.name} 必须实现 display 方法`);
  } // 抽象方法占位
}
