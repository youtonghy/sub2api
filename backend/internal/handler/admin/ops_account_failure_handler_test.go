package admin

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/Wei-Shaw/sub2api/internal/service"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

type accountFailureRepoStub struct {
	service.OpsRepository
	ids []int64
}

func (r *accountFailureRepoStub) GetAccountHourlyFailureBuckets(_ context.Context, ids []int64, _, _ time.Time, _ string) ([]*service.OpsAccountHourlyFailureBucket, error) {
	r.ids = append([]int64(nil), ids...)
	return []*service.OpsAccountHourlyFailureBucket{}, nil
}

func accountFailureTestRouter(h *OpsHandler) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.POST("/failures", h.GetAccountHourlyFailures)
	return r
}

func TestOpsAccountFailureHandlerRejectsInvalidIDs(t *testing.T) {
	svc := service.NewOpsService(&accountFailureRepoStub{}, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil)
	r := accountFailureTestRouter(NewOpsHandler(svc))
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/failures", bytes.NewBufferString(`{"account_ids":[1,-2]}`))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)
	require.Equal(t, http.StatusBadRequest, w.Code)
}

func TestOpsAccountFailureHandlerDeduplicatesIDs(t *testing.T) {
	repo := &accountFailureRepoStub{}
	svc := service.NewOpsService(repo, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil)
	r := accountFailureTestRouter(NewOpsHandler(svc))
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/failures", bytes.NewBufferString(`{"account_ids":[7,7,9]}`))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)
	require.Equal(t, http.StatusOK, w.Code)
	require.Equal(t, []int64{7, 9}, repo.ids)
}
