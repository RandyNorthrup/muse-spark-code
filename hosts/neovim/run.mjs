import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { conformHost } from '../../test/hostApi/harness.mjs'

await conformHost({
  host: 'neovim',
  tool: false,
  need: 'no MHP surface: the shim is excepted from MHP scenarios and qualifies via its headless harness (see receipt m104-neovim)',
  args: [],
  directory: path.dirname(fileURLToPath(import.meta.url)),
})
