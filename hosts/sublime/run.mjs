import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { conformHost } from '../../test/hostApi/harness.mjs'

await conformHost({
  host: 'sublime',
  tool: false,
  need: 'no MHP surface: the shim is excepted from MHP scenarios and qualifies via its offline unittest suite (see receipt m104-sublime)',
  args: [],
  directory: path.dirname(fileURLToPath(import.meta.url)),
})
