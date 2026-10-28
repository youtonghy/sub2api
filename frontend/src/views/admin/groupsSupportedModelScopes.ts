// 分组已不再归属单一平台：所有分组都是全平台分组，模型作用域一律保留。
// 历史实现会对非 antigravity 分组返回 []，导致保存时静默清空已配置的作用域。
export const normalizeSupportedModelScopesForPlatform = (
  _platform: string,
  scopes: string[] | undefined,
): string[] => scopes ?? [];
