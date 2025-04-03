# 导入聚宽函数库
from jqdata import *

# 策略参数
STOCK_CODE = '588200.XSHG'  # 交易标的
BENCHMARK = STOCK_CODE      # 基准标的
GRID_WIDTH = 0.025         # 网格宽度
MAX_DRAWDOWN = 0.012       # 最大回撤
MAX_BOUNCE = 0.012         # 最大反弹
TRADE_AMOUNT = 9000        # 每次交易数量
MAX_POSITION = 100000      # 最大持仓
MIN_PRICE = 0.1           # 最低触发价格
MAX_PRICE = 100           # 最高触发价格

def initialize(context):
    # 初始化参数
    g.stock = STOCK_CODE
    g.grid = []
    g.is_position_created = False
    g.current_price = None
    g.prev_price = None
    g.last_trade_price = None
    g.last_upper_turning_price = None
    g.last_lower_turning_price = None
    g.grid_base_price = None
    g.tendency = 0
    g.direction = 0
    
    # 设置基准收益
    set_benchmark(BENCHMARK)
    # 设置滑点
    set_slippage(PriceRelatedSlippage(0.002))
    # 设置佣金
    set_order_cost(OrderCost(open_tax=0, close_tax=0.001, open_commission=0.0003, close_commission=0.0003, min_commission=5), type='stock')
    
    # 建立初始仓位
    g.current_price = get_current_data()[g.stock].last_price
    if g.current_price:
        log.info(f'建立初始仓位：{g.current_price}')
        order_value(g.stock, TRADE_AMOUNT)  # 买入一个网格大小的仓位
        g.last_trade_price = g.current_price
        g.prev_price = g.current_price
        g.is_position_created = True
def handle_data(context, data):
    process_grid_trading(context, data)

def process_grid_trading(context, data):
    g.current_price = data[g.stock].close
    
    # 初始化网格
    if not g.grid:
        g.grid_base_price = g.current_price
        g.grid = init_price_grid(g.grid_base_price)
        g.prev_price = g.current_price
        g.last_trade_price = g.current_price
        return
    
    # 更新价格走向和趋势
    g.direction = find_price_direction()
    g.tendency = find_price_tendency()
    
    # 价格超出范围检查
    if not MIN_PRICE <= g.current_price <= MAX_PRICE:
        log.info(f'当前价格{g.current_price}超出范围[{MIN_PRICE}, {MAX_PRICE}]，暂停交易')
        g.prev_price = g.current_price
        return
        
    # 计算网格和拐点穿越
    grid_count = count_grid_number(g.current_price, g.last_trade_price or g.grid_base_price)
    grid_turning_count_upper = count_grid_number(g.current_price, g.last_upper_turning_price) if g.last_upper_turning_price else 0
    grid_turning_count_lower = count_grid_number(g.current_price, g.last_lower_turning_price) if g.last_lower_turning_price else 0
    
    # 更新拐点
    refresh_turning_point()
    
    # 执行交易策略
    order_strategy(context, grid_count, grid_turning_count_upper, grid_turning_count_lower)
    
    # 更新历史价格
    g.prev_price = g.current_price

def init_price_grid(base_price):
    grid = []
    if MIN_PRICE >= MAX_PRICE or not (MIN_PRICE <= base_price <= MAX_PRICE):
        log.error('价格范围设置错误')
        return grid
        
    # 向上生成网格
    current_price = base_price
    while current_price < MAX_PRICE:
        current_price += current_price * GRID_WIDTH
        if current_price <= MAX_PRICE:
            grid.append(round(current_price, 3))
            
    # 向下生成网格
    current_price = base_price
    while current_price > MIN_PRICE:
        current_price -= current_price * GRID_WIDTH
        if current_price >= MIN_PRICE:
            grid.insert(0, round(current_price, 3))
            
    # 确保基准价格在网格中
    if base_price not in grid:
        grid.append(base_price)
        grid.sort()
        
    return grid

def find_price_direction():
    if g.current_price > g.prev_price:
        return 1
    if g.current_price < g.prev_price:
        return -1
    return 0

def find_price_tendency():
    reference_price = g.last_trade_price or g.grid_base_price
    if g.current_price > reference_price:
        return 1
    if g.current_price < reference_price:
        return -1
    return 0

def refresh_turning_point():
    if g.direction == 1 and g.tendency == -1:
        if not g.last_lower_turning_price or g.current_price < g.last_lower_turning_price:
            g.last_lower_turning_price = g.prev_price
    elif g.direction == -1 and g.tendency == 1:
        if not g.last_upper_turning_price or g.current_price > g.last_upper_turning_price:
            g.last_upper_turning_price = g.prev_price

def calculate_correction():
    if g.direction > 0 and g.last_lower_turning_price:
        return (g.current_price - g.last_lower_turning_price) / g.last_lower_turning_price
    if g.direction < 0 and g.last_upper_turning_price:
        return (g.current_price - g.last_upper_turning_price) / g.last_upper_turning_price
    return 0

def count_grid_number(current, prev):
    if not current or not prev or current == prev:
        return 0
        
    lower_price = min(current, prev)
    upper_price = max(current, prev)
    
    count = len([p for p in g.grid if lower_price <= p <= upper_price])
    
    if count <= 1:
        return 0
    return count - 1 if current > prev else -(count - 1)

def order_strategy(context, grid_count, grid_turning_count_upper, grid_turning_count_lower):
    if g.direction * g.tendency > 0:
        log.info('价格趋势与方向一致，不进行交易')
        return
        
    correction = calculate_correction()
    threshold = MAX_DRAWDOWN if g.direction < 0 else MAX_BOUNCE
    
    if abs(correction) <= threshold:
        log.info(f'当前回撤/反弹幅度{correction*100:.2f}%，继续等待...')
        return
        
    if abs(grid_count) >= 1:
        log.info(f'价格穿越了 {grid_count} 个网格，触发策略')
        place_order(context, grid_count, '回撤下单' if g.direction < 0 else '反弹下单')
        return
        
    if g.direction < 0 and abs(grid_turning_count_upper) >= 1:
        log.info(f'价格穿越了上拐点，触发上拐点回调交易')
        place_order(context, 1, '格内上穿拐点下单')
        return
        
    if g.direction > 0 and abs(grid_turning_count_lower) >= 1:
        log.info(f'价格穿越了下拐点，触发下拐点回调交易')
        place_order(context, -1, '格内下穿拐点下单')
        return
        
    log.info('未触发任何交易条件，继续等待...')

def place_order(context, grid_count, order_type):
    amount = -grid_count * TRADE_AMOUNT
    
    if abs(amount) > MAX_POSITION:
        log.warn(f'交易量{amount}超过最大持仓限制{MAX_POSITION}')
        return
        
    log.info(f'{order_type}：{g.current_price} {amount}')
    
    if amount > 0:
        order_value(g.stock, amount)
    else:
        order_value(g.stock, amount)
        
    g.last_trade_price = g.current_price
    g.last_lower_turning_price = g.current_price
    g.last_upper_turning_price = g.current_price
    g.prev_price = g.current_price