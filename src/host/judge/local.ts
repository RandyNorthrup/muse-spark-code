import { UI_TEXT } from '../../shared/l10n/text'
import { homedir } from 'node:os'
import { MUSE_INSTALL_TIMEOUT_MS, LOCAL_JUDGE_MAX_RESPONSE_BYTES } from '../../shared/constants'
import { executeGuarded } from '../../core/judge/local/guardedExec'
import { darwinPeerDependencies } from '../../core/judge/local/darwinPeer'
import { requireLocalExecutable } from '../../core/judge/local/executable'
import type { LocalModelPullAction } from '../../core/judge/local/recommendations'
import type { JudgeRuntime } from '../../core/judge/engine'
import {
  createLocalJudgeSource,
  type LocalJudgeConfiguration,
  type LocalJudgeDependencies,
} from '../../core/judge/local/source'
import {
  requireInstalledPeer,
  windowsModelDirectory,
  windowsPeer,
} from '../../core/judge/local/windowsPeer'
import {
  posixPeer,
  type PosixPeerDependencies,
  type PosixPeerInstallation,
} from '../../core/judge/local/posixPeer'
import { createLinuxPeerDependencies } from '../../core/judge/local/linuxPeer'

export interface LocalJudgeHostDependencies extends Omit<LocalJudgeDependencies, 'verifyPeer'> {
  /** Host posture from the existing network/remote-host policy. Unknown refuses proof. */
  nativeScope(): 'native' | 'remote' | 'container' | 'wsl' | 'unknown'
  /** Trusted packaged helper, compiled by assembly; missing helper is an error. */
  peerHelper(platform: NodeJS.Platform): Promise<string>
  /** Vetted install/signature record, never a hash learned from an answering peer. */
  runtimeInstallation():
    { executable: string; ownerSid: string; executableDigest: string } | undefined
  posixRuntimeInstallation?(): PosixPeerInstallation | undefined
  /** Required native lifecycle and volume proof. Missing means unverified. */
  posixLifecycle?: PosixPeerDependencies
}

/** Called lazily by assembly only after a user turns on a local judge option. */
export function createHostLocalJudge(deps: LocalJudgeHostDependencies): JudgeRuntime {
  return createLocalJudgeSource({
    ...deps,
    async verifyPeer(socket, config, signal) {
      if (deps.nativeScope() !== 'native') throw new Error('unverified-host-scope')
      const installation = config.installation
      if (
        !installation?.certificationId ||
        installation.platform !== process.platform ||
        !installation.nativeHost
      )
        throw new Error('unverified-platform')
      signal.throwIfAborted()
      if (process.platform !== 'win32') {
        const installed = deps.posixRuntimeInstallation?.()
        if (installed?.modelDirectory !== installation.modelDirectory)
          throw new Error('unverified-platform')
        let lifecycle = deps.posixLifecycle
        if (lifecycle === undefined) {
          if (process.platform === 'linux') {
            lifecycle = createLinuxPeerDependencies(await deps.peerHelper('linux'))
          } else if (process.platform === 'darwin') {
            lifecycle = darwinPeerDependencies(await deps.peerHelper('darwin'), installed)
          }
        }
        if (!lifecycle) throw new Error('unverified-platform')
        return await posixPeer(socket, installed, lifecycle, signal)
      }
      const helper = await deps.peerHelper(process.platform)
      const installed = deps.runtimeInstallation()
      if (!installed) throw new Error('unverified-runtime')
      await windowsModelDirectory(helper, installation.modelDirectory, signal)
      const peer = await windowsPeer(helper, socket, signal)
      requireInstalledPeer(peer, installed)
      return JSON.stringify(peer)
    },
  })
}

/** Every configured outcome-(b) status uses P0's translated, explicit label. */
export function localJudgeStatus(config: LocalJudgeConfiguration): {
  label: string
  model: string
  trust: 'verified' | 'unverified'
} {
  return {
    label:
      config.trust === 'unverified' ? UI_TEXT.judgeLocalUnverified : UI_TEXT.judgeSourceSeparate,
    model: config.model,
    trust: config.trust,
  }
}

export interface HostLocalPullDependencies {
  isExplicitUserAction(): boolean
  nativeScope(): 'native' | 'remote' | 'container' | 'wsl' | 'unknown'
  installation(): { executable: string; executableDigest: string } | undefined
  consent(model: string, downloadBytes: number): Promise<boolean>
  /** Optional subprocess seam, defaulting to the guarded run with no shell. */
  run?: (
    file: string,
    args: string[],
    options: {
      windowsHide: boolean
      timeout: number
      maxBuffer: number
      signal: AbortSignal
      env: NodeJS.ProcessEnv
    },
  ) => Promise<unknown>
}

/** Explicit UI/CLI action only. The source never invokes this download action. */
export function hostLocalModelPullAction(deps: HostLocalPullDependencies): LocalModelPullAction {
  return {
    get explicitUserAction() {
      return deps.isExplicitUserAction()
    },
    consent: (model, bytes) => deps.consent(model, bytes),
    async pull(model, signal) {
      if (!deps.isExplicitUserAction() || deps.nativeScope() !== 'native')
        throw new Error('explicit-local-action-required')
      const installed = deps.installation()
      if (!installed) throw new Error('unverified-runtime')
      const initial = JSON.stringify(installed)
      await requireLocalExecutable(installed.executable, installed.executableDigest, signal)
      if (
        !deps.isExplicitUserAction() ||
        deps.nativeScope() !== 'native' ||
        JSON.stringify(deps.installation()) !== initial
      )
        throw new Error('explicit-local-action-required')
      try {
        await (deps.run ?? executeGuarded)(installed.executable, ['pull', model], {
          windowsHide: true,
          timeout: MUSE_INSTALL_TIMEOUT_MS,
          maxBuffer: LOCAL_JUDGE_MAX_RESPONSE_BYTES,
          signal,
          // No API credentials, proxies or user-chosen Ollama remote host.
          env: {
            SystemRoot: process.env['SystemRoot'],
            HOME: homedir(),
            USERPROFILE: homedir(),
            OLLAMA_HOST: '127.0.0.1:11434',
          },
        })
      } catch (error: unknown) {
        throw new Error('local-pull-failed', { cause: error })
      }
    },
  }
}
