// Attach proof for test/hosts/xcode.sh (M66): a session/new offering one
// real stdio MCP server, zero model calls. XCODE_MCP_SERVER selects it:
// unset (or anything but `xcode`) offers this package's own `mcp` mode;
// `xcode` offers `xcrun mcpbridge` (needs Xcode running with a project
// open and external agents allowed). Exit 0 when the session starts and the
// agent's forward line names the offered server (the offer reached the
// engine; whether that server answers is the probe's verdict, not this
// script's), 1 on any failure, 2 when the Muse Code CLI is not installed
// (nothing to attach through).
import { spawn } from 'node:child_process'

const agentJs = process.env['XCODE_ACP_JS']
const nodeBin = process.env['XCODE_NODE']
const cwd = process.env['XCODE_CWD']
if (agentJs === undefined || nodeBin === undefined || cwd === undefined) {
  console.error('xcode-attach: XCODE_ACP_JS, XCODE_NODE and XCODE_CWD must be set')
  process.exit(1)
}
const isXcodeServer = process.env['XCODE_MCP_SERVER'] === 'xcode'
const server = isXcodeServer
  ? { type: 'stdio', name: 'xcode', command: '/usr/bin/xcrun', args: ['mcpbridge'], env: [] }
  : {
      type: 'stdio',
      name: 'muse-spark-self',
      command: nodeBin,
      args: [agentJs, 'mcp'],
      env: [],
    }

const child = spawn(nodeBin, [agentJs, '--backend', 'museCode'], {
  stdio: ['pipe', 'pipe', 'pipe'],
})
const state = { stderr: '', nextId: 1, text: '' }
child.stderr.on('data', (chunk) => {
  state.stderr += chunk.toString()
})
const pending = new Map()
function send(method, params) {
  const id = state.nextId
  state.nextId += 1
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
  })
}
child.stdout.on('data', (chunk) => {
  state.text += chunk.toString()
  let newline = state.text.indexOf('\n')
  while (newline >= 0) {
    const line = state.text.slice(0, newline)
    state.text = state.text.slice(newline + 1)
    newline = state.text.indexOf('\n')
    if (line.trim() === '') continue
    const message = JSON.parse(line)
    if (message.id === undefined || !pending.has(message.id)) continue
    const { resolve, reject } = pending.get(message.id)
    pending.delete(message.id)
    if (message.error === undefined) resolve(message.result)
    else reject(message.error)
  }
})
function fail(why) {
  console.error(`xcode-attach: FAIL ${why}`)
  child.kill('SIGKILL')
  process.exit(1)
}
try {
  await send('initialize', {
    protocolVersion: 1,
    clientCapabilities: {},
    clientInfo: { name: 'xcode-attach', version: '0' },
  })
  let session
  try {
    session = await send('session/new', { cwd, mcpServers: [server] })
  } catch (error) {
    if (JSON.stringify(error).includes('not installed in any known location')) {
      console.error('xcode-attach: BLOCKED the Muse Code CLI is not installed')
      child.kill('SIGKILL')
      process.exit(2)
    }
    throw error
  }
  if (typeof session?.sessionId !== 'string' || session.sessionId === '') {
    fail('session/new answered without a session id')
  }
  // The forward line prints only past the grant check and the translation.
  if (!state.stderr.includes(`MCP servers from the editor: ${server.name}`)) {
    fail(`the agent never forwarded ${server.name} (stderr: ${state.stderr.slice(-400)})`)
  }
  await send('session/close', { sessionId: session.sessionId })
  console.log(`xcode-attach: ok, session ${session.sessionId} offered ${server.name}`)
  child.stdin.end()
  await new Promise((resolve) => child.on('exit', resolve))
} catch (error) {
  fail(JSON.stringify(error).slice(0, 500))
}
