package admin

import (
	"net/http"

	"github.com/Wei-Shaw/sub2api/internal/pkg/response"
	"github.com/gin-gonic/gin"
)

const maxAccountFailureIDs = 500

type accountHourlyFailuresRequest struct {
	AccountIDs []int64 `json:"account_ids"`
}

// GetAccountHourlyFailures returns today's hourly upstream-attempt failure rate
// for the requested accounts.
func (h *OpsHandler) GetAccountHourlyFailures(c *gin.Context) {
	if h.opsService == nil {
		response.Error(c, http.StatusServiceUnavailable, "Ops service not available")
		return
	}
	var req accountHourlyFailuresRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.BadRequest(c, "Invalid request body")
		return
	}
	if len(req.AccountIDs) == 0 || len(req.AccountIDs) > maxAccountFailureIDs {
		response.BadRequest(c, "account_ids must contain between 1 and 500 IDs")
		return
	}
	seen := make(map[int64]struct{}, len(req.AccountIDs))
	ids := make([]int64, 0, len(req.AccountIDs))
	for _, id := range req.AccountIDs {
		if id <= 0 {
			response.BadRequest(c, "account_ids must contain positive IDs")
			return
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		ids = append(ids, id)
	}

	result, err := h.opsService.GetAccountHourlyFailures(c.Request.Context(), ids)
	if err != nil {
		response.ErrorFrom(c, err)
		return
	}
	response.Success(c, result)
}
