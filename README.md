# 一句话简介（统计套利策略）
拟合两个资产价格，通过多空对冲实现套利

# NOTICE
- 做市商策略会亏手续费，没有免费接口不要去跑
- 模拟盘交易不代表实盘
# TODO
目前统计套利策略相对完善，主要以这个为主
- [ ] 下单函数改造为 Promise 在等待中轮询状态直到filled
- [ ] 下单超时需要进行撤单，单腿超时则需要进行手动强平，避免损失扩大
- [ ] 对于各种金额单位转换的代码需要CR以及补全
- [ ] 另外，需要写个订单详情处理器，内部做单位统一适配。
- [ ] 绘图引擎需要提供 web 版
- [ ] 所有本地的 local_variable 进缓存或者入库
- [ ] 「做市商策略」首先要做成 Processor,然后可以结合趋势跟踪策略优化上下沿设置，主要针对单边趋势设置一个朝向的上下边沿，例如当前价位P：正常{SELL(P+N),BUY(P-N)}；如果单边上行则{SELL(P+1.1xN),BUY(P)}；如果单边下行则{SELL(P),BUY(P-1xN)}

# 通过线性回归拟合两个标的K线图发现对冲机会
![image](https://github.com/user-attachments/assets/c7a59364-de1e-4029-87fc-788f5cfb83e8)
![image](https://github.com/user-attachments/assets/1bf910f6-3419-4429-9de3-e748cd74841a)
![image](https://github.com/user-attachments/assets/5724d877-1c7c-4f24-9ac7-329ce9c87749)
各种资产组合的盈利空间（用于盘点当前市场整体是否适合交易）
![image](https://github.com/user-attachments/assets/c15c4ed6-4486-46ac-8d06-d5213801466f)
正常启动的效果
<img width="1136" alt="image" src="https://github.com/user-attachments/assets/02847ccb-d633-4091-a197-ac1c5abb7611" />

