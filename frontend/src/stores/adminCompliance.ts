import { create } from 'zustand'
import adminComplianceAPI, { type AdminComplianceStatus } from '@/api/admin/compliance'
import { getLocale, subscribeI18n } from '@/i18n'

const FALLBACK_ZH_PHRASE = '我已阅读、理解并同意 Sub2API 部署与运营合规承诺'
const FALLBACK_EN_PHRASE = 'I have read, understood, and agree to the Sub2API Deployment and Operation Compliance Commitment'

interface AdminComplianceFields {
  status: AdminComplianceStatus | null
  loading: boolean
  submitting: boolean
  initialized: boolean
  forceVisible: boolean
}

export interface AdminComplianceState extends AdminComplianceFields {
  // Derived
  required: boolean
  shouldShow: boolean
  expectedPhrase: string

  // Actions
  fetchStatus: () => Promise<AdminComplianceStatus>
  accept: (phrase: string) => Promise<AdminComplianceStatus>
  requireAcknowledgement: (partialStatus?: Partial<AdminComplianceStatus>) => void
  reset: () => void
}

function computeExpectedPhrase(status: AdminComplianceStatus | null): string {
  if (getLocale() === 'zh') {
    return status?.ack_phrase_zh || FALLBACK_ZH_PHRASE
  }
  return status?.ack_phrase_en || FALLBACK_EN_PHRASE
}

export const useAdminComplianceStore = create<AdminComplianceState>()((set, get) => {
  let stateVersion = 0

  /**
   * Apply state changes and keep derived fields (Vue computed) in sync
   */
  function update(patch: Partial<AdminComplianceFields>): void {
    set((state) => {
      const next = { ...state, ...patch }
      const required = next.status?.required === true
      return {
        ...patch,
        required,
        shouldShow: required || next.forceVisible,
        expectedPhrase: computeExpectedPhrase(next.status)
      }
    })
  }

  // expectedPhrase also depends on the current locale
  subscribeI18n(() => {
    const expectedPhrase = computeExpectedPhrase(get().status)
    if (expectedPhrase !== get().expectedPhrase) {
      set({ expectedPhrase })
    }
  })

  async function fetchStatus(): Promise<AdminComplianceStatus> {
    const version = stateVersion
    update({ loading: true })
    try {
      const nextStatus = await adminComplianceAPI.getStatus()
      if (version !== stateVersion) return nextStatus
      update({ status: nextStatus, initialized: true, forceVisible: nextStatus.required })
      return nextStatus
    } finally {
      if (version === stateVersion) update({ loading: false })
    }
  }

  async function accept(phrase: string): Promise<AdminComplianceStatus> {
    const version = stateVersion
    update({ submitting: true })
    try {
      const nextStatus = await adminComplianceAPI.accept({
        phrase,
        language: getLocale()
      })
      if (version !== stateVersion) return nextStatus
      update({ status: nextStatus, forceVisible: nextStatus.required })
      return nextStatus
    } finally {
      if (version === stateVersion) update({ submitting: false })
    }
  }

  function requireAcknowledgement(partialStatus?: Partial<AdminComplianceStatus>): void {
    const status = get().status
    update({
      status: {
        required: true,
        version: partialStatus?.version || status?.version || 'v2026.06.10',
        document_path_zh: partialStatus?.document_path_zh || status?.document_path_zh || 'docs/legal/admin-compliance.zh.md',
        document_path_en: partialStatus?.document_path_en || status?.document_path_en || 'docs/legal/admin-compliance.en.md',
        document_url_zh: partialStatus?.document_url_zh || status?.document_url_zh || 'https://github.com/Wei-Shaw/sub2api/blob/main/docs/legal/admin-compliance.zh.md',
        document_url_en: partialStatus?.document_url_en || status?.document_url_en || 'https://github.com/Wei-Shaw/sub2api/blob/main/docs/legal/admin-compliance.en.md',
        ack_phrase_zh: partialStatus?.ack_phrase_zh || status?.ack_phrase_zh || FALLBACK_ZH_PHRASE,
        ack_phrase_en: partialStatus?.ack_phrase_en || status?.ack_phrase_en || FALLBACK_EN_PHRASE,
        acknowledgement: status?.acknowledgement
      },
      initialized: true,
      forceVisible: true
    })
  }

  function reset(): void {
    stateVersion++
    update({
      status: null,
      loading: false,
      submitting: false,
      initialized: false,
      forceVisible: false
    })
  }

  return {
    status: null,
    loading: false,
    submitting: false,
    initialized: false,
    forceVisible: false,
    required: false,
    shouldShow: false,
    expectedPhrase: computeExpectedPhrase(null),
    fetchStatus,
    accept,
    requireAcknowledgement,
    reset
  }
})
