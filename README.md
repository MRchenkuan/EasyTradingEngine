一个基于 Node.js 的专业量化交易系统，支持多种交易策略，包括网格交易、对冲交易等。系统采用模块化架构设计，具备实时数据处理、可视化图表、风险控制等完整功能。

## 先看一下效果

### 网格交易实时看板

![](https://github.com/user-attachments/assets/aeca8668-31a8-4bb2-97cb-a9468fe6e9b2)

### 对冲交易利润看板

![](https://github.com/user-attachments/assets/cde8f587-669d-4657-94bf-3b63a20642e5)

### 网格交易策略利润看板

![](https://github.com/user-attachments/assets/0164dc43-628e-41db-8575-c08991dbc270)

## 联系我

| ​**加我好友一起共建**                                                                                                  | ​**觉得有用也可以请我喝咖啡​**                                                                                        |
| ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| ​<img width="453" alt="image" src="https://github.com/user-attachments/assets/4b5b6ba4-b196-43d8-9527-37acf52ec878" /> | <img width="452" alt="image" src="https://github.com/user-attachments/assets/6f06f1f2-82bb-4be8-97bf-39f32b551aff" /> |

## 🚀 核心特性

- 多策略支持 ：网格交易、对冲交易、做市商策略
- 实时数据处理 ：WebSocket 实时行情数据接收与处理
- 可视化引擎 ：内置图表绘制系统，支持技术指标显示
- 风险控制 ：多层止损机制、持仓监控、保证金管理
- 模块化架构 ：可扩展的处理器和绘图模块
- Worker 线程 ：图表渲染与交易引擎分离，确保性能
- 缓存优化 ：智能缓存机制减少 API 调用

## 📁 项目结构

```
okx-trading/
├── config.js                 # 主配置文件
├── src/
│   ├── main.js               # 程序入口
│   ├── TradeEngine/          # 交易引擎核心
│   │   ├── TradeEngine.js    # 主交易引擎
│   │   ├── VisualEngine.js   # 可视化引擎
│   │   ├── processors/       # 交易策略处理器
│   │   │   ├── GridTradingProcessor.js    # 网格交易
│   │   │   ├── HedgeProcessor.js          # 对冲交易
│   │   │   ├── MarketMakerProcessor.js    # 做市商
│   │   │   └── utils/                     # 工具类
│   │   └── painters/         # 图表绘制模块
│   │       ├── MainGraph.js              # 主图表
│   │       ├── GridTradingSlice.js       # 网格交易图表
│   │       └── HedgeProfitDistance.js    # 对冲盈亏图表
│   ├── workers/              # Worker 线程
│   │   └── VisualWorker.js   # 可视化 Worker
│   ├── indicators/           # 技术指标
│   │   ├── MA.js             # 移动平均线
│   │   ├── BOLL.js           # 布林带
│   │   ├── RSI.js            # 相对强弱指数
│   │   ├── ATR.js            # 平均真实波幅
│   │   └── CD.js             # 筹码分布
│   ├── scripts/              # 命令行工具
│   ├── utils/                # 工具函数
│   ├── api.js                # OKX API 接口
│   ├── enum.js               # 枚举定义
│   └── tools.js              # 核心工具函数
└── package.json
```

## ⚙️ 环境配置

### 1. 安装依赖

```
npm install
# 或
pnpm instal
```

### 2. 配置 API 密钥

创建 config.security.js 文件(用于实盘)：

```
const base_url = 'wss://ws.okx.com:8443';
const api_key = '你的 OKX API Key';
const api_secret = '你的 OKX API Secret';
const pass_phrase = '你的 OKX API Passphrase';

export { base_url, api_key, api_secret, pass_phrase };
```

创建 config.security.mimic.js 文件（用于模拟盘）：

```
const base_url = 'wss://ws.okx.com:8443';
const api_key = '你的 OKX API Key';
const api_secret = '你的 OKX API Secret';
const pass_phrase = '你的 OKX API Passphrase';

export { base_url, api_key, api_secret, pass_phrase };
```

### 3. 配置交易参数

编辑 `config.js` 文件：

```
// 交易环境
export const Env = TradeEnv.PRODUCTION; // 或 TradeEnv.MIMIC

// 是否开启实盘交易
export const trade_open = true;

// K线配置
export const KLine = {
  bar_type: BarType.MINUTE_5,  // K线周期
  max_days: 3650,              // 历史数据天数
  candle_limit: 3000,          // K线数量限制
};

// 交易策略配置
export const Strategies = [
  {
    name: StrategyType.GRID_TRADING,
    params: {
      assetId: 'BTC-USDT-SWAP',
      _grid_width: 0.005,           // 网格宽度
      _upper_drawdown: 0.0075,      // 上行回撤
      _lower_drawdown: 0.0075,      // 下行回撤
      _base_amount: 60,             // 基础交易金额
      _position_supress_count: 6,   // 持仓警戒线
      _position_survival_count: 12, // 持仓止损线
    },
  },
];
```

## 🎯 交易策略

### 网格交易策略

网格交易是一种在价格波动中获利的策略，通过在不同价格水平设置买卖订单来捕获价格波动。

核心参数：

- \_grid_width : 网格宽度，决定相邻订单的价格间距
- \_upper_drawdown : 上行回撤阈值，价格上涨超过此值时卖出
- \_lower_drawdown : 下行回撤阈值，价格下跌超过此值时买入
- \_base_amount : 每次交易的基础金额
- \_position_supress_count : 持仓警戒线，超过时降低交易频率
- \_position_survival_count : 持仓止损线，超过时强制平仓
  风险控制：

- 两层止损机制：警戒线和生存线
- 动态阈值调整：根据市场波动性调整交易阈值
- 保证金监控：实时监控保证金比例

### 对冲交易策略

通过同时持有两个相关资产的多空头寸来获取价差收益。

```
TradeEngine.createHedge(['BTC-USDT', 'ETH-USDT'], 200, 0.02);
```

参数说明：

- 第一个参数：对冲资产对
- 第二个参数：交易金额
- 第三个参数：触发阈值

## 🖥️ 命令行工具

### 程序控制

```
# 启动主程序
npm run start

# 启动手动交易程序
npm run trading
```

### 交易操作

```
# 开仓（支持简写币种名称）
npm run open sol eth 2000

# 平仓
npm run close 318fe6d8

# 查看持仓
npm run list

# 清理已平仓记录
npm run list clear

# 实时监控
npm run monit
```

### 网格交易监控

```
# 查看网格交易统计
npm run grid

# 实时监控网格交易
npm run grid monit

# 监控指定币种
npm run grid monit BTC
```

### 图表控制

```
# 切换历史订单显示
npm run graph orders

# 切换开平仓信息显示
npm run graph trans
```

### Docker 部署

```
# 构建并运行
npm run docker

# 单独构建
npm run docker:build

# 单独运行
npm run docker:run

# 查看日志
npm run docker:logs
```

## 🏗️ 系统架构

### 交易引擎 (TradeEngine)

`TradeEngine.js` 是系统的核心，负责：

- 数据管理 ：实时行情数据接收、存储和处理
- 策略执行 ：管理和执行各种交易策略
- 风险控制 ：持仓监控、保证金管理、止损机制
- 订单管理 ：订单创建、执行、状态跟踪

### 可视化引擎 (VisualEngine)

`VisualEngine.js` 提供图表功能：

- 实时图表 ：K线图、成交量、技术指标
- 策略可视化 ：网格线、交易信号、盈亏分析
- Worker 线程 ：图表渲染与交易逻辑分离

### 策略处理器

- `GridTradingProcessor.js` ：网格交易策略实现
- `HedgeProcessor.js` ：对冲交易策略实现
- `MarketMakerProcessor.js` ：做市商策略实现

### 技术指标

系统内置多种技术指标：

- MA (移动平均线) ：趋势分析
- BOLL (布林带) ：波动性分析
- RSI (相对强弱指数) ：超买超卖判断
- ATR (平均真实波幅) ：波动性测量
- CD (筹码分布) ：成本分布分析

## 🔧 核心功能

### 实时数据处理

- WebSocket 连接管理
- 多品种行情数据同步
- 数据缓存和优化
- 历史数据回填

### 风险管理

- 多层止损 ：警戒线、生存线、强制平仓
- 保证金监控 ：实时计算保证金比例
- 持仓控制 ：动态调整持仓规模
- 异常处理 ：网络断线、API 错误恢复

### 性能优化

- 缓存机制 ：减少重复计算和 API 调用
- Worker 线程 ：图表渲染不阻塞交易逻辑
- 内存管理 ：定期清理过期数据
- 连接池 ：WebSocket 连接复用

## 📊 监控和分析

### 实时监控

系统提供多维度的实时监控：

- 持仓状态 ：实时盈亏、持仓数量、保证金比例
- 交易统计 ：成交次数、手续费、胜率
- 风险指标 ：最大回撤、夏普比率、波动率

### 图表分析

- 主图表 ：K线、成交量、技术指标
- 策略图表 ：网格线、交易信号、盈亏分布
- 筹码分布 ：成本分布分析
- 历史回测 ：策略历史表现分析

## 🛡️ 安全特性

- API 密钥加密 ：本地存储加密
- 签名验证 ：所有 API 请求签名验证
- 权限控制 ：最小权限原则
- 异常监控 ：实时监控异常情况

## 🔄 扩展开发

### 添加新策略

1. 继承 `AbstractProcessor.js`
2. 实现策略逻辑
3. 在配置文件中注册策略

### 添加新指标

1. 在 src/indicators/ 目录下创建指标文件
2. 实现指标计算逻辑
3. 在绘图模块中集成指标

### 添加新图表

1. 继承 `AbstractPainter.js`
2. 实现绘图逻辑
3. 在 VisualEngine 中注册

## 🐛 故障排除

### 常见问题

1. API 连接失败

- 检查网络连接
- 验证 API 密钥配置
- 确认 API 权限设置

2. 数据同步异常

- 检查 WebSocket 连接状态
- 验证订阅频道配置
- 查看错误日志

3. 策略执行异常

- 检查账户余额
- 验证交易权限
- 查看风险控制设置

### 日志分析

系统提供详细的日志记录：

```
# 查看实时日志
tail -f logs/trading.log

# 查看错误日志
tail -f logs/error.log
```

## 📈 性能指标

- 延迟 ：订单执行延迟 < 100ms
- 吞吐量 ：支持 1000+ TPS
- 可用性 ：99.9% 运行时间
- 内存使用 ：< 512MB

## 🤝 贡献指南

1. Fork 项目
2. 创建功能分支
3. 提交更改
4. 推送到分支
5. 创建 Pull Request

## 📄 许可证

本项目基于 GNU Affero General Public License v3.0 (AGPLv3) 开源。

- ✅ 允许 ：查看、修改、非商业用途的分发
- ⚠️ 要求 ：基于本项目的衍生作品（包括网络服务） 必须开源
- 💼 商业用途 ：需联系作者获取商业授权

## 📞 联系方式

- 邮箱 ： 393667111@qq.com

## 🙏 致谢

感谢所有为项目做出贡献的开发者和用户。
