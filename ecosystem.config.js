module.exports = {
  apps: [{
    name: 'meme-scanner',
    script: './dist/index.js',
    
    // Production settings
    instances: 1,
    exec_mode: 'fork',
    
    // Auto-restart configuration
    autorestart: true,
    max_restarts: Infinity,
    min_uptime: 5000,
    restart_delay: 5000,
    
    // Memory management
    max_memory_restart: '500M',
    
    // Logging
    error_file: './logs/pm2-error.log',
    out_file: './logs/pm2-out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true,
    
    // Environment
    env: {
      NODE_ENV: 'production'
    },
    
    // Watch (disabled in production)
    watch: false,
    
    // Graceful shutdown
    kill_timeout: 5000,
    wait_ready: true,
    listen_timeout: 10000
  }]
};
