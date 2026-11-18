package service

import (
	"context"
	"errors"
	"log/slog"
	"strings"
	"time"
)

const (
	compositeCrossPlatformFallbackCacheTTL  = 5 * time.Second
	compositeCrossPlatformFallbackDBTimeout = 2 * time.Second
	compositeCrossPlatformFallbackSFKey     = "composite_cross_platform_fallback"
)

type cachedCompositeCrossPlatformFallback struct {
	enabled   bool
	expiresAt int64
}

func compositeCrossPlatformFallbackFromConfig(s *SettingService) bool {
	return s != nil && s.cfg != nil && s.cfg.Gateway.Scheduling.CrossPlatformFallback
}

// parseCompositeCrossPlatformFallback 未保存过该设置的部署沿用配置文件/环境变量的值。
func parseCompositeCrossPlatformFallback(raw string, fallback bool) bool {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return fallback
	}
	return strings.EqualFold(raw, "true")
}

// IsCompositeCrossPlatformFallbackEnabled 返回 composite 分组跨平台优先级回退
// 开关的生效值。直接读设置表（带短 TTL 缓存），因此重启后仍以管理端保存的值为准；
// 读取失败时沿用配置值，避免数据库抖动改变路由行为。
func (s *SettingService) IsCompositeCrossPlatformFallbackEnabled(ctx context.Context) bool {
	if s == nil {
		return false
	}
	if cached, ok := s.compositeCrossPlatformFallbackCache.Load().(*cachedCompositeCrossPlatformFallback); ok && cached != nil {
		if time.Now().UnixNano() < cached.expiresAt {
			return cached.enabled
		}
	}
	result, _, _ := s.compositeCrossPlatformFallbackSF.Do(compositeCrossPlatformFallbackSFKey, func() (any, error) {
		enabled := compositeCrossPlatformFallbackFromConfig(s)
		if s.settingRepo != nil {
			if ctx == nil {
				ctx = context.Background()
			}
			dbCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), compositeCrossPlatformFallbackDBTimeout)
			defer cancel()
			value, err := s.settingRepo.GetValue(dbCtx, SettingKeyCompositeCrossPlatformFallback)
			switch {
			case err == nil:
				enabled = parseCompositeCrossPlatformFallback(value, enabled)
			case errors.Is(err, ErrSettingNotFound):
			default:
				slog.Warn("composite_cross_platform_fallback_setting_load_failed", "error", err)
			}
		}
		s.storeCompositeCrossPlatformFallback(enabled)
		return enabled, nil
	})
	enabled, _ := result.(bool)
	return enabled
}

func (s *SettingService) storeCompositeCrossPlatformFallback(enabled bool) {
	if s == nil {
		return
	}
	s.compositeCrossPlatformFallbackSF.Forget(compositeCrossPlatformFallbackSFKey)
	s.compositeCrossPlatformFallbackCache.Store(&cachedCompositeCrossPlatformFallback{
		enabled:   enabled,
		expiresAt: time.Now().Add(compositeCrossPlatformFallbackCacheTTL).UnixNano(),
	})
}
