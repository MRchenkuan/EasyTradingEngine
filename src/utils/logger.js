// 创建一个日志装饰器类
class Logger {
  static _getTimestamp() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    
    return `[${year}-${month}-${day} ${hours}:${minutes}:${seconds}]`;
  }

  static log(...args) {
    originalConsole.log(`${this._getTimestamp()}`, ...args);
  }

  static error(...args) {
    originalConsole.error(`${this._getTimestamp()}`, ...args);
  }

  static warn(...args) {
    originalConsole.warn(`${this._getTimestamp()}`, ...args);
  }
}

// 保存原始console对象
export const originalConsole = {
  log: console.log.bind(console),
  error: console.error.bind(console),
  warn: console.warn.bind(console)
};

// 重写console方法
console.log = (...args) => Logger.log(...args);
console.error = (...args) => Logger.error(...args);
console.warn = (...args) => Logger.warn(...args);
