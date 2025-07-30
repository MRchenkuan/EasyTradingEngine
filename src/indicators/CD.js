import { formatTimestamp } from '../tools.js';

/**
 * 多粒度筹码分布计算器（自动适应1m/5m/1H/1D数据）
 * @param {Array} data - K线数据(按时间升序), 格式: [{open, high, low, close, vol, ts}]
 * @param {number} circulation - 流通股本(单位:股)
 * @param {string} [model='uniform'] - 分布模型: 'uniform'(均匀)/'triangle'(三角形)
 * @returns {Object} {
 */
export function calculateChipDistribution(data, f_get_open_interest_by_time, f_get_volume_by_time) {
  const now = Date.now();
  const now_volume = f_get_volume_by_time(now).vol;
  const circulation = f_get_open_interest_by_time(now).oi;
  const now_turnover = now_volume / circulation;
  // 1. 参数校验
  if (!data || data.length === 0) throw new Error('数据不能为空');
  if (circulation <= 0) throw new Error('流通股本必须大于0');
  data = data.map(it => ({
    open: parseFloat(it.open),
    high: parseFloat(it.high),
    low: parseFloat(it.low),
    close: parseFloat(it.close),
    vol: parseFloat(it.vol),
    ts: it.ts,
  }));

  // 2. 自动检测数据粒度
  const granularityMinutes = detectGranularity(data);
  const granularity =
    granularityMinutes === 1
      ? '1分钟'
      : granularityMinutes === 5
        ? '5分钟'
        : granularityMinutes === 60
          ? '1小时'
          : '1天';

  // 3. 动态计算参数
  const params = {
    // 区间数量
    bins: 500,
  };

  // 4. 获取计算窗口 (基于流通股本)
  const { windowData, minPrice, maxPrice } = getVolumeWindow(data);

  // 5. 动态生成价格轴
  const priceStep = (maxPrice - minPrice) / params.bins;
  const priceAxis = Array.from(
    { length: params.bins },
    (_, i) => minPrice + priceStep * (i + 0.5) // 使用区间中心点
  );

  // 6. 初始化筹码数组和历史记录
  let chips = new Array(params.bins).fill(0);
  const allPeriods = []; // 存储所有周期的筹码分布

  let max_turnover = -Infinity;
  let min_turnover = Infinity;
  // 7. 处理计算窗口内所有K线
  windowData.forEach((bar, index) => {
    const { open, high, low, close, vol: volume, ts } = bar;
    const priceRange = [low, high];
    const turnover = f_get_volume_by_time(ts).vol / f_get_open_interest_by_time(ts).oi;
    max_turnover = Math.max(max_turnover, turnover);
    min_turnover = Math.min(min_turnover, turnover);

    if (priceRange[0] >= priceRange[1] || volume <= 0) {
      // 即使当前K线无效，也要记录当前状态（如果需要返回所有周期）
      const currentDistribution = [];
      for (let i = 0; i < priceAxis.length; i++) {
        currentDistribution.push({
          price: priceAxis[i],
          volume: chips[i],
        });
      }

      let min_volume = Infinity;
      let max_volume = -Infinity;
      for (let i = 0; i < chips.length; i++) {
        if (chips[i] < min_volume) min_volume = chips[i];
        if (chips[i] > max_volume) max_volume = chips[i];
      }

      const concentration = calculateConcentration(chips, priceAxis);

      allPeriods.push({
        ts: bar.ts,
        period: index + 1,
        distribution: currentDistribution,
        max_price: maxPrice,
        min_price: minPrice,
        min_volume: min_volume,
        max_volume: max_volume,
        open,
        close,
        volume: f_get_volume_by_time(ts).vol,
        turnover: turnover,
        max_turnover: max_turnover,
        min_turnover: min_turnover,
        open_interest: f_get_open_interest_by_time(ts).oi,
        step: priceStep,
        concentration,
      });
      return;
    }

    // 计算单根K线在各价位的筹码分布
    const distribution = calcTriangleDistribution(
      priceRange,
      open,
      high,
      low,
      close,
      volume,
      params.bins,
      minPrice,
      priceStep
    );

    // 应用衰减系数并累加
    chips = chips.map(v => v * (1 - Math.min(turnover, 1))); // 先整体衰减
    // console.log(`[${formatTimestamp(bar.ts)}] 换手率: ${(volume / open_interest).toFixed(4)}%`);
    distribution.forEach((chip, i) => (chips[i] += chip)); // 再添加新筹码

    // 如果需要返回所有周期，保存当前周期的筹码分布
    const currentDistribution = [];
    for (let i = 0; i < priceAxis.length; i++) {
      currentDistribution.push({
        price: priceAxis[i],
        volume: chips[i],
      });
    }

    let min_volume = Infinity;
    let max_volume = -Infinity;
    for (let i = 0; i < chips.length; i++) {
      if (chips[i] < min_volume) min_volume = chips[i];
      if (chips[i] > max_volume) max_volume = chips[i];
    }

    const concentration = calculateConcentration(chips, priceAxis);

    allPeriods.push({
      ts: bar.ts,
      period: index + 1,
      distribution: currentDistribution,
      max_price: maxPrice,
      min_price: minPrice,
      min_volume: min_volume,
      max_volume: max_volume,
      open,
      close,
      volume: f_get_volume_by_time(ts).vol,
      turnover: turnover,
      max_turnover: max_turnover,
      min_turnover: min_turnover,
      open_interest: f_get_open_interest_by_time(ts).oi,
      step: priceStep,
      concentration,
    });
  });

  // 8. 计算最终的筹码集中度
  const concentration = calculateConcentration(chips, priceAxis);

  const distribution = [];
  for (let i = 0; i < priceAxis.length; i++) {
    distribution.push({
      price: priceAxis[i],
      volume: chips[i],
    });
  }

  let min_volume = Infinity;
  let max_volume = -Infinity;
  for (let i = 0; i < chips.length; i++) {
    if (chips[i] < min_volume) min_volume = chips[i];
    if (chips[i] > max_volume) max_volume = chips[i];
  }

  const result = {
    distribution,
    allPeriods,
    totalPeriods: allPeriods.length,
    max_price: maxPrice,
    min_price: minPrice,
    min_volume: min_volume,
    max_volume: max_volume,
    turnover: now_turnover,
    volume: now_volume,
    open_interest: circulation,
    step: priceStep,
    concentration,
  };

  return result;
}

// 自动检测数据粒度 (单位:分钟)
function detectGranularity(data) {
  if (data.length < 2) return 1440; // 默认日线
  const millisPerMinute = 60 * 1000;
  const interval = (data[1].ts - data[0].ts) / millisPerMinute;

  // 识别标准粒度 (1m/5m/15m/30m/1H/1D)
  const standardGranularities = [1, 5, 15, 30, 60, 1440];
  return standardGranularities.reduce((prev, curr) =>
    Math.abs(curr - interval) < Math.abs(prev - interval) ? curr : prev
  );
}

// 获取基于流通股本的数据窗口
function getVolumeWindow(data) {
  let totalVol = 0;
  let minPrice = Number.MAX_VALUE;
  let maxPrice = Number.MIN_VALUE;
  const result = [];

  // 从最新数据向前遍历
  for (let i = data.length - 1; i >= 0; i--) {
    const bar = data[i];
    totalVol += parseFloat(bar.vol);
    minPrice = Math.min(minPrice, parseFloat(bar.low));
    maxPrice = Math.max(maxPrice, parseFloat(bar.high));
    result.unshift(bar);

    if (result.length >= 8000) break;
  }
  return { windowData: result, minPrice, maxPrice };
}

// 三角形分布模型
function calcTriangleDistribution(
  priceRange,
  open,
  high,
  low,
  close,
  volume,
  bins,
  minPrice,
  priceStep
) {
  const dist = new Array(bins).fill(0);
  const rangeWidth = priceRange[1] - priceRange[0];
  if (rangeWidth === 0) return dist;

  // 计算当日均价 (价格重心)
  const avgPrice = (open + high + low + close) / 4;

  // 找出影响的区间范围
  const startIdx = Math.max(0, Math.floor((priceRange[0] - minPrice) / priceStep));
  const endIdx = Math.min(bins - 1, Math.ceil((priceRange[1] - minPrice) / priceStep));

  // 提前退出条件
  if (startIdx > endIdx) return dist;

  // 计算权重总和
  let totalWeight = 0;
  const weights = [];
  for (let i = startIdx; i <= endIdx; i++) {
    const price = minPrice + (i + 0.5) * priceStep;
    const distance = Math.abs(price - avgPrice);
    // 距离均价越近权重越大 (线性衰减)
    const weight = Math.exp(-Math.pow(distance, 2) / (2 * Math.pow(priceStep, 2)));
    weights.push(weight);
    totalWeight += weight;
  }

  // 无有效权重时退出
  if (totalWeight <= 0) return dist;

  // 按权重分配成交量
  for (let i = 0; i < weights.length; i++) {
    const idx = startIdx + i;
    dist[idx] += (weights[i] / totalWeight) * volume;
  }
  return dist;
}

// 筹码集中度计算 (COST(90)/COST(10))
function calculateConcentration(chips, prices) {
  // 复制并排序(从大到小)
  const sorted = chips.map((v, i) => [v, prices[i]]).sort((a, b) => a[1] - b[1]);

  // 计算总筹码量
  const totalChips = sorted.reduce((sum, item) => sum + item[0], 0);
  if (totalChips <= 0) return 1;

  // 查找90%和10%成本分位点
  let accum = 0;
  let cost90 = null,
    cost10 = null;

  for (const [vol, price] of sorted) {
    accum += vol;
    if (!cost90 && accum >= totalChips * 0.9) {
      cost90 = price;
    }
    if (accum >= totalChips * 0.1) {
      if (!cost10) cost10 = price;
      break;
    }
  }

  // 异常处理
  if (!cost90 || !cost10 || cost10 === 0) return 1;
  return cost90 / cost10;
}
