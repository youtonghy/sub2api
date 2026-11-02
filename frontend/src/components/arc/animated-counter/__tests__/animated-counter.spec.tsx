import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { AnimatedCounter } from '../animated-counter'

describe('AnimatedCounter', () => {
  it('renders a NaN value (missing data) without looping', () => {
    expect(() => render(<AnimatedCounter value={Number.NaN} />)).not.toThrow()
  })
})
