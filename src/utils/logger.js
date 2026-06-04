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
    if (globalThis._terminalOriginalLog) {
      globalThis._terminalOriginalLog(`${this._getTimestamp()}`, ...args);
    } else {
      console.log(`${this._getTimestamp()}`, ...args);
    }
  }

  static error(...args) {
    if (globalThis._terminalOriginalError) {
      globalThis._terminalOriginalError(`${this._getTimestamp()}`, ...args);
    } else {
      console.error(`${this._getTimestamp()}`, ...args);
    }
  }

  static warn(...args) {
    if (globalThis._terminalOriginalWarn) {
      globalThis._terminalOriginalWarn(`${this._getTimestamp()}`, ...args);
    } else {
      console.warn(`${this._getTimestamp()}`, ...args);
    }
  }
}

// 保存原始console对象
export const originalConsole = {
  log: console.log.bind(console),
  error: console.error.bind(console),
  warn: console.warn.bind(console),
};

// 设置全局原始console引用（供TerminalDisplay使用）
if (!globalThis._terminalOriginalLog) {
  globalThis._terminalOriginalLog = console.log.bind(console);
  globalThis._terminalOriginalError = console.error.bind(console);
  globalThis._terminalOriginalWarn = console.warn.bind(console);
}

// 不要在这里重写console方法，让TerminalDisplay来处理
// console.log = (...args) => Logger.log(...args);
// console.error = (...args) => Logger.error(...args);
// console.warn = (...args) => Logger.warn(...args);
