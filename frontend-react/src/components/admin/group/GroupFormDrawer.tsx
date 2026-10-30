/**
 * 分组创建 / 编辑抽屉（Vue 版两个结构几乎相同的 BaseDialog 合并为一个），右侧宽抽屉 + 固定底部操作区。
 * 区块顺序与 Vue 版一致；编辑模式多出状态选择与固定账号 Codex Manifest（仅 openai 分组），订阅类型只读。
 */
import { AccountFormDrawer, FormSection } from '@/components/account/AccountFormLayout'
import { Button } from '@/components/arc/button/button'
import type { SelectOption } from '@/components/common/Select'
import { useI18n } from '@/i18n/useI18n'
import type { AdminGroup } from '@/types'
import CodexManifestAccountsField from './CodexManifestAccountsField'
import {
  GroupExplicitPricingSection,
  GroupModelPricingSection,
  GroupPeakRateSection,
  GroupProfitControlSection,
  GroupWebSearchPricingSection
} from './GroupBillingSections'
import { GroupIdentitySection, GroupLimitsSection, GroupSubscriptionSection, type GroupOption } from './GroupFormBasics'
import { GroupImagePricingSection, GroupVideoPricingSection } from './GroupMediaPricingSections'
import GroupModelAllowlistSection from './GroupModelAllowlistSection'
import GroupModelRoutingSection from './GroupModelRoutingSection'
import {
  GroupAccountFiltersSection,
  GroupClaudeCodeSection,
  GroupInvalidRequestFallbackSection,
  GroupLiveSection,
  GroupMcpXmlSection,
  GroupMessagesDispatchSection,
  GroupOpenAIFastSection,
  GroupSupportedScopesSection
} from './GroupPlatformSections'
import styles from './GroupFormDrawer.module.css'
import type { GroupFormController } from './useGroupForm'

export interface GroupFormDrawerProps {
  show: boolean
  ctl: GroupFormController
  /** 编辑中的分组；编辑模式下为 null 时不渲染表单 */
  editingGroup?: AdminGroup | null
  isSimpleMode: boolean
  submitting: boolean
  copyAccountsOptions: GroupOption[]
  fallbackGroupOptions: SelectOption[]
  invalidRequestFallbackOptions: SelectOption[]
  subscriptionTypeOptions: SelectOption[]
  statusOptions: SelectOption[]
  onToggleLive: () => void
  onSubmit: () => void
  onClose: () => void
}

export default function GroupFormDrawer({
  show,
  ctl,
  editingGroup,
  isSimpleMode,
  submitting,
  copyAccountsOptions,
  fallbackGroupOptions,
  invalidRequestFallbackOptions,
  subscriptionTypeOptions,
  statusOptions,
  onToggleLive,
  onSubmit,
  onClose
}: GroupFormDrawerProps) {
  const { t } = useI18n()
  const isEdit = ctl.mode === 'edit'
  const { bindCodex } = ctl
  const formId = isEdit ? 'edit-group-form' : 'create-group-form'
  const showForm = !isEdit || !!editingGroup

  return (
    <AccountFormDrawer
      show={show}
      title={isEdit ? t('admin.groups.editGroup') : t('admin.groups.createGroup')}
      width="wide"
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            type="submit"
            form={formId}
            variant="primary"
            disabled={submitting}
            loading={submitting}
            data-tour="group-form-submit"
          >
            {isEdit
              ? submitting
                ? t('admin.groups.updating')
                : t('common.update')
              : submitting
                ? t('admin.groups.creating')
                : t('common.create')}
          </Button>
        </>
      }
    >
      {showForm ? (
        <form
          id={formId}
          className={styles.form}
          onSubmit={(event) => {
            event.preventDefault()
            onSubmit()
          }}
        >
          <GroupIdentitySection ctl={ctl} isSimpleMode={isSimpleMode} copyAccountsOptions={copyAccountsOptions} />
          {!isSimpleMode ? (
            <>
              <GroupLimitsSection ctl={ctl} statusOptions={statusOptions} />
              <GroupSubscriptionSection ctl={ctl} subscriptionTypeOptions={subscriptionTypeOptions} />
              <GroupModelAllowlistSection ctl={ctl} />
              <GroupImagePricingSection ctl={ctl} />
              <GroupVideoPricingSection ctl={ctl} />
              <GroupPeakRateSection ctl={ctl} />
              <GroupProfitControlSection ctl={ctl} />
              <GroupSupportedScopesSection ctl={ctl} />
              <GroupMcpXmlSection ctl={ctl} />
              <GroupClaudeCodeSection ctl={ctl} fallbackOptions={fallbackGroupOptions} />
              <GroupWebSearchPricingSection ctl={ctl} />
              {/* 固定账号获取 Codex Model Manifest（仅 openai 平台，仅编辑表单） */}
              {isEdit && ctl.form.platform === 'openai' && editingGroup ? (
                <FormSection>
                  <CodexManifestAccountsField
                    ref={bindCodex}
                    groupId={editingGroup.id}
                    modelValue={ctl.codexManifest}
                    onModelValueChange={ctl.setCodexManifest}
                    accountNames={ctl.codexManifestAccountNames}
                  />
                </FormSection>
              ) : null}
              <GroupModelPricingSection ctl={ctl} />
              <GroupExplicitPricingSection ctl={ctl} />
              <GroupOpenAIFastSection ctl={ctl} />
              <GroupLiveSection ctl={ctl} onToggleLive={onToggleLive} />
              <GroupMessagesDispatchSection ctl={ctl} />
              <GroupAccountFiltersSection ctl={ctl} />
              <GroupInvalidRequestFallbackSection ctl={ctl} options={invalidRequestFallbackOptions} />
              <GroupModelRoutingSection ctl={ctl} />
            </>
          ) : null}
        </form>
      ) : null}
    </AccountFormDrawer>
  )
}
