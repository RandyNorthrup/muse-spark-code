import { createElement, type ReactElement } from 'react'
import type { TuiInk } from '../../../src/runtime/tui/view'
import type { TuiColorTier, TuiThemeMode } from '../../../src/runtime/tui/design/capabilities'
import { brandArt } from '../../../src/runtime/tui/design/art'
import {
  AgentMap,
  BottomPane,
  Panel,
  PeekPane,
  Progress,
  Splash,
  StatusLine,
  TabStrip,
} from '../../../src/runtime/tui/design/components'
import { progressBar, spinnerFrame } from '../../../src/runtime/tui/design/motion'
import { paint, type TuiTheme } from '../../../src/runtime/tui/design/theme'
import { wrapColored } from './wrap'

export interface TuiSceneFrame {
  ink: TuiInk
  columns: number
  tier: TuiColorTier
  mode: TuiThemeMode
}

export interface TuiGoldenScene {
  readonly name: string
  /** Reader scenes render plain and frameless, once per size. */
  readonly reader: boolean
  /** Splash and panel prove both theme modes; the rest pin dark. */
  readonly light: boolean
  element(frame: TuiSceneFrame): ReactElement
}

function themeOf(frame: TuiSceneFrame): TuiTheme {
  return { tier: frame.tier, mode: frame.mode }
}

function splashArt(frame: TuiSceneFrame, hasNerdFont: boolean): ReactElement {
  return createElement(Splash, {
    ink: frame.ink,
    theme: themeOf(frame),
    art: brandArt('squiggle', frame.tier, frame.mode, hasNerdFont),
    caption: 'Muse Spark Code',
    progress: progressBar(40, 0.6, frame.tier === 'plain'),
    width: frame.columns,
  })
}

function splash(frame: TuiSceneFrame): ReactElement {
  return splashArt(frame, true)
}

function splashSafe(frame: TuiSceneFrame): ReactElement {
  return splashArt(frame, false)
}

function panelArt(frame: TuiSceneFrame, extra?: { frame?: boolean }): ReactElement {
  return createElement(Panel, {
    ink: frame.ink,
    theme: themeOf(frame),
    title: 'Agents',
    lines: ['alpha is editing App.tsx', 'beta is reviewing the diff', 'gamma is idle'],
    width: Math.max(20, frame.columns - 4),
    ...extra,
  })
}

function panel(frame: TuiSceneFrame): ReactElement {
  return panelArt(frame)
}

function panelReader(frame: TuiSceneFrame): ReactElement {
  return panelArt(frame, { frame: false })
}

function status(frame: TuiSceneFrame): ReactElement {
  return createElement(StatusLine, {
    ink: frame.ink,
    theme: themeOf(frame),
    items: [
      ['node', 'home'],
      ['profile', 'LAN'],
      ['session', 'owner'],
      ['queue', '3 running'],
    ],
    width: frame.columns,
  })
}

function progress(frame: TuiSceneFrame): ReactElement {
  return createElement(Progress, {
    ink: frame.ink,
    theme: themeOf(frame),
    tick: spinnerFrame(3, frame.tier === 'plain'),
    label: 'Loading workspace state from the node service on the home network',
    width: frame.columns,
  })
}

function tabs(hasNerdFont: boolean) {
  return (frame: TuiSceneFrame): ReactElement =>
    createElement(TabStrip, {
      ink: frame.ink,
      theme: themeOf(frame),
      tabs: [
        ['chat', 'Chat'],
        ['diff', 'Diff'],
        ['tasks', 'Tasks'],
        ['status', 'Status'],
        ['terminal', 'Terminal'],
        ['settings', 'Settings'],
      ],
      active: 'diff',
      nerdFont: hasNerdFont,
      width: frame.columns,
    })
}

function agents(hasNerdFont: boolean) {
  return (frame: TuiSceneFrame): ReactElement =>
    createElement(AgentMap, {
      ink: frame.ink,
      theme: themeOf(frame),
      agents: [
        ['alpha', 'active', 'feature/terminal-tabs'],
        ['beta', 'idle', 'fix/audit-paging-with-retention-cursors'],
        ['gamma', 'done', 'main'],
      ],
      nerdFont: hasNerdFont,
      width: frame.columns,
    })
}

function peek(frame: TuiSceneFrame): ReactElement {
  return createElement(PeekPane, {
    ink: frame.ink,
    theme: themeOf(frame),
    title: 'Live peek: alpha',
    lines: [
      'reading src/webview/node/terminal/Terminal.tsx around the resize observer',
      'the unconditional refit feeds the observer its own resize and loops the frame',
    ],
    width: frame.columns,
  })
}

function bottom(frame: TuiSceneFrame): ReactElement {
  const width = Math.max(20, frame.columns - 4)
  // One long painted line, wrapped the way callers wrap log output:
  // the golden pins the re-seated colour on the continued line.
  const wrapped = wrapColored(
    paint(
      themeOf(frame),
      'warning',
      '$ npm run quality:gates -- --reporter=verbose --coverage enabled --all-workspaces --fail-fast',
    ),
    width - 2,
  )
  return createElement(BottomPane, {
    ink: frame.ink,
    theme: themeOf(frame),
    title: 'Terminal',
    lines: [...wrapped, 'all gates green in 41s'],
    width,
  })
}

function bottomReader(frame: TuiSceneFrame): ReactElement {
  return createElement(BottomPane, {
    ink: frame.ink,
    theme: themeOf(frame),
    title: 'Terminal',
    lines: ['$ npm run quality:gates', 'all gates green in 41s'],
    width: Math.max(20, frame.columns - 4),
    frame: false,
  })
}

export const TUI_SCENES: readonly TuiGoldenScene[] = [
  { name: 'splash', reader: false, light: true, element: splash },
  { name: 'splash-safe', reader: false, light: false, element: splashSafe },
  { name: 'panel', reader: false, light: true, element: panel },
  { name: 'panel-reader', reader: true, light: false, element: panelReader },
  { name: 'status', reader: false, light: false, element: status },
  { name: 'progress', reader: false, light: false, element: progress },
  { name: 'tabs', reader: false, light: false, element: tabs(false) },
  { name: 'tabs-nerd', reader: false, light: false, element: tabs(true) },
  { name: 'agents', reader: false, light: false, element: agents(false) },
  { name: 'agents-nerd', reader: false, light: false, element: agents(true) },
  { name: 'peek', reader: false, light: false, element: peek },
  { name: 'bottom', reader: false, light: false, element: bottom },
  { name: 'bottom-reader', reader: true, light: false, element: bottomReader },
]
