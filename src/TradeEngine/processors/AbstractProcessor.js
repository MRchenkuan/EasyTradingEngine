/**
 * @abstract
 */
export class AbstractProcessor {
  type = 'AbstractProcessor';

  constructor() {
    if (new.target === AbstractProcessor) {
      throw new Error('抽象类不能直接实例化');
    }
    // 运行时检查是否实现了必要的方法
    if (typeof this.tick !== 'function') {
      throw new Error('子类必须实现 tick 方法');
    }
    // if (typeof this.display !== 'function') {
    //   throw new Error('子类必须实现 display 方法');
    // }
  }

  /**
   * @abstract
   * @param {number} deltaTime
   */
  tick(deltaTime) {} // 抽象方法占位

  /**
   * @abstract
   * @returns {string} 返回处理器的状态信息
   */
  display() {} // 抽象方法占位
}
