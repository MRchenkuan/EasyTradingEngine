window.TradingApp = window.TradingApp || {};
window.TradingApp.Time = {
  updateTime: function () {
    const now = new Date();
    const timeStr = now.toLocaleString('zh-CN', { hour12: false });
    document.getElementById('currentTime').textContent = timeStr;
  },
  startTimeUpdater: function () {
    setInterval(this.updateTime, 1000);
    this.updateTime();
  }
};