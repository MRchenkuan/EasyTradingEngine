window.TradingApp = window.TradingApp || {};
window.TradingApp.Logs = {
  addLog: function (log) {
    const container = document.getElementById('logsContainer');
    const logElement = document.createElement('div');
    logElement.className = `log-item log-${log.level}`;
    logElement.innerHTML = `<strong>[${log.timestamp}]</strong> ${log.message}`;
    container.appendChild(logElement);
    container.scrollTop = container.scrollHeight;
  }
};