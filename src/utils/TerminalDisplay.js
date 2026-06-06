import { EventEmitter } from 'events';

const assetData = new Map();
const logBuffer = [];
const maxLogLines = 100; // 增加日志缓冲区大小
let currentPage = 0;
const assetsPerPage = 1;

export class TerminalDisplay extends EventEmitter {
  constructor() {
    super();
    this.isActive = false;
    this.lastUpdateTime = 0;
    this.updateInterval = null;
    this.isRendering = false;
    this.originalConsole = {
      log: console.log.bind(console),
      error: console.error.bind(console),
      warn: console.warn.bind(console),
    };
  }

  start() {
    if (this.isActive) return;
    this.isActive = true;

    this.redirectConsole();
    this.setupTerminalEvents();

    this.updateInterval = setInterval(() => {
      this.render();
    }, 100);

    setTimeout(() => {
      this.render();
    }, 100);
  }

  stop() {
    this.isActive = false;
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
    this.restoreConsole();
    process.stdin.setRawMode(false);
    process.stdin.pause();
    this.clearScreen();
    this.originalConsole.log('终端显示已关闭');
  }

  clearScreen() {
    process.stdout.write('\x1B[2J');
    process.stdout.write('\x1B[0f');
  }

  redirectConsole() {
    const addLog = message => {
      const timestamp = new Date().toLocaleTimeString();
      logBuffer.push(`[${timestamp}] ${message}`);
      if (logBuffer.length > maxLogLines) {
        logBuffer.shift();
      }
    };

    console.log = (...args) => {
      addLog(
        args.map(arg => (typeof arg === 'object' ? JSON.stringify(arg) : String(arg))).join(' ')
      );
    };

    console.error = (...args) => {
      addLog(
        '[ERROR] ' +
          args.map(arg => (typeof arg === 'object' ? JSON.stringify(arg) : String(arg))).join(' ')
      );
    };

    console.warn = (...args) => {
      addLog(
        '[WARN] ' +
          args.map(arg => (typeof arg === 'object' ? JSON.stringify(arg) : String(arg))).join(' ')
      );
    };
  }

  restoreConsole() {
    console.log = this.originalConsole.log;
    console.error = this.originalConsole.error;
    console.warn = this.originalConsole.warn;
  }

  setupTerminalEvents() {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on('data', data => {
      if (data[0] === 27) {
        if (data.length > 1 && data[1] === 91) {
          if (data.length > 2) {
            switch (data[2]) {
              case 68: // 左箭头
              case 65: // 上箭头
                this.previousPage();
                return;
              case 67: // 右箭头
              case 66: // 下箭头
                this.nextPage();
                return;
            }
          }
        }
        this.stop();
        process.exit(0);
      }
    });
  }

  updateAsset(assetName, data) {
    assetData.set(assetName, {
      ...data,
      timestamp: Date.now(),
    });
    this.lastUpdateTime = Date.now();
  }

  getAssets() {
    return Array.from(assetData.keys());
  }

  getCurrentPageAssets() {
    const assets = this.getAssets();
    const start = currentPage * assetsPerPage;
    return assets.slice(start, start + assetsPerPage);
  }

  nextPage() {
    const totalPages = Math.max(1, this.getAssets().length);
    if (currentPage < totalPages - 1) {
      currentPage++;
    }
  }

  previousPage() {
    if (currentPage > 0) {
      currentPage--;
    }
  }

  getDisplayWidth(str) {
    let width = 0;
    for (let i = 0; i < str.length; i++) {
      const code = str.codePointAt(i);
      // 中文字符、全角字符、emoji等占用2个字符宽度
      if (code > 0x7f) {
        // 简单判断：非ASCII字符都算2个宽度
        width += 2;
        // 如果是emoji（代理对），跳过下一个字符
        if (code >= 0x10000) {
          i++;
        }
      } else {
        width += 1;
      }
    }
    return width;
  }

  padLine(text, totalWidth) {
    const displayWidth = this.getDisplayWidth(text);
    const padding = totalWidth - displayWidth;
    if (padding <= 0) {
      // 需要截断，逐个字符添加直到达到宽度限制
      let result = '';
      let currentWidth = 0;
      for (let i = 0; i < text.length; i++) {
        const char = text[i];
        const charWidth = this.getDisplayWidth(char);
        if (currentWidth + charWidth > totalWidth) break;
        result += char;
        currentWidth += charWidth;
      }
      return result;
    }
    return text + ' '.repeat(padding);
  }

  renderAssetBox(assetName, data, width) {
    const lines = [];
    const contentWidth = width - 4;

    lines.push('╔' + '═'.repeat(width - 2) + '╗');

    let title = assetName;
    const titleDisplayWidth = this.getDisplayWidth(title);
    if (titleDisplayWidth > contentWidth) {
      title = this.padLine(title, contentWidth);
    }
    lines.push(`║ ${title}${' '.repeat(contentWidth - this.getDisplayWidth(title))} ║`);

    lines.push('╠' + '═'.repeat(width - 2) + '╣');

    if (data) {
      const indicators = data.indicators || data;

      const metrics = [
        indicators.price !== undefined ? `价格: ${indicators.price}` : '',
        indicators.price_grid_count !== undefined ? `价距格数: ${indicators.price_grid_count}` : '',
        indicators.price_span !== undefined
          ? `价差格数: ${parseFloat(indicators.price_span).toFixed(2)}`
          : '',
        indicators.volatility !== undefined
          ? `瞬时波动: ${(indicators.volatility * 100).toFixed(2)}%`
          : '',
        indicators.atr_6 !== undefined ? `ATR(6): ${(indicators.atr_6 * 100).toFixed(2)}%` : '',
        indicators.atr_22 !== undefined ? `ATR(22): ${(indicators.atr_22 * 100).toFixed(2)}%` : '',
        indicators.atr_120 !== undefined
          ? `ATR(120): ${(indicators.atr_120 * 100).toFixed(2)}%`
          : '',
        indicators.boll_bandwidth !== undefined
          ? `布林带宽: ${(indicators.boll_bandwidth * 100).toFixed(2)}%`
          : '',
        indicators.vol_power !== undefined
          ? `量能因子: ${(indicators.vol_power * 100).toFixed(2)}%`
          : '',
        indicators.rsi_fast !== undefined && indicators.rsi_slow !== undefined
          ? `动量因子(RSI): ${parseFloat(indicators.rsi_fast).toFixed(2)} / ${parseFloat(indicators.rsi_slow).toFixed(2)}`
          : '',
        indicators.initial_threshold !== undefined
          ? `初始阈值: ${(indicators.initial_threshold * 100).toFixed(2)}%`
          : '',
      ].filter(Boolean);

      metrics.forEach(metric => {
        const paddedContent = this.padLine(metric, contentWidth);
        lines.push(
          `║ ${paddedContent}${' '.repeat(contentWidth - this.getDisplayWidth(paddedContent))} ║`
        );
      });

      lines.push('╠' + '─'.repeat(width - 2) + '╣');

      // 显示信号信息
      if (indicators.factors) {
        const factors = indicators.factors;
        const cleanText = text => {
          // 只移除特定的 emoji 字符，保留所有其他字符
          const emojiList = ['🚧', '🔹', '🔺', '🔻', '♻️', '📈', '📉', '🪜', '⌛', '🐢'];
          let result = text;
          emojiList.forEach(emoji => {
            result = result.replace(new RegExp(emoji, 'g'), '');
          });
          return result.replace(/\s+/g, ' ').trim();
        };
        const signals = [
          factors.boll_msg
            ? `boll: ${factors.boll_factor.toFixed(1)} ${cleanText(factors.boll_msg)}`
            : '',
          factors.grid_msg
            ? `grid: ${factors.grid_factor.toFixed(1)} ${cleanText(factors.grid_msg)}`
            : '',
          factors.rsi_msg
            ? `rsi: ${factors.rsi_factor.toFixed(1)} ${cleanText(factors.rsi_msg)}`
            : '',
          factors.time_factor ? `time: ${factors.time_factor.toFixed(2)}` : '',
        ].filter(Boolean);

        signals.forEach(signal => {
          const paddedContent = this.padLine(signal, contentWidth);
          lines.push(
            `║ ${paddedContent}${' '.repeat(contentWidth - this.getDisplayWidth(paddedContent))} ║`
          );
        });
      }

      lines.push('╠' + '─'.repeat(width - 2) + '╣');

      const summary = [
        indicators.final_threshold !== undefined
          ? `调整阈值: ${(indicators.final_threshold * 100).toFixed(2)}%`
          : '',
        indicators.diff_rate !== undefined
          ? `当前回撤: ${(indicators.diff_rate * 100).toFixed(2)}%`
          : '',
        indicators.stopLossLevel !== undefined ? `止损等级: ${indicators.stopLossLevel}` : '',
      ].filter(Boolean);

      summary.forEach(item => {
        const paddedContent = this.padLine(item, contentWidth);
        lines.push(
          `║ ${paddedContent}${' '.repeat(contentWidth - this.getDisplayWidth(paddedContent))} ║`
        );
      });
    }

    lines.push('╚' + '═'.repeat(width - 2) + '╝');

    return lines;
  }

  render() {
    if (!this.isActive || this.isRendering) return;
    this.isRendering = true;

    try {
      const terminalWidth = process.stdout.columns || 120;
      const terminalHeight = process.stdout.rows || 30;

      const assets = this.getAssets();
      const totalPages = Math.max(1, assets.length);
      const currentAssets = this.getCurrentPageAssets();

      const output = [];

      const currentTime = new Date().toLocaleTimeString();
      const header = `交易监控面板 | 资产数: ${assets.length} | 当前: ${currentPage + 1}/${totalPages} | ${currentTime} | 按 ←→ 翻页 | ESC 退出`;
      output.push(this.padLine(header, terminalWidth));
      output.push('─'.repeat(terminalWidth));

      if (currentAssets.length === 0) {
        const emptyMsg = '[ 暂无资产数据 ]';
        const padding = Math.floor((terminalWidth - emptyMsg.length) / 2);
        output.push(this.padLine(' '.repeat(padding) + emptyMsg, terminalWidth));
        for (let i = 0; i < 16; i++) {
          output.push(' '.repeat(terminalWidth));
        }
      } else {
        const boxLines = this.renderAssetBox(
          currentAssets[0],
          assetData.get(currentAssets[0]),
          terminalWidth
        );
        output.push(...boxLines);
      }

      output.push(' '.repeat(terminalWidth));

      const logHeader = '日志信息:';
      output.push(this.padLine(logHeader, terminalWidth));
      output.push('─'.repeat(terminalWidth));

      // 计算日志区域可用行数（使用所有剩余空间）
      const logStartLine = output.length;
      const availableLogLines = Math.max(0, terminalHeight - logStartLine);

      // 需要显示的日志数量（取较小值）
      const displayLogCount = Math.min(logBuffer.length, availableLogLines);

      // 需要添加的空白行数（在日志上方）
      const emptyLines = availableLogLines - displayLogCount;

      // 先添加空白行
      for (let i = 0; i < emptyLines; i++) {
        output.push(' '.repeat(terminalWidth));
      }

      // 然后添加最新的日志内容（从底部开始）
      for (let i = logBuffer.length - displayLogCount; i < logBuffer.length; i++) {
        let logLine = logBuffer[i];
        // 移除换行符和多余空白，确保每条日志只占一行
        logLine = logLine
          .replace(/[\r\n]+/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        output.push(this.padLine(logLine.substring(0, terminalWidth), terminalWidth));
      }

      process.stdout.write('\x1B[2J');
      process.stdout.write('\x1B[H');
      process.stdout.write(output.join('\n'));
    } catch (error) {
      this.originalConsole.error('渲染错误:', error);
    } finally {
      this.isRendering = false;
    }
  }
}

export const terminalDisplay = new TerminalDisplay();
