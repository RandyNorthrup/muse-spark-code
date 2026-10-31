import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { conformHost } from '../../test/hostApi/harness.mjs'

await conformHost({
  host: 'xcode',
  tool: 'xcodebuild',
  need: 'macOS with Xcode (XCTest harness)',
  args: [
    '-project',
    'MuseSpark.xcodeproj',
    '-scheme',
    'MuseSpark',
    '-configuration',
    'Debug',
    '-derivedDataPath',
    '../../temp/m104x/DerivedData',
    '-destination',
    'platform=macOS',
    '-only-testing:ConformanceTests',
    'test',
    'CODE_SIGN_IDENTITY=-',
  ],
  directory: path.dirname(fileURLToPath(import.meta.url)),
})
