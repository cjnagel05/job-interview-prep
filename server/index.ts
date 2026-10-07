import path from 'node:path'
import dotenv from 'dotenv'
import { createApp } from './app.ts'

// npm runs from the project root. The host environment takes precedence over .env.
dotenv.config({ path: path.resolve('.env'), quiet: true })

const port = Number(process.env.PORT || 3001)
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error('PORT must be an integer between 1 and 65535.')
  process.exit(1)
}
const server = createApp().listen(port, '0.0.0.0', () => {
  console.log(`Interview prep server ready on port ${port}`)
})
server.on('error', () => {
  console.error(`The server could not start. Check whether port ${port} is already in use.`)
  process.exit(1)
})
