// What a scenario can do: what a person does at a terminal, and what an
// editor does over the editor protocol. Each scenario gets its own, in its
// own empty workspace, on one route.
import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { microUsd } from './budget.mjs'
import { jsonLines, runCommand, saidIn, startEditor } from './product.mjs'
import { editorArguments, routeArguments } from './routes.mjs'

const MODEL_OPTION = 'model'
const PERMISSION_KIND = { allow: 'allow_once', reject: 'reject_once' }

/**
 * @param {object} cell
 * @param {import('./product.mjs').Product} cell.product
 * @param {object} cell.route the route as lib/routes.mjs gives it
 * @param {string} cell.workspace a new, empty folder
 * @param {string} cell.admitUsd the hard cap handed to each `exec` (the product reserves a request's worst case against it)
 * @param {string | undefined} cell.key the route's key, for a route that takes it on standard input
 */
export function personFor(cell) {
  const { product, route, workspace } = cell
  const editors = []
  const logs = []
  const made = { requests: 0, micro: 0 }

  async function command(args, options = {}) {
    const run = await runCommand(product, args, { cwd: workspace, ...options })
    logs.push(run.stderr)
    return run
  }

  /** One headless turn: `exec` with the route's arguments, its result read from the JSONL it prints. */
  async function exec(prompt, options = {}) {
    const isKeyOnPipe = route.kind === 'meta'
    const args = [
      'exec',
      ...routeArguments(options.model === undefined ? route : { ...route, ...options.model }),
      '--permission-mode',
      options.mode ?? 'plan',
      '--max-requests',
      String(options.maxRequests ?? 1),
      '--max-budget-usd',
      cell.admitUsd,
      '--output',
      'jsonl',
      ...(isKeyOnPipe ? ['--key-stdin'] : []),
      ...(options.args ?? []),
      prompt,
    ]
    const run = await command(args, {
      stdin: isKeyOnPipe ? `${cell.key ?? ''}\n` : '',
      ...(options.interruptWhen !== undefined && { interruptWhen: options.interruptWhen }),
    })
    const events = jsonLines(run.stdout)
    const result = events.findLast((event) => event.type === 'result')?.result
    made.requests += result?.usage?.requests ?? 0
    const micro = microUsd(result?.usage?.costUsd?.total ?? '0')
    made.micro += Number.isNaN(micro) ? 0 : micro
    return { ...run, events, result }
  }

  function sessionOf(editor, sessionId, opened) {
    const modelOption = () =>
      (opened.configOptions ?? []).find((option) => option.id === MODEL_OPTION)
    const session = {
      sessionId,
      modes: opened.modes,
      /** The models the session offers, as the editor's picker shows them. */
      models: () => (modelOption()?.options ?? []).map((option) => option.value),
      currentModel: () => modelOption()?.currentValue,
      async setModel(value) {
        const set = await editor.request('session/set_config_option', {
          sessionId,
          configId: MODEL_OPTION,
          value,
        })
        opened.configOptions = set.configOptions
        return session.currentModel()
      },
      async setMode(modeId) {
        await editor.request('session/set_mode', { sessionId, modeId })
      },
      /** Starts a prompt and hands back its end, so a scenario can act while it runs. */
      start(text, options = {}) {
        // Nothing is ever sent on a model the route did not name: a session
        // that sits on another one (a dearer tier, an unknown one) is not used.
        if (session.currentModel() !== route.modelId) {
          throw new Error(
            `the session is on ${String(session.currentModel())}, not on ${route.modelId}: nothing was sent`,
          )
        }
        const kind = PERMISSION_KIND[options.permissions]
        editor.answerPermissions((asked) =>
          kind === undefined ? undefined : asked.options.find((one) => one.kind === kind)?.optionId,
        )
        const from = { updates: editor.updates.length, permissions: editor.permissions.length }
        const ended = async () => {
          const answer = await editor.request('session/prompt', {
            sessionId,
            prompt: [{ type: 'text', text }],
          })
          const updates = editor.updates.slice(from.updates)
          return {
            stopReason: answer.stopReason,
            said: saidIn(updates),
            updates,
            asked: editor.permissions.slice(from.permissions),
          }
        }
        return { done: ended(), cancel: () => editor.notify('session/cancel', { sessionId }) }
      },
      async prompt(text, options) {
        return await session.start(text, options).done
      },
    }
    return session
  }

  /** The agent started as an editor starts it for the route, initialized. */
  async function openEditor(extraArguments = []) {
    const editor = startEditor(product, [...editorArguments(route), ...extraArguments], {
      cwd: workspace,
    })
    editors.push(editor)
    const initialized = await editor.request('initialize', {
      protocolVersion: 1,
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
      clientInfo: { name: 'real-life-run', version: '1' },
    })
    return {
      initialized,
      nextUpdate: editor.nextUpdate,
      /** A new session on the route's model, chosen in the session as a person chooses it. */
      async newSession() {
        const opened = await editor.request('session/new', { cwd: workspace, mcpServers: [] })
        const session = sessionOf(editor, opened.sessionId, opened)
        if (session.currentModel() !== route.modelId) await session.setModel(route.modelId)
        return session
      },
      async listSessions() {
        const listed = await editor.request('session/list', { cwd: workspace })
        return listed.sessions ?? []
      },
      async loadSession(sessionId) {
        const from = editor.updates.length
        const opened = await editor.request('session/load', {
          sessionId,
          cwd: workspace,
          mcpServers: [],
        })
        return { ...sessionOf(editor, sessionId, opened), replayed: editor.updates.slice(from) }
      },
      /** Ends the agent as an editor does when its window closes. */
      stop: () => editor.stop(),
    }
  }

  return {
    route,
    workspace,
    /** A word no model would say by itself: the prompt asks for it, the scenario looks for it. */
    marker: () => `RL-${randomBytes(4).toString('hex').toUpperCase()}`,
    command,
    exec,
    openEditor,
    /** The product's own usage records for this home, as `usage --json` prints them. */
    async usage() {
      const printed = await command(['usage', '--json'])
      try {
        return JSON.parse(printed.stdout).records ?? []
      } catch {
        return []
      }
    },
    /** The text of a file in the workspace, or nothing when there is none. */
    file(name) {
      const file = path.join(workspace, name)
      return existsSync(file) ? readFileSync(file, 'utf8') : undefined
    },
    /** What the exec commands of this cell made, by the product's own ledger. */
    made,
    /** The product's own log lines of this cell. */
    logText: () => logs.join('\n'),
    /** Ends every agent the scenario left running. */
    async end() {
      for (const editor of editors) {
        await editor.stop()
        logs.push(editor.stderr)
      }
    },
  }
}
