import { describe, expect, it } from "vitest";

import {
  defaultAllowImageGenerationForPlatform,
  getDefaultImagePreviewPrice,
  getDefaultVideoPreviewPrice,
  getImagePricePlaceholder,
  getVideoPricePlaceholder,
  imagePricingI18nKey,
  supportsImagePricingPlatform,
  supportsVideoPricingPlatform,
  videoPricingI18nKey,
} from "../groupsImagePricing";

describe("groups image pricing platform support", () => {
  it("enables media pricing controls for every group", () => {
    // 全平台分组：分组不再归属单一平台，媒体定价对所有分组一律可配置。
    for (const platform of [
      "composite",
      "grok",
      "gemini",
      "antigravity",
      "openai",
      "anthropic",
      "kimi",
    ]) {
      expect(supportsImagePricingPlatform(platform)).toBe(true);
      expect(supportsVideoPricingPlatform(platform)).toBe(true);
    }
  });

  it("defaults image generation on for every group", () => {
    // 与后端 DefaultAllowImageGenerationForPlatform 对齐：全平台分组默认开启生图，
    // 运行时仍受请求解析出的目标平台约束。
    for (const platform of [
      "composite",
      "grok",
      "gemini",
      "antigravity",
      "openai",
      "anthropic",
    ]) {
      expect(defaultAllowImageGenerationForPlatform(platform)).toBe(true);
    }
  });

  it("keeps image and video pricing copy separate", () => {
    expect(imagePricingI18nKey("grok", "title")).toBe(
      "admin.groups.imagePricing.title",
    );
    expect(videoPricingI18nKey("title")).toBe("admin.groups.videoPricing.title");
  });

  it("uses Grok media defaults instead of generic image fallback placeholders", () => {
    expect(getImagePricePlaceholder("grok", "image_price_1k")).toBe("0.02");
    expect(getImagePricePlaceholder("grok", "image_price_2k")).toBe("0.02");
    // 视频 placeholder 为每秒单价：480p/720p 取 grok-imagine-video 官方每秒价，
    // 1080p 仅 video-1.5 支持、取 1.5 每秒价。
    expect(getVideoPricePlaceholder("grok", "video_price_480p")).toBe("0.05");
    expect(getVideoPricePlaceholder("grok", "video_price_720p")).toBe("0.07");
    expect(getVideoPricePlaceholder("grok", "video_price_1080p")).toBe("0.25");
  });

  it("keeps non-Grok image placeholders on the generic image card", () => {
    expect(getImagePricePlaceholder("openai", "image_price_1k")).toBe("0.134");
    expect(getDefaultImagePreviewPrice("openai", "image_price_2k")).toBe(0.201);
    expect(getDefaultVideoPreviewPrice("openai", "video_price_480p")).toBeNull();
  });
});
