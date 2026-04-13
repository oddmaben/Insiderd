import fs from 'fs';
import path from 'path';
import { config } from '../config.js';

const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  gray: '\x1b[90m'
};

const LOG_DIR = path.join(process.cwd(), 'logs');
const LOG_FILE = path.join(LOG_DIR, `scanner-${new Date().toISOString().split('T')[0]}.log`);

if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

function timestamp(): string {
  return new Date().toISOString().replace('T', ' ').substring(0, 19);
}

function writeToFile(level: string, message: string, data?: any): void {
  if (!config.enableLogs) return;

  try {
    const logEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      data: data || undefined
    };
    
    fs.appendFileSync(LOG_FILE, JSON.stringify(logEntry) + '\n');
  } catch (error) {
    console.error('[LOGGER] Failed to write to file:', error);
  }
}

export const logger = {
  info: (msg: string, data?: any) => {
    console.log(`${colors.gray}[${timestamp()}]${colors.reset} ${colors.blue}INFO${colors.reset}    ${msg}`);
    
    writeToFile('INFO', msg, data);
  },
  
  success: (msg: string, data?: any) => {
    console.log(`${colors.gray}[${timestamp()}]${colors.reset} ${colors.green}SUCCESS${colors.reset} ${msg}`);
    writeToFile('SUCCESS', msg, data);
  },
  
  debug: (msg: string, data?: any) => {
    writeToFile('DEBUG', msg, data);
  },
  
  warn: (msg: string, data?: any) => {
    console.log(`${colors.gray}[${timestamp()}]${colors.reset} ${colors.yellow}WARN${colors.reset}    ${msg}`);
    writeToFile('WARN', msg, data);
  },
  
  error: (msg: string, data?: any) => {
    console.log(`${colors.gray}[${timestamp()}]${colors.reset} ${colors.red}ERROR${colors.reset}   ${msg}`);
    writeToFile('ERROR', msg, data);
    
    if (data instanceof Error) {
      console.error(data.stack);
    }
  }
};

function rotateOldLogs(): void {
  try {
    if (!fs.existsSync(LOG_DIR)) return;
    
    const files = fs.readdirSync(LOG_DIR);
    const now = Date.now();
    const maxAge = 7 * 24 * 60 * 60 * 1000;
    
    files.forEach(file => {
      const filePath = path.join(LOG_DIR, file);
      const stats = fs.statSync(filePath);
      
      if (now - stats.mtimeMs > maxAge) {
        fs.unlinkSync(filePath);
        console.log(`[LOGGER] Rotated old log: ${file}`);
      }
    });
  } catch (error) {
    console.error('[LOGGER] Failed to rotate logs:', error);
  }
}

rotateOldLogs();
