// @vitest-environment jsdom
import { act, waitFor } from '@testing-library/react'
import { expect, it } from 'vitest'
import { mountTrafficHarness } from '../harness/trafficHarness'

function notMounted(): never {
  throw new Error('harness was not mounted')
}

function assertScenario(scenario: string, root: HTMLElement): void {
  switch (scenario) {
    case 'team-traffic-320': {
      expect(document.body.style.width).toBe('320px')
      return
    }
    case 'team-traffic-hints': {
      expect(root.querySelector('[aria-selected="true"]')?.textContent).toBe('Other windows')
      return
    }
    case 'team-traffic-recovery': {
      expect(root.querySelector('[aria-selected="true"]')?.textContent).toBe('Recovery')
      return
    }
    case 'runners': {
      expect(root.querySelector('form')).not.toBeNull()
      return
    }
    default: {
      return
    }
  }
}

it('finishes each Traffic harness scenario on a rendered surface before axe may scan it', async () => {
  for (const scenario of [
    'team-traffic',
    'team-traffic-320',
    'team-traffic-hints',
    'team-traffic-recovery',
    'runners',
  ]) {
    const root = document.createElement('div')
    root.id = 'root'
    document.body.append(root)
    let dispose: () => void = notMounted
    act(() => {
      dispose = mountTrafficHarness(document, scenario)
    })
    await waitFor(() => {
      expect(document.body.dataset['trafficReady']).toBe(scenario)
    })
    expect(root.querySelector('.traffic-view')).not.toBeNull()
    assertScenario(scenario, root)
    act(() => {
      dispose()
    })
    root.remove()
    delete document.body.dataset['trafficReady']
    document.body.style.removeProperty('width')
    document.documentElement.style.removeProperty('width')
  }
})
