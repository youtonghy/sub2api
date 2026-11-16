package handler

import (
	"strconv"
	"strings"
	"time"

	"github.com/Wei-Shaw/sub2api/internal/handler/admin"
	"github.com/Wei-Shaw/sub2api/internal/pkg/response"
	middleware2 "github.com/Wei-Shaw/sub2api/internal/server/middleware"
	"github.com/Wei-Shaw/sub2api/internal/service"
	"github.com/gin-gonic/gin"
)

// PrivacyFilterHandler lists the signed-in user's own privacy filter records.
type PrivacyFilterHandler struct {
	privacyFilterService *service.PrivacyFilterService
	apiKeyService        *service.APIKeyService
}

func NewPrivacyFilterHandler(privacyFilterService *service.PrivacyFilterService, apiKeyService *service.APIKeyService) *PrivacyFilterHandler {
	return &PrivacyFilterHandler{privacyFilterService: privacyFilterService, apiKeyService: apiKeyService}
}

// privacyFilterUserEvent leaves out the fields only administrators see.
type privacyFilterUserEvent struct {
	ID         int64          `json:"id"`
	CreatedAt  time.Time      `json:"created_at"`
	APIKeyID   *int64         `json:"api_key_id,omitempty"`
	APIKeyName string         `json:"api_key_name"`
	Model      string         `json:"model"`
	Action     string         `json:"action"`
	Fields     int            `json:"fields"`
	TotalHits  int            `json:"total_hits"`
	Categories map[string]int `json:"categories"`
}

// ListEvents handles GET /api/v1/privacy-filter/events. Results are always
// limited to the caller's own records.
func (h *PrivacyFilterHandler) ListEvents(c *gin.Context) {
	subject, ok := middleware2.GetAuthSubjectFromContext(c)
	if !ok {
		response.Unauthorized(c, "User not authenticated")
		return
	}
	filter, ok := admin.ParsePrivacyFilterEventQuery(c)
	if !ok {
		return
	}
	userID := subject.UserID
	filter.UserID = &userID

	if raw := strings.TrimSpace(c.Query("api_key_id")); raw != "" {
		id, err := strconv.ParseInt(raw, 10, 64)
		if err != nil || id <= 0 {
			response.BadRequest(c, "Invalid api_key_id")
			return
		}
		apiKey, err := h.apiKeyService.GetByID(c.Request.Context(), id)
		if err != nil {
			response.ErrorFrom(c, err)
			return
		}
		if apiKey.UserID != subject.UserID {
			response.Forbidden(c, "Not authorized to access this API key's records")
			return
		}
		filter.APIKeyID = &id
	}

	list, err := h.privacyFilterService.ListEvents(c.Request.Context(), filter)
	if err != nil {
		response.ErrorFrom(c, err)
		return
	}
	items := make([]privacyFilterUserEvent, 0, len(list.Items))
	for _, event := range list.Items {
		items = append(items, privacyFilterUserEvent{
			ID:         event.ID,
			CreatedAt:  event.CreatedAt,
			APIKeyID:   event.APIKeyID,
			APIKeyName: event.APIKeyName,
			Model:      event.Model,
			Action:     event.Action,
			Fields:     event.Fields,
			TotalHits:  event.TotalHits,
			Categories: event.Categories,
		})
	}
	response.Paginated(c, items, list.Total, list.Page, list.PageSize)
}
