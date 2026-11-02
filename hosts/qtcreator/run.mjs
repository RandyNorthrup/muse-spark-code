import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { conformHost } from '../../test/hostApi/harness.mjs'

await conformHost({
  host: 'qtcreator',
  tool: false,
  need: 'no MHP surface: the shim is excepted from MHP scenarios and qualifies via its unittest launch tests over the real agent; the Lua half needs an in-editor run (see receipt m104-qtcreator)',
  args: [],
  directory: path.dirname(fileURLToPath(import.meta.url)),
})
