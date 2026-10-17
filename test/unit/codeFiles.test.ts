import { describe, expect, it } from 'vitest'
import { canChangeWhatRuns, isCodeLoading } from '../../src/core/verify/codeFiles'

describe('isCodeLoading (the M68 review)', () => {
  it('names the files the editor’s own tools load and run as code', () => {
    for (const path of [
      'eslint.config.js',
      'eslint.config.mjs',
      'web/vite.config.ts',
      'prettier.config.cjs',
      'karma.conf.js',
      '.eslintrc.cjs',
      '.prettierrc.js',
      '.babelrc.js',
      'gulpfile.js',
      'Gruntfile.cjs',
      '.eslintrc',
      '.eslintrc.json',
      '.prettierrc.yaml',
      '.stylelintrc',
      'package.json',
      'app/package.json',
      '.pnpmfile.cjs',
      'biome.json',
      'deno.jsonc',
      'node_modules/eslint/lib/api.js',
      'packages/a/node_modules/x/index.js',
    ]) {
      expect(isCodeLoading(path), path).toBe(true)
    }
  })

  it('leaves ordinary sources and data alone', () => {
    for (const path of [
      'src/config.ts',
      'src/app.config.json',
      'tsconfig.json',
      'README.md',
      'src/eslint.ts',
      'docs/node_modules.md',
    ]) {
      expect(isCodeLoading(path), path).toBe(false)
    }
  })
})

describe('canChangeWhatRuns (the M68 review)', () => {
  it('holds for files that define commands, code the tools load, and files the command names', () => {
    expect(canChangeWhatRuns('package.json', 'npm run lint')).toBe(true)
    expect(canChangeWhatRuns('Makefile', 'make check')).toBe(true)
    expect(canChangeWhatRuns('pyproject.toml', 'pytest')).toBe(true)
    expect(canChangeWhatRuns('eslint.config.js', 'npx eslint .')).toBe(true)
    expect(canChangeWhatRuns('scripts/check.js', 'node scripts/check.js')).toBe(true)
    expect(canChangeWhatRuns('check.js', 'node ./check.js --fast')).toBe(true)
    expect(canChangeWhatRuns('tools/lint.ps1', String.raw`& '.\tools\lint.ps1'`)).toBe(true)
  })

  it('does not hold for a source file the command does not name', () => {
    expect(canChangeWhatRuns('src/a.ts', 'npm run lint')).toBe(false)
    expect(canChangeWhatRuns('src/check.ts', 'node scripts/lint.js')).toBe(false)
    expect(canChangeWhatRuns('src/a.ts', 'npx eslint --max-warnings=0 src/b.ts')).toBe(false)
  })

  // The review of PR #54's fourth round: names a runtime resolves.
  it('holds for a file named without its extension, as a module, or as its folder’s entry', () => {
    expect(canChangeWhatRuns('scripts/check.js', 'node scripts/check')).toBe(true)
    expect(canChangeWhatRuns('scripts/check.e2e.js', 'node scripts/check.e2e')).toBe(true)
    expect(canChangeWhatRuns('scripts/check.ps1', './scripts/check')).toBe(true)
    expect(canChangeWhatRuns('tools/check.py', 'python -m tools.check')).toBe(true)
    expect(canChangeWhatRuns('tools/__main__.py', 'python -m tools')).toBe(true)
    expect(canChangeWhatRuns('cmd/check/main.go', 'go run ./cmd/check')).toBe(true)
    expect(canChangeWhatRuns('cmd/check/main.go', 'go run ./cmd/check/')).toBe(true)
    expect(canChangeWhatRuns('index.js', 'node .')).toBe(true)
    expect(canChangeWhatRuns('index.js', 'node ./')).toBe(true)
    // A folder's other files are not what a runtime runs for it.
    expect(canChangeWhatRuns('cmd/check/util.go', 'go run ./cmd/check')).toBe(false)
    expect(canChangeWhatRuns('src/a.ts', 'node .')).toBe(false)
  })

  // PR #54, fourth Codex round: a command whose words cannot be told for certain.
  it('holds for a file the command names in quotes, and for any file when its words are uncertain', () => {
    expect(canChangeWhatRuns('scripts/my check.js', 'node "scripts/my check.js"')).toBe(true)
    expect(canChangeWhatRuns('scripts/my check.js', "node 'scripts/my check.js'")).toBe(true)
    expect(canChangeWhatRuns('scripts/my check.js', String.raw`node scripts/my\ check.js`)).toBe(
      true,
    )
    expect(canChangeWhatRuns('src/lint.js', String.raw`node .\src\lint.js`)).toBe(true)
    expect(canChangeWhatRuns('config/x.js', 'npx eslint --config=config/x.js .')).toBe(true)
    // A path inside a word of a plain command, found in the command's text.
    expect(canChangeWhatRuns('src/lint.js', 'node src/lint.js:fix')).toBe(true)
    // Any shell syntax: the command may run any file.
    for (const command of [
      'node "$SCRIPT"',
      'node $(cat which.txt)',
      'node `cat which.txt`',
      'node %SCRIPT%',
      'node scripts/*.js',
      'node scripts/{a,b}.js',
      'node ~/x.js',
      'node x.js; node y.js',
      'node x.js && node y.js',
      'node @args',
      'node a,b',
      'FOO=1 bash -c "node x.js"',
    ]) {
      expect(canChangeWhatRuns('src/unrelated.ts', command)).toBe(true)
    }
  })
})
