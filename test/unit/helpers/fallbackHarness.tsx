import { createRoot } from 'react-dom/client'
import { EN } from '../../../src/shared/l10n/en'
import { UI_TEXT, setUiText } from '../../../src/shared/l10n/text'
import { installEmbeddedTable } from '../../../src/webview/installTable'
import {
  hostToWebviewMessageSchema,
  webviewToHostMessageSchema,
} from '../../../src/shared/protocol'
import { parseMhpResult } from '../../../src/shared/hostApi/protocol'
import type { HostServices } from '../../../src/shared/hostApi/methods'
import { selectBridge } from '../../../src/webview/bridges/select'
import type { MuseEmbeddedHost } from '../../../src/shared/hostApi/panel'
import '../../../src/webview/portableTokens.css'
import '../../../src/webview/styles.css'

declare global {
  interface Window {
    showFallback?: (kind: string) => Promise<void>
  }
}
setUiText(EN, 'en')
const error = installEmbeddedTable(document)
if (error !== undefined) throw error
const params = new URLSearchParams(location.search)
const codec = { outgoing: webviewToHostMessageSchema, incoming: hostToWebviewMessageSchema }
const nativeState: { value?: unknown; posts: unknown[] } = { posts: [] }
function ignoreFixtureEvent(): void {
  /* This visual fixture has no runtime command receiver. */
}
function cancelledFixturePrompt(): void {
  /* Switching scenarios cancels the previous prompt. */
}
const native: MuseEmbeddedHost = {
  postMessage(message) {
    nativeState.posts.push(message)
  },
  onMessage() {
    return ignoreFixtureEvent
  },
  getState() {
    return undefined
  },
  setState(value) {
    nativeState.value = value
  },
}
switch (params.get('bridge')) {
  case 'native': {
    Object.assign(window, { museHost: native })
    break
  }
  case 'companion': {
    const stream = new ReadableStream<Uint8Array>()
    const send: typeof fetch = (input) =>
      Promise.resolve(
        input === '/panel/events'
          ? new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } })
          : new Response(null, { status: 204 }),
      )
    document.body.dataset['bridge'] = 'companion'
    const binding = document.createElement('script')
    binding.id = 'muse-panel'
    binding.type = 'application/json'
    binding.textContent = JSON.stringify({
      surface: 'a11y',
      sessionId: 'test',
      surfaceKind: 'chat',
    })
    document.body.append(binding)
    Object.assign(window, { fetch: send })
    break
  }
  default: {
    // A browser fixture of the host API; no test-library globals in the bundle.
    Object.assign(window, { acquireVsCodeApi: () => native })
  }
}
const bridge = await selectBridge(codec, (failure) => {
  throw failure
})
const services: HostServices = {
  request: (method) =>
    Promise.resolve(parseMhpResult(method, { jsonrpc: '2.0', id: 1, result: null }).result),
  notify: ignoreFixtureEvent,
}
const library = await bridge.loadFallbacks()
const rootElement = document.querySelector('#root')
if (rootElement === null) throw new Error('NO_ROOT')
const prompts = document.querySelector('#prompts')
if (prompts === null) throw new Error('NO_PROMPTS')
const root = createRoot(rootElement)
const fixture = { ui: library.createFallbackUi(prompts, ignoreFixtureEvent) }
const action = { id: 'open', title: UI_TEXT.fallbackContinue, run: () => Promise.resolve() }
Object.assign(window, {
  showFallback: async (kind: string) => {
    fixture.ui.dispose()
    fixture.ui = library.createFallbackUi(prompts, ignoreFixtureEvent)
    root.render(null)
    switch (kind) {
      case 'confirm': {
        void fixture.ui
          .request('ui/confirm', {
            title: UI_TEXT.paidUseWebSearchTitle,
            message: UI_TEXT.paidDailyBudgetLine,
            choices: [
              { id: 'allow', title: UI_TEXT.reviewAccept },
              { id: 'deny', title: UI_TEXT.reject },
            ],
          })
          .catch(cancelledFixturePrompt)
        break
      }
      case 'picker': {
        void fixture.ui
          .request('ui/pick', {
            title: UI_TEXT.skillsPickTitle,
            items: [
              { id: 'a', title: UI_TEXT.manageSkillsItem },
              { id: 'b', title: UI_TEXT.importSkillsItem },
            ],
            multiple: true,
          })
          .catch(cancelledFixturePrompt)
        break
      }
      case 'input': {
        void fixture.ui
          .request('ui/input', {
            title: UI_TEXT.memoryTitle,
            prompt: UI_TEXT.fallbackContinue,
            value: 'notes',
          })
          .catch(cancelledFixturePrompt)
        break
      }
      case 'toasts': {
        await fixture.ui.request('ui/notify', {
          severity: 'error',
          message: UI_TEXT.fallbackActionFailed,
        })
        break
      }
      case 'status': {
        await fixture.ui.request('ui/status', {
          id: 'ready',
          text: UI_TEXT.fallbackStatus,
          visible: true,
          command: 'logs',
        })
        await fixture.ui.request('ui/progress', {
          id: 'p',
          title: UI_TEXT.working,
          fraction: 1,
          done: false,
        })
        break
      }
      case 'settings': {
        root.render(
          <library.SettingsPage
            entries={[
              {
                key: 'museSpark.autosave',
                title: UI_TEXT.fallbackSettings,
                description: UI_TEXT.openSettings,
                value: true,
              },
            ]}
            scope="workspace"
            services={services}
          />,
        )
        break
      }
      case 'walkthrough': {
        root.render(
          <library.Walkthrough
            steps={[
              {
                id: 'setup',
                title: UI_TEXT.signInTitle,
                description: UI_TEXT.signInBrowserDetail,
                actionTitle: UI_TEXT.fallbackContinue,
                action: { type: 'hostAction', action: 'openSettings' },
              },
            ]}
            post={(message) => {
              bridge.post(message)
            }}
          />,
        )
        break
      }
      case 'diff': {
        root.render(
          <library.DiffPage
            title={UI_TEXT.reviewPaneTitle}
            hunks={[
              {
                id: 'hunk',
                uri: 'file:///workspace/main.ts',
                expectedVersion: 1,
                range: { start: { line: 0, character: 0 }, end: { line: 1, character: 0 } },
                before: 'const value = false',
                after: 'const value = true',
              },
            ]}
            onDecide={() => Promise.resolve()}
          />,
        )
        break
      }
      case 'terminal': {
        root.render(
          <library.TerminalOutput
            title={UI_TEXT.fallbackTerminal}
            output="check: all files passed\n"
            isRunning
            onStop={ignoreFixtureEvent}
          />,
        )
        break
      }
      case 'skills':
      case 'mcp':
      case 'hooks':
      case 'memory':
      case 'worktrees': {
        root.render(
          <library.ManagerPage
            kind={kind}
            entries={[
              {
                id: 'record',
                title: UI_TEXT.fallbackContinue,
                detail: UI_TEXT.fallbackSettings,
                actions: [action],
              },
            ]}
            actions={[action]}
          />,
        )
        break
      }
      default: {
        throw new Error('UNKNOWN_FALLBACK')
      }
    }
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          resolve()
        })
      })
    })
    document.body.dataset['ready'] = kind
  },
})
