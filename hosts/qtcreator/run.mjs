import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { conformHost } from '../../test/hostApi/harness.mjs'

await conformHost({
  host: 'qtcreator',
  tool: false,
  need: 'no MHP surface: the shim is excepted from MHP scenarios and qualifies via its Lua check under headless Neovim plus its unittest launch tests (see receipt m104-qtcreator)',
  args: [],
  directory: path.dirname(fileURLToPath(import.meta.url)),
})
