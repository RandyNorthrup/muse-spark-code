// M91 lane P, round 3: the declarative shape of one vendor's hook contract.
// Each vendor module under contracts/ is a table of EventRows; engine.ts is
// the only interpreter. Every row cites its saved source (hooks-parity/ file
// and lines, or a capture under test/fixtures/hookFormats/captured/).
import type * as z from 'zod/mini'
import { type HookAnswer } from '../hooks'
import { type AdapterEvent } from './core'

/** What a Muse tool is, for choosing a vendor's tool-specific event row. */
export type ToolClass = 'shell' | 'read' | 'write' | 'edit' | 'mcp' | 'other'

/** A named, documented stdin field builder (transforms.ts implements each). */
export type TransformName =
  /** Any defined value, unchanged (objects pass as-is: MCP arguments). */
  | 'copy'
  /** A string only; anything else is absent. */
  | 'text'
  /** A path made absolute against the workspace root; ambiguous forms refuse. */
  | 'absolutePath'
  /** An absolute directory inside the workspace (Copilot/Local cwd). */
  | 'containedCwd'
  /** JSON.stringify of the value (Cursor JSON params, Copilot toolArgs). */
  | 'json'
  /** The tool name through the row's vendor tool-name map. */
  | 'toolName'
  /** `mcp__server__tool` split: the server, or the tool. */
  | 'mcpServer'
  | 'mcpTool'
  /** Epoch milliseconds, or an ISO 8601 string, from a dispatcher timestamp. */
  | 'epochMs'
  | 'isoTime'
  /** Muse find/replace (or old/new) as a one-entry documented edits array. */
  | 'editsArray'
  /** A one-element array of the value ([cwd] as Cursor workspace_roots). */
  | 'wrapArray'
  /** Cursor prompt/read attachments: each file_path must be absolute. */
  | 'absoluteAttachments'
  /** Captured/documented Gemini arguments; unsupported native calls refuse. */
  | 'geminiToolInput'

export interface FieldSpec {
  /** Output key; a dot nests (`tool_info.command_line`). */
  readonly to: string
  /** Payload key or dotted path; a list takes the first defined. */
  readonly from?: string | readonly string[]
  /** A constant instead of a payload value. */
  readonly value?: unknown
  readonly transform?: TransformName
  /** A missing or untranslatable value refuses the build (never guessed). */
  readonly required?: boolean
}

/** A condition on the Muse payload the answer belongs to (`options.input`). */
export type InputCondition =
  { readonly path: string; readonly equals: string } | { readonly toolClass: ToolClass }

/** Field-equality conditions on the hook's JSON output; all must hold. */
export type OutputMatch = Readonly<Record<string, string | boolean | readonly string[]>>

export type ResultRule =
  /**
   * A documented veto: blocked. `stop` keeps the reason as stopReason;
   * `approval` also denies the approval; `interrupt` names a boolean field that
   * turns the veto into a stop. Checked on the raw output BEFORE strict
   * validation, so an invalid sibling field never erases the veto.
   */
  | {
      readonly kind: 'veto'
      readonly match: OutputMatch
      /** A non-empty string field also counts as the veto (Cursor followup). */
      readonly nonEmpty?: string
      readonly reason: readonly string[]
      readonly fallback: string
      readonly stop?: true
      readonly approval?: 'deny'
      readonly interrupt?: string
      readonly when?: InputCondition
    }
  | { readonly kind: 'ask'; readonly match: OutputMatch }
  | { readonly kind: 'context'; readonly field: string }
  /** A user warning: kept on every outcome, veto included. */
  | { readonly kind: 'message'; readonly field: string }
  | { readonly kind: 'updatedInput'; readonly field: string }
  /** A documented output replacement lane W applies before packing (D70). */
  | {
      readonly kind: 'replacement'
      readonly field: string
      readonly target: ForeignReplacement['target']
      /** Text replacement: the string at this path inside the field's object. */
      readonly textPath?: string
      readonly when?: InputCondition
    }
  /** Vendor code the table cannot express; named and documented per contract. */
  | {
      readonly kind: 'custom'
      readonly name: string
      readonly apply: (output: Readonly<Record<string, unknown>>) => CustomResult
    }

export type CustomResult =
  | { readonly ok: true; readonly answer: Partial<ForeignHookAnswer> }
  | { readonly ok: false; readonly reason: string }

export interface ResultSpec {
  /** Exit codes that veto; reason from stderr (then stdout unless stderrOnly). */
  readonly blockCodes: readonly number[]
  /** Every exit code at or above this vetoes (Gemini's hookRunner: exit >= 2). */
  readonly blockFrom?: number
  /** A block exit still reads a JSON veto on stdout for its messages. */
  readonly blockScansStdout?: true
  /** A block exit's reason prefers stdout over stderr (Gemini). */
  readonly stdoutFirst?: true
  /** Exit-0 stdout that is not JSON is a user warning, not a failure (Gemini). */
  readonly textIsMessage?: true
  readonly stderrOnly?: true
  /** Copilot: a block exit merges stdout JSON with this deny decision. */
  readonly blockMerge?: Readonly<Record<string, string>>
  /** The vendor never shows stderr as the veto reason (Copilot permissionRequest). */
  readonly ignoreStderr?: true
  /** Exit codes whose stdout text becomes context (Copilot postToolUseFailure 2). */
  readonly contextCodes?: readonly number[]
  /** Other non-zero exits and crashes (exit null). */
  readonly otherExit: 'fail' | 'block'
  /** The per-hook failClosed option upgrades failures to blocks on this row. */
  readonly failClosed?: true
  /** How exit-0 stdout is read. */
  readonly stdout: 'json' | 'text' | 'ignore'
  /** Empty exit-0 stdout: fine, or an invalid answer (Cursor permission hooks). */
  readonly emptyIsInvalid?: true
  /** JSON syntax or schema error: fail open, block, or ignore stdout. */
  readonly invalid: 'fail' | 'block' | 'ignore'
  /** Copilot: stdout that is not one JSON object counts as no output. */
  readonly unparseableIsEmpty?: true
  /** Copilot: single-line `{"type":"progress"}` objects are display-only. */
  readonly progressLines?: true
  /** Strict output schema; unknown fields are invalid. */
  readonly schema?: z.ZodMiniType
  readonly rules: readonly ResultRule[]
  /** Fallback reason for a blocked exit or failure. */
  readonly label: string
}

export interface EventRow {
  readonly muse: AdapterEvent
  /** The vendor's event name as its config spells it. */
  readonly vendor: string
  /** Other spellings the vendor accepts for the same event. */
  readonly aliases?: readonly string[]
  /** Contract flavor (Copilot: copilot | pascal | vscode). */
  readonly flavor?: string
  /** `explicit` rows are chosen only when the import names them. */
  readonly selection: 'default' | 'explicit'
  /** The Muse tools this row translates; others refuse. */
  readonly tools?: readonly ToolClass[]
  /** The vendor tool-name map for the `toolName` transform. */
  readonly toolNames?: Readonly<Record<string, string>>
  readonly fields: readonly FieldSpec[]
  readonly result: ResultSpec
  /** Saved-source citations, checked by the property suite. */
  readonly cite: { readonly input: string; readonly output: string }
}

export interface VendorContract {
  readonly vendor: string
  readonly defaultFlavor?: string
  /** Payload keys that refuse the build (Copilot env: secret risk). */
  readonly refusedPayloadKeys?: readonly string[]
  /** Fields every row's stdin starts with (common input). */
  readonly common: readonly FieldSpec[]
  readonly rows: readonly EventRow[]
  /**
   * Vendor code the table cannot express, run before the build: skip or
   * refuse, or undefined to continue (Kiro's file-trigger path scope).
   */
  readonly gate?: (
    payload: Readonly<Record<string, unknown>>,
    options: AdapterOptions | undefined,
  ) => { readonly outcome: 'skip' | 'refused'; readonly reason: string } | undefined
}

/** A documented output replacement; lane W applies it before packing (D70). */
export interface ForeignReplacement {
  readonly target: 'toolResult' | 'subagentResponse'
  readonly value: string | Readonly<Record<string, unknown>>
}

/** HookAnswer plus the contract results lane W wires (never a grant). */
export interface ForeignHookAnswer extends HookAnswer {
  /** Gemini BeforeToolSelection: vendor tool names admitted (empty: none). */
  readonly allowedToolNames?: readonly string[] | undefined
  readonly replacement?: ForeignReplacement | undefined
}

/** Inputs the import record and dispatcher supply (lane I keeps them stable). */
export interface AdapterOptions {
  /** The imported source event, exactly as the vendor config spelled it. */
  readonly sourceEvent?: string | undefined
  /** The protocol flavor (Copilot: copilot | vscode). */
  readonly flavor?: string | undefined
  /** Cursor's per-script failClosed. */
  readonly failClosed?: boolean | undefined
  /** Workspace root for absolute paths and cwd containment (else payload cwd). */
  readonly workspaceRoot?: string | undefined
  readonly platform?: NodeJS.Platform | undefined
  /** Kiro file triggers: the path regex applied before the hook runs. */
  readonly pathPattern?: string | undefined
  /** Parse only: the Muse payload this answer belongs to (status, tool_name). */
  readonly input?: Readonly<Record<string, unknown>> | undefined
}
