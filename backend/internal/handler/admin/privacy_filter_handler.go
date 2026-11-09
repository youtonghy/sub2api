package admin

import (
	"github.com/Wei-Shaw/sub2api/internal/pkg/response"
	"github.com/Wei-Shaw/sub2api/internal/service"
	"github.com/gin-gonic/gin"
)

// PrivacyFilterHandler exposes the privacy filter settings to administrators.
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

// GetConfig handles GET /admin/risk-control/privacy-filter/config.
func (h *PrivacyFilterHandler) GetConfig(c *gin.Context) {
	config, err := h.service.GetConfig(c.Request.Context())
	if err != nil {
		response.ErrorFrom(c, err)
		return
	}
	response.Success(c, config)
}

// UpdateConfig handles PUT /admin/risk-control/privacy-filter/config.
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

// GetStatus handles GET /admin/risk-control/privacy-filter/status.
func (h *PrivacyFilterHandler) GetStatus(c *gin.Context) {
	response.Success(c, h.service.GetStatus())
}
