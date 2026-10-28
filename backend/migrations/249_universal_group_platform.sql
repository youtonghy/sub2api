-- 全平台分组：分组不再归属单一平台。
--
-- 分组 platform 退化为「形态标记」，恒为 composite。现存所有具体平台分组回填为
-- composite，使既有账号绑定、订阅、渠道定价与用量历史继续有效：账号仍在自己的
-- accounts.platform 上，调度时按请求模型解析出的目标平台在对应平台账号池内选号。
--
-- 同时把列默认值改为 composite，避免新分组（含历史代码路径遗漏 platform 时）落回
-- 某个具体平台。无 CHECK 约束需要修改（见 242_drop_platform_check_constraints.sql）。
--
-- 可重入：纯 UPDATE + 幂等 ALTER。

UPDATE groups
SET platform = 'composite',
    updated_at = NOW()
WHERE platform IS DISTINCT FROM 'composite';

ALTER TABLE groups
    ALTER COLUMN platform SET DEFAULT 'composite';
