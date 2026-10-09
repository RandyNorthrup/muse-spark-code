import assert from 'node:assert/strict'
import { runInNewContext } from 'node:vm'

let input = ''
for await (const chunk of process.stdin) input += chunk
const scripts = JSON.parse(input)
for (const [kind, script] of Object.entries(scripts)) {
  const listeners = new Map()
  const styles = new Map()
  const document = {
    readyState: 'loading',
    documentElement: {
      dataset: { theme: 'dark' },
      style: {
        values: styles,
        setProperty(name, value) {
          styles.set(name, value)
        },
      },
    },
    addEventListener(name, listener) {
      listeners.set(name, listener)
    },
  }
  runInNewContext(script, { document })
  assert.equal(document.documentElement.style.values.size, 0)
  assert.ok(listeners.has('DOMContentLoaded'))
  listeners.get('DOMContentLoaded')()
  assert.equal(document.documentElement.dataset.theme, kind)
  assert.equal(document.documentElement.style.values.get('--ms-editor-background'), '#123456')
  assert.equal(document.documentElement.style.values.get('--ms-foreground'), '#abcdef')
  const loaded = { ...document, readyState: 'complete' }
  document.documentElement.style.values.clear()
  runInNewContext(script, { document: loaded })
  assert.equal(document.documentElement.style.values.get('--ms-editor-background'), '#123456')
}
process.stdout.write('M104_THEME_BOOTSTRAP_OK\n')
