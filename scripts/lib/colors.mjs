const colors = {
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  reset: '\x1b[0m'
}

export function log(msg) { console.log(`${colors.blue}[pilot]${colors.reset} ${msg}`) }
export function ok(msg) { console.log(`${colors.green}[ok]${colors.reset} ${msg}`) }
export function warn(msg) { console.log(`${colors.yellow}[warn]${colors.reset} ${msg}`) }
export function err(msg) { console.error(`${colors.red}[error]${colors.reset} ${msg}`) }
export function skip(msg) { console.log(`${colors.cyan}[skip]${colors.reset} ${msg}`) }
export function update(msg) { console.log(`${colors.magenta}[update]${colors.reset} ${msg}`) }
