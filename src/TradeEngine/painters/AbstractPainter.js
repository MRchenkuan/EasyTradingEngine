export class AbstractPainter {
  constructor(engine) {
    this.engine = engine; // 注入引擎引用
  }

  // 抽象方法（子类需实现）
  draw() {
    throw new Error('draw() must be implemented by subclass!');
  }

  async flush(file_path, configuration) {
    const render = this.constructor.chartJSNodeCanvas;
    const image = await render.renderToBuffer(configuration);
    await this.engine.writeChartFile(file_path, image);
  }
}
