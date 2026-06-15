window.TradingApp = window.TradingApp || {};
window.TradingApp.ChartInteraction = {
  setupInteractions: function (self, assetName, chartInstance, canvasEl) {
    // 初始化该资产的独立拖拽状态
    self.dragStates[assetName] = {
      isDragging: false,
      startX: 0,
      startOffset: 0,
    };

    // 计算每根K线占用的像素宽度
    const getBarPixelWidth = () => {
      const xScale = chartInstance.scales.x;
      const visibleCount = chartInstance.data.labels.length;
      return visibleCount > 0 ? xScale.width / visibleCount : 10;
    };

    // ===== 鼠标拖动（仅平移，不缩放）=====
    canvasEl.addEventListener('mousedown', function (e) {
      self.dragStates[assetName].isDragging = true;
      self.dragStates[assetName].startX = e.clientX;
      self.dragStates[assetName].startOffset = self.viewports[assetName] || 0;
      canvasEl.style.cursor = 'grabbing';
      e.preventDefault();
    });

    canvasEl.addEventListener('mousemove', function (e) {
      const ds = self.dragStates[assetName];
      if (!ds || !ds.isDragging) return;
      const dx = e.clientX - ds.startX;
      const barWidth = getBarPixelWidth();
      if (barWidth <= 0) return;
      const barShift = Math.round(dx / barWidth);
      const cached = self.chartDataCache[assetName];
      if (!cached) return;
      const totalCount = cached.allBodyData.length;
      let newOffset = ds.startOffset + barShift;
      newOffset = Math.max(0, Math.min(totalCount - self.MIN_VISIBLE_COUNT, newOffset));
      if (newOffset !== self.viewports[assetName]) {
        self.viewports[assetName] = newOffset;
        self.refreshViewport(assetName);
      }
    });

    canvasEl.addEventListener('mouseup', function () {
      const ds = self.dragStates[assetName];
      if (ds && ds.isDragging) {
        ds.isDragging = false;
        canvasEl.style.cursor = 'grab';
      }
    });

    canvasEl.addEventListener('mouseleave', function () {
      const ds = self.dragStates[assetName];
      if (ds && ds.isDragging) {
        ds.isDragging = false;
        canvasEl.style.cursor = 'grab';
      }
    });

    // PC端：触控板双指缩放（ctrlKey+wheel）
    canvasEl.addEventListener(
      'wheel',
      function (e) {
        if (!e.ctrlKey) return;
        e.preventDefault();
        const cached = self.chartDataCache[assetName];
        if (!cached) return;

        const currentCount = self.visibleCounts[assetName] || self.DEFAULT_VISIBLE_COUNT;
        const delta = e.deltaY > 0 ? 20 : -20;
        let newCount = currentCount + delta;
        newCount = Math.max(self.MIN_VISIBLE_COUNT, Math.min(self.MAX_VISIBLE_COUNT, newCount));

        if (newCount !== currentCount) {
          self.visibleCounts[assetName] = newCount;
          self.refreshViewport(assetName);
        }
      },
      { passive: false }
    );

    // ===== 触摸拖动 + 双指缩放 + 长按查看（移动端）=====
    let touchStartX = 0;
    let touchStartOffset = 0;
    let pinchStartDist = 0;
    let pinchStartCount = 0;
    let longPressTimer = null;
    let isLongPress = false;
    const LONG_PRESS_DURATION = 400;

    // 将触摸 x 坐标转换为数据索引
    const getTouchDataIndex = clientX => {
      const rect = canvasEl.getBoundingClientRect();
      const x = clientX - rect.left;
      const xScale = chartInstance.scales.x;
      return xScale.getValueForPixel(x);
    };

    // 更新长按十字线位置
    const updateLongPressCrosshair = clientX => {
      if (!self.longPressIndex) self.longPressIndex = {};
      const idx = getTouchDataIndex(clientX);
      if (idx !== undefined && idx !== null) {
        const visibleCount = chartInstance.data.labels.length;
        self.longPressIndex[assetName] = Math.max(0, Math.min(visibleCount - 1, Math.round(idx)));
        chartInstance.update('none');
      }
    };

    // 清除长按十字线
    const clearLongPressCrosshair = () => {
      if (self.longPressIndex) {
        delete self.longPressIndex[assetName];
        chartInstance.update('none');
      }
    };

    canvasEl.addEventListener(
      'touchstart',
      function (e) {
        isLongPress = false;
        if (e.touches.length === 1) {
          touchStartX = e.touches[0].clientX;
          touchStartOffset = self.viewports[assetName] || 0;

          // 启动长按计时器
          clearTimeout(longPressTimer);
          longPressTimer = setTimeout(() => {
            isLongPress = true;
            canvasEl.style.cursor = 'crosshair';
            // 显示十字线和 tooltip
            updateLongPressCrosshair(e.touches[0].clientX);
            const touch = e.touches[0];
            const rect = canvasEl.getBoundingClientRect();
            const x = touch.clientX - rect.left;
            const y = touch.clientY - rect.top;
            chartInstance._eventHandler({ type: 'mousemove', x: x, y: y, native: e });
          }, LONG_PRESS_DURATION);
        } else if (e.touches.length === 2) {
          // 双指缩放开始，取消长按
          clearTimeout(longPressTimer);
          isLongPress = false;
          const dx = e.touches[0].clientX - e.touches[1].clientX;
          const dy = e.touches[0].clientY - e.touches[1].clientY;
          pinchStartDist = Math.sqrt(dx * dx + dy * dy);
          pinchStartCount = self.visibleCounts[assetName] || self.DEFAULT_VISIBLE_COUNT;
        }
      },
      { passive: true }
    );

    canvasEl.addEventListener(
      'touchmove',
      function (e) {
        if (isLongPress && e.touches.length === 1) {
          // 长按模式：滑动查看每根K线的 tooltip，禁止拖拽
          e.preventDefault();
          updateLongPressCrosshair(e.touches[0].clientX);
          const touch = e.touches[0];
          const rect = canvasEl.getBoundingClientRect();
          const chartArea = chartInstance.chartArea;
          // 将坐标 clamp 到图表区域内，确保滑出图表时 tooltip 仍跟随十字线
          let x = touch.clientX - rect.left;
          let y = touch.clientY - rect.top;
          x = Math.max(chartArea.left, Math.min(chartArea.right, x));
          y = Math.max(chartArea.top, Math.min(chartArea.bottom, y));
          chartInstance._eventHandler({ type: 'mousemove', x: x, y: y, native: e });
          return;
        }

        if (e.touches.length === 1) {
          // 短按拖动：如果移动距离超过阈值，取消长按计时器
          const dx = e.touches[0].clientX - touchStartX;
          if (Math.abs(dx) > 10) {
            clearTimeout(longPressTimer);
          }
          // 单指拖动平移
          const barWidth = getBarPixelWidth();
          if (barWidth <= 0) return;
          const barShift = Math.round(dx / barWidth);
          const cached = self.chartDataCache[assetName];
          if (!cached) return;
          const totalCount = cached.allBodyData.length;
          let newOffset = touchStartOffset + barShift;
          newOffset = Math.max(0, Math.min(totalCount - self.MIN_VISIBLE_COUNT, newOffset));
          if (newOffset !== self.viewports[assetName]) {
            self.viewports[assetName] = newOffset;
            self.refreshViewport(assetName);
          }
        } else if (e.touches.length === 2) {
          // 双指缩放
          const dx = e.touches[0].clientX - e.touches[1].clientX;
          const dy = e.touches[0].clientY - e.touches[1].clientY;
          const currentDist = Math.sqrt(dx * dx + dy * dy);
          if (pinchStartDist > 0) {
            const scale = pinchStartDist / currentDist;
            let newCount = Math.round(pinchStartCount * scale);
            newCount = Math.max(self.MIN_VISIBLE_COUNT, Math.min(self.MAX_VISIBLE_COUNT, newCount));
            if (newCount !== self.visibleCounts[assetName]) {
              self.visibleCounts[assetName] = newCount;
              self.refreshViewport(assetName);
            }
          }
        }
      },
      { passive: false }
    );

    canvasEl.addEventListener(
      'touchend',
      function () {
        clearTimeout(longPressTimer);
        isLongPress = false;
        canvasEl.style.cursor = 'grab';
        clearLongPressCrosshair();
        // 松开时隐藏tooltip
        const el = document.getElementById('chartjs-tooltip');
        if (el) el.style.opacity = '0';
        chartInstance._eventHandler({ type: 'mouseout', x: 0, y: 0, native: null });
      },
      { passive: true }
    );

    // 设置初始光标
    canvasEl.style.cursor = 'grab';
  },
};
