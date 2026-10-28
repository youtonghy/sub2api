import { act, fireEvent, render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import HelpTooltip from '../HelpTooltip'

function getTooltipElement(): HTMLDivElement {
  const tooltip = document.body.querySelector('[role="tooltip"]')
  if (!(tooltip instanceof HTMLDivElement)) {
    throw new Error('tooltip element not found')
  }
  return tooltip
}

function getTrigger(container: HTMLElement): HTMLElement {
  const trigger = container.querySelector('[data-trigger]')
  if (!(trigger instanceof HTMLElement)) throw new Error('trigger not found')
  return trigger
}

describe('HelpTooltip', () => {
  it('keeps the existing hover interaction by default', () => {
    const { container } = render(<HelpTooltip content="hover details" />)

    const trigger = getTrigger(container)
    const tooltip = getTooltipElement()

    expect(tooltip.style.display).toBe('none')

    fireEvent.mouseEnter(trigger)
    expect(tooltip.style.display).not.toBe('none')

    fireEvent.mouseLeave(trigger)
    expect(tooltip.style.display).toBe('none')
  })

  it('keeps a hover tooltip open while the pointer moves between the trigger and the tooltip', () => {
    const { container } = render(<HelpTooltip content="copyable details" />)

    const trigger = getTrigger(container)
    const tooltip = getTooltipElement()

    fireEvent.mouseEnter(trigger)
    expect(tooltip.style.display).not.toBe('none')

    fireEvent.mouseLeave(trigger, { relatedTarget: tooltip })
    expect(tooltip.style.display).not.toBe('none')

    fireEvent.mouseLeave(tooltip, { relatedTarget: trigger })
    expect(tooltip.style.display).not.toBe('none')

    fireEvent.mouseLeave(tooltip, { relatedTarget: null })
    expect(tooltip.style.display).toBe('none')
  })

  it('supports click-to-toggle details and closes on outside click', () => {
    const { container } = render(<HelpTooltip content="click details" trigger="click" />)

    const trigger = getTrigger(container)
    const tooltip = getTooltipElement()

    expect(tooltip.style.display).toBe('none')

    fireEvent.click(trigger)
    expect(tooltip.style.display).not.toBe('none')
    expect(tooltip.textContent).toContain('click details')

    const closeButton = tooltip.querySelector('button[aria-label="Close"]')
    if (!(closeButton instanceof HTMLButtonElement)) {
      throw new Error('close button not found')
    }
    act(() => closeButton.click())
    expect(tooltip.style.display).toBe('none')

    fireEvent.click(trigger)
    expect(tooltip.style.display).not.toBe('none')

    act(() => {
      document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(tooltip.style.display).toBe('none')
  })
})
