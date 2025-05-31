module.exports = {
  apps: [
    {
      name: 'okx-trading',
      script: './main.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '2G',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      out_file: '/app/record/out.log',
      error_file: '/app/record/error.log',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
    },
  ],
};
