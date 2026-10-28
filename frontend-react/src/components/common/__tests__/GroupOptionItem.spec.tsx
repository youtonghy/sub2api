import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import GroupOptionItem from '../GroupOptionItem'
import styles from '../GroupOptionItem.module.css'

vi.mock('@/i18n/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => key, te: () => true, locale: 'en' }),
}))

describe('GroupOptionItem description layout', () => {
  it('applies multiline and overflow-safe text styles', () => {
    const description = 'First section\nvery-long-unbroken-description-value-that-must-not-overflow'
    const { container } = render(<GroupOptionItem name="Example group" platform="openai" description={description} />)

    const descriptionElement = [...container.querySelectorAll('span')].find((element) => element.textContent === description)

    expect(descriptionElement).toBeDefined()
    // Vue 版断言 whitespace-pre-line / [overflow-wrap:anywhere] / line-clamp-3 三个工具类；
    // React 版这三项样式集中在 CSS Module 的 description 类里。
    expect(styles.description).toBeTruthy()
    expect(descriptionElement).toHaveClass(styles.description)
    expect(container.querySelector('[title]')?.getAttribute('title')).toBe(description)
    expect(screen.getByText('Example group')).toBeInTheDocument()
  })
})
