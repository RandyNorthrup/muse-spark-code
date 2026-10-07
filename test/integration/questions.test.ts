// M112 U: actual VS Code renderer + a test-only injected host, no model process/call.
import * as assert from 'node:assert/strict'
import { EventEmitter, once } from 'node:events'
import * as vscode from 'vscode'
import { EN } from '../../src/shared/l10n/en'
import {
  CHAT_PANEL_VIEW_TYPE,
  EXTENSION_QUALIFIED_ID,
  SETTINGS_SECTION,
} from '../../src/shared/constants'
import { readSettings, toSettingsSnapshot } from '../../src/host/settings'
import { openChatPanel } from '../../src/host/views/chatPanel'
import { SurfaceRegistry } from '../../src/host/views/surfaceRegistry'
import type { WebviewHostContext } from '../../src/host/views/webviewSetup'
import { questionFixture } from '../unit/helpers/questions/fixtures'

suite('M112 real panel', () => {
  test('registers the question commands in the actual extension host', async () => {
    const extension = vscode.extensions.getExtension(EXTENSION_QUALIFIED_ID)
    assert.ok(extension)
    await extension.activate()
    const commands = await vscode.commands.getCommands(true)
    assert.ok(commands.includes('museSpark.nextOpenQuestion'))
    assert.ok(commands.includes('museSpark.previousOpenQuestion'))
    const setting = vscode.workspace.getConfiguration(SETTINGS_SECTION)
    assert.equal(setting.get('questions.deferAfterSeconds'), 60)
    // With no session these commands are honest no-ops and start no model.
    await vscode.commands.executeCommand('museSpark.nextOpenQuestion')
    await vscode.commands.executeCommand('museSpark.previousOpenQuestion')
  })

  test('renders a rowless open card in a real tab and posts its validated late answer', async () => {
    const extension = vscode.extensions.getExtension(EXTENSION_QUALIFIED_ID)
    assert.ok(extension)
    const channel = vscode.window.createOutputChannel('M112 test', { log: true })
    const registry = new SurfaceRegistry()
    const record = questionFixture({
      askedAt: Date.now(),
      deadlineAt: undefined,
      deferredAt: Date.now(),
    })
    const answerEvents = new EventEmitter()
    const answered = once(answerEvents, 'answered')
    const context: WebviewHostContext = {
      extensionUri: extension.extensionUri,
      l10n: { locale: 'en', table: EN },
      log: channel,
      getSettings: () =>
        toSettingsSnapshot(
          readSettings(vscode.workspace.getConfiguration(SETTINGS_SECTION), channel),
        ),
      onInputFocusChanged: () => {
        /* Test host has no editor focus state. */
      },
      onSurfaceReady: (surface) => {
        surface.post({ type: 'sessionInfo', sessionId: record.sessionId, modelId: 'test' })
        surface.post({ type: 'authState', status: 'signedIn' })
        surface.setTitle('M112 test')
        surface.post({
          type: 'openQuestions',
          snapshot: { sessionId: record.sessionId, questions: [record] },
        })
      },
      onConversationMessage: (_surface, message) => {
        if (message.type !== 'answerOpenQuestion') return
        assert.equal(message.sessionId, record.sessionId)
        assert.equal(message.userInputId, record.userInputId)
        assert.deepEqual(message.reply, {
          answers: [{ questionId: 'colour', selectedLabel: 'Blue' }],
        })
        answerEvents.emit('answered')
      },
    }
    const panel = openChatPanel(context, registry)
    try {
      const nonce = /nonce="([^"]+)"/.exec(panel.webview.html)?.[1]
      assert.ok(nonce)
      // This test-only driver runs within the real isolated webview/CSP.
      // It clicks the shared card; the normal host bridge parses the result.
      const driver = `<script nonce="${nonce}">
        function answerWhenReady() {
          const chip = document.querySelector('.open-questions-chip button');
          if (!chip) { setTimeout(answerWhenReady, 50); return; }
          chip.click();
          setTimeout(() => {
            const card = document.querySelector('[data-question-slot="dock"]:not([hidden])');
            card.querySelector('input[type="radio"]').click();
            card.querySelector('.question-actions .button-primary').click();
          }, 100);
        }
        answerWhenReady();
      </script>`
      panel.webview.html = panel.webview.html.replace('</body>', () => `${driver}</body>`)
      await answered
      assert.equal(panel.title, 'M112 test · 1 open')
      registry.active?.post({
        type: 'openQuestions',
        snapshot: {
          sessionId: record.sessionId,
          questions: [{ ...record, state: 'answeredLater' }],
        },
      })
      assert.equal(panel.title, 'M112 test')
      assert.equal(panel.viewType, CHAT_PANEL_VIEW_TYPE)
    } finally {
      panel.dispose()
      channel.dispose()
    }
  })
})
