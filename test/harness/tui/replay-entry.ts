import { Terminal } from '@xterm/xterm'

const params = new URLSearchParams(location.search)
const golden = params.get('golden') ?? 'splash/truecolor-80x24.ans'
const columns = Math.trunc(Number(params.get('cols') ?? '80'))
const rows = Math.trunc(Number(params.get('rows') ?? '24'))
const isDark = (params.get('theme') ?? 'dark') === 'dark'

const terminal = new Terminal({
  cols: columns,
  rows,
  theme: isDark
    ? { background: '#0a0a0f', foreground: '#e4e7ed' }
    : { background: '#fafafa', foreground: '#252932' },
  fontFamily: 'Menlo, Consolas, monospace',
  fontSize: 13,
})
const host = document.querySelector('#terminal')
if (host === null) throw new Error('the replay page has no terminal host')
terminal.open(host)

const errors: string[] = []
window.addEventListener('error', (event) => {
  errors.push(event.message)
})

const response = await fetch(`goldens/${golden}`)
const bytes = await response.text()
terminal.write(bytes.replaceAll('\n', '\r\n'), () => {
  if (errors.length > 0) {
    document.title = `replay errors: ${errors.join('; ')}`
    return
  }
  const marker = document.createElement('div')
  marker.id = 'replay-ready'
  document.body.append(marker)
})
