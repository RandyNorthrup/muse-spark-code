import { appendFileSync } from 'node:fs'
import * as z from 'zod/mini'

let input = ''
for await (const chunk of process.stdin) input += chunk
const payload = z
  .object({
    hook_event_name: z.string(),
    file_path: z.string(),
    content: z.optional(z.string()),
  })
  .parse(JSON.parse(input))
if (payload.hook_event_name === 'beforeTabFileRead') {
  process.stdout.write(
    JSON.stringify({ permission: payload.content?.includes('BLOCK_TAB') ? 'deny' : 'allow' }),
  )
} else {
  appendFileSync(payload.file_path, '\n// fake hook edited accepted completion\n')
}
