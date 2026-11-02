import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import UserAttributesConfigModal from '../UserAttributesConfigModal'

const mocks = vi.hoisted(() => ({ listDefinitions: vi.fn(), updateDefinition: vi.fn(), createDefinition: vi.fn() }))
vi.mock('@/api/admin', () => ({ adminAPI: { userAttributes: mocks } }))
vi.mock('@/stores/app', () => ({ useAppStore: { getState: () => ({ showSuccess: vi.fn(), showError: vi.fn() }) } }))
const i18n = vi.hoisted(() => ({ t: (key: string) => key, te: () => true, locale: 'en' }))
vi.mock('@/i18n/useI18n', () => ({ useI18n: () => i18n }))

const flushPromises = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)))

beforeEach(() => {
  vi.clearAllMocks()
  mocks.listDefinitions.mockResolvedValue([{ id: 1, key: 'note', name: 'Note', type: 'text', description: 'Old description', placeholder: 'Old placeholder', required: false, enabled: true }])
  mocks.updateDefinition.mockResolvedValue(undefined)
  mocks.createDefinition.mockResolvedValue(undefined)
})

async function openConfig() {
  const view = render(<UserAttributesConfigModal show={false} />)
  view.rerender(<UserAttributesConfigModal show />)
  await flushPromises()
  return view
}

const byPlaceholder = (placeholder: string) =>
  document.body.querySelector(`input[placeholder="${placeholder}"]`) as HTMLInputElement
const submitForm = () => fireEvent.submit(document.getElementById('attribute-form')!)

describe('UserAttributesConfigModal optional text fields', () => {
  it.each([
    ['', 'Old placeholder'],
    ['Old description', ''],
    ['', ''],
    ['New description', 'New placeholder']
  ])('persists description %j and placeholder %j explicitly', async (description, placeholder) => {
    await openConfig()
    fireEvent.click(document.body.querySelector('button[title="common.edit"]')!)
    fireEvent.change(byPlaceholder('admin.users.attributes.fieldDescriptionHint'), { target: { value: description } })
    fireEvent.change(byPlaceholder('admin.users.attributes.placeholderHint'), { target: { value: placeholder } })
    submitForm()
    await flushPromises()
    expect(mocks.updateDefinition).toHaveBeenCalledTimes(1)
    const [id, data] = mocks.updateDefinition.mock.calls[0]!
    expect(id).toBe(1)
    expect(JSON.parse(JSON.stringify(data))).toEqual({ key: 'note', name: 'Note', type: 'text', description, placeholder, required: false, enabled: true })
  })

  it('still creates an attribute without optional text', async () => {
    await openConfig()
    fireEvent.click(screen.getByRole('button', { name: 'admin.users.attributes.addAttribute' }))
    fireEvent.change(byPlaceholder('admin.users.attributes.keyHint'), { target: { value: 'note' } })
    fireEvent.change(byPlaceholder('admin.users.attributes.nameHint'), { target: { value: 'Note' } })
    submitForm()
    await flushPromises()
    expect(mocks.createDefinition).toHaveBeenCalledWith(expect.objectContaining({ key: 'note', name: 'Note', type: 'text' }))
    expect(mocks.updateDefinition).not.toHaveBeenCalled()
  })
})
