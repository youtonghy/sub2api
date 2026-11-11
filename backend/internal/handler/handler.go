package handler

import (
	"github.com/Wei-Shaw/sub2api/internal/handler/admin"
	"github.com/Wei-Shaw/sub2api/internal/securityaudit"
)

// AdminHandlers contains all admin-related HTTP handlers
type AdminHandlers struct {
	Dashboard              *admin.DashboardHandler
	User                   *admin.UserHandler
	Group                  *admin.GroupHandler
	Account                *admin.AccountHandler
	Announcement           *admin.AnnouncementHandler
	DataManagement         *admin.DataManagementHandler
	Backup                 *admin.BackupHandler
	OAuth                  *admin.OAuthHandler
	OpenAIOAuth            *admin.OpenAIOAuthHandler
	GeminiOAuth            *admin.GeminiOAuthHandler
	AntigravityOAuth       *admin.AntigravityOAuthHandler
	GrokOAuth              *admin.GrokOAuthHandler
	CNProvider             *admin.CNProviderHandler
	Proxy                  *admin.ProxyHandler
	Redeem                 *admin.RedeemHandler
	Promo                  *admin.PromoHandler
	Setting                *admin.SettingHandler
	Ops                    *admin.OpsHandler
	System                 *admin.SystemHandler
	Subscription           *admin.SubscriptionHandler
	Usage                  *admin.UsageHandler
	UserAttribute          *admin.UserAttributeHandler
	ErrorPassthrough       *admin.ErrorPassthroughHandler
	TLSFingerprintProfile  *admin.TLSFingerprintProfileHandler
	Plugin                 *admin.PluginHandler
	APIKey                 *admin.AdminAPIKeyHandler
	ScheduledTest          *admin.ScheduledTestHandler
	Channel                *admin.ChannelHandler
	ChannelMonitor         *admin.ChannelMonitorHandler
	ChannelMonitorTemplate *admin.ChannelMonitorRequestTemplateHandler
	ContentModeration      *admin.ContentModerationHandler
	PrivacyFilter          *admin.PrivacyFilterHandler
	PromptAudit            *securityaudit.PromptAdminHandler
	Payment                *admin.PaymentHandler
	Affiliate              *admin.AffiliateHandler
	Compliance             *admin.ComplianceHandler
	AuditLog               *admin.AuditLogHandler
}

// Handlers contains all HTTP handlers
type Handlers struct {
	Auth             *AuthHandler
	User             *UserHandler
	MCPOAuth         *MCPOAuthHandler
	APIKey           *APIKeyHandler
	Usage            *UsageHandler
	Redeem           *RedeemHandler
	Subscription     *SubscriptionHandler
	Announcement     *AnnouncementHandler
	ChannelMonitor   *ChannelMonitorUserHandler
	ChannelMonitorV2 *ChannelMonitorV2Handler
	Admin            *AdminHandlers
	Gateway          *GatewayHandler
	OpenAIGateway    *OpenAIGatewayHandler
	Setting          *SettingHandler
	Totp             *TotpHandler
	Passkey          *PasskeyHandler
	Payment          *PaymentHandler
	PaymentWebhook   *PaymentWebhookHandler
	AvailableChannel *AvailableChannelHandler
	ModelPlaza       *ModelPlazaHandler
	AsyncImage       *AsyncImageHandler
	BatchImage       *BatchImageHandler
}

// BuildInfo contains build-time information
type BuildInfo struct {
	// Version 是本程序的版本号：本地/镜像构建时为打包时间（YYMMDDHHmm，如 2611111054）。
	Version string
	// UpstreamVersion 是所基于的上游 Wei-Shaw/sub2api 版本（cmd/server/VERSION）。
	UpstreamVersion string
	BuildType       string // "source" for manual builds, "release" for CI builds
}
