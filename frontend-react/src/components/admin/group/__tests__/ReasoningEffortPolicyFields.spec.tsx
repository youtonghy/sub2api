import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import ReasoningEffortPolicyFields from '../ReasoningEffortPolicyFields'
import { createReasoningEffortMappingRow } from '@/views/admin/groupsReasoningEffort'

vi.mock('@/i18n/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => key, te: () => true, locale: 'en', setLocale: () => {} })
}))

// Vue 版用 global.stubs 替换 Select：渲染带 id 的容器，每个选项一个 data-value
vi.mock('@/components/common/Select', () => ({
  default: (props: { id?: string; options: Array<{ value: string }> }) => (
    <div id={props.id}>
      {props.options.map((option) => (
        <span key={option.value} data-value={option.value} />
      ))}
    </div>
  )
}))

afterEach(cleanup)

const noop = () => {}

describe('ReasoningEffortPolicyFields', () => {
  it('offers none only in the mapping source selector', () => {
    const mapping = createReasoningEffortMappingRow({ from: 'none', to: 'low' })
    const { container } = render(
      <ReasoningEffortPolicyFields
        idPrefix="edit-group-reasoning"
        platform="openai"
        maxEffort=""
        onMaxEffortChange={noop}
        overLimit="downgrade"
        onOverLimitChange={noop}
        mappings={[mapping]}
        onMappingsChange={noop}
      />
    )

    const optionValues = (id: string) =>
      Array.from(container.querySelector(`#${id}`)!.querySelectorAll('[data-value]')).map((option) =>
        option.getAttribute('data-value')
      )

    expect(optionValues('edit-group-reasoning-max-effort')).not.toContain('none')
    expect(optionValues('edit-group-reasoning-max-effort')).not.toContain('deny')
    expect(optionValues(`edit-group-reasoning-${mapping.pairs[0].id}-from`)).toContain('none')
    expect(optionValues(`edit-group-reasoning-${mapping.pairs[0].id}-from`)).not.toContain('deny')
    expect(optionValues(`edit-group-reasoning-${mapping.pairs[0].id}-to`)).not.toContain('none')
    expect(optionValues(`edit-group-reasoning-${mapping.pairs[0].id}-to`)).toContain('deny')
  })

  it('renders model scope fields for each mapping', () => {
    const mapping = createReasoningEffortMappingRow({ from: 'max', to: 'low', match_type: 'prefix', model: 'gpt' })
    const { container } = render(
      <ReasoningEffortPolicyFields
        idPrefix="create-group-reasoning"
        platform="openai"
        maxEffort=""
        onMaxEffortChange={noop}
        overLimit="downgrade"
        onOverLimitChange={noop}
        mappings={[mapping]}
        onMappingsChange={noop}
      />
    )

    expect(container.textContent).toContain('admin.groups.form.reasoningEffortMatchType')
    expect(container.textContent).toContain('admin.groups.form.reasoningEffortModel')
    expect(container.textContent).toContain('admin.groups.form.reasoningEffortFrom')
    expect(container.textContent).toContain('admin.groups.form.reasoningEffortTo')
    expect(container.textContent).toContain('admin.groups.form.addReasoningEffortPair')

    const modelInput = container.querySelector<HTMLInputElement>(`#create-group-reasoning-${mapping.id}-model`)!
    expect(modelInput).toMatchObject({
      value: 'gpt',
      placeholder: 'admin.groups.form.reasoningEffortModelPlaceholder'
    })
  })

  it('emits a new mapping group with one empty pair', () => {
    const onMappingsChange = vi.fn()
    const { container } = render(
      <ReasoningEffortPolicyFields
        idPrefix="edit-group-reasoning"
        platform="openai"
        maxEffort=""
        onMaxEffortChange={noop}
        overLimit="downgrade"
        onOverLimitChange={noop}
        mappings={[]}
        onMappingsChange={onMappingsChange}
      />
    )

    fireEvent.click(container.querySelector('button')!)

    expect(onMappingsChange).toHaveBeenCalledTimes(1)
    expect(onMappingsChange.mock.calls[0][0]).toEqual([
      expect.objectContaining({
        match_type: '',
        model: '',
        pairs: [expect.objectContaining({ from: '', to: '' })]
      })
    ])
  })
})
