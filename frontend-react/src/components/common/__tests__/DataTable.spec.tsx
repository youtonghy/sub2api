import { act, fireEvent, render } from '@testing-library/react'
import { createRef } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import DataTable, { type DataTableHandle, type DataTableProps } from '../DataTable'

vi.mock('@/i18n/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => key, te: () => true, locale: 'en' }),
}))

const stubMatchMedia = (matches: boolean) => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn()
    }))
  })
}
const stubDesktopMatchMedia = () => stubMatchMedia(true)
const stubMobileMatchMedia = () => stubMatchMedia(false)

function renderTable(props: DataTableProps) {
  const ref = createRef<DataTableHandle>()
  const view = render(<DataTable ref={ref} {...props} />)
  return {
    ...view,
    ref,
    setProps: (next: Partial<DataTableProps>) => view.rerender(<DataTable ref={ref} {...props} {...next} />)
  }
}

describe('DataTable', () => {
  beforeEach(() => {
    stubDesktopMatchMedia()
    localStorage.clear()
  })

  it('renders paired sort arrows and highlights the active direction', () => {
    const { container } = renderTable({
      columns: [
        { key: 'name', label: 'Name', sortable: true },
        { key: 'created_at', label: 'Created', sortable: true }
      ],
      data: [
        { id: 1, name: 'Beta', created_at: '2026-01-02T00:00:00Z' },
        { id: 2, name: 'Alpha', created_at: '2026-01-01T00:00:00Z' }
      ],
      defaultSortKey: 'name',
      defaultSortOrder: 'asc',
      headers: {
        name: () => <span data-test="custom-name-header">Name</span>
      }
    })

    const nameHeader = container.querySelectorAll('th')[0]
    expect(nameHeader.querySelector('[data-test="custom-name-header"]')).not.toBeNull()
    expect(nameHeader).toHaveAttribute('aria-sort', 'ascending')
    const arrows = () => nameHeader.querySelectorAll('svg')
    expect(arrows()).toHaveLength(2)
    expect(arrows()[0]).toHaveAttribute('data-active')
    expect(arrows()[1]).not.toHaveAttribute('data-active')

    fireEvent.click(nameHeader)

    expect(nameHeader).toHaveAttribute('aria-sort', 'descending')
    expect(arrows()[0]).not.toHaveAttribute('data-active')
    expect(arrows()[1]).toHaveAttribute('data-active')
  })

  it('renders every row with no virtual padding spacer for small datasets (virtualization off)', () => {
    const data = Array.from({ length: 8 }, (_, i) => ({ id: i + 1, name: `Row ${i + 1}` }))
    const { container, ref } = renderTable({ columns: [{ key: 'name', label: 'Name' }], data })

    // Virtualization is OFF for a small list…
    expect(ref.current?.shouldVirtualize).toBe(false)
    // …every row is in the DOM…
    expect(container.querySelectorAll('tbody tr[data-index]')).toHaveLength(data.length)
    // …and there are no aria-hidden virtual padding spacer rows.
    expect(container.querySelectorAll('tbody tr[aria-hidden="true"]')).toHaveLength(0)
  })

  it('switches to windowed rendering once row count exceeds virtualizeThreshold', () => {
    const data = Array.from({ length: 12 }, (_, i) => ({ id: i + 1, name: `Row ${i + 1}` }))
    const { ref } = renderTable({ columns: [{ key: 'name', label: 'Name' }], data, virtualizeThreshold: 3 })

    // Virtualization is ON: the mode-switch decision flipped…
    expect(ref.current?.shouldVirtualize).toBe(true)
    // …and the virtualizer drives off the full row count.
    expect(ref.current?.virtualizer.options.count).toBe(data.length)
  })

  it('keys the virtualizer size cache by row identity, not index (avoids stale heights on sort/filter)', () => {
    const data = Array.from({ length: 12 }, (_, i) => ({ id: 100 + i, name: `Row ${i + 1}` }))
    const { ref } = renderTable({
      columns: [{ key: 'name', label: 'Name' }],
      data,
      rowKey: 'id',
      virtualizeThreshold: 3
    })

    const instance = ref.current!.virtualizer
    // getItemKey must resolve to the row's stable key (id), not the positional index.
    expect(instance.options.getItemKey(0)).toBe(100)
    expect(instance.options.getItemKey(5)).toBe(105)
  })

  it('clears stale row and element caches when pagination replaces the row ID set', () => {
    const firstPage = Array.from({ length: 100 }, (_, i) => ({ id: i + 1, name: `First ${i + 1}` }))
    const secondPage = Array.from({ length: 100 }, (_, i) => ({ id: i + 101, name: `Second ${i + 1}` }))
    const { ref, setProps } = renderTable({
      columns: [{ key: 'name', label: 'Name' }],
      data: firstPage,
      rowKey: 'id',
      virtualizeThreshold: 1
    })

    const instance = ref.current!.virtualizer as any
    const firstPageIDs = firstPage.map((row) => row.id)
    instance.itemSizeCache = new Map(firstPageIDs.map((id) => [id, 156]))
    instance.elementsCache.clear()
    for (const id of firstPageIDs) {
      instance.elementsCache.set(id, document.createElement('tr'))
    }
    const measureElementSpy = vi.spyOn(instance, 'measureElement')

    act(() => setProps({ data: secondPage }))

    const sizeCache = instance.itemSizeCache as Map<number, number>
    expect(sizeCache.size).toBeLessThanOrEqual(secondPage.length)
    expect(instance.elementsCache.size).toBeLessThanOrEqual(secondPage.length)
    expect(firstPageIDs.some((id) => sizeCache.has(id))).toBe(false)
    expect(firstPageIDs.some((id) => instance.elementsCache.has(id))).toBe(false)
    expect(measureElementSpy.mock.calls.some(([node]) => node === null)).toBe(true)
  })

  it('clears stale caches when equal-length pages replace rows without stable keys', () => {
    const firstPage = Array.from({ length: 12 }, (_, i) => ({ name: `First ${i + 1}` }))
    const secondPage = Array.from({ length: 12 }, (_, i) => ({ name: `Second ${i + 1}` }))
    const { ref, setProps } = renderTable({
      columns: [{ key: 'name', label: 'Name' }],
      data: firstPage,
      virtualizeThreshold: 1
    })

    const measureElementSpy = vi.spyOn(ref.current!.virtualizer, 'measureElement')

    act(() => setProps({ data: secondPage }))

    expect(measureElementSpy.mock.calls.some(([node]) => node === null)).toBe(true)
  })

  it('conservatively clears caches when duplicate row-key multiplicity changes', () => {
    const firstPage = [
      { id: 1, name: 'First A' },
      { id: 1, name: 'First B' },
      { id: 2, name: 'First C' }
    ]
    const secondPage = [
      { id: 1, name: 'Second A' },
      { id: 2, name: 'Second B' },
      { id: 2, name: 'Second C' }
    ]
    // 重复行键会触发 React 的重复 key 警告，这里正是在验证该边界情况
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { ref, setProps } = renderTable({
      columns: [{ key: 'name', label: 'Name' }],
      data: firstPage,
      rowKey: 'id',
      virtualizeThreshold: 1
    })

    const measureElementSpy = vi.spyOn(ref.current!.virtualizer, 'measureElement')

    act(() => setProps({ data: secondPage }))

    expect(measureElementSpy.mock.calls.some(([node]) => node === null)).toBe(true)
    consoleError.mockRestore()
  })

  it('preserves cache when rows without stable keys only reorder the same objects', () => {
    const data = Array.from({ length: 12 }, (_, i) => ({ name: `Row ${i + 1}` }))
    const { ref, setProps } = renderTable({
      columns: [{ key: 'name', label: 'Name' }],
      data,
      virtualizeThreshold: 1
    })

    const measureSpy = vi.spyOn(ref.current!.virtualizer, 'measure')

    act(() => setProps({ data: [...data].reverse() }))

    expect(measureSpy).not.toHaveBeenCalled()
  })

  it('preserves stable row height cache when the same row IDs are only reordered', () => {
    const data = Array.from({ length: 100 }, (_, i) => ({ id: i + 1, name: `Row ${i + 1}` }))
    const { ref, setProps } = renderTable({
      columns: [{ key: 'name', label: 'Name' }],
      data,
      rowKey: 'id',
      virtualizeThreshold: 1
    })

    const instance = ref.current!.virtualizer as any
    instance.itemSizeCache = new Map(data.map((row) => [row.id, 156]))
    const measureSpy = vi.spyOn(instance, 'measure')

    act(() => setProps({ data: [...data].reverse() }))

    const sizeCache = instance.itemSizeCache as Map<number, number>
    expect(measureSpy).not.toHaveBeenCalled()
    expect(sizeCache.size).toBe(100)
  })

  it('emits controlled current-page selection while preserving off-page keys', () => {
    const onSelectedKeysChange = vi.fn()
    const { container, setProps } = renderTable({
      columns: [{ key: 'name', label: 'Name' }],
      data: [
        { id: 1, name: 'One' },
        { id: 2, name: 'Two' }
      ],
      rowKey: 'id',
      selectable: true,
      selectedKeys: [99],
      onSelectedKeysChange
    })

    fireEvent.click(container.querySelector('[data-test="select-all"]')!)

    const selectedAll = onSelectedKeysChange.mock.calls.at(-1)?.[0]
    expect(selectedAll).toEqual([99, 1, 2])

    setProps({ selectedKeys: selectedAll })
    const rowCheckboxes = [...container.querySelectorAll('[data-test="select-row"]')]
    expect(rowCheckboxes.every((checkbox) => checkbox.getAttribute('aria-checked') === 'true')).toBe(true)

    fireEvent.click(rowCheckboxes[0])

    expect(onSelectedKeysChange.mock.calls.at(-1)?.[0]).toEqual([99, 2])
  })

  it('keeps the single usage field shrinkable in a 320px mobile card', () => {
    stubMobileMatchMedia()
    const viewport = document.createElement('div')
    viewport.style.width = '320px'
    document.body.appendChild(viewport)
    const view = render(
      <DataTable
        columns={[{ key: 'usage', label: 'Usage' }]}
        data={[{ id: 1, usage: 'snapshot' }]}
        rowKey="id"
        cells={{ usage: () => <div data-test="usage-cell">snapshot</div> }}
      />,
      { container: viewport }
    )

    expect(viewport.style.width).toBe('320px')
    expect(viewport.querySelectorAll('[data-field="usage"]')).toHaveLength(1)
    expect(viewport.querySelector('[data-field="ollama_cloud_usage"]')).toBeNull()
    // 卡片字段与取值容器使用可收缩样式（min-width: 0 / max-width: 100%，见 DataTable.module.css 的 .cardField / .cardValue）
    const field = viewport.querySelector('[data-field="usage"]')!
    expect(field.className).toMatch(/cardField/)
    expect(field.querySelector('div')!.className).toMatch(/cardValue/)
    expect(viewport.querySelectorAll('[data-test="usage-cell"]')).toHaveLength(1)

    view.unmount()
    viewport.remove()
  })

  it('offers current-page select all in the mobile card layout', () => {
    stubMobileMatchMedia()
    const onSelectedKeysChange = vi.fn()
    const { container } = renderTable({
      columns: [{ key: 'name', label: 'Name' }],
      data: [
        { id: 1, name: 'One' },
        { id: 2, name: 'Two' }
      ],
      rowKey: 'id',
      selectable: true,
      selectedKeys: [99],
      onSelectedKeysChange
    })

    fireEvent.click(container.querySelector('[data-test="select-all-mobile"]')!)

    expect(onSelectedKeysChange.mock.calls.at(-1)?.[0]).toEqual([99, 1, 2])
  })
})
