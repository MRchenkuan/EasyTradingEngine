# 导入聚宽函数库
from jqdata import *

# 交易标的
# STOCK_CODE = '000300.XSHG' #沪深300
STOCK_CODE = '588200.XSHG' #科创芯片
# STOCK_CODE = '513520.XSHG' # 日经
# STOCK_CODE = '164824.XSHE' # 硬度
# STOCK_CODE = '159509.XSHE' # 纳科
# STOCK_CODE = '513500.XSHG' # 标普
# STOCK_CODE = '515790.XSHG' # 光伏科技
# STOCK_CODE = '159952.XSHE' # 创业板
# STOCK_CODE = '601689.XSHG' # 拓普
# STOCK_CODE = '002050.XSHE' # 三花
# STOCK_CODE = '600036.XSHG' # 招行
# STOCK_CODE = '002027.XSHE' # 分众
# 基准标的
# BENCHMARK = '000300.XSHG'
BENCHMARK = STOCK_CODE
# 基准价格
BASE_PRICE = 1
# 网格宽度
GRID_WIDTH = 0.025
# 最大回撤
MAX_DRAWDOWN = 0.012
# 最大反弹
MAX_BOUNCE = 0.012
# 每次交易股数
TRADE_AMOUNT = 9000
# 最大持仓
MAX_POSITION = 100000
# 起始仓位
START_POSITION = 0.5
# 实际持仓
REAL_POSITION = 0
# 最低触发价格
MIN_PRICE = 0.1
# 最高触发价格
MAX_PRICE = 100




##### 下面是全局变量
# 当前价格
g_current_price = BASE_PRICE
# 上一刻的价格
g_prev_price = BASE_PRICE
# 上一次交易的价格
g_last_trade_price = BASE_PRICE
# 前一个拐点的价格
g_last_turning_price = None
# 价格趋势
g_tendency = 0
# 价格走向
g_direction = 0

# 网格
g_grid = []
# 是否建仓
is_position_created = False;
g_profit=0


##### 函数定义
# 初始化函数，设定要操作的股票、网格宽度、每次交易股数、价格区间等参数
def initialize(context):
    log.set_level('system', 'error')
    global g_grid
    # 设定基准等等
    set_benchmark(BENCHMARK)
    # 开启动态复权模式
    set_option('use_real_price', True)
    # 股票类每笔交易时的手续费是：买入时佣金万分之三，卖出时佣金万分之三加千分之一印花税, 每笔交易佣金最低扣5块钱
    # set_order_cost(OrderCost(close_tax=0.001, 
    #         open_commission=0.00025, 
    #         close_commission=0.00025,
    #         min_commission=0.01), type='fund')
    # 设置执行频率为分钟级
    run_daily(trade, time='every_bar')

    # 初始化价格网格
    g_grid = init_price_grid(BASE_PRICE, MAX_PRICE, MIN_PRICE,GRID_WIDTH)
    log.info(f'网格：{g_grid}')

# 取整函数
def hand(num):
    return round(num/100)*100

# 初始化价格网格
def init_price_grid(basePrice, maxPrice, minPrice, grid_width):
    if minPrice >= maxPrice:
        raise ValueError("最低价必须小于最高价")
    if not (minPrice <= basePrice <= maxPrice):
        raise ValueError("基准价格必须在最低价和最高价之间")

    grid = []

    # 向上生成网格
    current_price = basePrice
    while current_price < maxPrice:
        current_price += current_price * grid_width
        if current_price <= maxPrice:
            grid.append(round(current_price, 3))
        else:
            break

    # 向下生成网格
    current_price = basePrice
    while current_price > minPrice:
        current_price -= current_price * grid_width
        if current_price >= minPrice:
            grid.insert(0, round(current_price, 3))
        else:
            break
    return grid


# 根据价格确定上下边沿
def find_price_bounds(price):
    if price < g_grid[0] or price > g_grid[-1]:
        raise ValueError("给定价格超出网格范围")
    
    if price in g_grid:
        return price, price
    
    lower_bound, upper_bound = None, None
    for i in range(len(g_grid) - 1):
        if g_grid[i] < price < g_grid[i + 1]:
            lower_bound = g_grid[i]
            upper_bound = g_grid[i + 1]
            break

    return lower_bound, upper_bound

# 确定价格走向
def find_price_direction():
    if(g_current_price > g_prev_price):
      return 1;
    if(g_current_price < g_prev_price):
      return -1
    return 0
    
# 确定趋势（相较上一个买点）
def find_price_tendenchy():
    if(g_current_price > g_last_trade_price):
      return 1;
    if(g_current_price < g_last_trade_price):
      return -1
    return 0
    
# 计算两个价格之间的网格数量
def count_grid_number(current, prev):
    if current == prev:
        return 0
    # 确保 price1 小于 price2
    if current==None or prev == None:
       return 0
    lower_price = min(current, prev)
    upper_price = max(current, prev)

    # 统计在范围内的网格数量
    count = sum(lower_price <= point <= upper_price for point in g_grid)
    if count <=1 :
        return 0
    if(current > prev):
        return (count-1)
    else :
        return -(count-1)
    
def trade(context):
    trade_by_tick(context, 'open');
    trade_by_tick(context, 'close');

# 交易函数
def trade_by_tick(context,type='close'):
    global g_prev_price,is_position_created,g_last_trade_price,g_last_turning_price,g_current_price,g_tendency,g_direction
    
    # 更新最新当前价格
    # 收盘价
    g_current_price = attribute_history(STOCK_CODE, 1, '1m', [type])[type][0];
    # 更新价格走向
    g_direction = find_price_direction()
    # 更新价格趋势
    g_tendency = find_price_tendenchy()
    # record(trade_price=g_current_price)
    # 首次启动建仓
    if not is_position_created:
        order(STOCK_CODE, hand(START_POSITION * MAX_POSITION/g_current_price))
        log.info(f'建仓{hand(START_POSITION * MAX_POSITION/g_current_price)},建仓价格{g_current_price}')
        log.info(f'当前持仓：{context.portfolio.positions_value}')
        # record(start_price=g_current_price)
        g_last_trade_price = g_current_price
        g_last_turning_price = g_current_price
        is_position_created = True;
        g_prev_price = g_current_price
        return
    # 如果当前价格超出价格区间，则终止程序
    if g_current_price < MIN_PRICE or g_current_price > MAX_PRICE:
        log.info(f"当前价格{g_current_price}超出设定区间，程序终止")
        log.info(f'当前持仓：{context.portfolio.positions_value}')
        g_prev_price = g_current_price
        return


    # 确定当前在哪个网格
    lower_edge, upper_edge = find_price_bounds(g_current_price)

    # 判断价格是否在网格线上
    is_price_online = lower_edge == upper_edge

    # 计算当前价格和前一个成交价之间有几个网格
    grid_count = count_grid_number(g_current_price, g_last_trade_price)

    # 更新拐点价格
    refreshTurningPoint()
    
    #执行交易策略
    order_strategy(context, grid_count, g_current_price)


    # 更新前一刻价格
    refreshLastPrice()
    # record(current_price=g_current_price)

# 更新价格拐点
def refreshTurningPoint():
    global g_last_turning_price
    turn_point = None
    # 价格走向相反，记录拐点
    if {g_direction, g_tendency} == {1,-1}:
      turn_point = g_prev_price;
      # 没有拐点时，第一次的拐点记录
      if g_last_turning_price == None:
        g_last_turning_price = turn_point;
        log.info(f'〽️初次设定拐点{g_last_turning_price}')

      # 向下走时，更新更高的价作为拐点
      if g_direction < 0 and turn_point > g_last_turning_price:
        g_last_turning_price = turn_point;
        log.info(f'〽️更新更高的拐点{g_last_turning_price}')
      
      # 向上走时，更新更低价的拐点作为
      if g_direction > 0 and turn_point < g_last_turning_price:
        g_last_turning_price = turn_point;
        log.info(f'〽️更新更低的拐点{g_last_turning_price}')
       

# 更新历史价格
def refreshLastPrice():
   global g_prev_price,g_current_price
   g_prev_price = g_current_price

# 计算回撤范围
def correction():
  if(g_last_turning_price == None):
     return 0
  return (g_current_price - g_last_turning_price)/g_last_turning_price
   
# 交易策略
def order_strategy(context, grid_count, current_price):
  # 当跨越了网格时则开始交易
  if grid_count != 0:
      # 价格持续上涨
      if grid_count >0 and g_direction > 0:
        log.info(f'↑{current_price} 价格持续上涨({round(100*(current_price-g_last_trade_price)/g_last_trade_price)}%)，距离上次({g_last_trade_price})交易{grid_count}个网格，不进行交易')
        return
      
      # 价格持续上涨
      if grid_count <0 and g_direction < 0:
        log.info(f'↓{current_price} 价格持续下跌({round(100*(current_price-g_last_trade_price)/g_last_trade_price)}%)，，距离上次({g_last_trade_price})交易{grid_count}个网格，不进行交易')
        return

      # 价格回撤
      if grid_count > 0 and g_direction <= 0: 
          # 没超过回撤线
          if abs(correction()) <= MAX_DRAWDOWN:
            log.info(f'⤵️{g_last_turning_price}->{current_price} 价格回撤 {round(correction()*100,2)}%，但未超过回撤线({MAX_DRAWDOWN*100}%)，不进行交易')
            return
          log.info(f'⤵️{current_price} 价格回撤 {round(correction()*100,2)}%，且超过了回撤线({round(g_last_turning_price*(1-MAX_DRAWDOWN),3)})')
          order_by_grid(context, grid_count, current_price, '回撤下单')

      # 价格反弹
      if grid_count < 0 and g_direction >= 0:
          # 没超过反弹线
          if abs(correction()) <= MAX_BOUNCE:
            log.info(f'⤴️{g_last_turning_price}->{current_price} 价格反弹 {round(correction()*100,2)}%，但未超过反弹线({MAX_BOUNCE*100}%)，不进行交易')
            return
          log.info(f'⤴️{current_price} 价格反弹 {round(correction()*100,2)}%，且超过了反弹线({round(g_last_turning_price*(1+MAX_BOUNCE),3)})')
          order_by_grid(context, grid_count, current_price, '反弹下单')
  else:
    # 计算最近一个顶点和前一个成交价之间是否有网格
    # 如果有则表示当前属于【跨线回调】
    grid_turning_count = count_grid_number(g_last_turning_price, g_last_trade_price)
    if grid_turning_count != 0:
      if grid_turning_count >0 and g_direction > 0:
        log.info(f'[跨线回调]↑{current_price} 价格持续上涨({round(100*(current_price-g_last_trade_price)/g_last_trade_price)}%)，距离上次({g_last_trade_price})交易{grid_turning_count}个网格，不进行交易')
        return
      
      if grid_turning_count <0 and g_direction < 0:
        log.info(f'[跨线回调]↓{current_price} 价格持续下跌({round(100*(current_price-g_last_trade_price)/g_last_trade_price)}%)，距离上次({g_last_trade_price})交易{grid_turning_count}个网格，不进行交易')
        return

      # 跨线回撤
      if grid_turning_count > 0 and g_direction <= 0: 
          # 没超过回撤线
          if abs(correction()) <= MAX_DRAWDOWN:
            log.info(f'[跨线回调]⤵️{g_last_turning_price}->{current_price} 价格回撤 {round(correction()*100,2)}%，但未超过回撤线({MAX_DRAWDOWN*100}%)，不进行交易')
            return
          log.info(f'[跨线回调]⤵️{current_price} 价格回撤 {round(correction()*100,2)}%，且超过了回撤线({round(g_last_turning_price*(1-MAX_DRAWDOWN),3)})')
          order_by_grid(context, grid_turning_count, current_price, '回撤下单')

      # 跨线反弹
      if grid_turning_count < 0 and g_direction >= 0:
          # 没超过反弹线
          if abs(correction()) <= MAX_BOUNCE:
            log.info(f'[跨线回调]⤴️{g_last_turning_price}->{current_price} 价格反弹 {round(correction()*100,2)}%，但未超过反弹线({MAX_BOUNCE*100}%)，不进行交易')
            return
          log.info(f'[跨线回调]⤴️{current_price} 价格反弹 {round(correction()*100,2)}%，且超过了反弹线({round(g_last_turning_price*(1+MAX_BOUNCE),3)})')
          order_by_grid(context, grid_turning_count, current_price, '反弹下单')
# 计算非对称网格过程中的利润
def calculate_grid_profit():
    
    return 0


def order_by_grid(context, grid_count, current_price, type='下单'):
  global g_last_trade_price,g_last_turning_price,g_profit
  log.info(f'💰定价单：{current_price} {-grid_count * TRADE_AMOUNT} 股({grid_count}个网格)， 当前持仓：{context.portfolio.positions[STOCK_CODE].total_amount}')
  result = order(STOCK_CODE, hand(-grid_count * TRADE_AMOUNT))
  if(result==None):
      log.info(f'⛔交易失败: 当前持仓：{context.portfolio.positions[STOCK_CODE].total_amount}，{context.portfolio.positions_value} 元,成本：{context.portfolio.positions[STOCK_CODE].acc_avg_cost}')
      return
  log.info(f'💰交易成功: 当前持仓：{context.portfolio.positions[STOCK_CODE].total_amount}，{context.portfolio.positions_value} 元,成本：{context.portfolio.positions[STOCK_CODE].acc_avg_cost}')
  g_last_turning_price = current_price
  g_last_trade_price = result.price
  g_profit+=(hand(grid_count * TRADE_AMOUNT)*current_price)
  record(position=context.portfolio.positions_value)
  record(g_profit=calculate_grid_profit())
  log.info('\n')