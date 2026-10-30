import { describe, expect, it } from "vitest";

import {
  createReasoningEffortMappingPair,
  createReasoningEffortMappingRow,
  normalizeReasoningEffortForPlatform,
  normalizeReasoningEffortSourceForPlatform,
  normalizeReasoningEffortMatchType,
  normalizeReasoningEffortOverLimit,
  reasoningEffortMappingsToAPI,
  reasoningEffortMappingsToRows,
  reasoningEffortOptionsForPlatform,
  reasoningEffortSourceOptionsForPlatform,
  reasoningEffortTargetOptionsForPlatform,
  reasoningEffortMappingDeny,
  reasoningEffortOverLimitDeny,
  reasoningEffortOverLimitDowngrade,
  normalizeReasoningEffortTargetForPlatform,
  supportsReasoningEffortPolicyPlatform,
  validateReasoningEffortMappings,
} from "../groupsReasoningEffort";

describe("groupsReasoningEffort", () => {
  it("provides fixed OpenAI choices to OpenAI and Composite groups", () => {
    const expected = [
      "minimal",
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
    ];
    for (const platform of ["openai", "composite"] as const) {
      expect(
        reasoningEffortOptionsForPlatform(platform).map(
          (option) => option.value,
        ),
      ).toEqual(expected);
      expect(
        reasoningEffortSourceOptionsForPlatform(platform).map(
          (option) => option.value,
        ),
      ).toEqual(["none", ...expected]);
      expect(
        reasoningEffortTargetOptionsForPlatform(platform).map(
          (option) => option.value,
        ),
      ).toEqual([...expected, reasoningEffortMappingDeny]);
      expect(supportsReasoningEffortPolicyPlatform(platform)).toBe(true);
    }
    // 全平台分组统一使用 OpenAI 取值集合（Anthropic 集合是其去掉 minimal 的子集，
    // 后端 anthropicCompatibleReasoningEffortPolicy 会把 minimal 降级为 low）。
    expect(
      reasoningEffortOptionsForPlatform("anthropic").map(
        (option) => option.value,
      ),
    ).toEqual(expected);
    expect(
      reasoningEffortTargetOptionsForPlatform("anthropic").map(
        (option) => option.value,
      ),
    ).toEqual([...expected, reasoningEffortMappingDeny]);
    expect(supportsReasoningEffortPolicyPlatform("anthropic")).toBe(true);

    // 全平台分组：推理强度策略对所有分组可用，取值统一。
    for (const platform of [
      "gemini",
      "antigravity",
      "grok",
      "kimi",
      "composite",
    ] as const) {
      expect(
        reasoningEffortOptionsForPlatform(platform).map((option) => option.value),
      ).toEqual(["minimal", "low", "medium", "high", "xhigh", "max"]);
      expect(
        reasoningEffortSourceOptionsForPlatform(platform).map((option) => option.value),
      ).toEqual(["none", "minimal", "low", "medium", "high", "xhigh", "max"]);
      expect(supportsReasoningEffortPolicyPlatform(platform)).toBe(true);
    }
  });

  it("hydrates supported rows and drops stale custom values", () => {
    const rows = reasoningEffortMappingsToRows(
      [
        { from: " max ", to: " xhigh " },
        { from: "ultra", to: "high" },
      ],
      "openai",
    );

    expect(rows).toHaveLength(1);
    expect(reasoningEffortMappingsToAPI(rows)).toEqual([
      { from: "max", to: "xhigh" },
    ]);
  });

  it("hydrates and validates none only as a mapping source", () => {
    const rows = reasoningEffortMappingsToRows(
      [{ from: " NONE ", to: "low" }],
      "openai",
    );
    expect(reasoningEffortMappingsToAPI(rows)).toEqual([
      { from: "none", to: "low" },
    ]);
    expect(validateReasoningEffortMappings(rows, "openai")).toEqual({});
    expect(normalizeReasoningEffortSourceForPlatform("composite", " NONE ")).toBe("none");

    const invalidTarget = createReasoningEffortMappingRow({
      from: "low",
      to: "none",
    });
    expect(validateReasoningEffortMappings([invalidTarget], "openai")).toEqual({
      [invalidTarget.pairs[0].id]: { to: "unsupportedTo" },
    });
    expect(normalizeReasoningEffortForPlatform("openai", "none")).toBe("");
  });

  it("hydrates and validates deny only as a mapping target", () => {
    const rows = reasoningEffortMappingsToRows(
      [{ from: " xhigh ", to: " DENY " }],
      "openai",
    );
    expect(reasoningEffortMappingsToAPI(rows)).toEqual([
      { from: "xhigh", to: reasoningEffortMappingDeny },
    ]);
    expect(validateReasoningEffortMappings(rows, "openai")).toEqual({});
    expect(normalizeReasoningEffortTargetForPlatform("openai", " Deny ")).toBe(
      reasoningEffortMappingDeny,
    );
    expect(normalizeReasoningEffortForPlatform("openai", "deny")).toBe("");
    expect(normalizeReasoningEffortSourceForPlatform("openai", "deny")).toBe("");

    const invalidSource = createReasoningEffortMappingRow({
      from: "deny",
      to: "low",
    });
    expect(validateReasoningEffortMappings([invalidSource], "openai")).toEqual({
      [invalidSource.pairs[0].id]: { from: "unsupportedFrom" },
    });
  });

  it("hydrates model scoped mappings", () => {
    const rows = reasoningEffortMappingsToRows(
      [
        {
          from: "max",
          to: "low",
          match_type: "prefix",
          model: " gpt ",
        },
        {
          from: "max",
          to: "medium",
          match_type: "exact",
          model: "gpt-5.4",
        },
      ],
      "openai",
    );

    expect(reasoningEffortMappingsToAPI(rows)).toEqual([
      { from: "max", to: "low", match_type: "prefix", model: "gpt" },
      { from: "max", to: "medium", match_type: "exact", model: "gpt-5.4" },
    ]);
  });

  it("groups multiple request mappings under the same type and model", () => {
    const rows = reasoningEffortMappingsToRows(
      [
        { from: "high", to: "medium", match_type: "prefix", model: "gpt" },
        { from: "xhigh", to: "medium", match_type: "prefix", model: "GPT" },
      ],
      "openai",
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].match_type).toBe("prefix");
    expect(rows[0].model).toBe("gpt");
    expect(rows[0].pairs.map((pair) => pair.from)).toEqual(["high", "xhigh"]);
    expect(reasoningEffortMappingsToAPI(rows)).toEqual([
      { from: "high", to: "medium", match_type: "prefix", model: "gpt" },
      { from: "xhigh", to: "medium", match_type: "prefix", model: "gpt" },
    ]);
  });

  it("omits empty model scopes from the API payload", () => {
    const row = createReasoningEffortMappingRow({
      from: "max",
      to: "low",
      match_type: "prefix",
    });
    expect(reasoningEffortMappingsToAPI([row])).toEqual([
      { from: "max", to: "low" },
    ]);
  });

  it("hydrates suffix mappings", () => {
    const rows = reasoningEffortMappingsToRows(
      [{ from: "max", to: "low", match_type: "suffix", model: " mini " }],
      "openai",
    );
    expect(reasoningEffortMappingsToAPI(rows)).toEqual([
      { from: "max", to: "low", match_type: "suffix", model: "mini" },
    ]);
  });

  it("clears values unsupported by OpenAI or used on another platform", () => {
    expect(normalizeReasoningEffortForPlatform("openai", " MAX ")).toBe("max");
    expect(normalizeReasoningEffortForPlatform("composite", " MAX ")).toBe(
      "max",
    );
    expect(normalizeReasoningEffortForPlatform("anthropic", "xhigh")).toBe(
      "xhigh",
    );
    // minimal 在 Anthropic 侧由后端降级为 low，前端仍保留该值以便切换平台不丢配置。
    expect(normalizeReasoningEffortForPlatform("anthropic", "minimal")).toBe(
      "minimal",
    );
    // 全平台分组下所有平台共用同一取值集合，"max" 在所有分组上都保留。
    expect(normalizeReasoningEffortForPlatform("grok", "max")).toBe("max");
    expect(normalizeReasoningEffortForPlatform("openai", "none")).toBe("");
    expect(normalizeReasoningEffortForPlatform("kimi", "bogus")).toBe("");
  });

  it("normalizes match type to exact, prefix, suffix, or empty", () => {
    expect(normalizeReasoningEffortMatchType("PREFIX")).toBe("prefix");
    expect(normalizeReasoningEffortMatchType("suffix")).toBe("suffix");
    expect(normalizeReasoningEffortMatchType("exact")).toBe("exact");
    expect(normalizeReasoningEffortMatchType("")).toBe("");
    expect(normalizeReasoningEffortMatchType("wildcard")).toBe("");
  });

  it("requires both sides of every mapping", () => {
    const first = createReasoningEffortMappingRow({ to: "low" });
    const second = createReasoningEffortMappingRow({ from: "max" });

    expect(validateReasoningEffortMappings([first, second])).toEqual({
      [first.id]: { duplicateScope: "duplicateScope" },
      [second.id]: { duplicateScope: "duplicateScope" },
      [first.pairs[0].id]: { from: "fromRequired" },
      [second.pairs[0].id]: { to: "toRequired" },
    });
  });

  it("rejects duplicate source values case insensitively", () => {
    const first = createReasoningEffortMappingRow({ from: "MAX", to: "xhigh" });
    const second = createReasoningEffortMappingRow({ from: " max ", to: "high" });

    expect(validateReasoningEffortMappings([first, second])).toEqual({
      [first.id]: { duplicateScope: "duplicateScope" },
      [second.id]: { duplicateScope: "duplicateScope" },
      [first.pairs[0].id]: { from: "duplicateFrom" },
      [second.pairs[0].id]: { from: "duplicateFrom" },
    });
  });

  it("allows the same source across different model scopes", () => {
    const prefix = createReasoningEffortMappingRow({
      from: "max",
      to: "low",
      match_type: "prefix",
      model: "gpt",
    });
    const exact = createReasoningEffortMappingRow({
      from: "max",
      to: "medium",
      match_type: "exact",
      model: "gpt-5.4",
    });
    const global = createReasoningEffortMappingRow({ from: "max", to: "high" });

    expect(validateReasoningEffortMappings([prefix, exact, global])).toEqual({});
  });

  it("allows multiple request values in one model scope", () => {
    const row = createReasoningEffortMappingRow({
      from: "high",
      to: "medium",
      match_type: "prefix",
      model: "gpt",
    });
    row.pairs.push(
      createReasoningEffortMappingPair({ from: "xhigh", to: "medium" }),
    );

    expect(validateReasoningEffortMappings([row])).toEqual({});
    expect(reasoningEffortMappingsToAPI([row])).toEqual([
      { from: "high", to: "medium", match_type: "prefix", model: "gpt" },
      { from: "xhigh", to: "medium", match_type: "prefix", model: "gpt" },
    ]);
  });

  it("rejects duplicate source values within the same model scope", () => {
    const first = createReasoningEffortMappingRow({
      from: "max",
      to: "low",
      match_type: "prefix",
      model: "GPT",
    });
    const second = createReasoningEffortMappingRow({
      from: "MAX",
      to: "high",
      match_type: "prefix",
      model: " gpt ",
    });

    expect(validateReasoningEffortMappings([first, second])).toEqual({
      [first.id]: { duplicateScope: "duplicateScope" },
      [second.id]: { duplicateScope: "duplicateScope" },
      [first.pairs[0].id]: { from: "duplicateFrom" },
      [second.pairs[0].id]: { from: "duplicateFrom" },
    });
  });

  it("allows empty type and model as a global mapping", () => {
    const row = createReasoningEffortMappingRow({
      from: "max",
      to: "low",
    });
    expect(row.match_type).toBe("");
    expect(row.model).toBe("");
    expect(validateReasoningEffortMappings([row], "openai")).toEqual({});
  });

  it("treats prefix without a model as a global mapping", () => {
    const row = createReasoningEffortMappingRow({
      from: "max",
      to: "low",
      match_type: "prefix",
    });
    expect(validateReasoningEffortMappings([row], "openai")).toEqual({});
    expect(reasoningEffortMappingsToAPI([row])).toEqual([
      { from: "max", to: "low" },
    ]);
  });

  it("rejects custom mappings", () => {
    const row = createReasoningEffortMappingRow({ from: "ultra", to: "high" });
    expect(validateReasoningEffortMappings([row], "openai")).toEqual({
      [row.pairs[0].id]: { from: "unsupportedFrom" },
    });
  });

  it("normalizes over-limit access control to downgrade or deny", () => {
    expect(normalizeReasoningEffortOverLimit(undefined)).toBe(
      reasoningEffortOverLimitDowngrade,
    );
    expect(normalizeReasoningEffortOverLimit("")).toBe(
      reasoningEffortOverLimitDowngrade,
    );
    expect(normalizeReasoningEffortOverLimit(" downgrade ")).toBe(
      reasoningEffortOverLimitDowngrade,
    );
    expect(normalizeReasoningEffortOverLimit("DENY")).toBe(
      reasoningEffortOverLimitDeny,
    );
    expect(normalizeReasoningEffortOverLimit("block")).toBe(
      reasoningEffortOverLimitDowngrade,
    );
  });
});
