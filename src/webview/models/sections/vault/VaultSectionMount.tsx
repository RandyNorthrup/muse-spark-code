// The vault section's mount in the Models & Agents panel (C-M109-1 P1):
// a thin SectionProps adapter over the shared VaultSurface. The surface
// loads lazily, so the panel body keeps its budget and nothing vault-shaped
// enters the static graph (vaultPanelBuild.test.ts pins that); the mount
// itself carries no strings and no styles of its own. The raw envelope is
// validated where it is used, inside the surface.
import { lazy, Suspense, useEffect } from 'react'
import { UI_TEXT } from '../../../../shared/constants'
import type { SectionProps } from '../../sections'

const VaultSurface = lazy(async () => {
  const module = await import('./VaultSurface')
  return { default: module.VaultSurface }
})

/** The mounted vault section: the shared surface over the host's state. */
export function VaultSectionMount({ vaultRaw, vaultPost, navigate }: SectionProps) {
  // Ask for the host's snapshot on mount; the host answers with the
  // vault state this surface renders. `vaultPost` is stable per panel.
  useEffect(() => {
    vaultPost?.({ type: 'vaultReady' })
  }, [vaultPost])
  if (vaultPost === undefined || vaultRaw === undefined) {
    return (
      <p className="models-hint" role="status">
        {UI_TEXT.connecting}
      </p>
    )
  }
  const raw = vaultRaw
  const post = vaultPost
  return (
    <Suspense
      fallback={
        <p className="models-hint" role="status">
          {UI_TEXT.loadingOutput}
        </p>
      }
    >
      <VaultSurface
        raw={raw}
        post={post}
        onManage={() => {
          navigate('vault')
        }}
      />
    </Suspense>
  )
}
