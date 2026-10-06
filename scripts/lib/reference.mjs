// HELPREF: code/manifest-derived reference and freshness gate. No model calls.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { Buffer } from 'node:buffer'
import * as esbuild from 'esbuild'
import ts from 'typescript'
import { format, resolveConfig } from 'prettier'

const MODULE = 'src/shared/reference/reference.generated.ts'
const DOC = 'docs/reference.md'
const JSON_MODEL = 'src/shared/reference/reference.generated.json'

export async function referenceSources(root) {
  const result = await esbuild.build({
    stdin: {
      contents:
        "export * from './src/shared/reference/referenceSource'; export { readSettings } from './src/host/settings'; export { parseCommandLine } from './src/runtime/cliArgs'; export { parseLoopPrompt } from './src/core/backends/modelapi/schedules'; export { locateDictationHelper, locateCaptureHelper } from './src/core/voice/helperLocation'",
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
    ...['Composer', 'HistoryDialog', 'Palette', 'GooeyMenu', 'Header', 'Modal'].map(
      (name) => `src/webview/components/${name}.tsx`,
    ),
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
        ['description', 'markdownDescription', 'title'].includes(key) &&
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

// The option inventory comes from node:util parseArgs, including its aliases.
export function parserOptions(runtimeSource, source) {
  const tree = ts.createSourceFile('cliArgs.ts', runtimeSource, ts.ScriptTarget.Latest, true)
  const result = []
  const read = (object, routes) => {
    for (const property of object.properties) {
      if (!ts.isPropertyAssignment(property) || !ts.isObjectLiteralExpression(property.initializer))
        continue
      const name = ts.isComputedPropertyName(property.name)
        ? source.ACP_PAID_FLAGS[property.name.expression.getText(tree).split('.').at(-1)]
        : property.name.text
      const fields = Object.fromEntries(
        property.initializer.properties
          .filter((field) => ts.isPropertyAssignment(field))
          .map((field) => [
            field.name.getText(tree),
            field.initializer.getText(tree).replaceAll("'", ''),
          ]),
      )
      result.push({ name, routes, ...fields })
    }
  }
  const visit = (node, functionName = '') => {
    if (ts.isFunctionDeclaration(node)) functionName = node.name?.text ?? ''
    if (ts.isPropertyAssignment(node) && node.name.getText(tree) === 'options') {
      if (ts.isConditionalExpression(node.initializer)) {
        read(node.initializer.whenTrue, ['scan-secrets'])
        read(node.initializer.whenFalse, ['exec'])
      } else if (ts.isObjectLiteralExpression(node.initializer)) {
        if (functionName === 'parseReport') read(node.initializer, ['report'])
        else if (functionName === 'parseCommandLineStrictly')
          read(node.initializer, ['serve', 'login', 'setup'])
      }
    }
    ts.forEachChild(node, (child) => visit(child, functionName))
  }
  visit(tree)
  return result
}

const OPTION_KEYS = {
  'trust-workspace': 'execTrustRefused',
  'allow-dangerously-skip-permissions': 'execTrustRefused',
  'web-search': 'execWebSearchUnbounded',
  'image-generation': 'execPaidNeedsEdits',
  'prompt-file': 'execPromptTwice',
  'untrusted-file': 'execFileUnreadable',
  'key-stdin': 'referenceKeyStdin',
  'max-budget-usd': 'execBudgetRequired',
  'permission-mode': 'execModeRefused',
  model: 'execUnknownModel',
  effort: 'execEffortUnavailable',
  'max-requests': 'referenceExecContract',
  timeout: 'referenceExecContract',
  output: 'referenceExecContract',
  cwd: 'referenceExecContract',
  ephemeral: 'referenceExecContract',
  'fail-on-denial': 'execDeniedStop',
  'muse-binary': 'cliNotFound',
  'shell-sandbox': 'sandboxNotNeeded',
  'allow-contributor-models': 'subagentContributorBlocked',
  verbose: 'referenceIntro',
  help: 'referenceBriefHelp',
  version: 'referenceVersion',
  maintenance: 'referenceSetup',
  backend: 'referenceIntro',
  out: 'reportUsage',
  description: 'reportUsage',
  'no-facts': 'reportUsage',
  'no-events': 'reportUsage',
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
        context: 'completed turns',
        goal: 'cleared',
        museCode: 'file tools may edit',
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
        modelApi: 'before next request',
        museCode: 'queued messages only; steer delivered immediately',
      },
    },
    attachments: {
      maxAttachments: source.MAX_ATTACHMENTS_PER_MESSAGE,
      textExtensions: [...source.TEXT_ATTACHMENT_EXTENSIONS],
      textSources: 'trusted indexed workspace paths',
      modelApiTextAllowanceBytes: source.MAX_MODEL_API_TEXT_ATTACHMENT_BYTES,
      imageBytes: source.MAX_IMAGE_BYTES,
      pdfBytes: source.MAX_DOCUMENT_BYTES,
      textBytes: source.MAX_TEXT_ATTACHMENT_BYTES,
      encodedMediaChars: source.MAX_ENCODED_MEDIA_CHARS,
      requestMedia: source.MODEL_API_MEDIA_PER_REQUEST,
      vision: 'selected model capability',
      museCodeMessageBytes: source.MSP_FRAME_LIMIT_BYTES,
      museCodeAttachmentBudgetBytes: source.MSP_ATTACHMENT_FRAME_BUDGET_BYTES,
      pdfPageImages: source.MODEL_API_PDF_PAGE_IMAGES,
      pdfBackend: 'modelApi',
    },
    exports: { sessionLog: 'museCode', formats: source.EXPORT_FORMATS },
    context: {
      meter: ['tokensUsed', 'contextWindow', 'pressure'],
      pressureThresholds: [source.CONTEXT_PRESSURE_MEDIUM, source.CONTEXT_PRESSURE_HIGH],
      compaction: 'summary replaces older context; rewind cannot precede latest compaction',
    },
    questions: { actions: ['submit', 'explain', 'cancel'], elicitation: 'modelApi only' },
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
      attempts: 'separate worktrees',
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
      admission: 'due run requires explicit dispatch and consent',
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
  const keys = new Set(
    source
      .referenceKeyboardActions()
      .flatMap((row) => row.key.split(/[ /]+/).flatMap((key) => key.split('+'))),
  )
  for (const [file, text] of Object.entries(source.evidence)) {
    if (!file.endsWith('.tsx')) continue
    const tree = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    const keyboardKeys = new Set()
    const visit = (node) => {
      if (
        ts.isCaseClause(node) &&
        ts.isStringLiteral(node.expression) &&
        ts.isSwitchStatement(node.parent.parent) &&
        node.parent.parent.expression.getText(tree).endsWith('.key')
      )
        keyboardKeys.add(node.expression.text)
      if (
        ts.isBinaryExpression(node) &&
        node.left.getText(tree).endsWith('.key') &&
        ts.isStringLiteral(node.right)
      )
        keyboardKeys.add(node.right.text)
      if (
        ts.isVariableDeclaration(node) &&
        node.name.getText(tree).endsWith('_KEY') &&
        node.initializer &&
        ts.isStringLiteral(node.initializer)
      )
        keyboardKeys.add(node.initializer.text)
      ts.forEachChild(node, visit)
    }
    visit(tree)
    for (const key of keyboardKeys)
      if (!['Control', 'Meta'].includes(key) && !keys.has(key === ' ' ? 'Space' : key))
        errors.push(`Undocumented keyboard action: ${file}: ${key}`)
  }
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

  const features = source.featureCatalog().map((feature) => ({
    ...feature,
    facts: {
      ...referenceFacts(source)[feature.id],
      ...(feature.paid && {
        paidSettings: feature.settings.filter((setting) =>
          Object.values(source.PAID_FEATURE_SETTINGS).some((key) => setting === `museSpark.${key}`),
        ),
        configuredDefaults: Object.fromEntries(
          feature.settings.map((setting) => [setting, properties[setting]?.default]),
        ),
        pricesUsd: source.PAID_PRICES_USD,
        tokenRatesPerMillion: source.MODEL_API_PRICES_PER_MILLION,
        billing: 'storedModelApiKey',
        effectiveAvailability: Object.fromEntries(
          feature.surfaces.map((surface) => {
            if (surface === 'vscode:modelApi')
              return [
                surface,
                {
                  enabledByDefault: feature.settings.some(
                    (setting) => properties[setting]?.default === true,
                  ),
                  key: 'SecretStorage',
                  consent: true,
                  ledger: feature.id === 'tab' ? 'tabDailyBudgetUsd' : 'paidDailyBudgetUsd',
                },
              ]
            if (surface === 'acp:modelApi')
              return [
                surface,
                {
                  enabledByDefault: false,
                  flag: source.PAID_FEATURES.filter((paid) =>
                    feature.settings.includes(`museSpark.${source.PAID_FEATURE_SETTINGS[paid]}`),
                  ).map((paid) => source.ACP_PAID_FLAGS[paid]),
                  consent: 'editor permission',
                  ledger: false,
                },
              ]
            return [
              surface,
              {
                enabledByDefault: feature.id === 'tab',
                key: 'SecretStorage',
                explicitOptIn: feature.id !== 'tab',
                consent: true,
                ledger: feature.id === 'tab' && 'tabDailyBudgetUsd',
              },
            ]
          }),
        ),
      }),
    },
    paid: feature.paid,
  }))
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
  for (const feature of source.PAID_FEATURES)
    if (source.PAID_FEATURE_SETTINGS[feature] === undefined)
      errors.push(`Undocumented paid feature: ${feature}`)
  for (const [id, schema] of Object.entries(properties)) {
    const key = id.slice('museSpark.'.length)
    const canonical = source.SETTING_DEFAULTS[key]
    if (JSON.stringify(canonical) !== JSON.stringify(schema.default))
      errors.push(`Runtime default mismatch: ${id}`)
    for (const value of [schema.default, ...(schema.enum ?? [])]) {
      const actual = source.readSettings(
        { get: (requested) => (requested === key ? value : undefined) },
        silentLog,
      )[key]
      if (JSON.stringify(actual) !== JSON.stringify(value))
        errors.push(`Runtime value mismatch: ${id}`)
    }
  }

  const probeLog = {
    ...silentLog,
    warn() {
      /* Invalid probes are expected; they are not reference errors. */
    },
  }
  const readSetting = (key, value) =>
    source.readSettings({ get: (requested) => (requested === key ? value : undefined) }, probeLog)[
      key
    ]
  for (const [id, schema] of Object.entries(properties)) {
    if (!['number', 'integer'].includes(schema.type)) continue
    const key = id.slice('museSpark.'.length)
    for (const value of [schema.minimum, schema.maximum]) {
      if (value === undefined) continue
      if (readSetting(key, value) !== value) errors.push(`Runtime bound mismatch: ${id}`)
    }
    for (const value of [
      schema.minimum === undefined ? undefined : schema.minimum - 1,
      schema.maximum === undefined ? undefined : schema.maximum + 1,
    ]) {
      if (value === undefined) continue
      if (readSetting(key, value) === value) errors.push(`Runtime bound mismatch: ${id}`)
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
    return {
      id: c.command,
      name: translated(c.title, nls),
      nameKey: keyOf(c.title),
      category: translated(c.category, nls) ?? '',
      categoryKey: keyOf(c.category),
      description: entry === undefined ? '' : descriptionFor(entry.description),
      text: entry?.description,
      enablement:
        [
          c.enablement,
          ...(manifest.contributes.menus?.commandPalette ?? [])
            .filter((menu) => menu.command === c.command)
            .map((menu) => menu.when),
        ]
          .filter(Boolean)
          .join(' && ') || undefined,
      canRun: entry?.canRun === true,
    }
  })
  const slashText = (description) => {
    const ui = Object.entries(source.EN).find(
      ([, text]) => typeof text === 'string' && text === description,
    )?.[0]
    if (ui !== undefined) return { ui }
    const tip = Object.entries(source.EN.paletteTips).find(([, text]) => text === description)?.[0]
    if (tip !== undefined) return { tip }
    errors.push(`Missing localized slash description: ${description}`)
    return { ui: 'referenceIntro' }
  }
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
      const old = slash.get(c.name)
      slash.set(c.name, {
        name: c.name,
        description: c.detail ?? c.tip,
        descriptions: { ...old?.descriptions, [backend]: slashText(c.detail ?? c.tip) },
        backends: [...(old?.backends ?? []), backend],
      })
    }
  }
  const cli = source.cliCommands()
  const optionFacts = {
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
      compaction: 'summary replaces older context; rewind cannot precede latest compaction',
    },
    questions: { actions: ['submit', 'explain', 'cancel'], elicitation: 'modelApi only' },
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
    if (OPTION_KEYS[option.name] === undefined)
      errors.push(`CLI option lacks contract: --${option.name}`)
    const routes = option.name === 'maintenance' ? ['setup'] : option.routes
    for (const route of routes) {
      const usageKey = route === 'report' ? 'reportUsage' : 'acpUsage'
      const usageLine =
        route === 'exec' &&
        [
          'trust-workspace',
          'allow-dangerously-skip-permissions',
          'web-search',
          'key-stdin',
        ].includes(option.name)
          ? -1
          : source.EN[usageKey]
              .split('\n')
              .findLastIndex(
                (line) =>
                  line.trim().startsWith(`--${option.name}`) ||
                  (option.name === 'maintenance' && line.includes('--maintenance')),
              )
      cli.push({
        route,
        name: `${route}: --${option.name}${option.short ? ` / -${option.short}` : ''}${option.type === 'string' ? ' <value>' : ''}`,
        description:
          usageLine < 0
            ? (source.EN[OPTION_KEYS[option.name]] ?? '')
            : source.EN[usageKey].split('\n')[usageLine].trim(),
        text: { ui: OPTION_KEYS[option.name] ?? 'referenceIntro' },
        ...(!(usageLine < 0) && { usageKey, usageLine }),
        contract: {
          type: option.type,
          repeatable: option.multiple === 'true',
          ...optionFacts[option.name],
          ...(option.type === 'boolean' && { default: false }),
          ...(route === 'login' &&
            !['muse-binary', 'verbose', 'help', 'version'].includes(option.name) && {
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
  const syntax = {
    goal: [
      '/goal <objective>',
      '/goal edit <objective>',
      '/goal pause',
      '/goal resume',
      '/goal clear',
    ],
    review: [
      '/review',
      '/review branch [base]',
      '/review commit [revision]',
      '/review <instructions>',
      '/review security …',
    ],
    handoff: ['/handoff [goal]'],
    'hook run': ['/hook run <name>'],
    loop: [
      '/loop <prompt>',
      '/loop <interval: 5m|1h|1d> <prompt>',
      '/loop "<cron>" <prompt>',
      '/loop list',
      '/loop cancel <id>',
    ],
  }
  for (const row of slash.values()) row.syntax = syntax[row.name] ?? [`/${row.name}`]
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
    const expectedPaid =
      Object.values(source.PAID_FEATURE_SETTINGS).some((key) =>
        f.settings.includes(`museSpark.${key}`),
      ) && !['auto-subscription', 'judge-subscription'].includes(f.id)
    if (f.paid !== expectedPaid) errors.push(`Paid claim mismatch: ${f.id}`)
    for (const surface of f.surfaces) {
      const paidIds = source.PAID_FEATURES.filter((paid) =>
        f.settings.includes(`museSpark.${source.PAID_FEATURE_SETTINGS[paid]}`),
      )
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
    for (const text of [f.name, f.summary, f.description, ...f.details]) {
      if (!descriptionFor(text)?.trim()) errors.push(`Feature lacks text: ${f.id}`)
    }
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
  if (errors.length > 0) throw new Error(errors.join('\n'))
  return {
    features,
    commands,
    settings,
    slash: slash.values().toArray(),
    cli,
    executable: source.ACP_AGENT_NAME,
    shortcuts: [...shortcuts, ...source.referenceKeyboardActions()],
  }
}

export function referenceMarkdown(model, source, nls, manifest) {
  const text = (ref) => {
    if ('ui' in ref) return source.EN[ref.ui]
    if ('tip' in ref) return source.EN.paletteTips[ref.tip]
    if ('command' in ref) return model.commands.find((c) => c.id === ref.command)?.name
    const s = manifest.contributes.configuration.properties[`museSpark.${ref.setting}`]
    return translated(s.markdownDescription ?? s.description, nls)
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
      `- **${c.syntax.join(' | ')}**: ${Object.entries(c.descriptions)
        .map(([backend, ref]) => `${backend}: ${text(ref)}`)
        .join('; ')}`,
    )
  lines.push('', '## Commands', '')
  for (const c of model.commands)
    lines.push(
      `### ${c.category}: ${c.name}`,
      '',
      `\`${c.id}\` — ${c.description}`,
      '',
      ...(c.enablement ? [`Available when: \`${c.enablement}\`.`, ''] : []),
    )
  lines.push('## Settings', '')
  for (const s of model.settings)
    lines.push(
      `### ${s.id}`,
      '',
      s.description,
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
        : s.enum.map((v, i) => `- \`${JSON.stringify(v)}\`: ${s.enumDescriptions?.[i] ?? ''}`)),
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
      `- \`${c.name}\`: ${source.fill(c.description, { command: model.executable })}${c.contract === undefined ? '' : ` \`${JSON.stringify(c.contract)}\``}`,
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
  const uiKeys = [
    ...new Set(
      [
        ...model.features.flatMap((f) => [f.name, f.summary, f.description, ...f.details]),
        ...model.commands.map((c) => c.text),
        ...model.cli.flatMap((c) => (c.text === undefined ? [] : [c.text])),
        ...model.shortcuts.flatMap((c) => (c.text === undefined ? [] : [c.text])),
        ...model.slash.flatMap((c) => Object.values(c.descriptions)),
      ]
        .filter((t) => 'ui' in t)
        .map((t) => t.ui),
    ),
  ]
  const tipKeys = [
    ...new Set(
      [
        ...model.features.flatMap((f) => [f.name, f.summary, f.description, ...f.details]),
        ...model.commands.map((c) => c.text),
        ...model.cli.flatMap((c) => (c.text === undefined ? [] : [c.text])),
        ...model.shortcuts.flatMap((c) => (c.text === undefined ? [] : [c.text])),
        ...model.slash.flatMap((c) => Object.values(c.descriptions)),
      ]
        .filter((t) => 'tip' in t)
        .map((t) => t.tip),
    ),
  ]
  const schema = `
    const textSchema = z.union([z.object({ ui: z.enum(${JSON.stringify(uiKeys)}) }), z.object({ tip: z.enum(${JSON.stringify(tipKeys)}) }), z.object({ setting: z.string() }), z.object({ command: z.string() })])
    const strings = z.array(z.string())
    const schema = z.object({ executable: z.string(),
      features: z.array(z.object({ id: z.string(), name: textSchema, summary: textSchema, description: textSchema, commands: strings, settings: strings, docs: z.string(), editors: z.array(z.enum(['vscode', 'acp'])), backends: z.array(z.enum(['museCode', 'modelApi'])), paid: z.boolean(), surfaces: z.array(z.enum(['vscode:museCode', 'vscode:modelApi', 'acp:museCode', 'acp:modelApi'])), details: z.array(textSchema), facts: z.record(z.string(), z.unknown()) })),
      commands: z.array(z.object({ id: z.string(), name: z.string(), nameKey: z.optional(z.string()), category: z.string(), categoryKey: z.optional(z.string()), description: z.string(), text: textSchema, enablement: z.optional(z.string()), canRun: z.boolean() })),
      settings: z.array(z.object({ id: z.string(), name: z.string(), nameKey: z.optional(z.string()), description: z.string(), descriptionKey: z.optional(z.string()), type: z.union([z.string(), strings]), default: z.unknown(), enum: z.optional(z.array(z.unknown())), enumDescriptions: z.optional(strings), enumDescriptionKeys: z.optional(z.array(z.nullable(z.string()))), scope: z.string(), refinements: strings, schema: z.record(z.string(), z.unknown()) })),
      slash: z.array(z.object({ name: z.string(), description: z.string(), descriptions: z.record(z.string(), textSchema), backends: strings, syntax: strings })),
      cli: z.array(z.object({ route: z.string(), name: z.string(), description: z.string(), text: z.optional(textSchema), usageKey: z.optional(z.enum(['acpUsage', 'reportUsage'])), usageLine: z.optional(z.number()), contract: z.optional(z.record(z.string(), z.unknown())) })),
      shortcuts: z.array(z.object({ command: z.string(), key: z.string(), mac: z.optional(z.string()), win: z.optional(z.string()), linux: z.optional(z.string()), when: z.optional(z.string()), text: z.optional(textSchema) }))
    })
    export function parseReferenceModel(value: unknown): ReferenceModel { return schema.parse(value) }
  `
  // Intern repeated JSON tokens without adding a browser/Node compression dependency.
  // The same expanded model is still parsed by zod before either host uses it.
  const modelJson = JSON.stringify(model)
  const tokens = /"(?:[^"\\]|\\.)*"/g
  if (modelJson.match(tokens).some((token) => /^"~[0-9]+"$/.test(token)))
    throw new Error('Reserved reference token')
  const fragments = new Map()
  const collect = (value) => {
    if (typeof value !== 'object' || value === null) return
    const fragment = JSON.stringify(value)
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
    const token = JSON.stringify(`~${pool.length}`)
    const uses = parts.length - 1
    if (uses <= 1 || uses * (fragment.length - token.length) <= JSON.stringify(fragment).length)
      continue
    packed = parts.join(token)
    pool.push(fragment)
  }
  const counts = new Map()
  for (const token of [packed, ...pool].join(' ').match(tokens))
    counts.set(token, (counts.get(token) ?? 0) + 1)
  const referenceLength = JSON.stringify(`~${pool.length + counts.size}`).length
  const repeatedTokens = [...counts]
    .filter(
      ([token, count]) =>
        count > 1 &&
        !/^"~[0-9]+"$/.test(token) &&
        count * (token.length - referenceLength) > JSON.stringify(token).length,
    )
    .map(([token]) => token)
  const indices = new Map(repeatedTokens.map((token, index) => [token, index + pool.length]))
  const encodeTokens = (json) =>
    json.replaceAll(tokens, (token) =>
      indices.has(token) ? JSON.stringify(`~${indices.get(token)}`) : token,
    )
  for (const [index, fragment] of pool.entries()) pool[index] = encodeTokens(fragment)
  pool.push(...repeatedTokens)
  packed = packed.replaceAll(tokens, (token) =>
    indices.has(token) ? JSON.stringify(`~${indices.get(token)}`) : token,
  )
  const formatting = await resolveConfig(path.join(root, MODULE))
  const module = await format(
    `// Generated by scripts/gen-reference.mjs; do not edit.\nimport * as z from 'zod/mini'\nimport type { ReferenceModel } from './types'\nexport function referenceModel(): ReferenceModel { const pool = ${JSON.stringify(pool)}; const expand = (text: string): string => text.replaceAll(/"~([0-9]+)"/g, (_match: string, index: string) => { const token = pool[Number(index)]; if (token === undefined) throw new RangeError(index); return expand(token) }); return parseReferenceModel(JSON.parse(expand(${JSON.stringify(packed)}))) }\n${schema}\n`,
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
