# 两个主要策略

策略1 - 多空对冲：💰拟合两个资产价格，通过多空对冲实现套利

策略2 - 趋势网格：💰结合网格交易策略，在趋势中控仓，并在回撤时平仓，实现风险和收益控制

# ONE MORE THING

实现了一个交易引擎🚀

# 先看效果

### 大盘指标 位置：chart/main_chart.jpg

![image](https://github.com/user-attachments/assets/f674885c-64e9-4188-8bff-57a8835553f4)

- 左上角各是个资产之间的ρ值（皮尔逊相关系数），用于比较哪些资产适合做对冲
- 中间是各个资产的实时价格、建议的对冲比（等额对冲），主要关注这个比值是否稳定
- 右边是实测的当前开仓的利润空间
  - 由于我在HedgeProcessor中实现的是「等额」对冲，所以准确利润（相较于等量）是无法确定的（向上成交则大于平均，向下成交则小于平均），但永远会大于0。

### 头寸的切片指标 位置 chart/slices

![image](https://github.com/user-attachments/assets/5724d877-1c7c-4f24-9ac7-329ce9c87749)

- 切片只会展示当前头寸的开平仓信息，并且会按照原始（开仓时的）对冲比来呈现。
  - 在切片中，实时利润也是按原始对冲比来计算的（关于对冲比β，见：NOTICE）

### 各种资产组合的盈利空间（用于盘点当前市场整体是否适合交易） 位置：chart/distance.jpg

![image](https://github.com/user-attachments/assets/c15c4ed6-4486-46ac-8d06-d5213801466f)

- 显示资产之间的背离程度（潜在利润），幅度越大则越背离，幅度越小则越收敛

### 正常启动的效果

“所有系统启动，启动启动！”

![image](https://github.com/user-attachments/assets/dedf2fea-0bac-4ed0-bf58-c90ad136dcec)

# NOTICE

- 做市商策略会亏手续费，没有免费接口不要去跑
- 模拟盘交易不代表实盘，实盘请手动改api地址
- 关于β，我在HedgeProcessor中实现的是：
  - 开仓时，是根据当前的实时价格拟合情况来计算，计算后会保存在订单中
  - 平仓时，是根据原始拟合β（最初开仓时）来计算，避免开、平仓的判定条件有差异。

# 秘钥配置

按照惯例，代码中省略了秘钥配置（代码中缺失的 config.security.mimic.js 文件），请自行手动添加如下代码，然后自行引入

```javascript
const base_url = 'wss://ws.okx.com:8443'; // 这个是
const api_key = '你在okx上申请的 api_key';
const api_secret = '你在okx上申请的 api_secret';
const pass_phrase = '你在okx上设置的 pass_phrase';

export { base_url, api_key, api_secret, pass_phrase };
```

## 可用命令

### 交易相关

- `npm run open [空头资产] [多头资产] [金额]`
  - 开仓命令，支持简写币种名称，不区分大小写
  - 示例：`npm run open sol eth 2000`
- `npm run close [交易ID]`
  - 平仓命令
  - 示例：`npm run close 318fe6d8`
- `npm run list [clear]`
  - 查看当前持仓列表
  - 可选参数 clear 用于清理已平仓记录
  - 示例：`npm run list clear`
- `npm run list:clear` - 清理已平仓数据
- `npm run list:delete <tradeId>` - 删除指定交易ID的所有相关记录
- `npm run monit`
  - 实时监控持仓情况，自动刷新
    <img width="651" alt="image" src="https://github.com/user-attachments/assets/cde8f587-669d-4657-94bf-3b63a20642e5" />

### 绘图相关

- `npm run graph orders` - 切换主图上历史订单记录的显示/隐藏
- `npm run graph trans` - 切换主图上开平仓信息的显示/隐藏

### 程序相关

- `npm run start` - 启动主程序
- `npm run trading` - 启动手动交易程序

### Docker 相关

- `npm run docker` - 重新构建并运行 Docker 容器
- `npm run docker:build` - 构建 Docker 镜像
- `npm run docker:run` - 运行 Docker 容器
- `npm run docker:logs` - 查看 Docker 容器日志

### 开发相关

- `npm run lint` - 检查代码规范
- `npm run format` - 格式化代码

# 交易策略

- 目前支持两种策略：
  - 对冲交易：
    - 基于两个资产的价格关系，通过多空对冲实现套利
    - 策略参数：
      - 对冲资产对：要进行对冲的两个资产，例如 ['XRP-USDT', 'BTC-USDT']
      - 触发门限：当两个资产价格偏离程度达到此门限时触发交易
  - 网格交易：
    - 基于单个资产的价格波动，通过网格交易实现盈利
    - 策略参数：
      - 交易资产：要进行网格交易的资产，例如 'SOL-USDT'
      - 网格宽度：相邻网格价格间隔
      - 最大回撤：当价格下跌超过此值时触发买入
      - 最大反弹：当价格上涨超过此值时触发卖出
      - 每次交易数量：每次买入或卖出的数量
      - 最大持仓数量：最大持仓数量，超过此值不再交易
      - 起始仓位：初始仓位数量
      - 最低触发价格：网格交易的最低触发价格
      - 最高触发价格：网格交易的最高触发价格
- 策略参数可以通过修改 TradeEngine.createHedge() 或 TradeEngine.createGridTrading() 方法的参数进行配置。

## 对冲交易

```javascript
TradeEngine.createHedge(['XRP-USDT', 'BTC-USDT'], 2000, 0.01);
```

- 参数说明：
  - 第一个参数：对冲资产对数组
  - 第二个参数：交易金额（USDT）
  - 第三个参数：触发门限

## 网格交易

![c23a576fc3a9701935b957e6cde69dbc](https://github.com/user-attachments/assets/a949b332-ca94-4ac4-8dad-8ca9c35ddf17)

```bash
# 查看网格交易盈亏统计
npm run grid

# 实时监控网格交易盈亏
npm run grid monit

# 查看指定币种的网格交易盈亏
npm run grid monit BTC
```

统计信息包含：

<img width="587" alt="image" src="https://github.com/user-attachments/assets/0164dc43-628e-41db-8575-c08991dbc270" />

- 净盈亏：当前总盈亏（已实现 + 未实现 - 手续费）
- 已实现：已完成交易的盈亏
- 未实现：未平仓头寸的浮动盈亏
- 手续费：累计交易手续费
- 持仓数量：当前未平仓数量
- 持仓价值：未平仓头寸按最新价计算的市值
- 持仓均价：当前持仓的平均成本

```javascript
TradeEngine.createGridTrading('SOL-USDT', {
  _grid_width: 0.0025, // 网格宽度，相邻网格价格间隔
  _upper_drawdown: 0.0012, // 最大回撤，超过此值触发买入
  _lower_drawdown: 0.0012, // 最大反弹，超过此值触发卖出
  _base_lots: 100, // 每次交易金额
  _start_position: 0, // 起始仓位
  _min_price: 50, // 最低触发价格
  _max_price: 300, // 最高触发价格
});
```

- 参数说明：
  - 第一个参数：交易资产
  - 第二个参数：网格交易参数对象
    - \_grid_width：网格宽度，相邻网格价格间隔
    - \_upper_drawdown：最大回撤，超过此值触发买入
    - \_lower_drawdown：最大反弹，超过此值触发卖出
    - \_base_lots：每次交易金额
    - \_trade_count：每次交易分数
    - \_start_position：起始仓位
    - \_min_price：最低触发价格
    - \_max_price：最高触发价格

# TODO

目前还有不少待完善的工作：

- [ ] 【择时】【重要】开仓时机目前是到达门限就开-难以最大化利润，需要优化下，遵循右侧交易的原则，在回调时开仓
- [ ] 【择时】平仓时机同样可以考虑在回落时平仓（目前是固定门限0.005）
- [x] 【稳健性】下单超时需要进行撤单，单腿超时则需要进行手动强平，避免损失扩大
- [ ] 【稳健性】下单函数改造为 Promise 在等待中轮询状态直到filled
- [ ] 【稳健性】对于各种金额单位转换的代码需要CR以及补全
- [x] 【稳健性】拟合算法依然有提升空间，由于我们拟合的是距离，所以尽量用线性方法，避免过拟合。
- [x] 【稳健性】交易的一致性检查需要整体设计下，比如配队订单交易结果不一致时如何处理。（撤单 or 追单）
- [ ] 【功能】另外，需要写个订单详情处理器，内部做单位统一适配。
- [ ] 【功能】绘图引擎需要提供 web 版
- [ ] 【功能】所有本地的 local_variable 进缓存或者入库
- [ ] 【功能】完全没有做回测功能，因为也没做行情入库，因此如果能做最好行情入库+回测，为什么要入库？因为目前OKX平台的历史数据分时只能取一整天，小时以上的数据粒度又太粗。
- [ ] 【功能】「做市商策略」首先要做成 Processor,然后可以结合趋势跟踪策略优化上下沿设置，主要针对单边趋势设置一个朝向的上下边沿，例如当前价位P：正常{SELL(P+N),BUY(P-N)}；如果单边上行则{SELL(P+1.1xN),BUY(P)}；如果单边下行则{SELL(P),BUY(P-1xN)}
- [x] 【编码规范】为了省事，代码中大量引用交易引擎私有变量(例如: TradeEngine.\_beta_map)需要规范, 实时数据尽量从唯一的（纯函数）tick()函数中读取确保数据安全。
- [x] 【稳健性】在 tick 方法中添加 n 秒限流 - 海龟交易策略

1. **动态回撤门限**

```javascript
// 当前的回撤门限是固定的
let threshold = this._direction < 0 ? this._upper_drawdown : this._lower_drawdown;

// 建议改进：根据市场波动率动态调整
// 1. 计算最近N个周期的价格波动率
// 2. 当波动率较大时适当放宽回撤门限
// 3. 当波动率较小时收紧回撤门限
```

2. **趋势强度相关性**

```javascript
// 当前只是简单判断趋势方向
if (this._tendency == 0 || this._direction / this._tendency >= 0) {
  return;
}

// 建议改进：增加趋势强度判断
// 1. 计算趋势的强度（可以用移动平均线的斜率）
// 2. 强趋势时适当放宽回撤门限
// 3. 弱趋势时收紧回撤门限
```

3. **交易量相关性**

```javascript
// 当前没有考虑交易量因素
// 建议改进：
// 1. 监控交易量的变化
// 2. 大交易量时可以适当放宽回撤门限
// 3. 小交易量时需要更谨慎，收紧回撤门限
```

4. **时间衰减优化**

```javascript
// 当前的时间衰减是固定的
if (timeDiff > this._backoff_1st_time) {
  threshold *= 0.5;
}
if (timeDiff > this._backoff_2nd_time) {
  threshold *= 0.5;
}

// 建议改进：使用平滑衰减函数
// 1. 使用指数衰减而不是阶梯式衰减
// 2. 考虑市场活跃时段差异
// 3. 根据持仓时间动态调整衰减速率
```

5. **价格距离自适应**

```javascript
// 当前价格距离判断较为简单
const price_distance_grid = diff_rate / this._grid_width;

// 建议改进：
// 1. 引入自适应网格宽度
// 2. 在高波动区间适当增加网格宽度
// 3. 在低波动区间减小网格宽度
```

6. **历史表现反馈**

```javascript
// 当前没有利用历史交易表现
// 建议改进：
// 1. 记录每次交易的盈亏情况
// 2. 分析不同回撤门限下的表现
// 3. 动态调整回撤门限以优化收益
```

7. **风险控制优化**

```javascript
// 建议增加以下风险控制措施：
// 1. 设置最大回撤限制
// 2. 增加止损机制
// 3. 根据账户盈亏情况动态调整风险承受能力
```

8. **外部因素整合**

```javascript
// 当前已有但未充分利用的外部因素
factor_is_people_bullish = false;

// 建议改进：
// 1. 整合更多市场情绪指标
// 2. 考虑整体市场环境
// 3. 根据外部因素动态调整回撤门限
```

这些优化建议主要围绕以下几个核心目标：

1. 提高策略的自适应能力
2. 增强风险控制
3. 优化收益表现
4. 提升策略的稳定性

建议逐步实施这些优化，每次修改后进行充分的回测验证，确保改进确实带来了预期的效果。

### 显示设置

- `npm run hide:order` - 在主图上隐藏所有的历史订单记录
- `npm run hide:trans` - 在主图上隐藏所有的开平仓信息

### 图表控制

- `npm run graph orders` - 切换主图上历史订单记录的显示/隐藏
- `npm run graph trans` - 切换主图上开平仓信息的显示/隐藏

| ​**加我好友一起共建**​                                                                                                 | ​**觉得有用也可以请我喝咖啡​**​                                                                                       |
| ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| ​<img width="453" alt="image" src="https://github.com/user-attachments/assets/4b5b6ba4-b196-43d8-9527-37acf52ec878" /> | <img width="452" alt="image" src="https://github.com/user-attachments/assets/6f06f1f2-82bb-4be8-97bf-39f32b551aff" /> |

# LICENSE

本项目基于 **GNU Affero General Public License v3.0 (AGPLv3)** 开源。

- ✅ 允许：查看、修改、非商业用途的分发。
- ⚠️ 要求：基于本项目的衍生作品（包括网络服务）**必须开源**。
- 💼 **商业用途**：需联系作者（[393667111@qq.com](mailto:393667111@qq.com)）获取商业授权并支付费用。
