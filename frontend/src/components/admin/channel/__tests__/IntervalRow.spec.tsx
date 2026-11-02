import { fireEvent, render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import IntervalRow from '../IntervalRow'
import type { IntervalFormEntry } from '../types'

const i18n = vi.hoisted(() => ({ t: (key: string) => key, te: () => true, locale: 'en' }))
vi.mock('@/i18n/useI18n', () => ({ useI18n: () => i18n }))

// React 的受控输入只在值真正变化时触发 onChange，因此起始值用 1（不与任何用例值相同），
// 保证 '' 用例也能产生更新；断言的解析结果与 Vue 版一致。
const interval: IntervalFormEntry = {
  min_tokens: 1, max_tokens: 1, tier_label: '', sort_order: 0,
  input_price: null, output_price: null, cache_write_price: null, cache_read_price: null,
  input_multiplier: null, output_multiplier: null, cache_write_multiplier: null,
  cache_read_multiplier: null, per_request_price: null
}

describe('pricing interval token bounds', () => {
  it.each([
    ['1e6', 1000000, 1000000],
    ['2.72e5', 272000, 272000],
    ['128000', 128000, 128000],
    ['', 0, null]
  ])('parses %s without losing the exponent', (value, min, max) => {
    const onUpdate = vi.fn()
    const { container } = render(<IntervalRow interval={interval} mode="token" onUpdate={onUpdate} />)
    const inputs = container.querySelectorAll('input[type="number"]')
    fireEvent.change(inputs[0], { target: { value } })
    fireEvent.change(inputs[1], { target: { value } })
    expect(onUpdate.mock.calls[0]?.[0]).toMatchObject({ min_tokens: min })
    expect(onUpdate.mock.calls[1]?.[0]).toMatchObject({ max_tokens: max })
  })
})
