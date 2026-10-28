import { describe, expect, it } from "vitest";
import { normalizeSupportedModelScopesForPlatform } from "../groupsSupportedModelScopes";

describe("normalizeSupportedModelScopesForPlatform", () => {
  it("preserves model scopes for universal groups", () => {
    expect(
      normalizeSupportedModelScopesForPlatform("composite", [
        "claude",
        "gemini_text",
      ]),
    ).toEqual(["claude", "gemini_text"]);
  });

  it("returns an empty array when no scopes are configured", () => {
    expect(
      normalizeSupportedModelScopesForPlatform("composite", undefined),
    ).toEqual([]);
  });

  it("keeps configured scopes instead of wiping them for a concrete platform value", () => {
    // 回归：分组平台恒为 composite；任何残留的具体平台值都不得清空作用域，
    // 否则保存分组会静默丢掉已配置的 Antigravity 模型作用域。
    expect(
      normalizeSupportedModelScopesForPlatform("openai", [
        "claude",
        "gemini_text",
        "gemini_image",
      ]),
    ).toEqual(["claude", "gemini_text", "gemini_image"]);
    expect(
      normalizeSupportedModelScopesForPlatform("claude", ["claude"]),
    ).toEqual(["claude"]);
  });
});
