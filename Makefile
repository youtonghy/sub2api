.PHONY: build build-backend build-frontend test test-backend test-frontend test-frontend-critical

FRONTEND_CRITICAL_VITEST := \
	src/i18n/__tests__/localeKeyCompleteness.spec.ts \
	src/api/__tests__/client.spec.ts \
	src/api/__tests__/tokenRefresh.spec.ts \
	src/api/__tests__/keys.bulkUpdate.spec.ts \
	src/composables/__tests__/useModelWhitelist.spec.ts \
	src/components/account/__tests__/OpenAIReferralCell.spec.tsx \
	src/components/account/__tests__/OpenAIReferralCell.transport.spec.tsx \
	src/components/account/__tests__/OpenAIQuotaResetCell.spark_shadow.spec.tsx \
	src/constants/__tests__/platforms.spec.ts \
	src/components/account/__tests__/credentialsBuilder.platformCatalog.spec.ts \
	src/components/account/__tests__/CreateAccountModal.spec.tsx \
	src/components/account/__tests__/EditAccountModal.spec.tsx \
	src/components/account/__tests__/credentialsBuilder.spec.ts \
	src/components/account/__tests__/OpenCodeGoProtocolRulesEditor.spec.tsx \
	src/components/keys/__tests__/BulkEditKeysModal.spec.tsx \
	src/components/admin/user/__tests__/UserPlatformQuotaModal.spec.tsx \
	src/views/user/__tests__/KeysView.spec.tsx \
	src/api/__tests__/channelMonitorV2.spec.ts \
	src/views/auth/__tests__/LinuxDoCallbackView.spec.tsx \
	src/views/auth/__tests__/WechatCallbackView.spec.tsx \
	src/views/user/__tests__/PaymentView.spec.tsx \
	src/views/user/__tests__/PaymentResultView.spec.tsx \
	src/views/user/__tests__/ChannelStatusView.mode.spec.tsx \
	src/components/user/profile/__tests__/ProfileInfoCard.spec.tsx \
	src/components/user/profile/__tests__/ProfileIdentityBindingsSection.spec.tsx \
	src/views/admin/__tests__/SettingsView.spec.tsx \
	src/features/channel-monitor-v2/__tests__/monitorFormat.spec.ts \
	src/features/channel-monitor-v2/__tests__/monitorZoom.spec.ts \
	src/components/admin/channel/__tests__/PricingEntryCard.modelDefaultPrice.spec.tsx

# 一键编译前后端
build: build-backend build-frontend

# 编译后端（复用 backend/Makefile）
build-backend:
	@$(MAKE) -C backend build

# 编译前端（需要已安装依赖）
build-frontend:
	@pnpm --dir frontend run build

# 运行测试（后端 + 前端）
test: test-backend test-frontend

test-backend:
	@$(MAKE) -C backend test

test-frontend:
	@pnpm --dir frontend run lint:check
	@pnpm --dir frontend run typecheck
	@$(MAKE) test-frontend-critical

test-frontend-critical:
	@pnpm --dir frontend exec vitest run $(FRONTEND_CRITICAL_VITEST)
