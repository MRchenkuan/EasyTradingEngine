export class IProcessor{
  timer = null;

  /**
   * 监听
   */
  listen(){
    this.timer = setTimeout(this.listen, 1000);
  }

  stop(){
    clearTimeout(this.timer)
  }
}
