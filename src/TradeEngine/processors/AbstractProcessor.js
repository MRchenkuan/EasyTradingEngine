/**
 * @abstract
 */
export class AbstractProcessor {

  type="AbstractProcessor";

  constructor() {
    if (new.target === AbstractProcessor) {
      throw new Error("抽象类不能直接实例化");
    }
    // 运行时检查是否实现了 tick 方法
    if (typeof this.tick !== "function") {
      throw new Error("子类必须实现 tick 方法");
    }
  }

  /**
   * @abstract
   * @param {number} deltaTime
   */
  tick(deltaTime) {} // 抽象方法占位

}