-- 隐私过滤命中记录（append-only）
-- 每个命中隐私过滤（或因过滤失败被拒绝）的网关请求写一行，供管理员和用户本人查看。
-- 设计约束：
--   1. 只保存类别与次数，从不保存命中的原文、位置或占位符
--   2. 与 usage_logs 共用“请求记录保留天数”，由 DashboardAggregationService 一并清理
--   3. request_id 与 usage_logs.request_id 的格式一致（client:/local: 前缀），便于对照
CREATE TABLE IF NOT EXISTS privacy_filter_events (
    id BIGSERIAL PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    request_id VARCHAR(128) NOT NULL DEFAULT '',
    user_id BIGINT,
    user_email VARCHAR(255) NOT NULL DEFAULT '',
    api_key_id BIGINT,
    api_key_name VARCHAR(255) NOT NULL DEFAULT '',
    group_id BIGINT,
    group_name VARCHAR(255) NOT NULL DEFAULT '',
    endpoint VARCHAR(255) NOT NULL DEFAULT '',
    protocol VARCHAR(64) NOT NULL DEFAULT '',
    model VARCHAR(255) NOT NULL DEFAULT '',
    action VARCHAR(16) NOT NULL DEFAULT '',
    fields INT NOT NULL DEFAULT 0,
    total_hits INT NOT NULL DEFAULT 0,
    categories JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_privacy_filter_events_created_id
    ON privacy_filter_events (created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_privacy_filter_events_user_created
    ON privacy_filter_events (user_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_privacy_filter_events_request_id
    ON privacy_filter_events (request_id);
CREATE INDEX IF NOT EXISTS idx_privacy_filter_events_categories
    ON privacy_filter_events USING GIN (categories);
