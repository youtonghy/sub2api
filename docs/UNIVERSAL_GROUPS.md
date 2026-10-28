# Universal Groups

Every group in sub2api is now a **universal group**: one group can hold upstream
accounts from any platform, and one subscription to that group gives access to
all of them. The group no longer belongs to a single provider platform.

`groups.platform` is kept only as a shape marker and is always `composite`. The
concrete provider platform for a request is resolved per request from the
requested model (and from the optional route registry below), and that resolved
platform is used for account selection, user platform quota checks, post-usage
billing, ops error attribution, channel mapping/pricing lookup, and platform
usage reporting.

## What a universal group means

- Accounts are still bound to a concrete platform (`accounts.platform`); only the
  group became platform-agnostic. Binding Anthropic, OpenAI, Gemini, Grok, Kimi,
  Zhipu, DeepSeek and MiniMax accounts to the same group is supported.
- A request is still dispatched **only** to accounts of the resolved platform.
  This gate is load-bearing: removing it would send OpenAI credentials to an
  Anthropic upstream. Universal groups do not mean platform-agnostic account
  selection.
- A model name that cannot be resolved (no explicit route and no recognizable
  provider prefix) fails closed with a client error instead of guessing.
- Group-level configuration that used to be platform-scoped is now available on
  every group and applies per resolved platform at runtime: profit control, the
  Codex models-manifest pinned accounts, OpenAI Messages dispatch mappings,
  `allow_live`, `force_openai_fast`/`free_openai_fast`, MCP XML injection,
  supported model scopes, image/video/audio pricing, and the invalid-request
  fallback group.

## Supported Providers

Universal groups can route to these concrete account platforms:

- Anthropic
- Gemini
- OpenAI
- Antigravity
- Grok
- Kimi
- Zhipu GLM
- DeepSeek
- MiniMax

The selected concrete platform is used for account selection, user platform
quota checks, post-usage billing, ops error platform attribution, channel
mapping/pricing lookup, and platform usage reporting.

## Route Registry

Admins can configure routes on a composite group from the group list's
`Routes` action or through the admin API:

- `GET /api/v1/admin/groups/:id/composite-routes`
- `POST /api/v1/admin/groups/:id/composite-routes`
- `PUT /api/v1/admin/groups/:id/composite-routes/:route_id`
- `DELETE /api/v1/admin/groups/:id/composite-routes/:route_id`
- `POST /api/v1/admin/groups/:id/composite-routes/preview`

Each route belongs to one composite group and contains:

- `public_model`: model identifier the client sends.
- `match_type`: `exact` or `prefix`.
- `target_platform`: concrete provider platform.
- `upstream_model`: model identifier sent upstream. If omitted, the public
  model is reused.
- `endpoint`: `any`, `messages`, `count_tokens`, `responses`,
  `chat_completions`, `embeddings`, `images`, or `gemini`.
- `priority`: lower values win after match specificity.
- `enabled`: disabled routes are ignored by runtime resolution but remain
  visible to admins.

Resolution order is explicit route first, then built-in detection. When more
than one explicit route matches, exact matches beat prefix matches,
endpoint-specific routes beat `any`, longer prefixes beat shorter prefixes,
then lower `priority`, then lower route id.

For JSON-body endpoints, the gateway rewrites the request `model` field to the
route's `upstream_model` before dispatch. For Gemini native paths such as
`/v1beta/models/{model}:generateContent`, the gateway resolves `{model}` and
the handler forwards the resolved upstream model.

Codex Alpha Search and Live requests use the `responses` route domain. Live
requests resolve the model from `session.model`, including multipart `session`
payloads, and apply the configured `upstream_model` before dispatch.
Codex model manifest requests reuse the existing OpenAI account selection and
failover path within the Composite group.

Responses WebSocket resolves the first `response.create` model in the
`responses` route domain (including `any` routes). Only OpenAI and Grok targets
are supported. The public model remains the admission and response identity;
the route's upstream model is applied before channel/account mapping. Subsequent
turns can repeat or omit the public model. Changing it requires reconnecting so
the gateway can resolve the route and select an account again.

## Built-In Detection

Composite routing detects common public model IDs and provider-prefixed IDs:

- `claude-*` and `anthropic/claude-*` route to Anthropic.
- `gemini-*` and `google/gemini-*` route to Gemini.
- `gpt-*`, `o*`, `codex-*`, `text-embedding-*`, `dall-e-*`, and
  `openai/*` route to OpenAI.
- `grok-*` and `xai/grok-*` route to Grok.
- `kimi-*`, `moonshot-*`, and `k3` route to Kimi.
- `glm-*` routes to Zhipu GLM.
- `deepseek-*` routes to DeepSeek.
- `minimax-*`, `abab*`, and `minimax/*` route to MiniMax.

Unknown or ambiguous model names fail closed with a client error instead of
guessing a provider.

## Admin Workflows

- Admins create a group; the platform selector is gone and the value is always
  `composite`.
- Admins can add, edit, delete, and preview composite model routes.
- Any group can copy accounts from any other group; platforms no longer have to
  match.
- Accounts of any platform can be assigned directly to any group from account
  create/edit and bulk account workflows.
- Subscription payment plans bind a group. The plan grants access to the whole
  group; each request is still billed and quota-checked against the resolved
  concrete provider platform.
- Channel configuration exposes universal groups in every concrete provider
  section. The channel `group_ids` payload is still flat; provider-specific
  model mapping and pricing remain keyed by concrete platform.

## Bucket 2 Setup: OpenAI + Claude + Gemini + Grok

Use one universal subscription group when one customer-facing plan should expose
model aliases across OpenAI, Claude, Gemini, and Grok without issuing separate
keys per provider.

1. Create concrete provider groups for the upstream account pools, for example
   `OpenAI Paid`, `Claude Paid`, `Gemini Paid`, and `Grok Paid`.
2. Create a `composite` group with `subscription_type` set to `subscription`.
3. Assign provider accounts directly to the composite group, or copy accounts
   from the concrete provider groups during group creation.
4. Add explicit routes for public aliases that should not rely on built-in
   model detection:

   | Public model | Endpoint | Target platform | Upstream model |
   | --- | --- | --- | --- |
   | `all/gpt-5` | `responses` | `openai` | `gpt-5` |
   | `all/claude-sonnet` | `messages` | `anthropic` | `claude-sonnet-4-6` |
   | `all/gemini-pro` | `gemini` | `gemini` | `gemini-2.5-pro` |
   | `all/grok` | `responses` | `grok` | `grok-4.3` |

5. Configure channel pricing and model mapping under the concrete platforms
   named in each route. Composite routing does not create pricing records.
6. Create a subscription payment plan for the composite group.

The same composite group can also rely on built-in detection for standard model
names such as `gpt-*`, `claude-*`, `gemini-*`, and `grok-*`. Explicit routes are
recommended for bundled plan aliases because they make endpoint, provider, and
upstream model attribution reviewable in the admin UI.

## Pricing and quotas

Group-level media prices (image `1K/2K/4K`, video `480p/720p/1080p`, audio
real-time / TTS / STT) are a single price card shared by every platform in the
group. When a platform needs its own prices, configure per-entry `platform` on
the channel model pricing rows instead; universal groups do not add a
group-by-platform price matrix.

Account cost statistics resolve channel pricing by the account's own platform,
and user platform quotas are charged against the resolved target platform.

## Limits

Routes choose a concrete provider and upstream model; they do not create
synthetic model metadata, pricing, or upstream capability records by themselves.
Keep channel pricing/model mapping configured for the concrete provider
platforms that the routes target.

Not implemented by design:

- AUTO smart-routing among multiple providers for the same abstract task.
- Protocol-agnostic provider decoupling or a LiteLLM-style adapter rewrite.
- Removing the `groups.platform` column; it stays as an always-`composite`
  marker so existing composite-aware code paths and rollbacks keep working.
