// Synthetic process-lock drill only. No credentials or service traffic.
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { withChatGptRefreshLock } = require(process.argv[2])
await withChatGptRefreshLock(
  async () => {
    process.send('held')
    await new Promise((resolve) => process.once('message', resolve))
  },
  { port: Number(process.argv[3]), timeoutMs: 5000 },
)
process.disconnect()
