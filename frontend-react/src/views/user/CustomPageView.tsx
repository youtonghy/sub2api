/**
 * 自定义页面，对应 Vue 版 views/user/CustomPageView.vue。
 * 菜单项为 Markdown 页（page_slug 或 md: 前缀）时拉取并渲染带目录的 Markdown；否则以 iframe 内嵌外部地址，
 * 右上角「新标签页打开」按钮可拖动，拖动后的那次点击不触发跳转。
 * 测试钩子沿用 Vue 版的类名语义：data-custom-embed-shell、data-custom-open-fab、data-markdown-content、data-toc-item、data-loading。
 */
import DOMPurify from 'dompurify'
import { ChevronLeft, ExternalLink, Link2, Menu } from 'lucide-react'
import { marked } from 'marked'
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent
} from 'react'
import { useParams } from 'react-router'

import { buildApiUrl } from '@/api/client'
import buttonStyles from '@/components/arc/button/button.module.css'
import { Skeleton } from '@/components/arc/skeleton/skeleton'
import { useI18n } from '@/i18n/useI18n'
import { useAdminSettingsStore } from '@/stores/adminSettings'
import { useAppStore } from '@/stores/app'
import { useAuthStore } from '@/stores/auth'
import { useTheme } from '@/theme/useTheme'
import { buildEmbeddedUrl } from '@/utils/embedded-url'
import styles from './CustomPageView.module.css'

interface TocItem {
  id: string
  text: string
  level: number
}

interface ButtonDrag {
  pointerId: number
  startX: number
  startY: number
  x: number
  y: number
}

function generateHeadingId(text: string, index: number): string {
  const base = text
    .toLowerCase()
    .replace(/[^\w一-鿿]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return base ? `${base}-${index}` : `heading-${index}`
}

function isRelativeMarkdownAsset(src: string): boolean {
  const trimmed = src.trim()
  if (!trimmed || /^[a-z][a-z0-9+.-]*:/i.test(trimmed) || trimmed.startsWith('//') || trimmed.startsWith('/')) {
    return false
  }
  const [pathPart] = trimmed.split(/([?#].*)/, 2)
  return pathPart
    .split('/')
    .filter((part) => part && part !== '.')
    .every((part) => part !== '..' && !part.includes('\\'))
}

function buildPageImageUrl(slug: string, src: string): string {
  const trimmed = src.trim()
  const [pathPart, suffix = ''] = trimmed.split(/([?#].*)/, 2)
  const encodedPath = pathPart
    .split('/')
    .filter((part) => part && part !== '.')
    .map((part) => encodeURIComponent(part))
    .join('/')
  return buildApiUrl(`/pages/${encodeURIComponent(slug)}/images/${encodedPath}${suffix}`)
}

export default function CustomPageView() {
  const { t, locale } = useI18n()
  const params = useParams()
  const { theme: pageTheme } = useTheme()
  const publicItems = useAppStore((state) => state.cachedPublicSettings?.custom_menu_items)
  const isAdmin = useAuthStore((state) => state.isAdmin)
  const userId = useAuthStore((state) => state.user?.id)
  const token = useAuthStore((state) => state.token)
  const adminMenuItems = useAdminSettingsStore((state) => state.customMenuItems)

  const [settingsLoading, setSettingsLoading] = useState(() => !useAppStore.getState().publicSettingsLoaded)
  // 最近一次完成的 Markdown 结果；slug 与当前不一致时视为加载中（对应 Vue 版切页时清空并显示加载）
  const [markdown, setMarkdown] = useState<{ slug: string; html: string; toc: TocItem[] }>({ slug: '', html: '', toc: [] })
  const [tocVisible, setTocVisible] = useState(() => (typeof window !== 'undefined' ? window.innerWidth > 768 : true))
  const [activeHeadingId, setActiveHeadingId] = useState('')
  const [openButtonPosition, setOpenButtonPosition] = useState<{ x: number; y: number } | null>(null)
  const [embedShell, setEmbedShell] = useState<HTMLDivElement | null>(null)
  const [openButton, setOpenButton] = useState<HTMLAnchorElement | null>(null)

  const markdownContainer = useRef<HTMLDivElement | null>(null)
  const markdownRequestVersion = useRef(0)
  const buttonDrag = useRef<ButtonDrag | null>(null)
  const suppressButtonClick = useRef(false)
  const scrollRafId = useRef(0)

  const menuItemId = params.id as string
  const menuItem =
    (publicItems ?? []).find((item) => item.id === menuItemId) ??
    (isAdmin ? adminMenuItems.find((item) => item.id === menuItemId) ?? null : null)

  let markdownSlug = ''
  if (menuItem) {
    if (menuItem.page_slug) markdownSlug = menuItem.page_slug
    else if (menuItem.url?.startsWith('md:')) markdownSlug = menuItem.url.slice(3)
  }
  const isMarkdownMode = !!markdownSlug
  const markdownReady = isMarkdownMode && markdown.slug === markdownSlug
  const markdownLoading = isMarkdownMode && !markdownReady
  const renderedHtml = markdownReady ? markdown.html : ''
  const tocItems = markdownReady ? markdown.toc : []
  const loading = settingsLoading || markdownLoading

  const embeddedUrl =
    !menuItem || isMarkdownMode ? '' : buildEmbeddedUrl(menuItem.url, userId, token, pageTheme, locale)
  const isValidUrl = !isMarkdownMode && (embeddedUrl.startsWith('http://') || embeddedUrl.startsWith('https://'))

  /** 把按钮位置限制在内嵌容器内；容器或按钮未挂载时返回 null */
  const clampPosition = useCallback(
    (x: number, y: number) => {
      if (!embedShell || !openButton) return null
      return {
        x: Math.max(0, Math.min(x, embedShell.clientWidth - openButton.offsetWidth)),
        y: Math.max(0, Math.min(y, embedShell.clientHeight - openButton.offsetHeight))
      }
    },
    [embedShell, openButton]
  )

  function clampOpenButtonPosition(x: number, y: number) {
    const next = clampPosition(x, y)
    if (next) setOpenButtonPosition(next)
  }

  // 容器或按钮尺寸变化时把已拖动的按钮收回可见区域
  useEffect(() => {
    if (!embedShell && !openButton) return
    const observer = new ResizeObserver(() => {
      setOpenButtonPosition((position) => (position ? clampPosition(position.x, position.y) ?? position : position))
    })
    if (embedShell) observer.observe(embedShell)
    if (openButton) observer.observe(openButton)
    return () => observer.disconnect()
  }, [embedShell, openButton, clampPosition])

  function startButtonDrag(event: ReactPointerEvent<HTMLAnchorElement>) {
    if (event.button !== 0 || !event.isPrimary || !openButton) return
    suppressButtonClick.current = false
    buttonDrag.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      x: openButton.offsetLeft,
      y: openButton.offsetTop
    }
    // Capture keeps receiving moves when the pointer crosses the embedded iframe.
    openButton.setPointerCapture(event.pointerId)
  }

  function moveButtonDrag(event: ReactPointerEvent<HTMLAnchorElement>) {
    const drag = buttonDrag.current
    if (!drag || event.pointerId !== drag.pointerId) return
    const dx = event.clientX - drag.startX
    const dy = event.clientY - drag.startY
    if (!suppressButtonClick.current && Math.hypot(dx, dy) < 4) return
    suppressButtonClick.current = true
    clampOpenButtonPosition(drag.x + dx, drag.y + dy)
    event.preventDefault()
  }

  function endButtonDrag(event: ReactPointerEvent<HTMLAnchorElement>) {
    const drag = buttonDrag.current
    if (!drag || event.pointerId !== drag.pointerId) return
    buttonDrag.current = null
    if (openButton?.hasPointerCapture(event.pointerId)) {
      openButton.releasePointerCapture(event.pointerId)
    }
  }

  function handleOpenButtonClick(event: ReactMouseEvent<HTMLAnchorElement>) {
    if (suppressButtonClick.current && event.detail !== 0) event.preventDefault()
    suppressButtonClick.current = false
  }

  // Markdown 页：每次切换 slug 递增版本号，旧请求完成时直接丢弃
  useEffect(() => {
    if (!markdownSlug) {
      markdownRequestVersion.current++
      return
    }
    const slug = markdownSlug
    const version = ++markdownRequestVersion.current
    const finish = (html: string, toc: TocItem[] = []) => {
      setActiveHeadingId('')
      setMarkdown({ slug, html, toc })
    }

    void (async () => {
      try {
        const authToken = useAuthStore.getState().token
        const resp = await fetch(buildApiUrl(`/pages/${encodeURIComponent(slug)}`), {
          headers: authToken ? { Authorization: `Bearer ${authToken}` } : {}
        })
        if (version !== markdownRequestVersion.current) return
        if (!resp.ok) {
          finish(`<p class="${styles.loadError}">${t('common.pageNotFound')}</p>`)
          return
        }
        let raw = await resp.text()
        if (version !== markdownRequestVersion.current) return

        raw = raw.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (match, alt: string, src: string) =>
          isRelativeMarkdownAsset(src) ? `![${alt}](${buildPageImageUrl(slug, src)})` : match
        )

        const html = marked.parse(raw, { async: false })
        const sanitized = DOMPurify.sanitize(html, {
          ADD_TAGS: ['iframe'],
          ADD_ATTR: ['allowfullscreen', 'frameborder', 'src']
        })

        // Inject IDs into headings and build TOC
        const toc: TocItem[] = []
        let headingIndex = 0
        const withIds = sanitized.replace(/<(h[1-4])[^>]*>(.*?)<\/h[1-4]>/gi, (_, tag: string, content: string) => {
          const level = parseInt(tag[1])
          const text = content.replace(/<[^>]+>/g, '').trim()
          const id = generateHeadingId(text, headingIndex++)
          toc.push({ id, text, level })
          return `<${tag} id="${id}">${content}</${tag}>`
        })

        finish(withIds, toc)
      } catch {
        if (version === markdownRequestVersion.current) {
          finish(`<p class="${styles.loadError}">Failed to load page</p>`)
        }
      }
    })()
    // t 随语言变化，不应触发重新拉取
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markdownSlug])

  // 渲染完成后为代码块注入复制按钮（同一段 HTML 只注入一次）
  useEffect(() => {
    if (loading || !isMarkdownMode) return
    const container = markdownContainer.current
    if (!container) return
    container.querySelectorAll('pre').forEach((pre) => {
      if (pre.querySelector('.copy-btn')) return
      const btn = document.createElement('button')
      btn.className = 'copy-btn'
      btn.textContent = t('customPage.copyCode')
      btn.addEventListener('click', async () => {
        const code = pre.querySelector('code')?.textContent ?? pre.textContent ?? ''
        try {
          await navigator.clipboard.writeText(code)
          btn.textContent = t('customPage.copiedCode')
          setTimeout(() => {
            btn.textContent = t('customPage.copyCode')
          }, 2000)
        } catch {
          btn.textContent = t('customPage.copyCodeFailed')
          setTimeout(() => {
            btn.textContent = t('customPage.copyCode')
          }, 2000)
        }
      })
      pre.style.position = 'relative'
      pre.appendChild(btn)
    })
  }, [loading, isMarkdownMode, renderedHtml, t])

  useEffect(() => {
    const versionRef = markdownRequestVersion
    const rafRef = scrollRafId
    let cancelled = false
    const appStore = useAppStore.getState()
    if (!appStore.publicSettingsLoaded) {
      void appStore.fetchPublicSettings().finally(() => {
        if (!cancelled) setSettingsLoading(false)
      })
    }
    return () => {
      cancelled = true
      versionRef.current++
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [])

  function scrollToHeading(id: string) {
    const container = markdownContainer.current
    if (!container) return
    const el = container.querySelector(`#${CSS.escape(id)}`)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' })
      setActiveHeadingId(id)
      if (window.innerWidth <= 640) {
        setTocVisible(false)
      }
    }
  }

  function onContentScroll() {
    if (scrollRafId.current) return
    scrollRafId.current = requestAnimationFrame(() => {
      scrollRafId.current = 0
      const container = markdownContainer.current
      if (!container || tocItems.length === 0) return

      const containerRect = container.getBoundingClientRect()
      let current = ''
      for (const item of tocItems) {
        const el = container.querySelector(`#${CSS.escape(item.id)}`) as HTMLElement | null
        if (el) {
          const elRect = el.getBoundingClientRect()
          if (elRect.top - containerRect.top <= 100) {
            current = item.id
          }
        }
      }
      setActiveHeadingId(current)
    })
  }

  const emptyState = (title: string, description: string) => (
    <div className={styles.centered}>
      <div className={styles.emptyBox}>
        <div className={styles.emptyIcon}>
          <Link2 size={22} strokeWidth={1.75} aria-hidden="true" />
        </div>
        <h3 className={styles.emptyTitle}>{title}</h3>
        <p className={styles.emptyText}>{description}</p>
      </div>
    </div>
  )

  let content
  if (loading) {
    content = (
      <div className={styles.loading} data-loading="">
        <Skeleton label={t('common.loading')} lines={6} />
      </div>
    )
  } else if (!menuItem) {
    content = emptyState(t('customPage.notFoundTitle'), t('customPage.notFoundDesc'))
  } else if (isMarkdownMode) {
    // Markdown mode with TOC
    content = (
      <div className={styles.markdownLayout}>
        {/* TOC Sidebar */}
        <aside className={styles.tocSidebar} hidden={!tocVisible}>
          <div className={styles.tocHeader}>
            <span className={styles.tocTitle}>{t('customPage.tableOfContents')}</span>
            <button
              type="button"
              className={styles.tocClose}
              aria-label={t('common.close')}
              onClick={() => setTocVisible(false)}
            >
              <ChevronLeft size={16} strokeWidth={2} aria-hidden="true" />
            </button>
          </div>
          <nav className={styles.tocNav}>
            {tocItems.map((item) => (
              <a
                key={item.id}
                href={`#${item.id}`}
                className={styles.tocItem}
                data-toc-item=""
                data-level={item.level}
                data-active={activeHeadingId === item.id || undefined}
                onClick={(event) => {
                  event.preventDefault()
                  scrollToHeading(item.id)
                }}
              >
                {item.text}
              </a>
            ))}
          </nav>
        </aside>

        {/* TOC Toggle Button (when collapsed) */}
        {!tocVisible && tocItems.length > 0 && (
          <button type="button" className={styles.tocToggle} onClick={() => setTocVisible(true)}>
            <Menu size={16} strokeWidth={2} aria-hidden="true" />
            <span>{t('customPage.tableOfContents')}</span>
          </button>
        )}

        {/* Content */}
        <div
          ref={markdownContainer}
          className={styles.markdownContent}
          data-markdown-content=""
          dangerouslySetInnerHTML={{ __html: renderedHtml }}
          onScroll={onContentScroll}
        />
      </div>
    )
  } else if (!isValidUrl) {
    // URL not configured
    content = emptyState(t('customPage.notConfiguredTitle'), t('customPage.notConfiguredDesc'))
  } else {
    // Iframe embed mode
    content = (
      <div ref={setEmbedShell} className={styles.embedShell} data-custom-embed-shell="">
        {!menuItem.hide_open_button && (
          <a
            ref={setOpenButton}
            href={embeddedUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={[buttonStyles.button, buttonStyles.secondary, buttonStyles.sm, styles.openFab].join(' ')}
            data-custom-open-fab=""
            style={
              openButtonPosition
                ? { left: `${openButtonPosition.x}px`, top: `${openButtonPosition.y}px`, right: 'auto' }
                : undefined
            }
            onPointerDown={startButtonDrag}
            onPointerMove={moveButtonDrag}
            onPointerUp={endButtonDrag}
            onPointerCancel={endButtonDrag}
            onLostPointerCapture={endButtonDrag}
            onDragStart={(event) => event.preventDefault()}
            onClick={handleOpenButtonClick}
          >
            <ExternalLink size={16} strokeWidth={2} aria-hidden="true" />
            {t('customPage.openInNewTab')}
          </a>
        )}
        <iframe src={embeddedUrl} className={styles.embedFrame} allowFullScreen title={menuItem.label} />
      </div>
    )
  }

  return (
    <div className={styles.layout}>
      <div className={styles.panel}>{content}</div>
    </div>
  )
}
