// Types for scripts/lib/osBootTest.mjs, which os-boot-test and its unit
// test import.
export declare function isKvmAvailable(): boolean
export type ComposeQemuResult =
  | {
      readonly ok: true
      readonly program: string
      readonly args: string[]
      readonly accel: 'kvm' | 'tcg'
    }
  | { readonly ok: false; readonly errors: string[] }
export declare function composeQemu(options: unknown): ComposeQemuResult
export interface TranscriptScan {
  readonly found: boolean
  readonly panic: string | null
}
export declare function scanTranscript(text: string, marker: string): TranscriptScan
export interface RunBootOptions {
  readonly program: string
  readonly args: readonly string[]
  readonly accel: 'kvm' | 'tcg'
  readonly marker: string
  readonly timeoutSec: number
  readonly outDir: string
}
export interface BootVerdict {
  readonly ok: boolean
  readonly reason: string
  readonly accel: 'kvm' | 'tcg'
  readonly bootMs: number
  readonly transcript: string
}
export declare function runBoot(options: RunBootOptions): Promise<BootVerdict>
