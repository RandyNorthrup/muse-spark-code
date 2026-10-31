import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { conformHost } from '../../test/hostApi/harness.mjs'

await conformHost({
  host: 'zed',
  tool: false,
  need: 'no MHP surface: the shim is excepted from MHP scenarios and qualifies via its offline unittest contract suite (see receipt m104-zed); no Zed GUI test harness exists upstream',
  args: [],
  directory: path.dirname(fileURLToPath(import.meta.url)),
})
