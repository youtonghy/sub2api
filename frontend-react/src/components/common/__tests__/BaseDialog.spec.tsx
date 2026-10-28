import { act, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import BaseDialog, { type BaseDialogProps } from '../BaseDialog'

afterEach(() => {
  document.body.classList.remove('modal-open')
})

function renderDialog(props: Partial<BaseDialogProps> & { title: string }) {
  const onClose = vi.fn()
  const allProps: BaseDialogProps = { show: true, onClose, ...props }
  const view = render(<BaseDialog {...allProps} />)
  return {
    onClose,
    view,
    setProps: (next: Partial<BaseDialogProps>) => view.rerender(<BaseDialog {...allProps} {...next} />),
  }
}

// 浏览器里的键盘事件可取消；Radix 依据 defaultPrevented 判断上层对话框是否拦截了 Escape
const pressEscape = () =>
  act(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
  })

// 关闭的对话框会先播放退出动画再卸载，等它离开 DOM
const waitForDialogCount = (count: number) =>
  waitFor(() => expect(document.body.querySelectorAll('[role="dialog"]')).toHaveLength(count))

const locked = () => document.body.classList.contains('modal-open')

// BaseDialog.escape.spec.ts
describe('stacked dialog Escape handling', () => {
  it('closes only the most recently opened dialog, then allows the parent to close', async () => {
    const parent = renderDialog({ title: 'Parent' })
    const child = renderDialog({ title: 'Child' })
    pressEscape()
    expect(child.onClose).toHaveBeenCalledTimes(1)
    expect(parent.onClose).not.toHaveBeenCalled()
    child.setProps({ show: false })
    await waitForDialogCount(1)
    await act(async () => {})
    pressEscape()
    expect(parent.onClose).toHaveBeenCalledTimes(1)
  })

  it('does not dismiss a parent behind a child that disallows Escape', () => {
    const parent = renderDialog({ title: 'Parent' })
    const child = renderDialog({ title: 'Child', closeOnEscape: false })
    pressEscape()
    expect(child.onClose).not.toHaveBeenCalled()
    expect(parent.onClose).not.toHaveBeenCalled()
    child.view.unmount()
    pressEscape()
    expect(parent.onClose).toHaveBeenCalledTimes(1)
  })
})

// BaseDialog.ids.spec.ts
describe('dialog accessible titles', () => {
  it('associates simultaneous dialogs with their own title', () => {
    renderDialog({ title: 'Edit account' })
    renderDialog({ title: 'Confirm deletion' })
    const dialogs = Array.from(document.body.querySelectorAll('[role="dialog"]'))
    expect(dialogs).toHaveLength(2)
    const titles = dialogs.map((dialog) => document.getElementById(dialog.getAttribute('aria-labelledby')!)?.textContent)
    expect(titles).toEqual(['Edit account', 'Confirm deletion'])
  })

  it('keeps the title association stable when a dialog is reopened', async () => {
    const dialog = renderDialog({ title: 'Details' })
    const id = document.body.querySelector('[role="dialog"]')!.getAttribute('aria-labelledby')!
    dialog.setProps({ show: false })
    await waitForDialogCount(0)
    dialog.setProps({ show: true, title: 'Updated details' })
    expect(document.body.querySelector('[role="dialog"]')!.getAttribute('aria-labelledby')).toBe(id)
    expect(document.getElementById(id)?.textContent).toBe('Updated details')
  })
})

// BaseDialog.scrollLock.spec.ts
describe('dialog body scroll lock', () => {
  it('keeps the body locked when a hidden sibling mounts or unmounts', () => {
    renderDialog({ title: 'Details' })
    const hidden = renderDialog({ title: 'Details', show: false })
    expect(locked()).toBe(true)
    hidden.view.unmount()
    expect(locked()).toBe(true)
  })

  it('keeps the lock until the last visible dialog closes', () => {
    const first = renderDialog({ title: 'Details' })
    const second = renderDialog({ title: 'Details' })
    second.setProps({ show: false })
    expect(locked()).toBe(true)
    first.setProps({ show: false })
    expect(locked()).toBe(false)
  })

  it('keeps the lock until the last visible dialog unmounts', () => {
    const first = renderDialog({ title: 'Details' })
    const second = renderDialog({ title: 'Details' })
    second.view.unmount()
    expect(locked()).toBe(true)
    first.view.unmount()
    expect(locked()).toBe(false)
  })

  it('releases the lock after repeated open and close cycles', () => {
    const dialog = renderDialog({ title: 'Details', show: false })
    expect(locked()).toBe(false)
    dialog.setProps({ show: true })
    expect(locked()).toBe(true)
    dialog.setProps({ show: false })
    expect(locked()).toBe(false)
    dialog.setProps({ show: true })
    dialog.view.unmount()
    expect(locked()).toBe(false)
  })
})

// BaseDialog.spec.ts
describe('BaseDialog', () => {
  it('resets body scroll position when reopened', async () => {
    const dialog = renderDialog({
      title: 'Details',
      show: false,
      children: <div style={{ height: 2000 }}>content</div>,
    })

    dialog.setProps({ show: true })
    const body = document.body.querySelector<HTMLElement>('[data-dialog-body]')
    expect(body).not.toBeNull()
    body!.scrollTop = 480

    dialog.setProps({ show: false })
    dialog.setProps({ show: true })

    expect(document.body.querySelector<HTMLElement>('[data-dialog-body]')?.scrollTop).toBe(0)
  })
})
