package admin

import (
	"strconv"
	"strings"

	"github.com/Wei-Shaw/sub2api/internal/pkg/privacyfilter"
	"github.com/Wei-Shaw/sub2api/internal/pkg/response"
	"github.com/Wei-Shaw/sub2api/internal/pkg/timezone"
	"github.com/Wei-Shaw/sub2api/internal/service"
	"github.com/gin-gonic/gin"
)

// PrivacyFilterHandler exposes the privacy filter settings and records to
// administrators.
type PrivacyFilterHandler struct {
	service *service.PrivacyFilterService
}

func NewPrivacyFilterHandler(svc *service.PrivacyFilterService) *PrivacyFilterHandler {
	return &PrivacyFilterHandler{service: svc}
}

type privacyFilterConfigRequest struct {
	Mode       string   `json:"mode" binding:"required"`
	GroupIDs   []int64  `json:"group_ids"`
	Categories []string `json:"categories"`
}

// GetConfig handles GET /admin/privacy-filter/config.
func (h *PrivacyFilterHandler) GetConfig(c *gin.Context) {
	config, err := h.service.GetConfig(c.Request.Context())
	if err != nil {
		response.ErrorFrom(c, err)
		return
	}
	response.Success(c, config)
}

// UpdateConfig handles PUT /admin/privacy-filter/config.
func (h *PrivacyFilterHandler) UpdateConfig(c *gin.Context) {
	var req privacyFilterConfigRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.BadRequest(c, "Invalid request: "+err.Error())
		return
	}
	config, err := h.service.UpdateConfig(c.Request.Context(), service.PrivacyFilterConfig{
		Mode:       req.Mode,
		GroupIDs:   req.GroupIDs,
		Categories: req.Categories,
	})
	if err != nil {
		response.ErrorFrom(c, err)
		return
	}
	response.Success(c, config)
}

// GetStatus handles GET /admin/privacy-filter/status.
func (h *PrivacyFilterHandler) GetStatus(c *gin.Context) {
	response.Success(c, h.service.GetStatus())
}

// ListEvents handles GET /admin/privacy-filter/events across all users.
func (h *PrivacyFilterHandler) ListEvents(c *gin.Context) {
	filter, ok := ParsePrivacyFilterEventQuery(c)
	if !ok {
		return
	}
	for _, param := range []struct {
		name   string
		target **int64
	}{
		{"user_id", &filter.UserID},
		{"api_key_id", &filter.APIKeyID},
		{"group_id", &filter.GroupID},
	} {
		raw := strings.TrimSpace(c.Query(param.name))
		if raw == "" {
			continue
		}
		id, err := strconv.ParseInt(raw, 10, 64)
		if err != nil || id <= 0 {
			response.BadRequest(c, "Invalid "+param.name)
			return
		}
		*param.target = &id
	}
	filter.RequestID = strings.TrimSpace(c.Query("request_id"))
	filter.Query = strings.TrimSpace(c.Query("q"))

	list, err := h.service.ListEvents(c.Request.Context(), filter)
	if err != nil {
		response.ErrorFrom(c, err)
		return
	}
	response.Paginated(c, list.Items, list.Total, list.Page, list.PageSize)
}

// ParsePrivacyFilterEventQuery reads the filters shared by the admin and user
// record lists: page, page_size, start_date/end_date (YYYY-MM-DD in timezone,
// end inclusive), action and category. It writes the error response itself.
func ParsePrivacyFilterEventQuery(c *gin.Context) (*service.PrivacyFilterEventFilter, bool) {
	page, pageSize := response.ParsePagination(c)
	filter := &service.PrivacyFilterEventFilter{Page: page, PageSize: pageSize}

	userTZ := c.Query("timezone")
	if raw := strings.TrimSpace(c.Query("start_date")); raw != "" {
		start, err := timezone.ParseInUserLocation("2006-01-02", raw, userTZ)
		if err != nil {
			response.BadRequest(c, "Invalid start_date format, use YYYY-MM-DD")
			return nil, false
		}
		filter.StartTime = &start
	}
	if raw := strings.TrimSpace(c.Query("end_date")); raw != "" {
		end, err := timezone.ParseInUserLocation("2006-01-02", raw, userTZ)
		if err != nil {
			response.BadRequest(c, "Invalid end_date format, use YYYY-MM-DD")
			return nil, false
		}
		end = end.AddDate(0, 0, 1)
		filter.EndTime = &end
	}
	if filter.StartTime != nil && filter.EndTime != nil && !filter.StartTime.Before(*filter.EndTime) {
		response.BadRequest(c, "start_date must not be after end_date")
		return nil, false
	}

	switch action := strings.TrimSpace(c.Query("action")); action {
	case "", service.PrivacyFilterModeObserve, service.PrivacyFilterModeRedact,
		service.PrivacyFilterModeRestore, service.PrivacyFilterEventActionFailed:
		filter.Action = action
	default:
		response.BadRequest(c, "Invalid action")
		return nil, false
	}
	if category := strings.TrimSpace(c.Query("category")); category != "" {
		if !privacyfilter.IsValidCategory(category) {
			response.BadRequest(c, "Invalid category")
			return nil, false
		}
		filter.Category = category
	}
	return filter, true
}
