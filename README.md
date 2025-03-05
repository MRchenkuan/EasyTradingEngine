# 一句话简介
拟合两个资产价格，通过多空对冲实现套利💰
# ONE MORE THING
实现了一个交易引擎🚀
# 先看效果
### 大盘指标 位置：chart/candle_chart.jpg
![image](https://github.com/user-attachments/assets/c7a59364-de1e-4029-87fc-788f5cfb83e8)
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
<img width="1136" alt="image" src="https://github.com/user-attachments/assets/02847ccb-d633-4091-a197-ac1c5abb7611" />

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
const pass_phrase = "你在okx上设置的 pass_phrase"

export {
  base_url,api_key, api_secret, pass_phrase
}
```

# TODO
目前统计套利策略相对完善，主要以这个为主
- [ ] 【择时】【重要】开仓时机目前是到达门限就开-难以最大化利润，需要优化下，遵循右侧交易的原则，在回调时开仓
- [ ] 【择时】平仓时机同样可以考虑在回落时平仓（目前是固定门限0.005）
- [ ] 【稳健性】下单超时需要进行撤单，单腿超时则需要进行手动强平，避免损失扩大
- [ ] 【稳健性】下单函数改造为 Promise 在等待中轮询状态直到filled
- [ ] 【稳健性】对于各种金额单位转换的代码需要CR以及补全
- [ ] 【稳健性】拟合算法依然有提升空间，由于我们拟合的是距离，所以尽量用线性方法，避免过拟合。
- [ ] 【稳健性】交易的一致性检查需要整体设计下，比如配队订单交易结果不一致时如何处理。（撤单 or 追单）
- [ ] 【功能】「做市商策略」首先要做成 Processor,然后可以结合趋势跟踪策略优化上下沿设置，主要针对单边趋势设置一个朝向的上下边沿，例如当前价位P：正常{SELL(P+N),BUY(P-N)}；如果单边上行则{SELL(P+1.1xN),BUY(P)}；如果单边下行则{SELL(P),BUY(P-1xN)}
- [ ] 【功能】另外，需要写个订单详情处理器，内部做单位统一适配。
- [ ] 【功能】绘图引擎需要提供 web 版
- [ ] 【功能】所有本地的 local_variable 进缓存或者入库



| ​**加我好友一起共建**​       | ​**觉得有用也可以请我喝咖啡​**​ |
|--------------------|-------------------------------|
| ​<img width="453" alt="image" src="https://github.com/user-attachments/assets/4b5b6ba4-b196-43d8-9527-37acf52ec878" /> | <img width="452" alt="image" src="https://github.com/user-attachments/assets/6f06f1f2-82bb-4be8-97bf-39f32b551aff" /> |
