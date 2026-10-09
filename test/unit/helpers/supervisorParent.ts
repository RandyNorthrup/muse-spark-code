import path from 'node:path'
import { PassThrough } from 'node:stream'
import { superviseRuntime } from '../../../src/runtime/lsp/supervisor'
const [registry, workspace, watchdogFile, receipt, locatorDirectory] = process.argv.slice(2)
if (
  registry === undefined ||
  workspace === undefined ||
  watchdogFile === undefined ||
  receipt === undefined
)
  throw new Error('fixture args')
const source = `
const {spawn} = require('node:child_process');
const child = spawn(process.execPath, ['-e', 'process.on("SIGTERM",()=>{});setInterval(()=>{},1000)'], {detached:true,stdio:'ignore'});
child.unref();
require('node:fs').writeFileSync(process.argv[1],JSON.stringify({root:process.pid,detached:child.pid}));
process.on('SIGTERM',()=>{});
setInterval(()=>{},1000);
`
const stdout = new PassThrough()
stdout.resume()
void superviseRuntime({
  registry,
  ...(locatorDirectory !== undefined && { locatorDirectory }),
  cwd: workspace,
  file: process.execPath,
  args: ['-e', source, receipt],
  watchdogFile,
  env: process.env,
  packageRoot: path.dirname(__filename),
  stdin: new PassThrough(),
  stdout,
})
  .then((code) => {
    process.exitCode = code
  })
  .catch(() => {
    process.exitCode = 1
  })
