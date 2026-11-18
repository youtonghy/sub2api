package routes

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/Wei-Shaw/sub2api/internal/domain"
	servermiddleware "github.com/Wei-Shaw/sub2api/internal/server/middleware"
	"github.com/Wei-Shaw/sub2api/internal/service"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

// Scenario: 跨平台回退开启时，多个 OpenAI 网关族平台认领的模型在中间件即解析出
// 首选平台并注入回退序列，从而分发到 OpenAI 网关 handler；关闭时保持未解析。
func TestCompositeTargetPlatformMiddlewareCrossPlatformFallback(t *testing.T) {
	gin.SetMode(gin.TestMode)
	for _, tc := range []struct {
		name         string
		enabled      bool
		wantResolved bool
	}{
		{name: "enabled", enabled: true, wantResolved: true},
		{name: "disabled", enabled: false, wantResolved: false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			resolver := service.NewCompositeRouteResolver(nil)
			resolver.SetModelOwnershipResolver(func(context.Context, int64, string) (service.CompositeModelOwnership, error) {
				return service.CompositeModelOwnership{
					Ambiguous: true,
					Platforms: []string{service.PlatformOpenAI, service.PlatformOpenCodeGo},
				}, nil
			})
			resolver.SetCrossPlatformFallbackEnabled(func(context.Context) bool { return tc.enabled })

			router := gin.New()
			router.Use(gin.HandlerFunc(servermiddleware.APIKeyAuthMiddleware(func(c *gin.Context) {
				groupID := int64(8)
				c.Set(string(servermiddleware.ContextKeyAPIKey), &service.APIKey{
					GroupID: &groupID,
					Group:   &service.Group{ID: groupID, Platform: service.PlatformComposite},
				})
				c.Next()
			})))
			router.Use(compositeTargetPlatformMiddleware(resolver))
			router.POST("/v1/chat/completions", func(c *gin.Context) {
				platform, resolved := service.ResolvedTargetPlatformFromContext(c.Request.Context())
				require.Equal(t, tc.wantResolved, resolved)
				if tc.wantResolved {
					require.Equal(t, service.PlatformOpenAI, platform)
					require.Equal(t, []string{service.PlatformOpenCodeGo}, service.CompositeFallbackPlatformsFromContext(c.Request.Context()))
					require.True(t, domain.UsesOpenAIGateway(getGroupPlatform(c)), "must dispatch to the OpenAI gateway handler")
				} else {
					require.Empty(t, service.CompositeFallbackPlatformsFromContext(c.Request.Context()))
				}
				c.Status(http.StatusNoContent)
			})

			req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(`{"model":"qwen4-max"}`))
			req.Header.Set("Content-Type", "application/json")
			w := httptest.NewRecorder()
			router.ServeHTTP(w, req)
			require.Equal(t, http.StatusNoContent, w.Code)
		})
	}
}
