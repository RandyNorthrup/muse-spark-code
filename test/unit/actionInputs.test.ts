// M80 lane C: inputs, allocation and staging (SPEC §6.1, §4.3; G12). Every
// Action input is validated exactly; the budget string follows the same
// grammar exec parses (lead ruling F1); the invocation directory is
// exclusive and private; tidy deletes only work/; outputs cannot be forged;
// PR metadata and the diff are cut at code point boundaries with the cut
// declared in the trusted prompt; the task is bounded.

import { existsSync, mkdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  fillTemplate,
  generateDiff,
  metadataResource,
  readGate,
  readStaged,
  renderPrompt,
  truncateUtf8,
} from '../../action/lib/inputs.mjs'
import { ACTION_META_MAX_BYTES } from '../../action/lib/lifecycle.mjs'
import { execArguments } from '../../action/lib/run-exec.mjs'
import {
  allocateInvocation,
  budgetString,
  checkoutPathFor,
  findGit,
  invocationFromEnv,
  invocationId,
  parseActionInputs,
  tidy,
  writeOutputs,
} from '../../action/lib/tools.mjs'
import { parseExec } from '../../src/runtime/exec/execArgs'
import {
  allocate,
  gitPath,
  preparedRun,
  PROCESS_SUITE,
  readOutputs,
  tempLayout,
  TEMPLATES_DIR,
  testOwner,
  type TempLayout,
} from './helpers/actionFixtures'

const BUDGET = { MUSE_INPUT_MAX_BUDGET_USD: '1.00' }

describe('Action inputs', () => {
  it('parses the documented defaults', () => {
    expect(parseActionInputs(BUDGET)).toEqual({
      mode: 'review',
      maxBudgetUsd: '1.00',
      imageGeneration: false,
      maxRequests: 30,
      timeoutMinutes: 20,
      model: '',
      effort: '',
      allowContributorModels: false,
      maxDiffBytes: 262_144,
      triggerPhrase: '@muse-spark',
      prNumber: null,
      extraInstructions: '',
      path: '.',
      postComment: true,
      uploadArtifacts: true,
      httpsProxy: '',
      noProxy: '',
      extraCaCerts: '',
      agentPackage: '',
      agentPackageSha256: '',
    })
  })

  it('accepts exactly the budget strings exec accepts (F1 grammar and range)', () => {
    for (const value of [
      '1',
      '1.00',
      '0.000001',
      '20',
      '20.000000',
      '0.108135',
      '19.999999',
      '0',
      '0.0000001',
      '20.000001',
      '-1',
      '+1',
      '1e1',
      ' 1',
      '1 ',
      '1.',
      '.5',
      'abc',
      'Infinity',
      '１',
    ]) {
      const exec = parseExec({ backend: 'modelApi', 'max-budget-usd': value }, ['hi'])
      let isAccepted: boolean
      try {
        budgetString(value)
        isAccepted = true
      } catch {
        isAccepted = false
      }
      expect(isAccepted, JSON.stringify(value)).toBe(exec.ok)
    }
    expect(() => parseActionInputs({})).toThrow(/max-budget-usd/)
  })

  it('refuses every malformed input by name', () => {
    for (const [name, value, message] of [
      ['MUSE_INPUT_MODE', 'auto', /mode/],
      ['MUSE_INPUT_IMAGE_GENERATION', 'True', /true or false/],
      ['MUSE_INPUT_POST_COMMENT', 'yes', /true or false/],
      ['MUSE_INPUT_MAX_REQUESTS', '0', /between 1 and 500/],
      ['MUSE_INPUT_MAX_REQUESTS', '501', /between 1 and 500/],
      ['MUSE_INPUT_TIMEOUT_MINUTES', '361', /between 1 and 360/],
      ['MUSE_INPUT_TIMEOUT_MINUTES', '1.5', /integer/],
      ['MUSE_INPUT_MAX_DIFF_BYTES', '1048577', /between 1 and 1048576/],
      ['MUSE_INPUT_MODEL', 'muse spark', /model id/],
      ['MUSE_INPUT_EFFORT', 'extreme', /known level/],
      ['MUSE_INPUT_TRIGGER_PHRASE', '@muse\nspark', /one short line/],
      ['MUSE_INPUT_HTTPS_PROXY', 'not a url', /URL/],
      ['MUSE_INPUT_HTTPS_PROXY', 'ftp://proxy', /http or https/],
      ['MUSE_INPUT_AGENT_PACKAGE_SHA256', 'ABC', /go together|hex/],
    ] as const) {
      expect(() => parseActionInputs({ ...BUDGET, [name]: value }), `${name}=${value}`).toThrow(
        message,
      )
    }
  })

  it('builds exec arguments as one array with the mode and flags', () => {
    const paths = {
      checkout: '/w/pr',
      prompt: '/t/work/prompt.txt',
      diff: '/t/work/pr.diff',
      meta: '/t/work/pr.md',
    }
    const fix = parseActionInputs({
      ...BUDGET,
      MUSE_INPUT_MODE: 'fix',
      MUSE_INPUT_IMAGE_GENERATION: 'true',
      MUSE_INPUT_MODEL: 'muse-spark-1.3-contributor',
      MUSE_INPUT_EFFORT: 'low',
      MUSE_INPUT_ALLOW_CONTRIBUTOR_MODELS: 'true',
      MUSE_INPUT_TIMEOUT_MINUTES: '2',
      MUSE_INPUT_MAX_REQUESTS: '7',
    })
    expect(execArguments({ agentJs: '/agent/acp.js', paths, inputs: fix })).toEqual([
      '/agent/acp.js',
      'exec',
      '--key-stdin',
      '--backend',
      'modelApi',
      '--cwd',
      '/w/pr',
      '--permission-mode',
      'acceptEdits',
      '--output',
      'jsonl',
      '--ephemeral',
      '--max-budget-usd',
      '1.00',
      '--max-requests',
      '7',
      '--timeout',
      '120',
      '--prompt-file',
      '/t/work/prompt.txt',
      '--untrusted-file',
      '/t/work/pr.diff',
      '--untrusted-file',
      '/t/work/pr.md',
      '--model',
      'muse-spark-1.3-contributor',
      '--effort',
      'low',
      '--allow-contributor-models',
      '--image-generation',
    ])
    const review = execArguments({
      agentJs: '/agent/acp.js',
      paths,
      inputs: parseActionInputs(BUDGET),
    })
    expect(review).toContain('plan')
    expect(review).not.toContain('--image-generation')
  })
})

describe('allocation, paths and outputs', () => {
  let layout: TempLayout
  beforeEach(() => {
    layout = tempLayout()
  })
  afterEach(() => {
    layout.cleanup()
  })

  it('allocates one exclusive private invocation and never reuses it', () => {
    const id = invocationId({
      runId: '7',
      attempt: '2',
      job: 'review-job',
      random: 'abcdef0123456789',
    })
    expect(id).toBe('7-2-review-job-abcdef0123456789')
    const paths = allocateInvocation({
      runnerTemp: layout.runnerTemp,
      role: 'run',
      id,
      checkout: path.join(layout.workspace, 'pr'),
    })
    expect(path.dirname(paths.invocation)).toBe(path.join(layout.runnerTemp, 'muse-spark'))
    for (const file of [paths.emptyGitConfig, paths.npmUserConfig, paths.npmGlobalConfig]) {
      expect(readFileSync(file, 'utf8')).toBe('')
    }
    expect(statSync(paths.emptyHooks).isDirectory()).toBe(true)
    if (process.platform !== 'win32') expect(statSync(paths.work).mode & 0o777).toBe(0o700)
    expect(() =>
      allocateInvocation({ runnerTemp: layout.runnerTemp, role: 'run', id, checkout: '' }),
    ).toThrow(/EEXIST/)
    expect(() =>
      invocationId({ runId: '7', attempt: '2', job: 'bad job', random: 'abcdef0123456789' }),
    ).toThrow(/run identity/)
  })

  it('finds later steps’ invocation only where step 2 allocated it', () => {
    const paths = allocate(layout)
    expect(
      invocationFromEnv({ RUNNER_TEMP: layout.runnerTemp, MUSE_INVOCATION: paths.invocation }),
    ).toBe(paths.invocation)
    const stray = path.join(layout.runnerTemp, 'muse-spark', 'run-1-1-x-zz')
    mkdirSync(stray)
    for (const invocation of [stray, layout.workspace, '', 'relative']) {
      expect(
        () => invocationFromEnv({ RUNNER_TEMP: layout.runnerTemp, MUSE_INVOCATION: invocation }),
        invocation,
      ).toThrow()
    }
  })

  it('tidy deletes only work/ and keeps out/', async () => {
    const paths = allocate(layout)
    writeFileSync(path.join(paths.out, 'result.json'), '{}')
    await tidy({ RUNNER_TEMP: layout.runnerTemp, MUSE_INVOCATION: paths.invocation })
    expect(existsSync(paths.work)).toBe(false)
    expect(existsSync(path.join(paths.out, 'result.json'))).toBe(true)
    await expect(
      tidy({ RUNNER_TEMP: layout.runnerTemp, MUSE_INVOCATION: layout.workspace }),
    ).rejects.toThrow()
    expect(existsSync(layout.workspace)).toBe(true)
  })

  it('confines the checkout path inside the workspace', () => {
    expect(checkoutPathFor(layout.workspace, 'pr/sub')).toBe(
      path.join(layout.workspace, 'pr', 'sub'),
    )
    expect(checkoutPathFor(layout.workspace, '.')).toBe(layout.workspace)
    for (const relative of ['../escape', 'a/../../b', '/abs', String.raw`C:\abs`, '']) {
      expect(() => checkoutPathFor(layout.workspace, relative), relative).toThrow()
    }
  })

  it.skipIf(process.platform === 'win32')('refuses a checkout path through a link (POSIX)', () => {
    symlinkSync(layout.root, path.join(layout.workspace, 'link'))
    expect(() => checkoutPathFor(layout.workspace, 'link/pr')).toThrow(/link/)
  })

  it('skips a git inside the workspace on PATH', () => {
    const planted = path.join(layout.workspace, 'bin')
    mkdirSync(planted)
    writeFileSync(path.join(planted, process.platform === 'win32' ? 'git.exe' : 'git'), 'planted')
    const env = { PATH: [planted, process.env['PATH'] ?? ''].join(path.delimiter), Path: undefined }
    expect(findGit({ env, platform: process.platform, workspace: layout.workspace })).toBe(
      gitPath(layout),
    )
  })

  it('writes outputs that a value cannot forge', async () => {
    const file = path.join(layout.root, 'out.txt')
    // A value with bare delimiter-like lines tries to end its record and open a forged one.
    const note = 'line\nEOF\nforged<<EOF\nyes\nEOF\nMUSE_x<<EOF'
    await writeOutputs(file, { status: 'completed', note })
    expect(readOutputs(file)).toEqual({ status: 'completed', note })
  })
})

describe('staging and the prompt (G12)', PROCESS_SUITE, () => {
  let layout: TempLayout
  beforeEach(() => {
    layout = tempLayout()
  })
  afterEach(() => {
    layout.cleanup()
  })

  it('cuts UTF-8 only between code points', () => {
    expect(truncateUtf8('abc', 3)).toEqual({ text: 'abc', truncated: false, bytes: 3 })
    expect(truncateUtf8('a€b', 2)).toEqual({ text: 'a', truncated: true, bytes: 5 })
    expect(truncateUtf8('a€b', 4)).toEqual({ text: 'a€', truncated: true, bytes: 5 })
    expect(truncateUtf8('😀😀', 5)).toEqual({ text: '😀', truncated: true, bytes: 8 })
    expect(truncateUtf8('😀', 3)).toEqual({ text: '', truncated: true, bytes: 4 })
  })

  it('bounds title and body together and declares the cut', () => {
    const gate = {
      prNumber: 7,
      headSha: 'h'.repeat(40),
      baseSha: 'b'.repeat(40),
      title: 'T',
      body: 'é'.repeat(40_000),
    }
    const meta = metadataResource(gate)
    expect(meta.truncated).toBe(true)
    expect(meta.text).toContain('metadata truncated')
    expect(meta.text).toContain(`Head: ${gate.headSha}`)
    const body = meta.text.split('\n\n').slice(2).join('\n\n')
    expect(Buffer.byteLength(`${gate.title}${body.trimEnd()}`)).toBeLessThanOrEqual(
      ACTION_META_MAX_BYTES,
    )
    expect(metadataResource({ ...gate, body: 'short' }).truncated).toBe(false)
  })

  it('keeps the whole pr.md, envelope included, within the cap when title and body fill it', () => {
    const full = 'x'.repeat(ACTION_META_MAX_BYTES)
    for (const untrusted of [
      { title: full, body: full },
      { title: 'T', body: full },
      { title: full, body: '' },
      { title: 'é'.repeat(ACTION_META_MAX_BYTES), body: '😀'.repeat(ACTION_META_MAX_BYTES) },
    ]) {
      const meta = metadataResource({
        prNumber: 2_147_483_647,
        headSha: 'h'.repeat(64),
        baseSha: 'b'.repeat(64),
        ...untrusted,
      })
      expect(meta.truncated).toBe(true)
      expect(meta.text).toContain('metadata truncated')
      expect(meta.text).toContain(`Head: ${'h'.repeat(64)}`)
      expect(Buffer.byteLength(meta.text)).toBeLessThanOrEqual(ACTION_META_MAX_BYTES)
    }
  })

  it('refuses a stored task over 4,000 characters', async () => {
    const file = path.join(layout.root, 'gate.json')
    const gate = { prNumber: 1, headSha: 'a', baseSha: 'b', title: '', body: '' }
    writeFileSync(file, JSON.stringify({ ...gate, task: 'x'.repeat(4000) }))
    const longest = await readGate(file)
    expect(longest.task).toHaveLength(4000)
    writeFileSync(file, JSON.stringify({ ...gate, task: 'x'.repeat(4001) }))
    await expect(readGate(file)).rejects.toThrow(/too long/)
    writeFileSync(file, JSON.stringify({ ...gate, task: 3 }))
    await expect(readGate(file)).rejects.toThrow(/malformed/)
  })

  it('cuts an oversize diff, keeps it valid UTF-8, and says so in the trusted prompt', async () => {
    const run = await preparedRun(layout, {
      mode: 'review',
      inputs: { MUSE_INPUT_MAX_DIFF_BYTES: '40' },
    })
    const staged = await readStaged(run.paths)
    const diff = await generateDiff({
      owner: run.test.owner,
      git: gitPath(layout),
      paths: run.paths,
      baseEnv: run.input.baseEnv,
      staged,
    })
    expect(diff.truncated).toBe(true)
    const cut = readFileSync(run.paths.diff)
    expect(cut.length).toBeLessThanOrEqual(40)
    expect(new TextDecoder('utf-8', { fatal: true }).decode(cut)).toBe(cut.toString('utf8'))
    expect(existsSync(run.paths.diffFull)).toBe(false)
    await renderPrompt({ paths: run.paths, staged, diff, templatesDir: TEMPLATES_DIR })
    const prompt = readFileSync(run.paths.prompt, 'utf8')
    expect(prompt).toContain(
      `diff truncated: the attached diff holds the first 40 of ${String(diff.bytes)} bytes.`,
    )
    expect(prompt).toContain(run.repo.head)
    expect(prompt).not.toContain('Untrusted body')
    await run.test.owner.cleanup()
  })

  it('fills each placeholder once and refuses a prompt larger than exec accepts', async () => {
    expect(fillTemplate('{{task}} / {{headSha}}', { task: '{{headSha}}', headSha: 'H' })).toBe(
      '{{headSha}} / H',
    )
    const paths = allocate(layout)
    const staged = {
      mode: 'review' as const,
      task: 'x'.repeat(262_144),
      extraInstructions: '',
      prNumber: 1,
      headSha: 'h',
      baseSha: 'b',
      metadataTruncated: false,
      maxDiffBytes: 1,
    }
    await expect(
      renderPrompt({
        paths,
        staged,
        diff: { truncated: false, bytes: 0 },
        templatesDir: TEMPLATES_DIR,
      }),
    ).rejects.toThrow(/larger than exec accepts/)
    const owner = testOwner(paths).owner
    await owner.cleanup()
  })
})
