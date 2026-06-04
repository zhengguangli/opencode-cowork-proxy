/**
 * Vercel serverless function — catch-all route.
 * Wraps the Hono app's fetch handler for Vercel's Node.js runtime.
 */
import app from '../src/index'

export default app.fetch
