# 两个主要策略

策略1 - 多空对冲：💰拟合两个资产价格，通过多空对冲实现套利

策略2 - 趋势网格：💰结合网格交易策略，在趋势中控仓，并在回撤时平仓，实现风险和收益控制

# ONE MORE THING

实现了一个交易引擎🚀

# 先看效果 - 趋势网格
<img width="3840" height="2160" alt="image" src="https://github.com/user-attachments/assets/aeca8668-31a8-4bb2-97cb-a9468fe6e9b2" />
- 左侧是筹码分布
- 右侧是价格游标
- 底部是成交量
策略，总体上遵循高卖，低买，但会根据成交量、ATR、时间来择时。

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
    
### 显示设置

- `npm run hide:order` - 在主图上隐藏所有的历史订单记录
- `npm run hide:trans` - 在主图上隐藏所有的开平仓信息

### 图表控制

- `npm run graph orders` - 切换主图上历史订单记录的显示/隐藏
- `npm run graph trans` - 切换主图上开平仓信息的显示/隐藏

# TODO
1. **动态回撤门限**
已完成 ✅

2. **趋势强度相关性**
已完成 ✅

3. **交易量相关性**
已完成 ✅

4. **时间衰减优化**
已完成 ✅

5. **价格距离自适应**
不完成 ❌

6. **风险控制优化**
已完成 ✅

| ​**加我好友一起共建**​                                                                                                 | ​**觉得有用也可以请我喝咖啡​**​                                                                                       |
| ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| ​<img width="453" alt="image" src="https://github.com/user-attachments/assets/4b5b6ba4-b196-43d8-9527-37acf52ec878" /> | <img width="452" alt="image" src="https://github.com/user-attachments/assets/6f06f1f2-82bb-4be8-97bf-39f32b551aff" /> |

# LICENSE

本项目基于 **GNU Affero General Public License v3.0 (AGPLv3)** 开源。

- ✅ 允许：查看、修改、非商业用途的分发。
- ⚠️ 要求：基于本项目的衍生作品（包括网络服务）**必须开源**。
- 💼 **商业用途**：需联系作者（[393667111@qq.com](mailto:393667111@qq.com)）获取商业授权并支付费用。
