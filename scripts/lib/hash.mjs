import { createHash } from 'crypto'

export function sha256(content) {
  return createHash('sha256').update(content).digest('hex')
}
