/** @vitest-environment jsdom */
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { UI_TEXT } from '../../src/shared/constants'
import { ServiceStatusRow } from '../../src/webview/components/ServiceStatusRow'

afterEach(cleanup)

describe('CATCHAUDIT ServiceStatusRow', () => {
  it('leaves the row unavailable for a failed read', async () => {
    render(
      <ServiceStatusRow
        read={() => Promise.reject(new Error('status-canary'))}
        onOpenExternal={() => {
          /* No external opener in this test. */
        }}
      />,
    )
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(UI_TEXT.modelApiStatusUnavailable)
    })
  })

  it('lets a non-error rejection reach the failure record instead of the row', async () => {
    const hostile: unknown = 'status-boom'
    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason)
    }
    process.on('unhandledRejection', onUnhandled)
    try {
      render(
        <ServiceStatusRow
          read={vi.fn().mockRejectedValue(hostile)}
          onOpenExternal={() => {
            /* No external opener in this test. */
          }}
        />,
      )
      await waitFor(() => {
        expect(unhandled).toContain(hostile)
      })
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
  })
})
