/**
 * 新手引导（driver.js）：与 Vue 版 useOnboardingTour 行为一致。
 * 在应用外壳（AppLayout）中调用一次；引导实例存放在 onboarding store 中，跨组件保持。
 */
import { useEffect, useState } from 'react'
import { driver, type Driver, type DriveStep } from 'driver.js'
import 'driver.js/dist/driver.css'
import '@/styles/onboarding.css'

import { getAdminSteps, getUserSteps } from '@/components/Guide/steps'
import { t } from '@/i18n'
import { useAuthStore } from '@/stores/auth'
import { useOnboardingStore } from '@/stores/onboarding'

export interface OnboardingOptions {
  storageKey?: string
  autoStart?: boolean
}

export interface OnboardingTour {
  startTour: (startIndex?: number) => Promise<void>
  replayTour: () => void
  nextStep: (delay?: number) => Promise<void>
  isCurrentStep: (elementSelector: string) => boolean
  hasSeen: () => boolean
  markAsSeen: () => void
  clearSeen: () => void
}

interface OnboardingController extends OnboardingTour {
  /** 挂载时调用：注册控制方法并按条件自动启动，返回卸载清理函数 */
  mount: () => () => void
  /** 更新调用方传入的选项（storageKey / autoStart） */
  setOptions: (options: OnboardingOptions) => void
}

const storageVersion = 'v4_interactive' // Bump version for new tour type

// Timing constants for better maintainability
const TIMING = {
  INTERACTIVE_WAIT_MS: 800,        // Default wait time for interactive steps
  ELEMENT_TIMEOUT_MS: 8000,        // Timeout for element detection
  AUTO_START_DELAY_MS: 1000        // Delay before auto-starting tour
} as const

// Helper: Check if a step is interactive (only close button shown)
const isInteractiveStep = (step: DriveStep): boolean => {
  return step.popover?.showButtons?.length === 1 &&
         step.popover.showButtons[0] === 'close'
}

/**
 * 检查元素是否存在，如果不存在则重试
 */
const ensureElement = async (selector: string, timeout = 5000): Promise<boolean> => {
  const startTime = Date.now()
  while (Date.now() - startTime < timeout) {
    const element = document.querySelector(selector)
    if (element && element.getBoundingClientRect().height > 0) {
      return true
    }
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
  return false
}

/** 等待下一帧，相当于 Vue 版的 nextTick：让刚提交的 DOM 先完成布局 */
const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))

/**
 * 创建引导控制器。options 由 setOptions 保持为调用方的最新值。
 */
function createOnboardingTour(initialOptions: OnboardingOptions): OnboardingController {
  let options = initialOptions
  const getOptions = () => options
  const setOptions = (next: OnboardingOptions) => {
    options = next
  }
  const onboardingStore = useOnboardingStore.getState()

  // 使用 store 管理的全局 driver 实例
  let driverInstance: Driver | null = onboardingStore.getDriverInstance()
  let currentClickListener: {
    element: HTMLElement
    handler: () => void
    keyHandler?: (e: KeyboardEvent) => void
    originalTabIndex?: string | null
    eventTypes?: string[] // Track which event types were added
  } | null = null
  let globalKeyboardHandler: ((e: KeyboardEvent) => void) | null = null

  // Helper: Clean up click listener
  const cleanupClickListener = () => {
    if (!currentClickListener) return
    const { element: el, handler, keyHandler, originalTabIndex, eventTypes } = currentClickListener
    if (eventTypes) {
      eventTypes.forEach(type => el.removeEventListener(type, handler))
    }
    if (keyHandler) el.removeEventListener('keydown', keyHandler)
    if (originalTabIndex !== undefined) {
      if (originalTabIndex === null) el.removeAttribute('tabindex')
      else el.setAttribute('tabindex', originalTabIndex)
    }
    currentClickListener = null
  }

  const getStorageKey = () => {
    const user = useAuthStore.getState().user
    const baseKey = getOptions().storageKey ?? 'onboarding_tour'
    const userId = user?.id ?? 'guest'
    const role = user?.role ?? 'user'
    return `${baseKey}_${userId}_${role}_${storageVersion}`
  }

  const hasSeen = () => {
    return localStorage.getItem(getStorageKey()) === 'true'
  }

  const markAsSeen = () => {
    localStorage.setItem(getStorageKey(), 'true')
  }

  const clearSeen = () => {
    localStorage.removeItem(getStorageKey())
  }

  const resolveStepElement = (step: DriveStep): HTMLElement | null => {
    if (!step.element) return null
    return typeof step.element === 'string'
      ? document.querySelector(step.element) as HTMLElement | null
      : step.element as HTMLElement
  }

  const startTour = async (startIndex = 0) => {
    // 动态获取当前用户角色和步骤
    const authStore = useAuthStore.getState()
    const isAdmin = authStore.user?.role === 'admin'
    const isSimpleMode = authStore.isSimpleMode
    const steps = isAdmin ? getAdminSteps(t, isSimpleMode) : getUserSteps(t)

    // 确保 DOM 就绪
    await nextFrame()

    // 如果指定了起始步骤，确保元素可见
    const currentStep = steps[startIndex]
    if (currentStep?.element && typeof currentStep.element === 'string') {
      await ensureElement(currentStep.element, TIMING.ELEMENT_TIMEOUT_MS)
    }

    if (driverInstance) {
      driverInstance.destroy()
    }

    // 创建新的 driver 实例并存储到 store
    driverInstance = driver({
      showProgress: true,
      steps,
      animate: true,
      allowClose: false, // 禁止点击遮罩关闭
      stagePadding: 4,
      popoverClass: 'theme-tour-popover',
      nextBtnText: t('common.next'),
      prevBtnText: t('common.back'),
      doneBtnText: t('common.confirm'),

      // 导航处理
      onNextClick: async (_el, _step, { config, state }) => {
        // 如果是最后一步，点击则是"完成"
        if (state.activeIndex === (config.steps?.length ?? 0) - 1) {
          markAsSeen()
          driverInstance?.destroy()
          useOnboardingStore.getState().setDriverInstance(null)
        } else {
          // 注意：交互式步骤通常隐藏 Next 按钮，此处逻辑为防御性编程
          const currentIndex = state.activeIndex ?? 0
          const currentStep = steps[currentIndex]

          if (currentStep && isInteractiveStep(currentStep) && currentStep.element) {
            const targetElement = resolveStepElement(currentStep)

            if (targetElement) {
              const isClickable = !['INPUT', 'TEXTAREA', 'SELECT'].includes(targetElement.tagName)
              if (isClickable) {
                targetElement.click()
                return
              }
            }
          }
          driverInstance?.moveNext()
        }
      },
      onPrevClick: () => {
        driverInstance?.movePrevious()
      },
      onCloseClick: () => {
        markAsSeen()
        driverInstance?.destroy()
        useOnboardingStore.getState().setDriverInstance(null)
      },

      // 渲染时重组 Footer 布局
      onPopoverRender: (popover, { config, state }) => {
        // Class name constants for easier maintenance
        const CLASS_REORGANIZED = 'reorganized'
        const CLASS_FOOTER_LEFT = 'footer-left'
        const CLASS_FOOTER_RIGHT = 'footer-right'
        const CLASS_DONE_BTN = 'driver-popover-done-btn'
        const CLASS_PROGRESS_TEXT = 'driver-popover-progress-text'
        const CLASS_NEXT_BTN = 'driver-popover-next-btn'
        const CLASS_PREV_BTN = 'driver-popover-prev-btn'

        try {
          const { title: titleEl, footer: footerEl, nextButton, previousButton } = popover

          // Defensive check: ensure popover elements exist
          if (!titleEl || !footerEl) {
            console.warn('Onboarding: Missing popover elements')
            return
          }

          // 1.5 交互式步骤提示
          const currentStep = steps[state.activeIndex ?? 0]

          if (currentStep && isInteractiveStep(currentStep) && popover.description) {
            const hintClass = 'driver-popover-description-hint'
            if (!popover.description.querySelector(`.${hintClass}`)) {
              const hint = document.createElement('div')
              hint.className = hintClass

              const textNode = document.createTextNode(
                t('onboarding.interactiveHint', 'Press Enter or Click to continue'),
              )

              hint.appendChild(textNode)
              popover.description.appendChild(hint)
            }
          }

          // 2. 底部：DOM 重组
          if (!footerEl.classList.contains(CLASS_REORGANIZED)) {
            footerEl.classList.add(CLASS_REORGANIZED)

            const progressEl = footerEl.querySelector(`.${CLASS_PROGRESS_TEXT}`)
            const nextBtnEl = nextButton || footerEl.querySelector(`.${CLASS_NEXT_BTN}`)
            const prevBtnEl = previousButton || footerEl.querySelector(`.${CLASS_PREV_BTN}`)

            const leftContainer = document.createElement('div')
            leftContainer.className = CLASS_FOOTER_LEFT

            const rightContainer = document.createElement('div')
            rightContainer.className = CLASS_FOOTER_RIGHT

            if (progressEl) leftContainer.appendChild(progressEl)

            const shortcutsEl = document.createElement('div')
            shortcutsEl.className = 'footer-shortcuts'

            const shortcut1 = document.createElement('span')
            shortcut1.className = 'shortcut-item'
            const kbd1 = document.createElement('kbd')
            kbd1.textContent = '←'
            const kbd2 = document.createElement('kbd')
            kbd2.textContent = '→'
            shortcut1.appendChild(kbd1)
            shortcut1.appendChild(kbd2)
            shortcut1.appendChild(
              document.createTextNode(` ${t('onboarding.navigation.flipPage')}`),
            )

            const shortcut2 = document.createElement('span')
            shortcut2.className = 'shortcut-item'
            const kbd3 = document.createElement('kbd')
            kbd3.textContent = 'ESC'
            shortcut2.appendChild(kbd3)
            shortcut2.appendChild(
              document.createTextNode(` ${t('onboarding.navigation.exit')}`),
            )

            shortcutsEl.appendChild(shortcut1)
            shortcutsEl.appendChild(shortcut2)
            leftContainer.appendChild(shortcutsEl)

            if (prevBtnEl) rightContainer.appendChild(prevBtnEl)
            if (nextBtnEl) rightContainer.appendChild(nextBtnEl)

            footerEl.innerHTML = ''
            footerEl.appendChild(leftContainer)
            footerEl.appendChild(rightContainer)
          }

          // 3. 状态更新
          const isLastStep = state.activeIndex === (config.steps?.length ?? 0) - 1
          const activeNextBtn = nextButton || footerEl.querySelector(`.${CLASS_NEXT_BTN}`)

          if (activeNextBtn) {
            if (isLastStep) {
              activeNextBtn.classList.add(CLASS_DONE_BTN)
            } else {
              activeNextBtn.classList.remove(CLASS_DONE_BTN)
            }
          }
        } catch (e) {
          console.error('Onboarding Tour Render Error:', e)
        }
      },

      // 步骤高亮时触发
      onHighlightStarted: async (element, step) => {
        // 清理之前的监听器
        cleanupClickListener()

        // 尝试等待元素
        if (!element && step.element && typeof step.element === 'string') {
          const exists = await ensureElement(step.element, 8000)
          if (!exists) {
            console.warn(`Tour element not found after 8s: ${step.element}`)
            return
          }
          element = document.querySelector(step.element) as HTMLElement
        }

        if (isInteractiveStep(step) && element) {
          const htmlElement = element as HTMLElement

          // Check if this is a submit button - if so, don't bind auto-advance listeners
          // Let business code (e.g., handleCreateGroup) manually call nextStep after success
          const isSubmitButton = htmlElement.getAttribute('type') === 'submit' ||
                                (htmlElement.tagName === 'BUTTON' && htmlElement.closest('form'))

          if (isSubmitButton) {
            return // Don't bind any click listeners for submit buttons
          }

          const originalTabIndex = htmlElement.getAttribute('tabindex')
          if (!htmlElement.isContentEditable && htmlElement.tabIndex === -1) {
            htmlElement.setAttribute('tabindex', '0')
          }

          // Enhanced Select component detection - check both children and self
          const isSelectComponent = htmlElement.querySelector('.select-trigger') !== null ||
                                    htmlElement.classList.contains('select-trigger')

          // Select dropdowns are teleported to <body>, so click events on options
          // won't bubble through this element. Skip auto-advance for Select components.
          // Users navigate using Next/Previous buttons after making their selection.
          if (isSelectComponent) {
            return
          }

          // Single-execution protection flag
          let hasExecuted = false

          // Capture the step index when binding the handler
          const boundStepIndex = driverInstance?.getActiveIndex() ?? 0

          const clickHandler = async () => {
            // Prevent duplicate execution
            if (hasExecuted) {
              return
            }
            hasExecuted = true

            // Wait before advancing to allow user to see the result of their action
            await new Promise(resolve => setTimeout(resolve, TIMING.INTERACTIVE_WAIT_MS))

            // Verify driver is still active and not destroyed
            if (!driverInstance || !driverInstance.isActive()) {
              return
            }

            // Check if we're still on the same step - abort if step changed during wait
            const currentIndex = driverInstance.getActiveIndex() ?? 0
            if (currentIndex !== boundStepIndex) {
              return
            }

            const nextStep = steps[currentIndex + 1]

            if (nextStep?.element && typeof nextStep.element === 'string') {
              const exists = await ensureElement(nextStep.element, TIMING.ELEMENT_TIMEOUT_MS)
              if (!exists) {
                console.warn(`Onboarding: Next step element not found: ${nextStep.element}`)
                return
              }
            }

            // Final check before moving
            if (driverInstance && driverInstance.isActive()) {
              driverInstance.moveNext()
            }
          }

          // For input fields, advance on input/change events instead of click
          const isInputField = ['INPUT', 'TEXTAREA', 'SELECT'].includes(htmlElement.tagName)

          if (isInputField) {
            const inputHandler = () => {
              // Remove listener after first input
              htmlElement.removeEventListener('input', inputHandler)
              htmlElement.removeEventListener('change', inputHandler)
              void clickHandler()
            }

            htmlElement.addEventListener('input', inputHandler)
            htmlElement.addEventListener('change', inputHandler)

            currentClickListener = {
              element: htmlElement,
              handler: inputHandler,
              originalTabIndex,
              eventTypes: ['input', 'change']
            }
          } else {
            const keyHandler = (e: KeyboardEvent) => {
              if (['Enter', ' '].includes(e.key)) {
                e.preventDefault()
                void clickHandler()
              }
            }

            htmlElement.addEventListener('click', clickHandler, { once: true })
            htmlElement.addEventListener('keydown', keyHandler)

            currentClickListener = {
              element: htmlElement,
              handler: clickHandler as () => void,
              keyHandler,
              originalTabIndex,
              eventTypes: ['click']
            }
          }
        }
      },

      onDestroyed: () => {
        cleanupClickListener()
        // 清理全局监听器 (由此处唯一管理)
        if (globalKeyboardHandler) {
          document.removeEventListener('keydown', globalKeyboardHandler, { capture: true })
          globalKeyboardHandler = null
        }
        useOnboardingStore.getState().setDriverInstance(null)
      }
    })

    useOnboardingStore.getState().setDriverInstance(driverInstance)

    // 添加全局键盘监听器
    globalKeyboardHandler = (e: KeyboardEvent) => {
      if (!driverInstance?.isActive()) return

      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        markAsSeen()
        driverInstance.destroy()
        useOnboardingStore.getState().setDriverInstance(null)
        return
      }

      if (e.key === 'ArrowRight') {
        const target = e.target as HTMLElement
        // 允许在输入框中使用方向键
        if (['INPUT', 'TEXTAREA'].includes(target?.tagName)) {
          return
        }

        e.preventDefault()
        e.stopPropagation()

        // 对于交互式步骤，箭头键应该触发交互而非跳过
        const currentIndex = driverInstance.getActiveIndex() ?? 0
        const currentStep = steps[currentIndex]

        if (currentStep && isInteractiveStep(currentStep) && currentStep.element) {
          const targetElement = resolveStepElement(currentStep)

          if (targetElement) {
            // 对于非输入类元素，提示用户需要点击或按Enter
            const isClickable = !['INPUT', 'TEXTAREA', 'SELECT'].includes(targetElement.tagName)
            if (isClickable) {
              // 不自动触发，只是停留提示
              return
            }
          }
        }

        // 非交互式步骤才允许箭头键翻页
        driverInstance.moveNext()
      } else if (e.key === 'Enter') {
        const target = e.target as HTMLElement
        // 允许在输入框中使用回车
        if (['INPUT', 'TEXTAREA'].includes(target?.tagName)) {
          return
        }

        e.preventDefault()
        e.stopPropagation()

        // 回车键处理交互式步骤
        const currentIndex = driverInstance.getActiveIndex() ?? 0
        const currentStep = steps[currentIndex]

        if (currentStep && isInteractiveStep(currentStep) && currentStep.element) {
          const targetElement = resolveStepElement(currentStep)

          if (targetElement) {
            const isClickable = !['INPUT', 'TEXTAREA', 'SELECT'].includes(targetElement.tagName)
            if (isClickable) {
              targetElement.click()
              return
            }
          }
        }
        driverInstance.moveNext()
      } else if (e.key === 'ArrowLeft') {
        const target = e.target as HTMLElement
        // 允许在输入框中使用方向键
        if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName) || target?.isContentEditable) {
          return
        }

        e.preventDefault()
        e.stopPropagation()
        driverInstance.movePrevious()
      }
    }

    document.addEventListener('keydown', globalKeyboardHandler, { capture: true })
    driverInstance.drive(startIndex)
  }

  const nextStep = async (delay = 300) => {
    if (!driverInstance?.isActive()) return
    if (delay > 0) {
      await new Promise(resolve => setTimeout(resolve, delay))
    }
    driverInstance.moveNext()
  }

  const isCurrentStep = (elementSelector: string): boolean => {
    if (!driverInstance?.isActive()) return false
    const activeElement = driverInstance.getActiveElement()
    return activeElement?.matches(elementSelector) ?? false
  }

  const replayTour = () => {
    clearSeen()
    void startTour()
  }

  const mount = (): (() => void) => {
    let autoStartTimer: ReturnType<typeof setTimeout> | null = null
    const store = useOnboardingStore.getState()
    store.setControlMethods({
      nextStep,
      isCurrentStep
    })

    if (store.isDriverActive()) {
      driverInstance = store.getDriverInstance()
    } else {
      const authStore = useAuthStore.getState()
      // 简易模式下禁用新手引导；只在管理员+标准模式下自动启动
      const isAdmin = authStore.user?.role === 'admin'
      if (!authStore.isSimpleMode && isAdmin && getOptions().autoStart && !hasSeen()) {
        autoStartTimer = setTimeout(() => {
          void startTour()
        }, TIMING.AUTO_START_DELAY_MS)
      }
    }

    return () => {
      if (autoStartTimer) {
        clearTimeout(autoStartTimer)
        autoStartTimer = null
      }
      // 关键修复：不再此处清理 globalKeyboardHandler，交由 driver.onDestroyed 管理
      useOnboardingStore.getState().clearControlMethods()
    }
  }

  return { startTour, replayTour, nextStep, isCurrentStep, hasSeen, markAsSeen, clearSeen, mount, setOptions }
}

export function useOnboardingTour(options: OnboardingOptions): OnboardingTour {
  // 控制器只创建一次，之后每次渲染同步最新的 options
  const [tour] = useState(() => createOnboardingTour(options))

  useEffect(() => {
    tour.setOptions(options)
  })

  useEffect(() => tour.mount(), [tour])

  return tour
}
