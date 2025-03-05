# NOTICE
- AbstractProcessor 抽象类，用于规范所有交易策略的写法，不需要实例化，所有继承这个抽象类的策略需要共同实现tick方法。
- HedgeProcessor 对冲策略的实现
- MarketMakerProcessor 做市商策略的实现
- TreadFollwingProcessor 趋势跟踪策略的实现（暂未实现）