import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { conformHost } from '../../test/hostApi/harness.mjs'

await conformHost({
  host: 'eclipse',
  tool: ['xvfb-run', 'mvn', 'java', 'node'],
  need: 'Linux with Xvfb, Apache Maven 3.9.11, JDK 21 and Node.js',
  args: ['-a', 'mvn', '-B', 'verify', '-Dtest=ConformanceIT'],
  directory: path.dirname(fileURLToPath(import.meta.url)),
  jdk: true,
})
