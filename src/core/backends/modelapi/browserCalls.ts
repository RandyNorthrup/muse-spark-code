// What a browser check (M81, PLAN.md D49) hands the Model API backend: the
// model's English text with what the page produced between markers, the
// row's lines in the display language, and the screenshot as an image the
// model sees in a user message after the round, as `read_file`'s images go
// (D47: Meta reads images only in user messages).

import { Buffer } from 'node:buffer'
import { randomBytes } from 'node:crypto'
import {
  BROWSER_CHECK_MARKER_BYTES,
  MAX_IMAGE_BYTES,
  MODEL_API_MODEL_TEXT,
  PNG_MEDIA_TYPE,
  TOOL_OUTPUT_MAX_CHARS,
  UI_TEXT,
} from '../../../shared/constants'
import { fill } from '../../../shared/l10n/text'
import type { BrowserCheckResult } from '../../browser/browserRun'
import {
  type BrowserRefusal,
  browserRefusal,
  browserReportFullText,
  browserReportRow,
  browserReportText,
} from '../../browser/browserTool'
import { codePointBoundary, type ToolOutcome, retainNote, type ShellRetain } from './tools'

/** A check that did not happen or did not finish: the model's reason, the row's in the user's language. */
export function browserCheckRefused(refusal: BrowserRefusal): ToolOutcome {
  return {
    output: `Error: ${refusal.model}`,
    visibleOutput: refusal.user,
    failureReason: refusal.user,
  }
}

/** The check refused in Restricted Mode. */
export function browserCheckRestricted(): ToolOutcome {
  return browserCheckRefused({
    model: MODEL_API_MODEL_TEXT.browserCheckRestrictedMode,
    user: UI_TEXT.browserCheckRestrictedMode,
  })
}

/**
 * What the model and the row receive for a check of `url`. A clipped report
 * stays reachable through `recall_output` where `retain` keeps one (B3).
 */
export function browserCheckOutcome(
  url: string,
  result: BrowserCheckResult,
  retain?: ShellRetain,
): ToolOutcome {
  if (!result.ok) {
    return browserCheckRefused(browserRefusal(result.failure))
  }
  // The image limit is the model's: a screenshot past it is left out.
  const report =
    result.report.screenshot !== undefined && result.report.screenshot.png.length > MAX_IMAGE_BYTES
      ? { ...result.report, screenshot: undefined }
      : result.report
  const marker = randomBytes(BROWSER_CHECK_MARKER_BYTES).toString('hex')
  const full = browserReportFullText(url, report, marker)
  const output = browserReportText(url, report, marker)
  const id = full.length > TOOL_OUTPUT_MAX_CHARS ? retain?.keep(full, retain.tool) : undefined
  const kept =
    id === undefined
      ? output
      : `${output}\n${retainNote(id, codePointBoundary(full, TOOL_OUTPUT_MAX_CHARS))}`
  const visibleOutput = browserReportRow(url, report)
  const { screenshot } = report
  if (screenshot === undefined) {
    return { output: kept, visibleOutput }
  }
  return {
    output: kept,
    visibleOutput,
    visibleFile: {
      lead: fill(MODEL_API_MODEL_TEXT.browserCheckScreenshotLead, { url }),
      notDelivered: fill(MODEL_API_MODEL_TEXT.browserCheckScreenshotLost, { url }),
      part: {
        type: 'image',
        base64Data: Buffer.from(screenshot.png).toString('base64'),
        mediaType: PNG_MEDIA_TYPE,
        width: screenshot.width,
        height: screenshot.height,
      },
    },
  }
}
