/**
 * 首次安装向导，对应 Vue 版 SetupWizardView.vue：数据库 → Redis → 管理员 → 确认安装，
 * 安装成功后轮询 /setup/status，服务以正常模式重启后跳转到登录页。
 */
import { ChevronLeft, ChevronRight, Settings } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { Alert } from '@/components/arc/alert/alert'
import { Button } from '@/components/arc/button/button'
import { Input } from '@/components/arc/input/input'
import { PasswordField } from '@/components/arc/password-field/password-field'
import { Stepper } from '@/components/arc/stepper/stepper'
import Select from '@/components/common/Select'
import Toggle from '@/components/common/Toggle'
import { buildGatewayUrl } from '@/api/client'
import { install, testDatabase, testRedis, type InstallRequest } from '@/api/setup'
import { useI18n } from '@/i18n/useI18n'
import styles from './SetupWizardView.module.css'

type RequestError = { response?: { data?: { detail?: string; message?: string } }; message?: string }

function extractErrorMessage(error: unknown, fallback: string): string {
  const err = error as RequestError
  return err.response?.data?.detail || err.response?.data?.message || err.message || fallback
}

/** 等价于 Vue 的 v-model.number：能解析为数字时取数字，否则保留原始输入 */
function toNumber(raw: string): number {
  const parsed = parseFloat(raw)
  return (Number.isNaN(parsed) ? raw : parsed) as number
}

// Default server port
function getCurrentPort(): number {
  const port = window.location.port
  if (port) {
    return parseInt(port, 10)
  }

  return window.location.protocol === 'https:' ? 443 : 80
}

function createInitialForm(): InstallRequest {
  return {
    database: {
      host: 'localhost',
      port: 5432,
      user: 'postgres',
      password: '',
      dbname: 'sub2api',
      sslmode: 'disable'
    },
    redis: {
      host: 'localhost',
      port: 6379,
      username: '',
      password: '',
      db: 0,
      enable_tls: false
    },
    admin: {
      email: '',
      password: ''
    },
    server: {
      host: '0.0.0.0',
      port: getCurrentPort(), // Use current port from browser
      mode: 'release'
    }
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export default function SetupWizardView() {
  const { t } = useI18n()

  const [currentStep, setCurrentStep] = useState(0)
  const [errorMessage, setErrorMessage] = useState('')
  const [installSuccess, setInstallSuccess] = useState(false)

  // Connection test states
  const [testingDb, setTestingDb] = useState(false)
  const [testingRedis, setTestingRedis] = useState(false)
  const [dbConnected, setDbConnected] = useState(false)
  const [redisConnected, setRedisConnected] = useState(false)
  const [installing, setInstalling] = useState(false)
  const [confirmPassword, setConfirmPassword] = useState('')
  const [serviceReady, setServiceReady] = useState(false)

  const [formData, setFormData] = useState<InstallRequest>(createInitialForm)

  // 卸载后停止轮询，避免离开页面后仍在请求与跳转
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const updateDatabase = (patch: Partial<InstallRequest['database']>) =>
    setFormData((prev) => ({ ...prev, database: { ...prev.database, ...patch } }))
  const updateRedis = (patch: Partial<InstallRequest['redis']>) =>
    setFormData((prev) => ({ ...prev, redis: { ...prev.redis, ...patch } }))
  const updateAdmin = (patch: Partial<InstallRequest['admin']>) =>
    setFormData((prev) => ({ ...prev, admin: { ...prev.admin, ...patch } }))

  const steps = [
    { id: 'database', label: t('setup.database.title') },
    { id: 'redis', label: t('setup.redis.title') },
    { id: 'admin', label: t('setup.admin.title') },
    { id: 'complete', label: t('setup.ready.title') }
  ]

  const canProceed = (() => {
    switch (currentStep) {
      case 0:
        return dbConnected
      case 1:
        return redisConnected
      case 2:
        return (
          !!formData.admin.email &&
          formData.admin.password.length >= 8 &&
          formData.admin.password === confirmPassword
        )
      default:
        return true
    }
  })()

  async function testDatabaseConnection() {
    setTestingDb(true)
    setErrorMessage('')
    setDbConnected(false)

    try {
      await testDatabase(formData.database)
      setDbConnected(true)
    } catch (error: unknown) {
      setErrorMessage(extractErrorMessage(error, 'Connection failed'))
    } finally {
      setTestingDb(false)
    }
  }

  async function testRedisConnection() {
    setTestingRedis(true)
    setErrorMessage('')
    setRedisConnected(false)

    try {
      await testRedis(formData.redis)
      setRedisConnected(true)
    } catch (error: unknown) {
      setErrorMessage(extractErrorMessage(error, 'Connection failed'))
    } finally {
      setTestingRedis(false)
    }
  }

  function nextStep() {
    if (canProceed) {
      setErrorMessage('')
      setCurrentStep((step) => step + 1)
    }
  }

  async function performInstall() {
    setInstalling(true)
    setErrorMessage('')

    try {
      await install(formData)
      setInstallSuccess(true)
      // Start polling for service restart
      void waitForServiceRestart()
    } catch (error: unknown) {
      setErrorMessage(extractErrorMessage(error, 'Installation failed'))
    } finally {
      setInstalling(false)
    }
  }

  // Wait for service to restart and become available
  async function waitForServiceRestart() {
    const maxAttempts = 60 // Increase to 60 attempts, ~60 seconds max
    const interval = 1000 // 1 second between attempts

    // Wait a moment for the service to start restarting
    await sleep(3000)

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (!mountedRef.current) return
      try {
        // Use setup status endpoint as it tells us the real mode
        // Service might return 404 or connection refused while restarting
        const response = await fetch(buildGatewayUrl('/setup/status'), {
          method: 'GET',
          cache: 'no-store'
        })

        if (response.ok) {
          const data = await response.json()
          // If needs_setup is false, service has restarted in normal mode
          if (data.data && !data.data.needs_setup) {
            if (!mountedRef.current) return
            setServiceReady(true)
            // Redirect to login page after a short delay
            setTimeout(() => {
              window.location.href = '/login'
            }, 1500)
            return
          }
        }
      } catch {
        // Service not ready or network error during restart, continue polling
      }

      await sleep(interval)
    }

    // If we reach here, service didn't restart in time
    // Show a message to refresh manually
    if (mountedRef.current) setErrorMessage(t('setup.status.timeout'))
  }

  const tlsToggle = (
    <div className={styles.toggleRow}>
      <div>
        <p className={styles.toggleTitle}>{t('setup.redis.enableTls')}</p>
        <p className={styles.toggleHint}>{t('setup.redis.enableTlsHint')}</p>
      </div>
      <Toggle
        value={formData.redis.enable_tls}
        onChange={(enable_tls) => updateRedis({ enable_tls })}
        aria-label={t('setup.redis.enableTls')}
      />
    </div>
  )

  const testButtonLabel = (testing: boolean, connected: boolean) =>
    testing ? t('setup.status.testing') : connected ? t('setup.status.success') : t('setup.status.testConnection')

  return (
    <div className={styles.page}>
      <div className={styles.container}>
        {/* Logo & Title */}
        <header className={styles.header}>
          <div className={styles.logo} aria-hidden="true">
            <Settings size={28} strokeWidth={1.75} />
          </div>
          <h1 className={styles.title}>{t('setup.title')}</h1>
          <p className={styles.description}>{t('setup.description')}</p>
        </header>

        {/* Progress Steps */}
        <Stepper className={styles.stepper} steps={steps} current={currentStep} label={t('setup.title')} />

        {/* Step Content */}
        <section className={styles.card}>
          {/* Step 1: Database */}
          {currentStep === 0 && (
            <div className={styles.step}>
              <div className={styles.stepHeader}>
                <h2>{t('setup.database.title')}</h2>
                <p>{t('setup.database.description')}</p>
              </div>

              <div className={styles.grid}>
                <Input
                  label={t('setup.database.host')}
                  type="text"
                  placeholder="localhost"
                  value={formData.database.host}
                  onChange={(event) => updateDatabase({ host: event.target.value })}
                />
                <Input
                  label={t('setup.database.port')}
                  type="number"
                  placeholder="5432"
                  value={formData.database.port}
                  onChange={(event) => updateDatabase({ port: toNumber(event.target.value) })}
                />
              </div>

              {/* 与 Vue 版一致：数据库步骤也显示 Redis TLS 开关（绑定 redis.enable_tls） */}
              {tlsToggle}

              <div className={styles.grid}>
                <Input
                  label={t('setup.database.username')}
                  type="text"
                  placeholder="postgres"
                  value={formData.database.user}
                  onChange={(event) => updateDatabase({ user: event.target.value })}
                />
                <PasswordField
                  label={t('setup.database.password')}
                  placeholder={t('setup.database.passwordPlaceholder')}
                  value={formData.database.password}
                  onChange={(event) => updateDatabase({ password: event.target.value })}
                />
              </div>

              <div className={styles.grid}>
                <Input
                  label={t('setup.database.databaseName')}
                  type="text"
                  placeholder="sub2api"
                  value={formData.database.dbname}
                  onChange={(event) => updateDatabase({ dbname: event.target.value })}
                />
                <div className={styles.field}>
                  <label className={styles.fieldLabel} htmlFor="setup-db-sslmode">
                    {t('setup.database.sslMode')}
                  </label>
                  <Select
                    id="setup-db-sslmode"
                    aria-label={t('setup.database.sslMode')}
                    value={formData.database.sslmode}
                    onChange={(value) => updateDatabase({ sslmode: String(value ?? '') })}
                    options={[
                      { value: 'disable', label: t('setup.database.ssl.disable') },
                      { value: 'require', label: t('setup.database.ssl.require') },
                      { value: 'verify-ca', label: t('setup.database.ssl.verifyCa') },
                      { value: 'verify-full', label: t('setup.database.ssl.verifyFull') }
                    ]}
                  />
                </div>
              </div>

              <Button
                variant="secondary"
                className={styles.fullWidth}
                loading={testingDb}
                onClick={() => void testDatabaseConnection()}
              >
                {testButtonLabel(testingDb, dbConnected)}
              </Button>
            </div>
          )}

          {/* Step 2: Redis */}
          {currentStep === 1 && (
            <div className={styles.step}>
              <div className={styles.stepHeader}>
                <h2>{t('setup.redis.title')}</h2>
                <p>{t('setup.redis.description')}</p>
              </div>

              <div className={styles.grid}>
                <Input
                  label={t('setup.redis.host')}
                  type="text"
                  placeholder="localhost"
                  value={formData.redis.host}
                  onChange={(event) => updateRedis({ host: event.target.value })}
                />
                <Input
                  label={t('setup.redis.port')}
                  type="number"
                  placeholder="6379"
                  value={formData.redis.port}
                  onChange={(event) => updateRedis({ port: toNumber(event.target.value) })}
                />
              </div>

              <div className={styles.grid}>
                <Input
                  label={t('setup.redis.username')}
                  type="text"
                  placeholder={t('setup.redis.usernamePlaceholder')}
                  value={formData.redis.username}
                  onChange={(event) => updateRedis({ username: event.target.value })}
                />
                <PasswordField
                  label={t('setup.redis.password')}
                  placeholder={t('setup.redis.passwordPlaceholder')}
                  value={formData.redis.password}
                  onChange={(event) => updateRedis({ password: event.target.value })}
                />
                <Input
                  label={t('setup.redis.database')}
                  type="number"
                  placeholder="0"
                  value={formData.redis.db}
                  onChange={(event) => updateRedis({ db: toNumber(event.target.value) })}
                />
              </div>

              {tlsToggle}

              <Button
                variant="secondary"
                className={styles.fullWidth}
                loading={testingRedis}
                onClick={() => void testRedisConnection()}
              >
                {testButtonLabel(testingRedis, redisConnected)}
              </Button>
            </div>
          )}

          {/* Step 3: Admin */}
          {currentStep === 2 && (
            <div className={styles.step}>
              <div className={styles.stepHeader}>
                <h2>{t('setup.admin.title')}</h2>
                <p>{t('setup.admin.description')}</p>
              </div>

              <Input
                label={t('setup.admin.email')}
                type="email"
                placeholder="admin@example.com"
                value={formData.admin.email}
                onChange={(event) => updateAdmin({ email: event.target.value })}
              />

              <PasswordField
                label={t('setup.admin.password')}
                placeholder={t('setup.admin.passwordPlaceholder')}
                value={formData.admin.password}
                onChange={(event) => updateAdmin({ password: event.target.value })}
              />

              <div className={styles.field}>
                <PasswordField
                  label={t('setup.admin.confirmPassword')}
                  placeholder={t('setup.admin.confirmPasswordPlaceholder')}
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  aria-invalid={confirmPassword && formData.admin.password !== confirmPassword ? true : undefined}
                />
                {confirmPassword && formData.admin.password !== confirmPassword && (
                  <p className={styles.errorText} role="alert">
                    {t('setup.admin.passwordMismatch')}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Step 4: Complete */}
          {currentStep === 3 && (
            <div className={styles.step}>
              <div className={styles.stepHeader}>
                <h2>{t('setup.ready.title')}</h2>
                <p>{t('setup.ready.description')}</p>
              </div>

              <dl className={styles.summary}>
                <div className={styles.summaryItem}>
                  <dt>{t('setup.ready.database')}</dt>
                  <dd>
                    {formData.database.user}@{formData.database.host}:{formData.database.port}/{formData.database.dbname}
                  </dd>
                </div>
                <div className={styles.summaryItem}>
                  <dt>{t('setup.ready.redis')}</dt>
                  <dd>
                    {formData.redis.host}:{formData.redis.port}
                  </dd>
                </div>
                <div className={styles.summaryItem}>
                  <dt>{t('setup.ready.adminEmail')}</dt>
                  <dd>{formData.admin.email}</dd>
                </div>
              </dl>
            </div>
          )}

          {/* Error Message */}
          {errorMessage && <Alert className={styles.message} tone="danger" title={errorMessage} />}

          {/* Success Message */}
          {installSuccess && (
            <Alert className={styles.message} tone="success" title={t('setup.status.completed')}>
              {serviceReady ? t('setup.status.redirecting') : t('setup.status.restarting')}
            </Alert>
          )}

          {/* Navigation Buttons */}
          <div className={styles.actions}>
            {currentStep > 0 && !installSuccess ? (
              <Button variant="secondary" onClick={() => setCurrentStep((step) => step - 1)}>
                <ChevronLeft size={16} strokeWidth={1.75} aria-hidden="true" />
                {t('common.back')}
              </Button>
            ) : (
              <div />
            )}

            {currentStep < 3 ? (
              <Button onClick={nextStep} disabled={!canProceed}>
                {t('common.next')}
                <ChevronRight size={16} strokeWidth={1.75} aria-hidden="true" />
              </Button>
            ) : !installSuccess ? (
              <Button loading={installing} onClick={() => void performInstall()}>
                {installing ? t('setup.status.installing') : t('setup.status.completeInstallation')}
              </Button>
            ) : null}
          </div>
        </section>
      </div>
    </div>
  )
}
