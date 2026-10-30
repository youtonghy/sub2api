// 分组已不再归属单一平台：所有分组都是全平台分组（composite），
// 原本按平台显示的配置区块因此一律展示。参数保留是为了让调用点与
// 后端 `groupSupportsOpenAIFast` 的签名保持一致，便于将来恢复平台维度。
export function supportsGroupOpenAIFast(_platform: string): boolean {
  return true;
}

// 全平台分组下 Fast 开关的语义由请求解析出的目标平台决定，
// 因此保存时不再因为分组平台而把开关归零。
export function normalizeGroupOpenAIFast(
  _platform: string,
  enabled: boolean,
): boolean {
  return enabled;
}
