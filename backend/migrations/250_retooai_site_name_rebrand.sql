-- 品牌更名：站点名默认值由 Sub2API 改为 RetooAi。
--
-- 管理员保存过系统设置的部署会把旧的回退值 'Sub2API' 写进 settings，
-- 仅修改代码默认值对它们无效。这里只替换与旧默认值完全一致的记录，
-- 管理员自定义过的站点名保持不变。
--
-- 可重入：纯条件 UPDATE。

UPDATE settings
SET value = 'RetooAi',
    updated_at = NOW()
WHERE key = 'site_name'
  AND value = 'Sub2API';
