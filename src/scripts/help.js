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