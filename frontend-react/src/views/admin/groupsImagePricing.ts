// 分组已不再归属单一平台：所有分组都是全平台分组，图片/视频定价与生图开关
// 一律可配置。平台参数保留以对齐后端签名（并在需要时用于占位价选择）。
export const supportsImagePricingPlatform = (_platform: string): boolean => true;

// 与后端 DefaultAllowImageGenerationForPlatform 一致：全平台分组新建时默认允许生图
// （开关在运行时仍受请求解析出的目标平台约束）。
export const defaultAllowImageGenerationForPlatform = (
  _platform: string,
): boolean => true;

export const supportsVideoPricingPlatform = (_platform: string): boolean => true;

export const imagePricingI18nKey = (_platform: string, key: string): string =>
  `admin.groups.imagePricing.${key}`;

export const videoPricingI18nKey = (key: string): string =>
  `admin.groups.videoPricing.${key}`;

type ImagePricingTierKey = "image_price_1k" | "image_price_2k" | "image_price_4k";
type VideoPricingTierKey =
  | "video_price_480p"
  | "video_price_720p"
  | "video_price_1080p";

const defaultImagePricePlaceholders: Record<
  string,
  Record<ImagePricingTierKey, string>
> = {
  default: {
    image_price_1k: "0.134",
    image_price_2k: "0.201",
    image_price_4k: "0.268",
  },
  grok: {
    image_price_1k: "0.02",
    image_price_2k: "0.02",
    image_price_4k: "0.02",
  },
};

// 视频价为每秒单价（USD/s）。480p/720p 取 grok-imagine-video（文生视频实际走该模型）的
// 官方每秒价；1080p 仅 grok-imagine-video-1.5 图生视频支持，取 1.5 的每秒价。
const defaultVideoPricePlaceholders: Record<
  string,
  Record<VideoPricingTierKey, string>
> = {
  grok: {
    video_price_480p: "0.05",
    video_price_720p: "0.07",
    video_price_1080p: "0.25",
  },
};

export const getImagePricePlaceholder = (
  platform: string,
  tier: ImagePricingTierKey,
): string => {
  const card =
    defaultImagePricePlaceholders[platform] ?? defaultImagePricePlaceholders.default;
  return card[tier];
};

export const getVideoPricePlaceholder = (
  platform: string,
  tier: VideoPricingTierKey,
): string => {
  const card = defaultVideoPricePlaceholders[platform];
  return card?.[tier] ?? "";
};

export const getDefaultImagePreviewPrice = (
  platform: string,
  tier: ImagePricingTierKey,
): number | null => {
  const placeholder = getImagePricePlaceholder(platform, tier);
  if (placeholder === "") {
    return null;
  }
  const value = Number(placeholder);
  return Number.isFinite(value) ? value : null;
};

export const getDefaultVideoPreviewPrice = (
  platform: string,
  tier: VideoPricingTierKey,
): number | null => {
  const placeholder = getVideoPricePlaceholder(platform, tier);
  if (placeholder === "") {
    return null;
  }
  const value = Number(placeholder);
  return Number.isFinite(value) ? value : null;
};
