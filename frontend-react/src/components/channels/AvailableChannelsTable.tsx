import { Clock, Globe, Inbox, Shield } from 'lucide-react'
import { Fragment } from 'react'

import type { UserAvailableChannel, UserAvailableGroup, UserChannelPlatformSection } from '@/api/channels'
import { platformTone } from '@/components/admin/channel/platformTone'
import GroupBadge from '@/components/common/GroupBadge'
import LoadingSpinner from '@/components/common/LoadingSpinner'
import PlatformIcon from '@/components/common/PlatformIcon'
import { useI18n } from '@/i18n/useI18n'
import { useAppStore } from '@/stores/app'
import type { GroupPlatform, SubscriptionType } from '@/types'
import { formatPeakRateWindow, hasPeakRate, serverTimezoneLabel } from '@/utils/peak-rate'
import SupportedModelChip from './SupportedModelChip'
import styles from './AvailableChannelsTable.module.css'

export interface AvailableChannelsTableColumns {
  name: string
  description: string
  platform: string
  groups: string
  supportedModels: string
}

export interface AvailableChannelsTableProps {
  columns: AvailableChannelsTableColumns
  rows: UserAvailableChannel[]
  loading: boolean
  pricingKeyPrefix: string
  noPricingLabel: string
  noModelsLabel: string
  emptyLabel: string
  /** 用户专属倍率（group_id → multiplier）；无专属时由 GroupBadge 仅显示默认倍率。 */
  userGroupRates: Record<number, number>
}

function exclusiveGroups(section: UserChannelPlatformSection): UserAvailableGroup[] {
  return section.groups.filter((g) => g.is_exclusive)
}

function publicGroups(section: UserChannelPlatformSection): UserAvailableGroup[] {
  return section.groups.filter((g) => !g.is_exclusive)
}

/**
 * 可用渠道表，对应 Vue 版 AvailableChannelsTable.vue。
 * 桌面端为五列表格（每个渠道一个 tbody，渠道名与描述 rowspan 合并）；移动端为按渠道分段的可读列表。
 */
export default function AvailableChannelsTable({
  columns,
  rows,
  loading,
  pricingKeyPrefix,
  noPricingLabel,
  noModelsLabel,
  emptyLabel,
  userGroupRates
}: AvailableChannelsTableProps) {
  const { t } = useI18n()
  const serverUtcOffset = useAppStore((s) => s.cachedPublicSettings?.server_utc_offset)

  const peakRateLabel = (group: UserAvailableGroup) => formatPeakRateWindow(group, serverTimezoneLabel(serverUtcOffset))
  const peakRateTitle = (group: UserAvailableGroup) =>
    t('common.peakRateTooltip', { window: peakRateLabel(group) }) + t('common.peakRateImageNote')

  function platformBadge(platform: string) {
    return (
      <span {...platformTone(platform, 'tag', styles.platformBadge)}>
        <PlatformIcon platform={platform as GroupPlatform} size="xs" />
        {platform}
      </span>
    )
  }

  function groupList(groups: UserAvailableGroup[], kind: 'exclusive' | 'public', keyPrefix: string) {
    if (groups.length === 0) return null
    const exclusive = kind === 'exclusive'
    return (
      <div className={styles.groupLine}>
        <span
          className={styles.groupKind}
          data-kind={kind}
          title={exclusive ? t('availableChannels.exclusiveTooltip') : t('availableChannels.publicTooltip')}
        >
          {exclusive ? (
            <Shield size={12} strokeWidth={1.75} aria-hidden="true" />
          ) : (
            <Globe size={12} strokeWidth={1.75} aria-hidden="true" />
          )}
          {exclusive ? t('availableChannels.exclusive') : t('availableChannels.public')}
        </span>
        {groups.map((g) => (
          <div key={`${keyPrefix}-${g.id}`} className={styles.groupItem}>
            <GroupBadge
              className={styles.groupBadge}
              name={g.name}
              platform={g.platform as GroupPlatform}
              subscriptionType={(g.subscription_type || 'standard') as SubscriptionType}
              rateMultiplier={g.rate_multiplier}
              userRateMultiplier={userGroupRates[g.id] ?? null}
              alwaysShowRate
            />
            {hasPeakRate(g) && (
              <span className={styles.peak} title={peakRateTitle(g)}>
                <Clock size={12} strokeWidth={1.75} aria-hidden="true" data-icon="clock" />
                {peakRateLabel(g)}
              </span>
            )}
          </div>
        ))}
      </div>
    )
  }

  // 分组：专属分组在前（shield 行），公开分组在后（globe 行）。
  function groupsCell(section: UserChannelPlatformSection, keyPrefix: string) {
    return (
      <>
        {groupList(exclusiveGroups(section), 'exclusive', `${keyPrefix}ex`)}
        {groupList(publicGroups(section), 'public', `${keyPrefix}pub`)}
        {section.groups.length === 0 && <span className={styles.placeholder}>-</span>}
      </>
    )
  }

  function modelsCell(section: UserChannelPlatformSection, keyPrefix: string) {
    return (
      <>
        {section.supported_models.map((m) => (
          <SupportedModelChip
            key={`${keyPrefix}${section.platform}-${m.name}`}
            className={styles.modelChip}
            model={m}
            pricingKeyPrefix={pricingKeyPrefix}
            noPricingLabel={noPricingLabel}
            showPlatform={false}
            platformHint={section.platform}
          />
        ))}
        {section.supported_models.length === 0 && <span className={styles.placeholder}>{noModelsLabel}</span>}
      </>
    )
  }

  const empty = (
    <>
      <Inbox size={40} strokeWidth={1.5} className={styles.emptyIcon} aria-hidden="true" />
      <p className={styles.emptyText}>{emptyLabel}</p>
    </>
  )

  return (
    <div className={styles.root}>
      <table data-testid="desktop-channels" className={styles.desktop}>
        <thead>
          <tr>
            <th className={styles.colName}>{columns.name}</th>
            <th className={styles.colDescription}>{columns.description}</th>
            <th className={styles.colPlatform}>{columns.platform}</th>
            <th>{columns.groups}</th>
            <th>{columns.supportedModels}</th>
          </tr>
        </thead>
        {loading ? (
          <tbody>
            <tr>
              <td colSpan={5} className={styles.stateCell} data-testid="desktop-loading">
                <LoadingSpinner size="md" />
              </td>
            </tr>
          </tbody>
        ) : rows.length === 0 ? (
          <tbody>
            <tr>
              <td colSpan={5} className={styles.stateCell}>
                {empty}
              </td>
            </tr>
          </tbody>
        ) : (
          rows.map((channel, chIdx) => (
            // 每个渠道一个 tbody：首行 td rowspan 渠道名，后续行只渲染其余三列。
            // tbody 之间强分隔线表达"渠道边界"，tbody 内部用淡分隔线区分平台。
            <tbody key={`${channel.name}-${chIdx}`} className={styles.channelBody}>
              {channel.platforms.map((section, secIdx) => (
                <tr key={`${channel.name}-${section.platform}`} data-first={secIdx === 0 ? '' : undefined}>
                  {secIdx === 0 && (
                    <Fragment>
                      {/* 渠道名：只在第一行渲染并用 rowspan 纵向合并 */}
                      <td rowSpan={channel.platforms.length} className={styles.nameCell}>
                        {channel.name}
                      </td>
                      {/* 描述：独立一列，同样用 rowspan 纵向合并 */}
                      <td rowSpan={channel.platforms.length} className={styles.descriptionCell}>
                        {channel.description ? channel.description : <span className={styles.placeholder}>-</span>}
                      </td>
                    </Fragment>
                  )}
                  <td className={styles.topCell}>{platformBadge(section.platform)}</td>
                  <td className={styles.topCell}>
                    <div className={styles.groupsStack}>{groupsCell(section, '')}</div>
                  </td>
                  <td className={styles.topCell}>
                    <div className={styles.models}>{modelsCell(section, '')}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          ))
        )}
      </table>

      <div data-testid="mobile-channels" className={styles.mobile}>
        {loading ? (
          <div data-testid="mobile-loading" className={styles.mobileState}>
            <LoadingSpinner size="md" />
          </div>
        ) : rows.length === 0 ? (
          <div data-testid="mobile-empty" className={styles.mobileState}>
            {empty}
          </div>
        ) : (
          rows.map((channel, chIdx) => (
            <section key={`mobile-${channel.name}-${chIdx}`} className={styles.mobileChannel}>
              <header className={styles.mobileHeader}>
                <h3 className={styles.mobileName}>{channel.name}</h3>
                <p className={styles.mobileDescription}>{channel.description || '-'}</p>
              </header>

              <div className={styles.mobileSections}>
                {channel.platforms.map((section) => (
                  <div key={`mobile-${channel.name}-${section.platform}`} className={styles.mobileSection}>
                    {platformBadge(section.platform)}
                    <dl className={styles.mobileList}>
                      <div>
                        <dt className={styles.mobileTerm}>{columns.groups}</dt>
                        <dd className={styles.groupsStack}>{groupsCell(section, 'mobile-')}</dd>
                      </div>
                      <div>
                        <dt className={styles.mobileTerm}>{columns.supportedModels}</dt>
                        <dd className={styles.models}>{modelsCell(section, 'mobile-')}</dd>
                      </div>
                    </dl>
                  </div>
                ))}
              </div>
            </section>
          ))
        )}
      </div>
    </div>
  )
}
