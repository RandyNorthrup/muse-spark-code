import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { conformHost } from '../../test/hostApi/harness.mjs'

await conformHost({
  host: 'visualstudio',
  tool: 'dotnet',
  need: 'Windows with Visual Studio 2022/2026 (VSSDK workload) and the experimental instance',
  args: [
    'test',
    'Test/MuseSpark.VisualStudio.Test.csproj',
    '--filter',
    'FullyQualifiedName~Conformance',
  ],
  directory: path.dirname(fileURLToPath(import.meta.url)),
  platforms: ['win32'],
})
