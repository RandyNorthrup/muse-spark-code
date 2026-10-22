// Types for the fault-rig library (M110r Y4), beside its implementation.
import type { FaultScenario } from '../../test/faults/scenario'

export declare const FAULT_EXIT: { pass: 0; fail: 1; refused: 2 }
export declare class FaultAssertion extends Error {}
export declare class FaultRefused extends Error {}
export declare function checkFact(condition: unknown, message: string): asserts condition
export interface RecordedFrame {
  event: string
  data: unknown
}
export declare function frameToSse(frame: RecordedFrame): string
export declare function loadRecordedStream(repoRoot: string): Promise<{
  bytes: Buffer
  frames: RecordedFrame[]
}>
export declare function serveAndCut(
  bytes: Buffer,
  cutAt: number,
): Promise<{ port: number; close: () => Promise<void> }>
export declare function readSocketChunks(port: number): AsyncIterable<Uint8Array>
export declare function probeNamespaces(): Promise<
  { ok: true; sudo: string[] } | { ok: false; reason: string }
>
export declare function namespaceIp(sudo: string[], args: string[]): Promise<string>
export declare function loadScenario(repoRoot: string, name: string): Promise<FaultScenario>
