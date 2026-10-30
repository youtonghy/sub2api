import { describe, expect, it } from "vitest";

import {
  normalizeGroupOpenAIFast,
  supportsGroupOpenAIFast,
} from "../groupsOpenAIFast";
import en from "@/i18n/locales/en/admin/overview";
import zh from "@/i18n/locales/zh/admin/overview";

describe("groupsOpenAIFast", () => {
  it("supports every group since all groups are universal", () => {
    for (const platform of ["openai", "composite", "anthropic", "gemini", "grok"]) {
      expect(supportsGroupOpenAIFast(platform)).toBe(true);
    }
  });

  it("keeps the switch value on every platform", () => {
    // 全平台分组的 Fast 开关只在请求解析到 OpenAI 时生效，保存时不得被归零。
    for (const platform of ["openai", "composite", "anthropic", "gemini"]) {
      expect(normalizeGroupOpenAIFast(platform, true)).toBe(true);
    }
    expect(normalizeGroupOpenAIFast("openai", false)).toBe(false);
  });

  it("provides localized switch labels", () => {
    expect(zh.groups.openaiFast).toMatchObject({
      title: expect.any(String),
      force: expect.any(String),
      hint: expect.stringContaining("service_tier=priority"),
      free: expect.any(String),
      freeHint: expect.stringContaining("Standard"),
    });
    expect(en.groups.openaiFast).toMatchObject({
      title: expect.any(String),
      force: expect.any(String),
      hint: expect.stringContaining("service_tier=priority"),
      free: expect.any(String),
      freeHint: expect.stringContaining("Standard"),
    });
  });
});
