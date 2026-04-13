import http from 'http';
import { logger } from '../utils/logger.js';
import { getCacheStats } from '../services/scanner.js';
import { getCircuitState } from '../utils/fetch.js';

const PORT = 8080;
const startTime = Date.now();

export function startHealthServer(): void {
  const server = http.createServer((req, res) => {
    if (req.url === '/health' && req.method === 'GET') {
      const uptime = (Date.now() - startTime) / 1000;
      const cacheStats = getCacheStats();
      const circuitState = getCircuitState();
      
      const health = {
        status: 'ok',
        uptime: parseFloat(uptime.toFixed(2)),
        timestamp: new Date().toISOString(),
        cache: {
          size: cacheStats.size,
          oldestMinutes: cacheStats.oldest
        },
        circuitBreaker: circuitState,
        memory: {
          heapUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
          heapTotal: Math.round(process.memoryUsage().heapTotal / 1024 / 1024)
        }
      };
      
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(health, null, 2));
      
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
    }
  });

  server.listen(PORT, () => {
    logger.success(`Health check server running on http://localhost:${PORT}/health`);
  });

  server.on('error', (error) => {
    logger.error('Health server error:', error);
  });
}
