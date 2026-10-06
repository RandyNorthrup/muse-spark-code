// Runtime keyboard actions and the /help inventory share this table. An action
// means a handler branch in this context, not a key observed elsewhere.
import type { ReferenceText } from './featureCatalog'

interface KeyGesture {
  readonly key: string
  readonly shift?: boolean
  readonly alt?: boolean
  readonly primary?: boolean
  readonly phase?: 'up'
}
interface KeyBinding {
  readonly keys: readonly KeyGesture[]
  readonly text: ReferenceText
  readonly when?: { readonly setting: 'useCtrlEnterToSend'; readonly value: boolean }
}
export const WEBVIEW_KEYBINDINGS = {
  'composer.send': {
    send: {
      when: { setting: 'useCtrlEnterToSend', value: false },
      keys: [{ key: 'Enter', shift: false, alt: false, primary: false }],
      text: { ui: 'referenceSendKeys' },
    },
    sendModified: {
      when: { setting: 'useCtrlEnterToSend', value: true },
      keys: [{ key: 'Enter', shift: false, alt: false, primary: true }],
      text: { ui: 'referenceSendKeys' },
    },
  },
  'composer.newline': {
    newline: { keys: [{ key: 'Enter', shift: true }], text: { ui: 'referenceNewlineKeys' } },
  },
  'composer.dictation': {
    dictate: {
      keys: [{ key: 'd', alt: false, primary: true }],
      text: { ui: 'referenceDictationKeys' },
    },
    release: {
      keys: [
        { key: 'd', phase: 'up' },
        { key: 'Control', phase: 'up' },
        { key: 'Meta', phase: 'up' },
      ],
      text: { ui: 'referenceDictationKeys' },
    },
  },
  'composer.permission': {
    cycle: { keys: [{ key: 'Tab', shift: true }], text: { ui: 'referenceModeKeys' } },
  },
  'composer.mention': {
    next: { keys: [{ key: 'ArrowDown' }], text: { ui: 'referenceMenuKeys' } },
    previous: { keys: [{ key: 'ArrowUp' }], text: { ui: 'referenceMenuKeys' } },
    accept: { keys: [{ key: 'Enter' }], text: { ui: 'referenceMenuKeys' } },
    complete: { keys: [{ key: 'Tab' }], text: { ui: 'referenceMenuKeys' } },
    close: { keys: [{ key: 'Escape' }], text: { ui: 'referenceMenuKeys' } },
  },
  'composer.slash': {
    next: { keys: [{ key: 'ArrowDown' }], text: { ui: 'referenceMenuKeys' } },
    previous: { keys: [{ key: 'ArrowUp' }], text: { ui: 'referenceMenuKeys' } },
    accept: { keys: [{ key: 'Enter', shift: false }], text: { ui: 'referenceMenuKeys' } },
    complete: { keys: [{ key: 'Tab', shift: false }], text: { ui: 'referenceMenuKeys' } },
    close: { keys: [{ key: 'Escape' }], text: { ui: 'referenceMenuKeys' } },
  },
  'composer.mic': {
    dictate: { keys: [{ key: 'Enter' }, { key: ' ' }], text: { ui: 'referenceMicKeys' } },
  },
  'history.archive': {
    archive: { keys: [{ key: 'Delete' }], text: { ui: 'referenceArchiveKeys' } },
  },
  palette: {
    next: { keys: [{ key: 'ArrowDown' }], text: { ui: 'referencePaletteKeys' } },
    previous: { keys: [{ key: 'ArrowUp' }], text: { ui: 'referencePaletteKeys' } },
    increase: { keys: [{ key: 'ArrowRight' }], text: { ui: 'referencePaletteKeys' } },
    decrease: { keys: [{ key: 'ArrowLeft' }], text: { ui: 'referencePaletteKeys' } },
    accept: { keys: [{ key: 'Enter' }], text: { ui: 'referencePaletteKeys' } },
    close: { keys: [{ key: 'Escape' }], text: { ui: 'referencePaletteKeys' } },
  },
  popover: {
    next: { keys: [{ key: 'ArrowDown' }], text: { ui: 'referencePopoverKeys' } },
    previous: { keys: [{ key: 'ArrowUp' }], text: { ui: 'referencePopoverKeys' } },
    increase: { keys: [{ key: 'ArrowRight' }], text: { ui: 'referencePopoverKeys' } },
    decrease: { keys: [{ key: 'ArrowLeft' }], text: { ui: 'referencePopoverKeys' } },
    accept: { keys: [{ key: 'Enter' }, { key: ' ' }], text: { ui: 'referencePopoverKeys' } },
    close: { keys: [{ key: 'Escape' }], text: { ui: 'referencePopoverKeys' } },
  },
  dialog: {
    next: { keys: [{ key: 'ArrowDown' }], text: { ui: 'referenceDialogKeys' } },
    previous: { keys: [{ key: 'ArrowUp' }], text: { ui: 'referenceDialogKeys' } },
    accept: { keys: [{ key: 'Enter' }], text: { ui: 'referenceDialogKeys' } },
    close: { keys: [{ key: 'Escape' }], text: { ui: 'referenceDialogKeys' } },
  },
  'row.menu': {
    open: {
      keys: [{ key: 'ContextMenu' }, { key: 'F10', shift: true }],
      text: { ui: 'referenceRowKeys' },
    },
  },
  'radial.menu': {
    next: {
      keys: [{ key: 'ArrowDown' }, { key: 'ArrowRight' }],
      text: { ui: 'referenceRadialKeys' },
    },
    previous: {
      keys: [{ key: 'ArrowUp' }, { key: 'ArrowLeft' }],
      text: { ui: 'referenceRadialKeys' },
    },
    first: { keys: [{ key: 'Home' }], text: { ui: 'referenceRadialKeys' } },
    last: { keys: [{ key: 'End' }], text: { ui: 'referenceRadialKeys' } },
    accept: { keys: [{ key: 'Enter' }, { key: ' ' }], text: { ui: 'referenceRadialKeys' } },
    close: { keys: [{ key: 'Escape' }], text: { ui: 'referenceRadialKeys' } },
  },
  'header.rename': {
    accept: { keys: [{ key: 'Enter' }], text: { ui: 'referenceRenameKeys' } },
    close: { keys: [{ key: 'Escape' }], text: { ui: 'referenceRenameKeys' } },
  },
  'modal.focus': {
    focus: { keys: [{ key: 'Tab' }], text: { ui: 'referenceModalKeys' } },
    close: { keys: [{ key: 'Escape' }], text: { ui: 'referenceModalKeys' } },
  },
  'agent.message': { send: { keys: [{ key: 'Enter' }], text: { ui: 'referenceAgentKeys' } } },
  'output.open': {
    open: { keys: [{ key: 'Enter' }, { key: ' ' }], text: { ui: 'referenceOutputKeys' } },
  },
  'goal.edit': { close: { keys: [{ key: 'Escape' }], text: { ui: 'referenceGoalKeys' } } },
  elicitation: { close: { keys: [{ key: 'Escape' }], text: { ui: 'referenceElicitationKeys' } } },
  'deferred.close': { close: { keys: [{ key: 'Escape' }], text: { ui: 'referenceModalKeys' } } },
  'bestOfN.close': { close: { keys: [{ key: 'Escape' }], text: { ui: 'referenceModalKeys' } } },
} as const satisfies Readonly<Record<string, Readonly<Record<string, KeyBinding>>>>

interface KeyEvent {
  readonly key: string
  readonly shiftKey: boolean
  readonly altKey: boolean
  readonly ctrlKey: boolean
  readonly metaKey: boolean
}
function isAction<C extends keyof typeof WEBVIEW_KEYBINDINGS>(
  context: C,
  action: string,
): action is string & keyof (typeof WEBVIEW_KEYBINDINGS)[C] {
  return Object.hasOwn(WEBVIEW_KEYBINDINGS[context], action)
}
/** Resolve one gesture in its own handler context. No handler owns key literals. */
export function webviewKey<C extends keyof typeof WEBVIEW_KEYBINDINGS>(
  context: C,
  event: KeyEvent,
  phase: 'down' | 'up' = 'down',
  settings?: { readonly useCtrlEnterToSend: boolean },
): (string & keyof (typeof WEBVIEW_KEYBINDINGS)[C]) | undefined {
  const bindings: Readonly<Record<string, KeyBinding>> = WEBVIEW_KEYBINDINGS[context]
  for (const [action, binding] of Object.entries(bindings)) {
    if (
      (binding.when === undefined || settings?.[binding.when.setting] === binding.when.value) &&
      binding.keys.some(
        (key) =>
          key.key.toLowerCase() === event.key.toLowerCase() &&
          (key.phase ?? 'down') === phase &&
          (key.shift === undefined || key.shift === event.shiftKey) &&
          (key.alt === undefined || key.alt === event.altKey) &&
          (key.primary === undefined || key.primary === (event.ctrlKey || event.metaKey)),
      ) &&
      isAction(context, action)
    )
      return action
  }
  return undefined
}

/** Display syntax is computed from the same gestures which dispatch the action. */
export function referenceKeyboardActions() {
  return Object.entries(WEBVIEW_KEYBINDINGS).map(([context, actions]) => {
    const bindings: readonly KeyBinding[] = Object.values(actions)
    return {
      command: context,
      key: [
        ...new Set(
          bindings
            .flatMap((binding) => binding.keys)
            .filter((key) => key.phase !== 'up')
            .map((key) => {
              const name = key.key.length === 1 ? key.key.toUpperCase() : key.key
              return key.primary === true
                ? `Ctrl+${name} / Cmd+${name}`
                : `${key.shift === true ? 'Shift+' : ''}${key.key === ' ' ? 'Space' : key.key}`
            }),
        ),
      ].join(' / '),
      when:
        bindings
          .flatMap((binding) =>
            binding.when === undefined
              ? []
              : [
                  `${binding.keys.map((key) => (key.primary === true ? `Ctrl/Cmd+${key.key}` : key.key)).join(' / ')}: ${binding.when.setting}=${String(binding.when.value)}`,
                ],
          )
          .join('; ') || context,
      text: bindings[0]?.text,
    }
  })
}
