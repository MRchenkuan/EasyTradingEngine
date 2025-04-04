const commands = [
  {
    command: 'open',
    usage: 'npm run open [空头资产] [多头资产] [金额]',
    example: 'npm run open sol eth 2000',
    description: '开仓命令，支持简写币种名称，不区分大小写'
  },
  {
    command: 'close',
    usage: 'npm run close [交易ID]',
    example: 'npm run close 318fe6d8',
    description: '平仓命令'
  },
  {
    command: 'list',
    usage: 'npm run list [clear]',
    example: 'npm run list clear',
    description: '查看当前持仓列表，可选参数 clear 用于清理已平仓记录'
  },
  {
    command: 'monit',
    usage: 'npm run monit',
    description: '实时监控持仓情况，自动刷新'
  },
  {
    command: 'start',
    usage: 'npm run start',
    description: '启动主程序'
  },
  {
    command: 'trading',
    usage: 'npm run trading',
    description: '启动手动交易程序'
  },
  {
    command: 'docker',
    usage: 'npm run docker',
    description: '重新构建并运行 Docker 容器'
  },
  {
    command: 'docker:build',
    usage: 'npm run docker:build',
    description: '构建 Docker 镜像'
  },
  {
    command: 'docker:run',
    usage: 'npm run docker:run',
    description: '运行 Docker 容器'
  },
  {
    command: 'docker:logs',
    usage: 'npm run docker:logs',
    description: '查看 Docker 容器日志'
  },
  {
    command: 'lint',
    usage: 'npm run lint',
    description: '检查代码规范'
  },
  {
    command: 'format',
    usage: 'npm run format',
    description: '格式化代码'
  },
  {
    command: 'graph',
    usage: 'npm run graph [orders|trans]',
    example: 'npm run graph orders',
    description: '切换主图显示内容，orders 控制订单记录，trans 控制开平仓信息'
  }
];

console.log('\n可用命令：\n');

commands.forEach(cmd => {
  console.log(`${cmd.command}`);
  console.log(`    用法: ${cmd.usage}`);
  if (cmd.example) {
    console.log(`    示例: ${cmd.example}`);
  }
  console.log(`    说明: ${cmd.description}`);
  console.log('');
});

console.log(`
使用说明:

  交易相关:
    open <空头资产> <多头资产> <金额>  开仓命令，支持简写币种名称
    close <交易ID>                    平仓命令
    list [clear]                     查看当前持仓列表，可选参数clear用于清理已平仓记录
    list:clear                       清理已平仓数据
    list:delete <tradeId>           删除指定交易ID的所有相关记录
    monit                           实时监控持仓情况
    grid                           查看网格交易盈亏统计
    grid monit                     实时监控网格交易盈亏
    grid monit <币种>               监控指定币种的网格交易盈亏

  绘图相关:
    graph orders                     切换主图上历史订单记录的显示/隐藏
    graph trans                      切换主图上开平仓信息的显示/隐藏

  程序相关:
    start                           启动主程序
    trading                         启动手动交易程序

  Docker相关:
    docker                          重新构建并运行Docker容器
    docker:build                    构建Docker镜像
    docker:run                      运行Docker容器
    docker:logs                     查看Docker容器日志

  开发相关:
    lint                            检查代码规范
    format                          格式化代码

示例:
  npm run open sol eth 2000         开仓2000USDT的SOL-ETH对冲头寸
  npm run close 318fe6d8            平仓ID为318fe6d8的头寸
  npm run list clear                清理并显示持仓列表
  npm run grid monit BTC            监控BTC的网格交易盈亏
`);