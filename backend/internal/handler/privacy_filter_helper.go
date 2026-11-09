package handler

import (
	"github.com/Wei-Shaw/sub2api/internal/service"
	"github.com/gin-gonic/gin"
	"go.uber.org/zap"
)

// privacyFilterClientMessage is safe to show clients: it reveals nothing about
// the request text or the rule that failed.
const privacyFilterClientMessage = "The privacy filter could not process this request"

// runPrivacyFilter must run before security auditing, so audit storage and any
// third-party moderation service receive the redacted text as well. On error
// the request has to be rejected rather than forwarded.
func runPrivacyFilter(c *gin.Context, reqLog *zap.Logger, svc *service.PrivacyFilterService, apiKey *service.APIKey, protocol string, body []byte) ([]byte, error) {
	if svc == nil || apiKey == nil {
		return body, nil
	}
	result, err := svc.Apply(c.Request.Context(), service.PrivacyFilterInput{
		GroupID:  apiKey.GroupID,
		Protocol: protocol,
		Body:     body,
	})
	if err != nil {
		if reqLog != nil {
			reqLog.Error("privacy_filter.failed", zap.String("protocol", protocol), zap.Error(err))
		}
		return nil, err
	}
	if reqLog != nil && len(result.Counts) > 0 {
		reqLog.Info("privacy_filter.applied",
			zap.String("mode", result.Mode),
			zap.String("protocol", protocol),
			zap.Int("fields", result.Fields),
			zap.Any("counts", result.Counts),
		)
	}
	return result.Body, nil
}

func (h *GatewayHandler) applyPrivacyFilter(c *gin.Context, reqLog *zap.Logger, apiKey *service.APIKey, protocol string, body []byte) ([]byte, error) {
	return runPrivacyFilter(c, reqLog, h.privacyFilterService, apiKey, protocol, body)
}

func (h *OpenAIGatewayHandler) applyPrivacyFilter(c *gin.Context, reqLog *zap.Logger, apiKey *service.APIKey, protocol string, body []byte) ([]byte, error) {
	return runPrivacyFilter(c, reqLog, h.privacyFilterService, apiKey, protocol, body)
}

// applyPrivacyFilterToParsed also refreshes the raw ranges held by parsedReq.
func (h *GatewayHandler) applyPrivacyFilterToParsed(c *gin.Context, reqLog *zap.Logger, apiKey *service.APIKey, protocol string, parsedReq *service.ParsedRequest) ([]byte, error) {
	current := parsedReq.Body.Bytes()
	filtered, err := h.applyPrivacyFilter(c, reqLog, apiKey, protocol, current)
	if err != nil {
		return nil, err
	}
	if len(filtered) == len(current) && string(filtered) == string(current) {
		return current, nil
	}
	if err := parsedReq.ReplaceBody(filtered); err != nil {
		return nil, err
	}
	return parsedReq.Body.Bytes(), nil
}
