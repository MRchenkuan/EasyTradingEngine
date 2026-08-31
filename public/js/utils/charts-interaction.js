window.TradingApp = window.TradingApp || {};
window.TradingApp.ChartInteraction = {
  // document 级 click 监听：点击 canvas 外区域 → unpin 所有 tooltip
  // 只注册一次，setupInteractions 各 asset 共用
  _docClickBound: false,
  _lastTouchEndTs: 0, // 追踪最近一次 touchend，用于过滤移动端 synthetic click
  _bindDocClick: function (self) {
    if (this._docClickBound) return;
    this._docClickBound = true;
    const selfRef = this;

    const isOutsideAllCharts = target => {
      const canvasEls = document.querySelectorAll('canvas[id^="chart-"]');
      for (const c of canvasEls) {
        if (c.contains(target)) return false;
      }
      return true;
    };

    // ===== PC 端：click 事件 =====
    document.addEventListener(
      'click',
      function (e) {
        // 过滤移动端 synthetic click（touchend 后 ~300ms 触发的 click 不是真实 PC 点击）
        if (Date.now() - selfRef._lastTouchEndTs < 500) return;
        if (isOutsideAllCharts(e.target) && self.pinnedTooltip) {
          for (const name of Object.keys(self.pinnedTooltip)) delete self.pinnedTooltip[name];
          const el = document.getElementById('chartjs-tooltip');
          if (el) el.style.opacity = '0';
        }
      },
      true
    ); // capture 阶段尽早捕获

    // ===== 移动端：touchend 事件（原生 touch 事件，不走 synthetic click）=====
    // 移动端没有真正的 click — 全部通过 touchend 处理"点击空白关闭"
    document.addEventListener(
      'touchend',
      function (e) {
        selfRef._lastTouchEndTs = Date.now();
        const touch = e.changedTouches[0];
        if (!touch) return;
        // 用 elementFromPoint 拿到 touch 位置的 DOM 元素，判断是否在 canvas 外
        const el = document.elementFromPoint(touch.clientX, touch.clientY);
        if (el && isOutsideAllCharts(el) && self.pinnedTooltip) {
          for (const name of Object.keys(self.pinnedTooltip)) delete self.pinnedTooltip[name];
          const tip = document.getElementById('chartjs-tooltip');
          if (tip) tip.style.opacity = '0';
        }
      },
      true
    );
  },

  setupInteractions: function (self, assetName, chartInstance, canvasEl) {
    // 确保全局 document click 监听已注册（只注册一次）
    this._bindDocClick(self);

    // 初始化该资产的独立拖拽状态
    self.dragStates[assetName] = {
      isDragging: false,
      startX: 0,
      startOffset: 0,
      mouseDownPos: null, // 记录 mousedown 坐标，排除拖动后的 click
    };

    // 计算每根K线占用的像素宽度
    const getBarPixelWidth = () => {
      const xScale = chartInstance.scales.x;
      const visibleCount = chartInstance.data.labels.length;
      return visibleCount > 0 ? xScale.width / visibleCount : 10;
    };

    // 清除 pinned tooltip 并隐藏
    const clearPinnedTooltip = () => {
      if (self.pinnedTooltip?.[assetName]) {
        delete self.pinnedTooltip[assetName];
        const el = document.getElementById('chartjs-tooltip');
        if (el) el.style.opacity = '0';
        chartInstance.update('none');
      }
    };

    // ===== 点击事件：pin / unpin tooltip（PC 端）=====
    // candlestick body/成交量柱/BS文字标签由自定义 plugin 直接画 canvas，不注册为 dataset 元素，
    // 所以用 intersect:false + mode 'index'：取最近 index（覆盖所有可视区域）
    const interaction = window.TradingApp.ChartInteraction;
    canvasEl.addEventListener('click', function (e) {
      // 过滤移动端 synthetic click（touchend 后 300ms 内触发的 click 不是真实 PC 点击）
      if (Date.now() - interaction._lastTouchEndTs < 500) return;

      const ds = self.dragStates[assetName];
      // 排除拖动后的 click：移动距离超过 5px 视为拖动
      if (ds?.mouseDownPos) {
        const dx = e.clientX - ds.mouseDownPos.x;
        const dy = e.clientY - ds.mouseDownPos.y;
        if (Math.sqrt(dx * dx + dy * dy) > 5) {
          ds.mouseDownPos = null;
          return;
        }
        ds.mouseDownPos = null;
      }

      const elements = chartInstance.getElementsAtEventForMode(
        e,
        'index',
        { intersect: false },
        false
      );

      if (elements.length === 0) {
        clearPinnedTooltip();
        return;
      }

      const idx = elements[0].index;
      self.pinnedTooltip = self.pinnedTooltip || {};

      // toggle：同一个 index 再次点击 → unpin，不同 index → 切换
      if (self.pinnedTooltip[assetName]?.visibleIndex === idx) {
        clearPinnedTooltip();
      } else {
        const rect = canvasEl.getBoundingClientRect();
        const caretX = e.clientX - rect.left;
        const caretY = e.clientY - rect.top;
        self.pinnedTooltip[assetName] = {
          visibleIndex: idx,
          caretX,
          caretY,
        };
        try {
          chartInstance.tooltip.setActiveElements([{ datasetIndex: 0, index: idx }], {
            x: caretX,
            y: caretY,
          });
        } catch (_) {
          // Chart.js v4 tooltip.setActiveElements 可能不存在，忽略
        }
        chartInstance.update('none');
      }
    });

    // ===== 鼠标拖动（仅平移，不缩放）=====
    canvasEl.addEventListener('mousedown', function (e) {
      self.dragStates[assetName].isDragging = true;
      self.dragStates[assetName].startX = e.clientX;
      self.dragStates[assetName].startOffset = self.viewports[assetName] || 0;
      self.dragStates[assetName].mouseDownPos = { x: e.clientX, y: e.clientY };
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
        clearPinnedTooltip();
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
          clearPinnedTooltip();
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
    let lastTouchPos = null; // 记录最近一次触摸坐标，用于 touchend 时 pin 定位
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
          lastTouchPos = { x: e.touches[0].clientX, y: e.touches[0].clientY };

          // 启动长按计时器
          clearTimeout(longPressTimer);
          longPressTimer = setTimeout(() => {
            isLongPress = true;
            if (!self.longPressActive) self.longPressActive = {};
            self.longPressActive[assetName] = true;
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
          lastTouchPos = { x: e.touches[0].clientX, y: e.touches[0].clientY };
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
            clearPinnedTooltip();
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
              clearPinnedTooltip();
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
        // 在重置前捕获状态
        const wasLongPress = isLongPress;
        const lastIdx = self.longPressIndex?.[assetName];
        const lastPos = lastTouchPos;
        isLongPress = false;
        if (self.longPressActive) delete self.longPressActive[assetName];
        canvasEl.style.cursor = 'grab';
        clearLongPressCrosshair();

        if (wasLongPress && lastIdx !== undefined) {
          // ===== 移动端长按释放：pin 住 tooltip，不隐藏 =====
          const rect = canvasEl.getBoundingClientRect();
          const caretX = lastPos ? lastPos.x - rect.left : 0;
          const caretY = lastPos ? lastPos.y - rect.top : 0;
          self.pinnedTooltip = self.pinnedTooltip || {};
          self.pinnedTooltip[assetName] = {
            visibleIndex: lastIdx,
            caretX,
            caretY,
          };
          try {
            chartInstance.tooltip.setActiveElements([{ datasetIndex: 0, index: lastIdx }], {
              x: caretX,
              y: caretY,
            });
          } catch (_) {
            /* ignore */
          }
          chartInstance.update('none');
        } else {
          // 非长按的短按：如果已有 pinned 则取消（"tap blank to close" on mobile canvas）
          clearPinnedTooltip();
          chartInstance._eventHandler({ type: 'mouseout', x: 0, y: 0, native: null });
        }
      },
      { passive: true }
    );

    // 设置初始光标
    canvasEl.style.cursor = 'grab';
  },
};
