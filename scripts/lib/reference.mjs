import { brotliCompressSync } from 'node:zlib'
// HELPREF: code/manifest-derived reference and freshness gate. No model calls.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import LZString from 'lz-string'
import path from 'node:path'
import { Buffer } from 'node:buffer'
import * as esbuild from 'esbuild'
import ts from 'typescript'
import { format, resolveConfig } from 'prettier'

const MODULE = 'src/shared/reference/reference.generated.ts'
const DOC = 'docs/reference.md'
const JSON_MODEL = 'src/shared/reference/reference.generated.json'

// Catalogue lint: descriptions explain operations and conditions. UI notices
// asserting the current session's state are not reusable reference descriptions.
export function lintReferenceDescription(text, identity) {
  if (typeof text !== 'string') return []
  return /\b(?:when|if|currently|enabled|disabled|already)\b|\bright\s+now\b|\b(?:is|are|was|were|becomes?|remains?|stays?)\s+(?:not\s+)?["'`]*(?:available|unavailable|enabled|disabled|on|off|active|inactive|running|connected|disconnected|signed\s+in|installed|configured)\b|\bcannot\b[^.!?\n]*\buntil\b|\b(?:this|the current)\b[^.!?\n]*\b(?:cannot|contains a secret)\b|\b(?:was|were)\s+detected\b|\bhas\s+no\b[^.!?\n]*\bin\s+this\b/i.test(
    text,
  )
    ? [`Catalogue asserts conditional state: ${identity}`]
    : []
}

export function lintReferenceFacts(value, identity = 'facts') {
  if (Array.isArray(value)) return value.flatMap((entry) => lintReferenceFacts(entry, identity))
  if (typeof value !== 'object' || value === null) return []
  return Object.entries(value).flatMap(([key, entry]) => {
    return typeof entry === 'string' && /\s/.test(entry) && typeof value[`${key}Key`] !== 'string'
      ? [`Unlocalized reference fact: ${identity}.${key}`]
      : lintReferenceFacts(entry, `${identity}.${key}`)
  })
}

function lintDescriptionReference(ref) {
  return 'ui' in ref &&
    /(?:Failed|Error|Unavailable|Unreadable|Unknown|Denied|Blocked|Refused|NotLatest|SideChat)/.test(
      ref.ui,
    )
    ? [`Failure message used as catalogue description: ${ref.ui}`]
    : []
}

function plainTexts(ref) {
  return 'conditions' in ref ? ref.conditions.map((condition) => condition.text) : [ref]
}

function lintReferenceText(ref, identity, resolve) {
  if (!('conditions' in ref))
    return [...lintReferenceDescription(resolve(ref), identity), ...lintDescriptionReference(ref)]
  const errors = ref.conditions.length === 0 ? [`Empty catalogue conditions: ${identity}`] : []
  for (const condition of ref.conditions) {
    if (!/^[\w.=:&|!-]+$/.test(condition.when))
      errors.push(`Invalid condition selector: ${identity}`)
    if ('conditions' in condition.text) errors.push(`Nested catalogue conditions: ${identity}`)
    if (!resolve(condition.text)?.trim()) errors.push(`Missing condition description: ${identity}`)
    errors.push(...lintDescriptionReference(condition.text))
  }
  return errors
}

// Evidence identifiers use one spelling on every platform, including allow-lists.
function referencePath(file) {
  return file.replaceAll('\\', '/')
}

// Catalogue mutations do not change handler source. Cache only this pure scan;
// context membership is checked against the current registry on every build.
const keyboardAnalysis = new Map()
function keyboardDispatch(file, text) {
  const previous = keyboardAnalysis.get(file)
  if (previous?.text === text) return previous
  const errors = []
  const contexts = new Set()
  const tree = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const visit = (node, functionName = '', keyboardParameters = new Set()) => {
    if (ts.isFunctionDeclaration(node)) functionName = node.name?.text ?? ''
    if (ts.isFunctionLike(node)) {
      keyboardParameters = new Set(keyboardParameters)
      const attribute = node.parent?.parent
      const isKeyHandler =
        attribute !== undefined &&
        ts.isJsxAttribute(attribute) &&
        ['onKeyDown', 'onKeyUp'].includes(attribute.name.getText(tree))
      for (const parameter of node.parameters) {
        const isKeyboardParameter =
          parameter.type !== undefined &&
          ts.isTypeReferenceNode(parameter.type) &&
          parameter.type.typeName.getText(tree).split('.').at(-1) === 'KeyboardEvent'
        if (isKeyHandler || isKeyboardParameter) {
          if (ts.isIdentifier(parameter.name)) keyboardParameters.add(parameter.name.text)
          else errors.push(`Keyboard dispatch bypasses registry: ${file}`)
        }
      }
    }
    const isKeyboardAccess =
      ((ts.isPropertyAccessExpression(node) && ['key', 'code'].includes(node.name.text)) ||
        (ts.isElementAccessExpression(node) &&
          ts.isStringLiteral(node.argumentExpression) &&
          ['key', 'code'].includes(node.argumentExpression.text))) &&
      ts.isIdentifier(node.expression) &&
      keyboardParameters.has(node.expression.text)
    const isImeAccess =
      file === 'src/webview/components/Composer.tsx' &&
      functionName === 'isComposing' &&
      ts.isBinaryExpression(node.parent) &&
      node.parent.right.getText(tree) === 'IME_PROCESS_KEY'
    if (
      !isImeAccess &&
      (isKeyboardAccess ||
        (ts.isPropertyAccessExpression(node) && node.getText(tree) === 'event.key'))
    )
      errors.push(`Keyboard dispatch bypasses registry: ${file}`)
    if (ts.isCallExpression(node) && node.expression.getText(tree) === 'webviewKey') {
      const context = node.arguments[0]
      if (!context || !ts.isStringLiteral(context)) errors.push(`Unknown keyboard context: ${file}`)
      else contexts.add(context.text)
    }
    ts.forEachChild(node, (child) => visit(child, functionName, keyboardParameters))
  }
  visit(tree)
  const result = { text, errors, contexts }
  keyboardAnalysis.set(file, result)
  return result
}

export async function referenceSources(root) {
  const result = await esbuild.build({
    stdin: {
      contents:
        "export * from './src/shared/reference/referenceSource'; export { readSettings } from './src/host/settings'; export { readResourceSettings, resourceSettingsSchema } from './src/shared/resources'; export { parseCommandLine } from './src/runtime/cliArgs'; export { parseLoopPrompt } from './src/core/backends/modelapi/schedules'; export { locateDictationHelper, locateCaptureHelper } from './src/core/voice/helperLocation'",
      resolveDir: root,
      sourcefile: 'reference-tooling.ts',
    },
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    logLevel: 'silent',
  })
  const source = await import(
    `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].contents).toString('base64')}`
  )
  const files = [
    'src/shared/protocol.ts',
    'src/runtime/backends.ts',
    'src/extension.ts',
    'src/acp/agent.ts',
    ...readdirSync(path.join(root, 'src/webview'), { recursive: true })
      .filter((name) => /\.tsx?$/.test(name))
      .map((name) => referencePath(`src/webview/${name}`)),
  ]
  return {
    ...source,
    bundledSkills: readdirSync(
      path.join(root, 'vendor/high-quality-projects-skill/skills'),
    ).toSorted((a, b) => a.localeCompare(b)),
    firstPartySkills: readdirSync(path.join(root, 'first-party-skills')).toSorted((a, b) =>
      a.localeCompare(b),
    ),
    evidence: Object.fromEntries(
      files.map((file) => [file, readFileSync(path.join(root, file), 'utf8')]),
    ),
  }
}

function keyOf(text) {
  return /^%[^%]+%$/.test(text ?? '') ? text.slice(1, -1) : undefined
}
function translated(text, nls) {
  return keyOf(text) === undefined ? text : nls[keyOf(text)]
}

function settingSchema(value, nls) {
  if (Array.isArray(value)) return value.map((entry) => settingSchema(entry, nls))
  if (typeof value !== 'object' || value === null) return value
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, entry]) => {
      if (
        [
          'description',
          'markdownDescription',
          'title',
          'deprecationMessage',
          'markdownDeprecationMessage',
        ].includes(key) &&
        keyOf(entry) !== undefined
      )
        return [
          [key, translated(entry, nls)],
          [`${key}Key`, keyOf(entry)],
        ]
      return [[key, settingSchema(entry, nls)]]
    }),
  )
}

// Read the exact tables passed to parseArgs by each runtime route.
export function parserOptions(_runtimeSource, source) {
  return Object.entries(source.CLI_OPTION_REGISTRY).flatMap(([route, definition]) =>
    Object.entries(definition.options).map(([name, option]) => ({
      name,
      routes: [route],
      ...option,
    })),
  )
}

const platformProbe = (platform, remoteName) => ({
  platform,
  remoteName,
  systemRoot: String.raw`C:\Windows`,
  programFiles: String.raw`C:\Program Files`,
  appName: 'reference',
  helperDir: '/reference/native',
  pathVariable: '/reference/bin',
  fileExists: () => true,
})

export function referenceFacts(source) {
  // Probe the actual platform selectors with installed-helper paths; no process
  // or microphone is started. Availability still requires the named recorder.
  const platforms = ['win32', 'darwin', 'linux']
  const dictationPlatforms = platforms.filter(
    (platform) => source.locateDictationHelper(platformProbe(platform)).isAvailable,
  )
  const voicePlatforms = platforms.filter(
    (platform) => source.locateCaptureHelper(platformProbe(platform)).isAvailable,
  )
  return {
    providers: {
      management: ['vscode:museCode', 'vscode:modelApi', 'acp:museCode', 'acp:modelApi'],
      modelRequests: 'modelApi',
    },
    'team-workers': {
      dispatch: 'integrationPending',
      controls: 'capturedTaskState',
      tariff: 'selectedProviderModel',
    },
    usage: {
      journal: 'sharedAcpHeadlessLocalDay',
      companion: 'loopback',
      credentials: 'neverExported',
    },
    compaction: { automatic: 'evaluationPending', manual: '/compact' },
    acp: {
      operations: source.evidence['src/acp/agent.ts']
        .matchAll(/\.on(?:Request|Notification)\('([^']+)'/g)
        .map((match) => match[1])
        .toArray(),
      clientRequests: [
        ...new Set(
          source.evidence['src/acp/agent.ts']
            .matchAll(/\.client\.request\('([^']+)'/g)
            .map((match) => match[1]),
        ),
      ],
      configOptions: source.ACP_CONFIG_IDS,
      permissionModes: source.PERMISSION_MODES,
      bypassFlag: '--allow-dangerously-skip-permissions',
      projectContext: {
        flag: '--trust-workspace',
        modelApi: {
          rules: source.RULES_FILE_NAMES,
          skillFile: source.SKILL_FILE_NAME,
          memory: source.MEMORY_DIR_SEGMENTS,
        },
        museCode: 'CLI-owned',
      },
      editorMcp: { museCode: ['stdio', 'http'], modelApi: [], sse: false },
    },
    skills: {
      resumeSelectors: source.RESUME_SKILL_SELECTORS,
      resumeAvailability: 'installedMuseCodeSkills',
      bundled: {
        museCode: source.bundledSkills,
        modelApi: [...source.bundledSkills, ...source.firstPartySkills],
      },
    },
    'conversation-actions': {
      sideChat: {
        mode: 'plan',
        context: 'completedTurns',
        goal: 'cleared',
        museCode: 'fileToolsMayEdit',
      },
      messageWhileRunning: 'steer',
      rewind: {
        fork: 'newConversationBeforeSelectedTurn',
        conversation: 'historyBeforeSelectedTurnAndRestorePrompt',
        code: 'recordedMuseEdits',
        restoreBoth: 'checkpointFilesAndHistory',
        forkRewind: 'newConversationAndRecordedMuseEdits',
      },
      withdrawal: {
        modelApi: 'beforeNextRequest',
        museCode: 'queuedOnly',
      },
    },
    attachments: {
      maxAttachments: source.MAX_ATTACHMENTS_PER_MESSAGE,
      textExtensions: [...source.TEXT_ATTACHMENT_EXTENSIONS],
      textSources: 'trustedIndexedWorkspacePaths',
      modelApiTextAllowanceBytes: source.MAX_MODEL_API_TEXT_ATTACHMENT_BYTES,
      imageBytes: source.MAX_IMAGE_BYTES,
      pdfBytes: source.MAX_DOCUMENT_BYTES,
      textBytes: source.MAX_TEXT_ATTACHMENT_BYTES,
      encodedMediaChars: source.MAX_ENCODED_MEDIA_CHARS,
      requestMedia: source.MODEL_API_MEDIA_PER_REQUEST,
      vision: 'modelCapability',
      museCodeMessageBytes: source.MSP_FRAME_LIMIT_BYTES,
      museCodeAttachmentBudgetBytes: source.MSP_ATTACHMENT_FRAME_BUDGET_BYTES,
      pdfPageImages: source.MODEL_API_PDF_PAGE_IMAGES,
      pdfBackend: 'modelApi',
    },
    exports: { sessionLog: 'museCode', formats: source.EXPORT_FORMATS },
    context: {
      meter: ['tokensUsed', 'contextWindow', 'pressure'],
      pressureThresholds: [source.CONTEXT_PRESSURE_MEDIUM, source.CONTEXT_PRESSURE_HIGH],
      compaction: 'summaryReplacesOlderContext',
    },
    questions: { actions: ['submit', 'explain', 'cancel'] },
    'mcp-elicitation': { actions: ['accept', 'decline', 'cancel'], answers: 'requestingServer' },
    effort: {
      default: source.DEFAULT_EFFORT,
      tiers: source.MODEL_EFFORT_LEVELS,
      thinkingOff: { museCode: source.THINKING_OFF_EFFORT, modelApi: source.MODEL_API_EFFORT_OFF },
    },
    'custom-agents': {
      project: source.PROJECT_AGENTS_DIR_SEGMENTS,
      personal: source.PERSONAL_AGENTS_DIR_SEGMENTS,
      file: source.AGENT_FILE_NAME,
      builtIns: [source.BUILTIN_AGENT_EXPLORE_ID, source.BUILTIN_AGENT_SECOND_OPINION_ID],
    },
    browser: {
      actions: ['click', 'type'],
      maxActions: source.BROWSER_CHECK_MAX_ACTIONS,
      results: ['consoleErrors', 'failedRequests'],
      screenshot: { modelApi: 'PNG', museCode: false },
    },
    'best-of-n': {
      workspace: 'trusted',
      attempts: 'separateWorktrees',
      controls: ['attempts', 'requestsPerAttempt', 'compare', 'cancel', 'take'],
    },
    'code-intelligence': {
      modelApi: source.CODE_INTEL_TOOLS,
      museCode: source.IDE_CODE_INTEL_TOOLS,
    },
    schedules: {
      defaultIntervalMs: source.SCHEDULE_DEFAULT_INTERVAL_MS,
      minimumIntervalMs: source.SCHEDULE_MIN_INTERVAL_MS,
      maximumIntervalMs: source.SCHEDULE_MAX_INTERVAL_MS,
      maximumPromptChars: source.SCHEDULE_MAX_PROMPT_CHARS,
      maximumJobs: source.SCHEDULE_MAX_JOBS_PER_SESSION,
      admission: 'explicitDispatchAndConsent',
    },
    tab: {
      trigger: source.SETTING_DEFAULTS.tabTrigger,
      key: 'SecretStorage',
      ledger: 'tabDailyBudgetUsd',
      budgetUsd: source.SETTING_DEFAULTS.tabDailyBudgetUsd,
      rates: source.MODEL_API_PRICES_PER_MILLION,
    },
    voice: {
      modelApi: 'unavailable',
      museCode: ['local', 'storedModelApiKey', 'explicitOptIn'],
      platforms: voicePlatforms,
      remote: platforms.some(
        (platform) => source.locateCaptureHelper(platformProbe(platform, 'remote')).isAvailable,
      ),
      linuxRecorders: source.LINUX_RECORDERS.map((recorder) => recorder.command),
    },
    'free-dictation': {
      platforms: dictationPlatforms,
      remote: platforms.some(
        (platform) => source.locateDictationHelper(platformProbe(platform, 'remote')).isAvailable,
      ),
    },
  }
}

export function buildReference(manifest, nls, source, runtimeSource, readme) {
  source = {
    ...source,
    evidence: Object.fromEntries(
      Object.entries(source.evidence).map(([file, text]) => [referencePath(file), text]),
    ),
  }
  const anchors = new Set(
    readme
      .split('\n')
      .filter((line) => /^#+ /.test(line))
      .map((line) =>
        line
          .replace(/^#+ /, '')
          .toLowerCase()
          .replaceAll(/[^\p{L}\p{N}_\- ]/gu, '')
          .replaceAll(' ', '-'),
      ),
  )
  const errors = []
  const properties = manifest.contributes.configuration.properties
  const protocol = source.evidence['src/shared/protocol.ts']
    .split('const webviewToHostMessageSchema =', 2)[1]
    .split('export type WebviewToHostMessage', 1)[0]
  const operationNames = [
    ...source.HOST_ACTIONS,
    ...protocol.matchAll(/type: z.literal\('([^']+)'\)/g).map((match) => match[1]),
  ]
  for (const operation of operationNames) {
    const feature = source.REFERENCE_ACTION_FEATURES[operation]
    if (feature === undefined || !source.REFERENCE_FEATURE_IDS.includes(feature))
      errors.push(`Uncovered host action: ${operation}`)
  }
  const toolNames = [
    ...Object.values(source.MODEL_API_TOOLS),
    ...Object.values(source.MODEL_API_SUBAGENT_TOOLS),
    ...Object.values(source.VERIFY_TOOLS),
  ]
  for (const name of toolNames) {
    const feature = source.REFERENCE_TOOL_FEATURES[name]
    if (feature === undefined || !source.REFERENCE_FEATURE_IDS.includes(feature))
      errors.push(`Uncovered model tool: ${name}`)
  }
  // Every event key dispatch must use the runtime registry, including new
  // components. Unlike a union of observed key names, this ties context/action
  // identity to the very call which selects the handler branch.
  const usedContexts = new Set()
  for (const [file, text] of Object.entries(source.evidence)) {
    if (!/\.tsx?$/.test(file) || !file.startsWith('src/webview/')) continue
    const analysis = keyboardDispatch(file, text)
    errors.push(...analysis.errors)
    for (const context of analysis.contexts) {
      if (Object.hasOwn(source.WEBVIEW_KEYBINDINGS, context)) usedContexts.add(context)
      else errors.push(`Unknown keyboard context: ${file}`)
    }
  }
  for (const context of Object.keys(source.WEBVIEW_KEYBINDINGS))
    if (!usedContexts.has(context)) errors.push(`Keyboard context has no handler: ${context}`)
  // Adapter and admission witnesses invalidate the reviewed capability table if
  // host wiring changes. These are semantic source guards, not wire guesses.
  const witnesses = {
    'src/runtime/backends.ts': [
      'webFetch: createWebFetcher',
      'isPaidFeatureOn: (feature) => paid.isOn(feature)',
    ],
    'src/extension.ts': [
      "isModelApi: () => paidBackend === 'modelApi'",
      "feature === 'tab' || paidBackend === 'modelApi' || !isDefaultPaidOn(feature)",
      "if (auth.current.backend === 'modelApi') {\n              return currentSettings().dictationEngine === 'system'",
    ],
    'src/acp/agent.ts': ["if (host.info.kind !== 'museCode')"],
  }
  for (const [file, fragments] of Object.entries(witnesses))
    for (const fragment of fragments)
      if (!source.evidence[file].replaceAll(/\s+/g, ' ').includes(fragment.replaceAll(/\s+/g, ' ')))
        errors.push(`Host capability witness changed: ${file}`)

  const facts = referenceFacts(source)
  const features = source.featureCatalog().map((feature) => {
    const paidId = source.PAID_FEATURES.find(
      (id) => source.PAID_USE_REGISTRY[id].featureId === feature.id,
    )
    const settingId =
      paidId === undefined ? undefined : `museSpark.${source.PAID_FEATURE_SETTINGS[paidId]}`
    const schema = properties[settingId]
    // Retain enum values and their schema meanings; never treat a string enum
    // as a boolean default. Runtime predicate truth is tested separately.
    let defaultState = schema === undefined ? undefined : source.resolveSettingDefault(schema, nls)
    if (typeof defaultState?.meaningKey === 'string') {
      const meaning = source.referenceDescription({
        fallbackKey: defaultState.meaningKey,
        fallback: defaultState.meaning,
      })
      if ('conditions' in meaning) {
        const { meaningKey: _key, ...state } = defaultState
        defaultState = { ...state, meaning }
      }
    }
    return {
      ...feature,
      summary: source.referenceDescription(feature.summary),
      description: source.referenceDescription(feature.description),
      details: feature.details.map((text) => source.referenceDescription(text)),
      paid: paidId !== undefined,
      facts: {
        ...facts[feature.id],
        ...(paidId !== undefined && {
          paidFeature: paidId,
          paidSettings: [settingId],
          configuredDefaults: { [settingId]: schema?.default },
          defaultState,
          pricesUsd: source.PAID_PRICES_USD,
          tokenRatesPerMillion: source.MODEL_API_PRICES_PER_MILLION,
          billing: 'storedModelApiKey',
          effectiveAvailability: Object.fromEntries(
            feature.surfaces.map((surface) => {
              if (surface === 'vscode:modelApi')
                return [
                  surface,
                  {
                    defaultState,
                    key: 'SecretStorage',
                    consent: source.PAID_USE_REGISTRY[paidId].once,
                    ledger: paidId === 'tab' ? 'tabDailyBudgetUsd' : 'paidDailyBudgetUsd',
                  },
                ]
              if (surface === 'acp:modelApi')
                return [
                  surface,
                  {
                    configuredDefault: false,
                    flag: source.ACP_PAID_FLAGS[paidId],
                    consent: 'editorPermission',
                    ledger: 'runtime:paidDailyBudgetUsd',
                  },
                ]
              return [
                surface,
                {
                  configuredDefault: paidId === 'tab',
                  key: 'SecretStorage',
                  explicitOptIn: paidId !== 'tab',
                  consent: source.PAID_USE_REGISTRY[paidId].once,
                  ledger:
                    { tab: 'tabDailyBudgetUsd', legalExplanation: 'paidDailyBudgetUsd' }[paidId] ??
                    false,
                },
              ]
            }),
          ),
        }),
      },
    }
  })
  // A separate inventory is retained even for features without a manifest contribution.
  for (const id of source.REFERENCE_FEATURE_IDS)
    if (features.every((feature) => feature.id !== id)) errors.push(`Missing feature: ${id}`)
  const silentLog = {
    trace() {
      /* No trace is produced by the settings projection. */
    },
    info() {
      /* No info is produced by the settings projection. */
    },
    warn(message) {
      errors.push(`Runtime setting: ${message}`)
    },
    error() {
      /* Warnings above collect validation failures. */
    },
  }
  for (const feature of source.PAID_FEATURES) {
    if (source.PAID_FEATURE_SETTINGS[feature] === undefined)
      errors.push(`Undocumented paid feature: ${feature}`)
    const identity = source.PAID_USE_REGISTRY[feature].featureId
    if (
      source.PAID_FEATURES.filter((paid) => source.PAID_USE_REGISTRY[paid].featureId === identity)
        .length !== 1 ||
      features.every((entry) => entry.id !== identity)
    )
      errors.push(`Paid registry identity is missing or duplicated: ${feature}`)
  }
  // Resource settings intentionally use their separate inspected-machine reader.
  const resourceFields = {
    resourceGovernor: 'enabled',
    resourceCpuMaxPercent: 'cpuMaxPercent',
    resourceMemoryMaxPercent: 'memoryMaxPercent',
    resourceMemoryMinFreeGiB: 'memoryMinFreeGiB',
    resourceGpuMaxPercent: 'gpuMaxPercent',
    resourceDiskBusyMaxPercent: 'diskBusyMaxPercent',
    resourceDiskMinFreeGiB: 'diskMinFreeGiB',
    resourceRelocate: 'relocate',
  }
  const resourceDefaults = source.resourceSettingsSchema.parse({})
  const runtimeSetting = (key, value, log) => {
    const field = resourceFields[key]
    if (field === undefined)
      return source.readSettings(
        { get: (requested) => (requested === key ? value : undefined) },
        log,
      )[key]
    try {
      return source.readResourceSettings((requested) =>
        requested === key ? { globalValue: value } : undefined,
      )[field]
    } catch {
      return
    }
  }
  const moneySettings = new Set([
    'modelApiSessionBudgetUsd',
    'paidDailyBudgetUsd',
    'tabDailyBudgetUsd',
  ])
  const isSameSetting = (key, actual, expected) =>
    moneySettings.has(key)
      ? source.Usd.from(actual).compare(source.Usd.from(expected)) === 0
      : JSON.stringify(actual) === JSON.stringify(expected)
  for (const [id, schema] of Object.entries(properties)) {
    const key = id.slice('museSpark.'.length)
    const field = resourceFields[key]
    if (field !== undefined && schema.scope !== 'machine')
      errors.push(`Resource setting is not machine-scoped: ${id}`)
    const canonical = field === undefined ? source.SETTING_DEFAULTS[key] : resourceDefaults[field]
    if (JSON.stringify(canonical) !== JSON.stringify(schema.default))
      errors.push(`Runtime default mismatch: ${id}`)
    for (const value of [schema.default, ...(schema.enum ?? [])]) {
      const actual = runtimeSetting(key, value, silentLog)
      if (!isSameSetting(key, actual, value)) errors.push(`Runtime value mismatch: ${id}`)
    }
  }

  const probeLog = {
    ...silentLog,
    warn() {
      /* Invalid probes are expected; they are not reference errors. */
    },
  }
  const readSetting = (key, value) => runtimeSetting(key, value, probeLog)
  for (const [id, schema] of Object.entries(properties)) {
    if ([schema.type].flat().every((type) => !['number', 'integer'].includes(type))) continue
    const key = id.slice('museSpark.'.length)
    for (const value of [schema.minimum, schema.maximum]) {
      if (value === undefined) continue
      if (!isSameSetting(key, readSetting(key, value), value))
        errors.push(`Runtime bound mismatch: ${id}`)
    }
    for (const value of [
      schema.minimum === undefined ? undefined : schema.minimum - 1,
      schema.maximum === undefined ? undefined : schema.maximum + 1,
    ]) {
      if (value === undefined) continue
      if (isSameSetting(key, readSetting(key, value), value))
        errors.push(`Runtime bound mismatch: ${id}`)
    }
  }
  const duplicateChecks = [
    { name: 'check', command: 'check' },
    { name: 'check', command: 'check' },
  ]
  if (readSetting('checkCommands', duplicateChecks).length > 0)
    errors.push('Runtime refinement mismatch: unique:name')
  if (
    Object.values(readSetting('tabLanguages', { typescript: 'invalid' })).some(
      (value) => typeof value !== 'boolean',
    )
  )
    errors.push('Runtime refinement mismatch: values:boolean')
  if (readSetting('browserCheckExtraHosts', ['invalid/path']).length > 0)
    errors.push('Runtime refinement mismatch: valid:host')

  const descriptionFor = (ref) => {
    if ('conditions' in ref)
      return ref.conditions.map(({ when, text }) => `${when}: ${descriptionFor(text)}`).join('\n')
    if ('cli' in ref) return source.EN.referenceCliOptions[ref.cli]
    if ('fallbackKey' in ref) return nls[ref.fallbackKey] ?? ref.fallback
    if ('ui' in ref) return source.EN[ref.ui]
    if ('tip' in ref) return source.EN.paletteTips[ref.tip]
    if ('command' in ref)
      return translated(
        manifest.contributes.commands.find((c) => c.command === ref.command)?.title,
        nls,
      )
    const setting = properties[`museSpark.${ref.setting}`]
    return translated(setting?.markdownDescription ?? setting?.description, nls)
  }
  const settings = Object.entries(properties).map(([id, s]) => ({
    ...('conditions' in source.referenceDescription({ setting: id.slice('museSpark.'.length) }) && {
      text: source.referenceDescription({ setting: id.slice('museSpark.'.length) }),
    }),
    id,
    name: translated(s.title, nls) ?? id,
    nameKey: keyOf(s.title),
    description: translated(s.markdownDescription ?? s.description, nls),
    descriptionKey: keyOf(s.markdownDescription ?? s.description),
    type: s.type,
    default: s.default,
    enum: s.enum,
    enumDescriptions: (s.markdownEnumDescriptions ?? s.enumDescriptions)?.map((d) =>
      translated(d, nls),
    ),
    enumDescriptionKeys: (s.markdownEnumDescriptions ?? s.enumDescriptions)?.map((description) =>
      keyOf(description),
    ),
    ...((s.markdownEnumDescriptions ?? s.enumDescriptions) !== undefined && {
      enumTexts: Object.fromEntries(
        (s.markdownEnumDescriptions ?? s.enumDescriptions).flatMap((description, index) => {
          const key = keyOf(description)
          if (key === undefined) return []
          const ref = source.referenceDescription({ fallbackKey: key, fallback: nls[key] })
          return 'conditions' in ref ? [[index, ref]] : []
        }),
      ),
    }),
    scope: s.scope ?? 'window',
    refinements:
      {
        'museSpark.checkCommands': ['unique:name'],
        'museSpark.browserCheckExtraHosts': ['valid:host'],
        'museSpark.tabLanguages': ['values:boolean'],
      }[id] ?? [],
    schema: settingSchema(
      Object.fromEntries(
        Object.entries(s).filter(
          ([key]) =>
            ![
              'description',
              'markdownDescription',
              'enumDescriptions',
              'markdownEnumDescriptions',
              'title',
              'scope',
            ].includes(key),
        ),
      ),
      nls,
    ),
  }))
  const commands = manifest.contributes.commands.map((c) => {
    const key = Object.keys(source.COMMAND_IDS).find((k) => source.COMMAND_IDS[k] === c.command)
    const entry = source.COMMAND_REFERENCE[key]
    if (entry === undefined) errors.push(`Command lacks catalogue entry: ${c.command}`)
    const text = entry === undefined ? undefined : source.referenceDescription(entry.description)
    return {
      id: c.command,
      name: translated(c.title, nls),
      nameKey: keyOf(c.title),
      category: translated(c.category, nls) ?? '',
      categoryKey: keyOf(c.category),
      description: text === undefined ? '' : descriptionFor(text),
      text,
      enablement: source.resolveCommandCondition(
        c,
        manifest.contributes.menus?.commandPalette ?? [],
      ),
      canRun: entry?.canRun === true,
    }
  })
  const slash = new Map()
  for (const backend of ['museCode', 'modelApi']) {
    const groups = source.buildPalette({
      currentModel: undefined,
      models: [],
      effort: 'medium',
      isThinkingEnabled: true,
      permissionMode: 'manual',
      isFocusView: false,
      useCtrlEnterToSend: false,
      usage: undefined,
      skills: [],
      backend,
      paidFeatures: [],
      isKeyStored: true,
    })
    for (const c of source.slashCommandsOf(groups)) {
      if (c.reference?.[backend] === undefined)
        errors.push(`Missing localized slash description: ${c.name}`)
      const old = slash.get(c.name)
      slash.set(c.name, {
        name: c.name,
        description: c.detail ?? c.tip,
        descriptions: {
          ...old?.descriptions,
          [backend]: source.referenceDescription(
            c.reference?.[backend] ?? { ui: 'referenceIntro' },
          ),
        },
        backends: [...(old?.backends ?? []), backend],
      })
    }
  }
  const cli = source.cliCommands().map((entry) => ({
    ...entry,
    ...(entry.text !== undefined && { text: source.referenceDescription(entry.text) }),
  }))
  const optionFacts = {
    'usage-history': { enum: ['on', 'off'], default: 'on' },
    'no-auto-compaction': { purpose: 'disableAutoCompaction', effective: 'evaluationPending' },
    privacy: { enum: ['zdr', 'no-training', 'any'] },
    range: { enum: ['today', '7d', '30d', '90d', 'custom'], default: '30d' },
    by: { enum: ['provider', 'model', 'kind', 'client'] },
    from: { format: 'YYYY-MM-DD' },
    to: { format: 'YYYY-MM-DD' },
    stdio: { route: 'usage serve', protocol: 'usageCompanion' },
    registry: { route: 'legal', consent: 'explicitFlag', privateRegistries: 'neverRead' },
    'untrusted-file': {
      maxItems: source.EXEC_UNTRUSTED_FILES_MAX,
      perFileMaxBytes: source.EXEC_UNTRUSTED_FILE_MAX_BYTES,
      totalMaxBytes: source.EXEC_UNTRUSTED_TOTAL_MAX_BYTES,
    },
    'prompt-file': { maximumBytes: source.EXEC_PROMPT_MAX_BYTES },
    backend: { enum: source.ACP_BACKENDS, default: source.ACP_DEFAULT_BACKEND },
    'shell-sandbox': {
      enum: source.SHELL_SANDBOX_MODES,
      default: source.SETTING_DEFAULTS.shellSandbox,
    },
    'permission-mode': { enum: source.EXEC_MODES, default: source.EXEC_DEFAULT_MODE },
    output: { enum: source.EXEC_OUTPUTS, default: source.EXEC_DEFAULT_OUTPUT },
    context: {
      meter: ['tokensUsed', 'contextWindow', 'pressure'],
      pressureThresholds: [source.CONTEXT_PRESSURE_MEDIUM, source.CONTEXT_PRESSURE_HIGH],
      compaction: 'summaryReplacesOlderContext',
    },
    questions: { actions: ['submit', 'explain', 'cancel'] },
    'mcp-elicitation': { actions: ['accept', 'decline', 'cancel'], answers: 'requestingServer' },
    effort: { enum: source.EFFORT_LEVELS },
    'max-requests': {
      default: source.EXEC_DEFAULT_MAX_REQUESTS,
      minimum: 1,
      maximum: source.EXEC_MAX_REQUESTS,
    },
    timeout: {
      default: source.EXEC_DEFAULT_TIMEOUT_SECONDS,
      minimum: source.EXEC_MIN_TIMEOUT_SECONDS,
      maximum: source.EXEC_MAX_TIMEOUT_SECONDS,
      unit: 'seconds',
    },
    'max-budget-usd': {
      exclusiveMinimum: 0,
      maximum: source.EXEC_MAX_BUDGET_USD,
      decimals: source.EXEC_USD_DECIMALS,
      required: 'modelApi',
      unit: 'USD',
    },
  }
  for (const option of parserOptions(runtimeSource, source)) {
    if (source.CLI_OPTION_TEXT[option.name] === undefined)
      errors.push(`CLI option lacks contract: --${option.name}`)
    const routes = option.routes
    for (const route of routes) {
      let text = { cli: source.CLI_OPTION_TEXT[option.name] }
      if (route === 'exec' && option.name === 'image-generation')
        text = { ui: 'referenceExecImages' }
      else if (
        route === 'exec' &&
        ['trust-workspace', 'allow-dangerously-skip-permissions', 'web-search'].includes(
          option.name,
        )
      )
        text = { ui: 'referenceExecContract' }
      text = source.referenceDescription(text)

      cli.push({
        route,
        name: `${route}: --${option.name}${option.short ? ` / -${option.short}` : ''}${option.type === 'string' ? ' <value>' : ''}`,
        description: descriptionFor(text),
        text,
        contract: {
          type: option.type,
          ...(option.name === 'maintenance' && route !== 'setup' && { refused: true }),
          repeatable: option.multiple === true,
          ...optionFacts[option.name],
          ...(['serve', 'login'].includes(route) &&
            [
              'provider',
              'preset',
              'as',
              'address',
              'format',
              'model',
              'privacy',
              'private-ok',
              'key-stdin',
            ].includes(option.name) && { refused: true }),
          ...(['authSet', 'authStatus', 'authClear'].includes(route) &&
            [
              'preset',
              'as',
              'address',
              'format',
              'model',
              'privacy',
              'private-ok',
              'key-stdin',
            ].includes(option.name) && { refused: true }),
          ...(route === 'providersAdd' &&
            option.name === 'format' && {
              enum: ['chat', 'responses', 'anthropic'],
              preset: 'custom',
            }),
          ...(route === 'providersAdd' && option.name === 'privacy' && { preset: 'openrouter' }),
          ...(option.name === 'format' && route === 'legal' && { enum: ['text', 'json'] }),
          ...(option.name === 'json' && { output: 'json' }),
          ...(option.name === 'csv' && { output: 'csv' }),
          ...(option.name === 'private-ok' && { consent: 'privateNetwork' }),
          ...(option.type === 'boolean' && { default: false }),
          ...(['login', 'authSet', 'authStatus', 'authClear'].includes(route) &&
            ![
              'preset',
              'as',
              'address',
              'format',
              'model',
              'privacy',
              'private-ok',
              'key-stdin',
            ].includes(option.name) &&
            !(route === 'login' && option.name === 'provider') &&
            !(
              route === 'login'
                ? ['muse-binary', 'verbose', 'help', 'version']
                : ['help', 'version', 'provider']
            ).includes(option.name) && {
              purpose: 'acceptedUnused',
            }),
          ...(route === 'setup' &&
            !['trust-workspace', 'maintenance', 'verbose', 'help', 'version'].includes(
              option.name,
            ) && {
              purpose: 'acceptedUnused',
            }),
          ...(route === 'setup' && option.name === 'maintenance' && { event: 'maintenance' }),
          ...(route === 'exec' && {
            ...(['trust-workspace', 'allow-dangerously-skip-permissions', 'web-search'].includes(
              option.name,
            ) && { refused: true }),
            purpose:
              {
                'max-requests': 'maxRequests',
                timeout: 'timeoutMs',
                output: 'output',
                cwd: 'cwd',
                model: 'model',
                effort: 'effort',
                ephemeral: 'ephemeral',
                'untrusted-file': 'untrustedFiles',
                'fail-on-denial': 'failOnDenial',
                'prompt-file': 'prompt',
                'key-stdin': 'keyFromStdin',
                'image-generation': 'paidFeatures:imageGeneration',
              }[option.name] ?? option.name,
          }),
        },
      })
    }
  }
  cli.push(
    {
      route: 'exec',
      name: 'exec <prompt> | exec - | exec --prompt-file <file>',
      description: source.EN.referenceExecContract,
      text: { ui: 'referenceExecContract' },
    },
    {
      route: 'scan-secrets',
      name: 'scan-secrets <file> [--key-stdin]',
      description: source.EN.referenceKeyStdin,
      text: { ui: 'referenceKeyStdin' },
    },
    {
      route: 'playbook',
      name: 'playbook <status|record|settings ...>',
      description: source.EN.referencePlaybookCommand,
      text: { ui: 'referencePlaybookCommand' },
    },
  )

  const exec = (options) =>
    source.parseCommandLine([
      'exec',
      '--backend',
      'modelApi',
      '--max-budget-usd',
      '1',
      ...options,
      'prompt',
    ])
  for (const value of [source.EXEC_DEFAULT_MAX_REQUESTS, source.EXEC_MAX_REQUESTS])
    if (exec(['--max-requests', String(value)]).options?.maxRequests !== value)
      errors.push('CLI request limit mismatch')
  if (exec(['--max-requests', String(source.EXEC_MAX_REQUESTS + 1)]).command !== 'invalid')
    errors.push('CLI request bound mismatch')
  for (const value of [source.EXEC_MIN_TIMEOUT_SECONDS, source.EXEC_MAX_TIMEOUT_SECONDS])
    if (
      exec(['--timeout', String(value)]).options?.timeoutMs !==
      value * source.MILLISECONDS_PER_SECOND
    )
      errors.push('CLI timeout limit mismatch')
  for (const flag of ['--trust-workspace', '--allow-dangerously-skip-permissions', '--web-search'])
    if (exec([flag]).command !== 'invalid') errors.push(`CLI refusal mismatch: ${flag}`)
  // referenceCliOptions['questions-defer-after'] states the parser's own normalization.
  const deferAfter = (value) =>
    source.parseCommandLine(['--questions-defer-after', String(value)]).options
      ?.questionsDeferAfterSeconds
  if (
    source.parseCommandLine([]).options?.questionsDeferAfterSeconds !==
      source.QUESTION_DEFER_DEFAULT_SECONDS ||
    deferAfter(0) !== 0 ||
    deferAfter(1) !== source.QUESTION_DEFER_MIN_SECONDS ||
    deferAfter(source.QUESTION_DEFER_MAX_SECONDS) !== source.QUESTION_DEFER_MAX_SECONDS ||
    source.parseCommandLine([
      '--questions-defer-after',
      String(source.QUESTION_DEFER_MAX_SECONDS + 1),
    ]).command !== 'invalid'
  )
    errors.push('CLI question deadline mismatch')
  for (const value of source.EXEC_MODES)
    if (exec(['--permission-mode', value]).options?.mode !== value) errors.push('CLI mode mismatch')
  for (const value of source.EXEC_OUTPUTS)
    if (exec(['--output', value]).options?.output !== value) errors.push('CLI output mismatch')
  // RuntimeCommand is the parser's closed command inventory; new routes must
  // appear in the public command table as well as being documented.
  const runtimeTree = ts.createSourceFile('cliArgs.ts', runtimeSource, ts.ScriptTarget.Latest, true)
  // Some switches (help --all) are direct branches rather than parseArgs options.
  // A new literal flag in those branches must also have a public entry.
  const declaredFlags = new Set(
    parserOptions(runtimeSource, source).map((option) => `--${option.name}`),
  )
  const visitDirectFlags = (node) => {
    if (
      ts.isPropertyAssignment(node) &&
      node.name.getText(runtimeTree) === 'options' &&
      ts.isCallExpression(node.parent.parent) &&
      node.parent.parent.expression.getText(runtimeTree) === 'parseArgs' &&
      !node.initializer.getText(runtimeTree).includes('CLI_OPTION_REGISTRY')
    )
      errors.push('CLI parser bypasses registry')
    if (
      ts.isStringLiteral(node) &&
      /^--[a-z-]+$/.test(node.text) &&
      !declaredFlags.has(node.text) &&
      cli.every((entry) => !entry.name.split(/[ :/<>]+/).includes(node.text))
    )
      errors.push(`CLI direct flag lacks entry: ${node.text}`)
    ts.forEachChild(node, visitDirectFlags)
  }
  visitDirectFlags(runtimeTree)
  const runtimeType = runtimeTree.statements.find(
    (statement) => ts.isTypeAliasDeclaration(statement) && statement.name.text === 'RuntimeCommand',
  )
  if (runtimeType === undefined) throw new Error('Missing RuntimeCommand inventory')
  const variants = ts.isUnionTypeNode(runtimeType.type)
    ? runtimeType.type.types
    : [runtimeType.type]
  const runtimeNames = variants.flatMap((variant) => {
    if (!ts.isTypeLiteralNode(variant)) throw new Error('Invalid RuntimeCommand variant')
    const command = variant.members.find(
      (member) =>
        ts.isPropertySignature(member) &&
        (ts.isIdentifier(member.name) || ts.isStringLiteral(member.name)) &&
        member.name.text === 'command',
    )
    if (command?.type === undefined) throw new Error('Missing RuntimeCommand discriminator')
    const literals = ts.isUnionTypeNode(command.type) ? command.type.types : [command.type]
    return literals.map((literal) => {
      if (!ts.isLiteralTypeNode(literal) || !ts.isStringLiteral(literal.literal))
        throw new Error('Invalid RuntimeCommand discriminator')
      return literal.literal.text
    })
  })
  const names = new Set(cli.map((c) => c.route))
  for (const name of runtimeNames) {
    if (name !== 'invalid' && !names.has(name)) errors.push(`CLI command lacks entry: ${name}`)
  }
  for (const row of slash.values())
    row.syntax = source.SLASH_REFERENCE[row.name]?.syntax ?? [`/${row.name}`]
  if (
    source.parseGoalPrompt('/goal pause')?.verb !== 'pause' ||
    source.parseGoalPrompt('/goal edit objective')?.verb !== 'edit' ||
    source.parseReviewPrompt('/review branch main')?.scope !== 'branch' ||
    source.parseReviewPrompt('/review security commit HEAD')?.focus !== 'security' ||
    source.parseHandoffPrompt('/handoff goal')?.goal !== 'goal' ||
    source.parseLoopPrompt('/loop list')?.command?.verb !== 'list' ||
    source.parseLoopPrompt('/loop 5m prompt')?.command?.verb !== 'create'
  )
    errors.push('Slash grammar mismatch')
  const shortcuts = manifest.contributes.keybindings ?? []
  for (const k of shortcuts)
    if (k.command.startsWith('museSpark.') && commands.every((c) => c.id !== k.command))
      errors.push(`Unknown shortcut command: ${k.command}`)
  const ids = new Set()
  for (const f of features) {
    if (ids.has(f.id)) errors.push(`Duplicate feature: ${f.id}`)
    ids.add(f.id)
    errors.push(...lintReferenceFacts(f.facts, f.id))
    const original = source.featureCatalog().find((entry) => entry.id === f.id)
    const paidId = source.PAID_FEATURES.find(
      (id) => source.PAID_USE_REGISTRY[id].featureId === f.id,
    )
    const isPaid = paidId !== undefined
    if (original.paid !== isPaid) errors.push(`Paid claim mismatch: ${f.id}`)
    if (
      paidId !== undefined &&
      !original.settings.includes(`museSpark.${source.PAID_FEATURE_SETTINGS[paidId]}`)
    )
      errors.push(`Paid setting relationship missing: ${f.id}`)
    for (const surface of f.surfaces) {
      const paidIds = paidId === undefined ? [] : [paidId]
      if (
        surface === 'vscode:museCode' &&
        f.paid &&
        paidIds.some((paid) => !source.MUSE_CODE_PAID_FEATURES.includes(paid) && paid !== 'tab')
      )
        errors.push(`Muse Code paid capability mismatch: ${f.id}`)
      if (
        f.paid &&
        surface.startsWith('acp:') &&
        (surface !== 'acp:modelApi' ||
          paidIds.some((paid) => !source.ACP_PAID_FEATURES.includes(paid)))
      )
        errors.push(`ACP paid capability mismatch: ${f.id}`)
    }
    const expectedSurfaces = source.REFERENCE_CAPABILITIES[f.id]
    if (JSON.stringify(f.surfaces) !== JSON.stringify(expectedSurfaces))
      errors.push(`Host capability mismatch: ${f.id}`)
    for (const text of [f.summary, f.description, ...f.details]) {
      if (!descriptionFor(text)?.trim()) errors.push(`Feature lacks text: ${f.id}`)
    }
    let name
    if ('setting' in f.name) {
      if (Object.hasOwn(properties, `museSpark.${f.name.setting}`))
        name = `museSpark.${f.name.setting}`
    } else name = descriptionFor(f.name)
    if (!name?.trim()) errors.push(`Feature lacks text: ${f.id}`)
    for (const id of f.commands)
      if (commands.every((c) => c.id !== id)) errors.push(`Unknown feature command: ${f.id}: ${id}`)
    for (const id of f.settings)
      if (!Object.hasOwn(properties, id)) errors.push(`Unknown feature setting: ${f.id}: ${id}`)
    if (
      !f.docs.startsWith('https://github.com/RandyNorthrup/muse-spark-code#') ||
      !anchors.has(f.docs.split('#', 2)[1])
    )
      errors.push(`Invalid docs link: ${f.id}`)
  }
  for (const entry of [...commands, ...settings, ...slash.values(), ...cli]) {
    if (!entry.description?.trim()) errors.push(`Missing description: ${entry.id ?? entry.name}`)
  }
  for (const entry of [...commands, ...settings]) {
    const group = 'canRun' in entry ? 'commands' : 'settings'
    if (features.every((f) => !f[group].includes(entry.id)))
      errors.push(`No feature covers ${entry.id}`)
  }
  for (const [key, entry] of Object.entries(source.COMMAND_REFERENCE)) {
    if (commands.every((c) => c.id !== source.COMMAND_IDS[key]))
      errors.push(`Orphan command entry: ${key}`)
    if (!descriptionFor(entry.description)?.trim())
      errors.push(`Missing command description: ${key}`)
  }
  const model = {
    features,
    commands,
    settings,
    slash: slash.values().toArray(),
    cli,
    executable: source.ACP_AGENT_NAME,
    shortcuts: [...shortcuts, ...source.referenceKeyboardActions()],
  }
  // Walk what we emit, rather than maintaining a list of description-bearing kinds.
  const lintOutput = (value, identity = 'reference', field = '') => {
    if (typeof value === 'string')
      return /\s/.test(value) || /description|summary|meaning/i.test(field)
        ? lintReferenceDescription(value, identity)
        : []
    if (Array.isArray(value))
      return value.flatMap((entry, index) => lintOutput(entry, identity, `${field}.${index}`))
    if (typeof value !== 'object' || value === null) return []
    if (
      'conditions' in value ||
      (Object.keys(value).length === 1 &&
        ['ui', 'cli', 'tip', 'setting', 'command'].some((key) => Object.hasOwn(value, key))) ||
      ('fallbackKey' in value && 'fallback' in value)
    )
      return field === 'name' && 'setting' in value
        ? []
        : lintReferenceText(value, identity, descriptionFor)
    const owner = value.id ?? value.command ?? value.name ?? identity
    return Object.entries(value).flatMap(([key, entry]) => {
      if (key.endsWith('Key') || key.endsWith('Keys')) return []
      // Resolved aliases are checked through their authoritative typed text.
      if (key === 'description' && (value.text !== undefined || value.descriptions !== undefined))
        return []
      return key === 'enumDescriptions' && Array.isArray(entry)
        ? entry.flatMap((description, index) =>
            lintOutput(value.enumTexts?.[index] ?? description, owner, key),
          )
        : lintOutput(entry, owner, key)
    })
  }
  errors.push(...lintOutput(model))
  if (errors.length > 0) throw new Error(errors.join('\n'))
  return model
}

// Preserve code spans; angle brackets in prose must survive Markdown's HTML parser.
function prose(value) {
  return value.replaceAll(/`[^`]*`|[<>]/g, (token) => {
    if (token === '<') return '&lt;'
    return token === '>' ? '&gt;' : token
  })
}

export function referenceMarkdown(model, source, nls, manifest) {
  const text = (ref) => {
    if ('conditions' in ref)
      return ref.conditions
        .map(({ when, text: condition }) => `${prose(when)}: ${text(condition)}`)
        .join('\n')
    if ('cli' in ref) return prose(source.EN.referenceCliOptions[ref.cli])
    if ('fallbackKey' in ref) return prose(nls[ref.fallbackKey] ?? ref.fallback)
    if ('ui' in ref) return prose(source.EN[ref.ui])
    if ('tip' in ref) return prose(source.EN.paletteTips[ref.tip])
    if ('command' in ref) return prose(model.commands.find((c) => c.id === ref.command)?.name)
    const s = manifest.contributes.configuration.properties[`museSpark.${ref.setting}`]
    return prose(translated(s.markdownDescription ?? s.description, nls))
  }
  const lines = [
    '<!-- Generated by scripts/gen-reference.mjs. Edit the source catalogue/registries. -->',
    '# Help & Reference — Muse Spark Code (Unofficial)',
    '',
    'Open `/help` in the panel or **Muse Spark: Open Help & Reference**. Search the reference and open a setting directly. ACP editors: `/help`; terminal: `muse-spark-code-acp help --all`.',
    '',
    '## Features',
    '',
  ]
  for (const f of model.features)
    lines.push(
      `### ${'setting' in f.name ? `museSpark.${f.name.setting}` : text(f.name)}`,
      '',
      text(f.summary),
      '',
      ...(text(f.description) === text(f.summary) ? [] : [text(f.description), '']),
      ...f.details.flatMap((detail) => [text(detail), '']),
      ...(Object.keys(f.facts).length === 0
        ? []
        : ['```json', JSON.stringify(f.facts, null, 2), '```', '']),
      `Surfaces: ${f.surfaces.join(', ')}. Paid: ${f.paid ? 'yes; consent required; admission depends on the surface' : 'no extra feature charge; model usage still applies'}.`,
      '',
      `Commands: ${f.commands.map((id) => `\`${id}\``).join(', ') || '—'}. Settings: ${f.settings.map((id) => `\`${id}\``).join(', ') || '—'}. [Documentation](${f.docs})`,
      '',
    )
  lines.push(
    '## Slash commands',
    '',
    'Availability depends on the backend. Installed skills also add their own slash commands.',
    '',
  )
  for (const c of model.slash)
    lines.push(
      `- ${c.syntax.map((syntax) => `\`${syntax}\``).join(' | ')}: ${Object.entries(c.descriptions)
        .map(([backend, ref]) => `${backend}: ${text(ref)}`)
        .join('; ')}`,
    )
  lines.push('', '## Commands', '')
  for (const c of model.commands)
    lines.push(
      `### ${prose(c.category)}: ${prose(c.name)}`,
      '',
      `\`${c.id}\` — ${text(c.text)}`,
      '',
      ...(c.enablement ? [`Available when: \`${c.enablement}\`.`, ''] : []),
    )
  lines.push('## Settings', '')
  for (const s of model.settings)
    lines.push(
      `### ${s.id}`,
      '',
      s.text === undefined ? prose(s.description) : text(s.text),
      '',
      `Type: \`${JSON.stringify(s.type)}\`. Default: \`${JSON.stringify(s.default)}\`. Scope: \`${s.scope}\`.`,
      '',
      '```json',
      JSON.stringify(s.schema, null, 2),
      '```',
      '',
      ...s.refinements.map((rule) => `Runtime: \`${rule}\`.`),
      '',
      ...(s.enum === undefined
        ? []
        : s.enum.map(
            (v, i) =>
              `- \`${JSON.stringify(v)}\`: ${s.enumTexts?.[i] === undefined ? prose(s.enumDescriptions?.[i] ?? '') : text(s.enumTexts[i])}`,
          )),
      '',
    )
  lines.push(
    '## Keyboard shortcuts',
    '',
    'These are defaults; editor customizations take precedence.',
    '',
  )
  for (const k of model.shortcuts)
    lines.push(
      `- \`${k.command}\`: \`${k.key}\`${k.mac ? ` (macOS: \`${k.mac}\`)` : ''}${k.win ? ` (Windows: \`${k.win}\`)` : ''}${k.linux ? ` (Linux: \`${k.linux}\`)` : ''}${k.when ? `; when \`${k.when}\`` : ''}${k.text ? `; ${text(k.text)}` : ''}`,
    )
  lines.push('', '## ACP / CLI commands', '')
  for (const c of model.cli)
    lines.push(
      `- \`${c.name}\`: ${prose(source.fill(c.description, { command: model.executable }))}${c.contract === undefined ? '' : ` \`${JSON.stringify(c.contract)}\``}`,
    )
  lines.push(
    '',
    'For full headless argument syntax, run `muse-spark-code-acp exec --help`, or see [the ACP guide](acp.md) and [headless/CI contract](ci.md).',
    '',
  )
  return lines.join('\n')
}

export async function generateReference(root, isCheck = false) {
  const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
  const nls = JSON.parse(readFileSync(path.join(root, 'package.nls.json'), 'utf8'))
  const source = await referenceSources(root)
  const model = buildReference(
    manifest,
    nls,
    source,
    readFileSync(path.join(root, 'src/runtime/cliArgs.ts'), 'utf8'),
    readFileSync(path.join(root, 'README.md'), 'utf8'),
  )
  const texts = [
    ...model.features.flatMap((f) => [f.name, f.summary, f.description, ...f.details]),
    ...model.commands.map((c) => c.text),
    ...model.settings.flatMap((s) => [
      ...(s.text === undefined ? [] : [s.text]),
      ...Object.values(s.enumTexts ?? {}),
    ]),
    ...model.cli.flatMap((c) => (c.text === undefined ? [] : [c.text])),
    ...model.shortcuts.flatMap((c) => (c.text === undefined ? [] : [c.text])),
    ...model.slash.flatMap((c) => Object.values(c.descriptions)),
  ].flatMap((text) => plainTexts(text))
  const uiKeys = [...new Set(texts.filter((text) => 'ui' in text).map((text) => text.ui))]
  const tipKeys = [...new Set(texts.filter((text) => 'tip' in text).map((text) => text.tip))]
  const cliKeys = Object.keys(source.EN.referenceCliOptions)
  const textKeys = [...new Set([...uiKeys, ...tipKeys, ...cliKeys])]
  const keyArray = (keys) =>
    `[${keys.map((key) => `textKeys[${textKeys.indexOf(key)}]`).join(',')}]`
  const schema = `
    const plainTextSchema = z.union([z.object({ fallbackKey: z.string(), fallback: z.string() }), z.object({ cli: z.enum(${keyArray(cliKeys)}) }), z.object({ ui: z.enum(${keyArray(uiKeys)}) }), z.object({ tip: z.enum(${keyArray(tipKeys)}) }), z.object({ setting: z.string() }), z.object({ command: z.string() })])
    const textSchema = z.union([plainTextSchema, z.object({ conditions: z.array(z.object({ when: z.string().check(z.regex(/^[A-Za-z0-9_.=:&|!-]+$/)), text: plainTextSchema })).check(z.minLength(1)) })])
    const strings = z.array(z.string())
    const schema = z.object({ executable: z.string(),
      features: z.array(z.object({ id: z.string(), name: textSchema, summary: textSchema, description: textSchema, commands: strings, settings: strings, docs: z.string(), editors: z.array(z.enum(['vscode', 'acp'])), backends: z.array(z.enum(['museCode', 'modelApi'])), paid: z.boolean(), surfaces: z.array(z.enum(['vscode:museCode', 'vscode:modelApi', 'acp:museCode', 'acp:modelApi'])), details: z.array(textSchema), facts: z.record(z.string(), z.unknown()) })),
      commands: z.array(z.object({ id: z.string(), name: z.string(), nameKey: z.optional(z.string()), category: z.string(), categoryKey: z.optional(z.string()), description: z.string(), text: textSchema, enablement: z.optional(z.string()), canRun: z.boolean() })),
      settings: z.array(z.object({ text: z.optional(textSchema), id: z.string(), name: z.string(), nameKey: z.optional(z.string()), description: z.string(), descriptionKey: z.optional(z.string()), type: z.union([z.string(), strings]), default: z.unknown(), enum: z.optional(z.array(z.unknown())), enumDescriptions: z.optional(strings), enumTexts: z.optional(z.record(z.string(), textSchema)), enumDescriptionKeys: z.optional(z.array(z.nullable(z.string()))), scope: z.string(), refinements: strings, schema: z.record(z.string(), z.unknown()) })),
      slash: z.array(z.object({ name: z.string(), description: z.string(), descriptions: z.record(z.string(), textSchema), backends: strings, syntax: strings })),
      cli: z.array(z.object({ route: z.string(), name: z.string(), description: z.string(), text: z.optional(textSchema), usageKey: z.optional(z.enum(['acpUsage', 'reportUsage'])), usageLine: z.optional(z.number()), contract: z.optional(z.record(z.string(), z.unknown())) })),
      shortcuts: z.array(z.object({ command: z.string(), key: z.string(), mac: z.optional(z.string()), win: z.optional(z.string()), linux: z.optional(z.string()), when: z.optional(z.string()), text: z.optional(textSchema) }))
    })
    export function parseReferenceModel(value: unknown): ReferenceModel { return schema.parse(value) }
  `
  // Intern repeated JSON tokens without adding a browser/Node compression dependency.
  // The same expanded model is still parsed by zod before either host uses it.
  const numericPrefix = '~n:'
  const stringPrefixes = [
    'museSpark.',
    'config.',
    'https://github.com/RandyNorthrup/muse-spark-code#',
    // Every CLI row name repeats its route before the option (REL0143).
    ...Object.keys(source.CLI_OPTION_REGISTRY).map((route) => `${route}: --`),
  ]
  const serialize = (value) =>
    JSON.stringify(value, (_key, entry) => {
      if (typeof entry === 'number') return `${numericPrefix}${entry}`
      if (typeof entry !== 'string') return entry
      const index = stringPrefixes.findIndex((prefix) => entry.startsWith(prefix))
      return index === -1
        ? entry
        : `~s${index.toString(source.REFERENCE_POOL_RADIX)}:${entry.slice(stringPrefixes[index].length)}`
    })
  const modelJson = serialize(model)
  const tokens = /"(?:[^"\\]|\\.)*"/g
  if (
    JSON.stringify(model)
      .match(tokens)
      .some((token) => /^"~(?:[0-9a-z]+"$|n:|s[0-9a-z]+:)/.test(token))
  )
    throw new Error('Reserved reference token')
  const fragments = new Map()
  const collect = (value) => {
    if (typeof value !== 'object' || value === null) return
    const fragment = serialize(value)
    fragments.set(fragment, (fragments.get(fragment) ?? 0) + 1)
    for (const child of Object.values(value)) collect(child)
  }
  collect(model)
  const pool = []
  let packed = modelJson
  const candidates = [...fragments]
    .filter(([, count]) => count > 1)
    .toSorted(([a], [b]) => b.length - a.length)
  for (const [fragment] of candidates) {
    const parts = packed.split(fragment)
    const token = JSON.stringify(`~${pool.length.toString(source.REFERENCE_POOL_RADIX)}`)
    const uses = parts.length - 1
    if (uses <= 1 || uses * (fragment.length - token.length) <= JSON.stringify(fragment).length)
      continue
    packed = parts.join(token)
    pool.push(fragment)
  }
  const counts = new Map()
  for (const token of [packed, ...pool].join(' ').match(tokens))
    counts.set(token, (counts.get(token) ?? 0) + 1)
  const referenceLength = JSON.stringify(
    `~${(pool.length + counts.size).toString(source.REFERENCE_POOL_RADIX)}`,
  ).length
  const repeatedTokens = [...counts]
    .filter(
      ([token, count]) =>
        count > 1 &&
        !/^"~[0-9a-z]+"$/.test(token) &&
        count * (token.length - referenceLength) > JSON.stringify(token).length,
    )
    .map(([token]) => token)
  const indices = new Map(repeatedTokens.map((token, index) => [token, index + pool.length]))
  const encodeTokens = (json) =>
    json.replaceAll(tokens, (token) =>
      indices.has(token)
        ? JSON.stringify(`~${indices.get(token).toString(source.REFERENCE_POOL_RADIX)}`)
        : token,
    )
  for (const [index, fragment] of pool.entries()) pool[index] = encodeTokens(fragment)
  pool.push(...repeatedTokens)
  packed = packed.replaceAll(tokens, (token) =>
    indices.has(token)
      ? JSON.stringify(`~${indices.get(token).toString(source.REFERENCE_POOL_RADIX)}`)
      : token,
  )
  // Give the most-used pool entries the shortest references, including object keys.
  const uses = new Map()
  for (const token of [packed, ...pool].join(' ').match(tokens))
    uses.set(token, (uses.get(token) ?? 0) + 1)
  const poolToken = (index) => JSON.stringify(`~${index.toString(source.REFERENCE_POOL_RADIX)}`)
  const orderedPool = pool
    .map((fragment, index) => ({ fragment, token: poolToken(index) }))
    .toSorted((a, b) => (uses.get(b.token) ?? 0) - (uses.get(a.token) ?? 0))
  const remappedTokens = new Map(orderedPool.map(({ token }, index) => [token, poolToken(index)]))
  const remap = (json) => json.replaceAll(tokens, (token) => remappedTokens.get(token) ?? token)
  for (const [index, { fragment }] of orderedPool.entries()) pool[index] = remap(fragment)
  packed = remap(packed)
  // Lossless generated data; decoded dictionaries and models retain schema validation.
  const encodedPayload = LZString.compressToBase64(
    JSON.stringify({
      pool: pool.map((fragment) => JSON.parse(fragment)),
      model: JSON.parse(packed),
    }),
  )
  const formatting = await resolveConfig(path.join(root, MODULE))
  const module = await format(
    `// Generated by scripts/gen-reference.mjs; do not edit.
import * as z from 'zod/mini'
import LZString from 'lz-string'
import type { ReferenceModel } from './types'
import { parseReferenceModel } from './referenceSchema.generated'
export { parseReferenceModel } from './referenceSchema.generated'
export function referenceModel(): ReferenceModel {
  const referenceRadix = ${source.REFERENCE_POOL_RADIX}
  const numericPrefix = ${JSON.stringify(numericPrefix)}
  const stringPrefixes = ${JSON.stringify(stringPrefixes)}
  const packed = z.object({ pool: z.array(z.unknown()), model: z.unknown() }).parse(
    JSON.parse(LZString.decompressFromBase64(${JSON.stringify(encodedPayload)})),
  )
  const pool = packed.pool
  const expand = (value: unknown): unknown => {
    if (typeof value === 'string') {
      if (value.startsWith(numericPrefix)) return Number(value.slice(numericPrefix.length))
      const prefixMatch = /^~s([0-9a-z]+):(.*)$/s.exec(value)
      if (prefixMatch !== null) {
        const prefix = stringPrefixes[Number.parseInt(prefixMatch[1] ?? '', referenceRadix)]
        if (prefix === undefined) throw new RangeError(value)
        return prefix + (prefixMatch[2] ?? '')
      }
      const match = /^~([0-9a-z]+)$/.exec(value)
      if (match === null) return value
      const token = pool[Number.parseInt(match[1] ?? '', referenceRadix)]
      if (token === undefined) throw new RangeError(value)
      return expand(token)
    }
    if (Array.isArray(value)) return value.map((entry: unknown) => expand(entry))
    if (typeof value !== 'object' || value === null) return value
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => {
      const name = expand(key)
      if (typeof name !== 'string') throw new TypeError(key)
      return [name, expand(entry)]
    }))
  }
  return parseReferenceModel(expand(packed.model))
}
`,
    { ...formatting, filepath: MODULE },
  )
  const markdown = await format(referenceMarkdown(model, source, nls, manifest), {
    ...formatting,
    filepath: DOC,
    proseWrap: 'preserve',
  })
  const json = await format(JSON.stringify(model), { ...formatting, filepath: JSON_MODEL })
  for (const [file, content] of [
    [MODULE, module],
    [
      'src/runtime/reference.node.generated.ts',
      await format(
        `// Generated by scripts/gen-reference.mjs; do not edit.\nimport type { ReferenceModel } from '../shared/reference/types'\nimport { parseReferenceModel } from '../shared/reference/referenceSchema.generated'\nimport { brotliDecompressSync } from 'node:zlib'\nexport function referenceModel(): ReferenceModel { return parseReferenceModel(JSON.parse(brotliDecompressSync(Buffer.from('${brotliCompressSync(Buffer.from(JSON.stringify(model))).toString('base64')}', 'base64')).toString('utf8'))) }\n`,
        { ...formatting, filepath: 'src/runtime/reference.node.generated.ts' },
      ),
    ],
    [
      'src/shared/reference/referenceSchema.generated.ts',
      await format(
        `// Generated by scripts/gen-reference.mjs; do not edit.\nimport * as z from 'zod/mini'\nimport type { ReferenceModel } from './types'\nexport const textKeys = ${JSON.stringify(textKeys)} as const\n${schema}\n`,
        { ...formatting, filepath: 'src/shared/reference/referenceSchema.generated.ts' },
      ),
    ],
    [DOC, markdown],
    [JSON_MODEL, json],
  ]) {
    if (isCheck) {
      if (readFileSync(path.join(root, file), 'utf8').replaceAll('\r\n', '\n') !== content)
        throw new Error(`Stale reference: ${file}; run npm run reference:generate`)
    } else writeFileSync(path.join(root, file), content)
  }
  return model
}
