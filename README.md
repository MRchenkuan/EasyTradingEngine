# EasyTradingEngine (okx-trading)

一个基于 Node.js 的 OKX 永续合约量化交易系统。核心是一套**拐点回撤网格策略**——不是传统的挂单网格，而是「等回调确认再出手」的震荡市增强网格，配备四级风险控制与完整的可视化监控看板。

## 先看一下效果

### 网格交易实时看板

![](https://github.com/user-attachments/assets/aeca8668-31a8-4bb2-97cb-a9468fe6e9b2)

### 对冲交易利润看板

![](https://github.com/user-attachments/assets/cde8f587-669d-4657-94bf-3b63a20642e5)

### 网格交易策略利润看板

![](https://github.com/user-attachments/assets/0164dc43-628e-41db-8575-c08991dbc270)

## 实盘表现（2026-08-27 ~ 09-22，27 天）

| 指标     | 数值                                                   |
| -------- | ------------------------------------------------------ |
| 账户权益 | 100 → 241.67 USDT（**+141.7%**）                       |
| 权益峰值 | 299.18 USDT                                            |
| 最大回撤 | -22.4%（触发过一次 20% 回撤清仓，峰谷重置后自动恢复）  |
| 成交笔数 | 554 笔（5 币种，确认成交口径）                         |
| 总手续费 | 13.23 USDT                                             |
| 运行方式 | 7×24 云端 Docker，期间经历一次全账户强平事件后自动恢复 |

> 每笔订单都落盘完整决策快照（BOLL/RSI/网格/时间四因子系数、触发阈值、回撤值），可逐笔复盘「为什么这笔要下」。

## 🧭 策略架构

```
行情层      OKX WebSocket 实时行情 + 5m K线（本地 jsonl 落盘，可回测）
   ↓
引擎层      TradeEngine（500ms 轮询驱动 tick，BOLL/持仓/品种信息多级缓存）
   ↓
策略层      GridTradingProcessor（网格，主力） / HedgeProcessor（对冲） / MarketMakerProcessor（做市，开发中）
   ↓
风控层      PositionController（8 级复合风险） / AccountRiskMonitor（回撤监控） / Liquidator（一键清仓）
   ↓
展示层      监控面板（Express + WebSocket :8080）
```

## 🎯 网格策略：拐点回撤 + 多因子动态阈值

与「每格必挂单」的经典网格不同，本策略只在**回调确认**后出手，专吃「冲高回落 / 探底回升」的震荡段：

### 1. 触发条件（三个门闩缺一不可）

- **跨格 ≥ 1**：现价与上次成交价之间至少完整跨过 2 条网格线（等比网格，默认 0.5%/格）
- **回调确认**：回撤幅度 `correction = (现价 - 本轮拐点价) / 拐点价` 超过动态阈值
- **方向门闩**：价格顺着趋势冲（direction 与 tendency 同向）时不交易——单边急跌不接飞刀

因此每一份「低买→高卖」配对的价格差严格大于 1 格，扣除双边手续费后**每份净收益 > A×(g−2f)**，与行情剧烈程度无关；±1 格以内的噪音不产生任何交易、零磨损。

### 2. 四因子动态阈值

```
最终阈值 = clamp( 基础回撤值, ≤ ATR(120)×3, [0.1%, 1.2%] )
           × 时间衰减因子 × (BOLL因子 + RSI因子) / 2 × 网格位置因子
```

| 因子       | 判断依据             | 意图                                              |
| ---------- | -------------------- | ------------------------------------------------- |
| BOLL 位置  | (20,2) 带内偏离度    | 越极端阈值越小，加速锁利（系数 0.1~1.0）          |
| RSI 快慢线 | 快 60 点 / 慢 300 点 | 顺势超买超卖快速落袋；反向极端快速减损（0.2~1.0） |
| 网格位置   | 距格线的距离         | 贴线锁定利润 0.2；跨 ≥3 格放宽容忍 1.25~1.5       |
| 时间衰减   | 距上次成交的时间     | 持仓越久阈值越松，避免长期挂死（0.5~1.0）         |

每次下单时全部因子系数写入订单 snapshot，便于复盘与后续参数寻优。

### 3. 双维风险控制（单仓 × 全仓 → 8 级）

- **单仓风险**：`|持仓名义| / 账户权益`（价格每动 1% 权益的敏感度）→ 正常 / 注意 / 高 / 紧急
- **全仓风险**：维持保证金率 → 正常 / 注意 / 高 / 紧急
- 两维组合出 8 级复合状态，逐 tick 重算，核心哲学：**风险越高，开仓越难（门槛×2~×3），平仓越容易（阈值×0.25~0.5）**，全仓/双重紧急时直接停止开仓

### 4. 频率节流

连续同向交易按「上次网格跨度 × 倍数」节流（低风险 ×1.25 / 高风险 ×1.5 / 紧急 ×2），平仓节流松、开仓节流紧；超过 7 小时或 10 格自动重置。杜绝连续追单。

### 5. 账户级兜底：20% 回撤清仓

- 每 10s 拉取总权益，`回撤 = (峰值 - 当前) / 峰值`，≥20% 触发全账户市价清仓
- **跳变防护**：权益偏差超 30% 视为可疑，需连续两次相近才采纳，单次 API 异常永不污染极值
- **峰谷延迟重置**：清仓后等下一次余额刷新拿真实权益再重置，防止「人造回撤」导致反复清仓
- 触发标志持久化，重启不丢；回撤恢复后策略自动复位
- 设计文档见 [docs/drawdown-liquidation-design.md](docs/drawdown-liquidation-design.md)（口径固化、模式选型、反模式都有记录）

## 🛡️ 工程可靠性

- **分阶段订单状态机**：PENDING → PLACED → CONFIRMED，失败自动重试（最多 5 次），每次状态变更落盘
- **重启补偿确认**：进程重启时扫描未确认订单，查询实际成交结果并恢复策略基准价
- **状态全量持久化**：策略状态、账户权益极值、实时价格均经 LocalVariable 自动落盘，重启即恢复
- **API 层弹性**：axios 全局超时 + 指数退避自动重试（网络/5xx 重试，4xx 不重试）
- **K 线本地落盘**：按日切片 jsonl 存储，可直接用于策略回测与参数寻优

## 📐 其他策略

- **对冲套利（HedgeProcessor）**：线性回归拟合两币价格（Beta map），价差偏离门限开双腿对冲仓，回归平仓吃 spread
- **做市商（MarketMakerProcessor）**：±0.5% 限价双边挂单，开发中

## ⚙️ 快速开始

### 1. 安装依赖

```bash
npm install
# 或
pnpm install
```

### 2. 配置 API 密钥

创建 `config.security.js`（实盘）：

```js
const base_url = 'wss://ws.okx.com:8443';
const api_key = '你的 OKX API Key';
const api_secret = '你的 OKX API Secret';
const pass_phrase = '你的 OKX API Passphrase';

export { base_url, api_key, api_secret, pass_phrase };
```

创建 `config.security.mimic.js`（模拟盘）——格式相同，填模拟盘密钥。

### 3. 配置交易参数

编辑 `config.json`（支持运行中修改、重启生效）：

```json
{
  "env": "PRODUCTION",
  "trade_open": false,
  "drawdown_liquidation_threshold": 0.2,
  "rebalance_threshold": 0.15,
  "assets": [
    {
      "assetId": "BTC-USDT-SWAP",
      "theme": "#f0b27a",
      "params": {
        "_upper_drawdown": 0.0075,
        "_lower_drawdown": 0.0075,
        "_grid_width": 0.005,
        "_min_price": 40000,
        "_max_price": 150000,
        "_base_amount": 60,
        "_settlement_type": "VALUE"
      }
    }
  ]
}
```

**关键参数说明**：

| 参数                             | 含义                 | 备注                                                  |
| -------------------------------- | -------------------- | ----------------------------------------------------- |
| `_grid_width`                    | 网格宽度（等比）     | BTC/ETH/SOL/XRP 用 0.005，波动大的小币种可放宽到 0.01 |
| `_base_amount`                   | 每格下单金额（USDT） | VALUE 模式下每份的名义金额                            |
| `_upper/_lower_drawdown`         | 基础回调阈值         | 会被四因子动态修正                                    |
| `_min_price` / `_max_price`      | 网格价格区间         | 出界即暂停该品种交易                                  |
| `drawdown_liquidation_threshold` | 账户回撤清仓线       | 默认 0.2                                              |
| `trade_open`                     | 实盘下单开关         | `false` 时只记录不执行，务必先模拟                    |

## 🖥️ 命令行工具

```bash
npm run start        # 启动主程序（交易引擎 + 监控面板）
npm run trading      # 手动交易程序

npm run grid         # 网格交易统计
npm run grid monit   # 实时监控网格（可指定币种：npm run grid monit BTC）
npm run list         # 查看持仓
npm run open sol eth 2000   # 手动开仓（对冲）
npm run close 318fe6d8      # 手动平仓
npm run liquidate    # 手动一键清仓（交互确认，--yes 跳过）

npm run pm2:start    # pm2 托管运行
```

### Docker 部署

```bash
npm run docker          # 构建并运行
npm run docker:logs     # 查看日志
npm run docker:restart  # 重启
```

## 🔧 扩展开发

- **新策略**：继承 `src/TradeEngine/processors/AbstractProcessor.js`，实现 `tick()` / `display()`，在 `config.json` 注册或通过 `TradeEngine.createXxx` 创建
- **新技术指标**：在 `src/indicators/` 下新建，纯函数实现，在阈值计算中接入

内置指标：MA、BOLL、RSI、ATR、IV（瞬时波动率）、CD（筹码分布，结合持仓量与成交量）。

## 🗺️ Roadmap

- [ ] 回调触发改限价单（maker 费率，每份配对收益 +15%）
- [ ] 账户级总敞口预算（多币种高相关，单仓上限不足以约束总风险）
- [ ] 长周期趋势闸门（长期下降通道暂停买入，减少逆势接盘）
- [ ] 基于 kline_data 本地数据的阈值因子回测寻优
- [ ] 网格宽度按 ATR 自适应
- [ ] 资金费率（funding rate）计入持仓成本与开仓决策

## 🤝 联系我

| **加我好友一起共建**                                                                                                  | **觉得有用也可以请我喝咖啡**                                                                                          |
| --------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| <img width="453" alt="image" src="https://github.com/user-attachments/assets/4b5b6ba4-b196-43d8-9527-37acf52ec878" /> | <img width="452" alt="image" src="https://github.com/user-attachments/assets/6f06f1f2-82bb-4be8-97bf-39f32b551aff" /> |

邮箱：393667111@qq.com

## 📄 许可证

本项目基于 GNU Affero General Public License v3.0 (AGPLv3) 开源。

- ✅ 允许：查看、修改、非商业用途的分发
- ⚠️ 要求：基于本项目的衍生作品（包括网络服务）**必须开源**
- 💼 商业用途：需联系作者获取商业授权

## ⚠️ 免责声明

量化交易存在重大风险，历史表现不代表未来收益。本项目仅供研究学习，请充分理解策略逻辑与风险后谨慎使用，据此交易盈亏自负。
