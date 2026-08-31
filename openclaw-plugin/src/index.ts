import { Type } from "@sinclair/typebox";
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { jsonResult } from "openclaw/plugin-sdk/tool-results";
import { callApi, readConfig, type PluginConfig } from "./api.js";

const MentionStatus = Type.Union([
  Type.Literal("NEW"),
  Type.Literal("APPROVED"),
  Type.Literal("REJECTED"),
]);

const MentionSource = Type.Union([
  Type.Literal("REDDIT_POST"),
  Type.Literal("REDDIT_COMMENT"),
  Type.Literal("TWITTER"),
  Type.Literal("BLUESKY"),
  Type.Literal("HACKERNEWS"),
]);

const RelevanceBucket = Type.Union([
  Type.Literal("VERY_LOW"),
  Type.Literal("LOW"),
  Type.Literal("MEDIUM"),
  Type.Literal("HIGH"),
  Type.Literal("VERY_HIGH"),
]);

export default definePluginEntry({
  id: "redreplier",
  name: "RedReplier",
  description:
    "Monitor Reddit, Hacker News, X and Bluesky for keyword mentions of your product, AI-scored 0-100 for relevance.",
  register(api) {
    const cfg = (): PluginConfig => readConfig(api as { config?: unknown });

    api.registerTool({
      name: "redreplier_websites",
      label: "RedReplier: list monitored websites",
      description:
        "List the websites this account monitors, each with its keywords and their status. Start here: the other tools need a website id or a keyword. Keyword status matters, since only ACTIVE keywords match new mentions. PENDING ones do not, and clearing that backlog can cost a plan upgrade, which this plugin deliberately cannot trigger.",
      parameters: Type.Object({}),
      async execute(_toolCallId, _params, signal) {
        return jsonResult(await callApi(cfg(), "GET", "/websites", { signal }));
      },
    });

    api.registerTool({
      name: "redreplier_mentions",
      label: "RedReplier: list mentions",
      description:
        "List matched mentions across Reddit, Hacker News, X and Bluesky, each AI-scored 0-100 for relevance. Two filters are on by default and hide things: REJECTED mentions are excluded, and anything under 30 is hidden unless includeLowRelevance is set. Sort defaults to RELEVANCE, so use RECENT when the question is about timing rather than quality.",
      parameters: Type.Object({
        websiteId: Type.Optional(Type.String({ description: "Limit to one monitored website (UUID)." })),
        statuses: Type.Optional(Type.Array(MentionStatus, { description: "Filter by triage status." })),
        scoreBuckets: Type.Optional(
          Type.Array(RelevanceBucket, {
            description: "VERY_LOW under 10, LOW 10-29, MEDIUM 30-49, HIGH 50-74, VERY_HIGH 75 and above.",
          }),
        ),
        includeLowRelevance: Type.Optional(
          Type.Boolean({ description: "Include mentions scoring under 30, hidden by default." }),
        ),
        keywords: Type.Optional(
          Type.Array(Type.String(), { description: "Only mentions matched by these keywords." }),
        ),
        sources: Type.Optional(Type.Array(MentionSource, { description: "Filter by platform." })),
        sort: Type.Optional(
          Type.Union([Type.Literal("RELEVANCE"), Type.Literal("RECENT")], {
            description: "RELEVANCE is the default, highest score first.",
          }),
        ),
        from: Type.Optional(Type.String({ description: "ISO 8601. Only mentions ingested at or after this." })),
        to: Type.Optional(Type.String({ description: "ISO 8601. Only mentions ingested at or before this." })),
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 500, description: "Defaults to 50." })),
        offset: Type.Optional(Type.Integer({ minimum: 0 })),
      }),
      async execute(_toolCallId, params, signal) {
        return jsonResult(
          await callApi(cfg(), "GET", "/mentions", {
            query: params as Record<string, unknown>,
            signal,
          }),
        );
      },
    });

    api.registerTool({
      name: "redreplier_explain_mention",
      label: "RedReplier: explain a relevance score",
      description:
        "Get the AI reasoning and tags behind one mention's relevance score. Generates the explanation on first call, so it is slower than reading the score and it consumes AI quota. Use it when a score looks wrong, not on every mention in a list.",
      parameters: Type.Object({
        mentionId: Type.String({ description: "Mention id (UUID) from redreplier_mentions." }),
      }),
      async execute(_toolCallId, params, signal) {
        const { mentionId } = params as { mentionId: string };
        return jsonResult(
          await callApi(cfg(), "POST", `/mentions/${encodeURIComponent(mentionId)}/explain`, { signal }),
        );
      },
    });

    api.registerTool({
      name: "redreplier_set_mention_status",
      label: "RedReplier: triage a mention",
      description:
        "Set one mention's status. APPROVED marks it a real lead, REJECTED hides it and drops it from default listings, NEW returns it to the inbox. Reversible, so triage freely, but REJECTED mentions disappear from later queries unless statuses asks for them.",
      parameters: Type.Object({
        mentionId: Type.String({ description: "Mention id (UUID)." }),
        status: MentionStatus,
      }),
      async execute(_toolCallId, params, signal) {
        const { mentionId, status } = params as { mentionId: string; status: string };
        return jsonResult(
          await callApi(cfg(), "PATCH", `/mentions/${encodeURIComponent(mentionId)}/status`, {
            body: { status },
            signal,
          }),
        );
      },
    });

    api.registerTool({
      name: "redreplier_add_keywords",
      label: "RedReplier: add keywords",
      description:
        "Add keywords to a monitored website. Each one lands as PENDING, then anything that fits the current plan is promoted to ACTIVE for free. Keywords beyond the plan stay PENDING and match nothing until activated, which costs money and is deliberately not exposed here. Adding is always free.",
      parameters: Type.Object({
        websiteId: Type.String({ description: "Monitored website id (UUID) from redreplier_websites." }),
        keywords: Type.Array(Type.String({ maxLength: 255 }), {
          minItems: 1,
          description: "Keywords to start matching, for example a product name or a competitor.",
        }),
      }),
      async execute(_toolCallId, params, signal) {
        const { websiteId, keywords } = params as { websiteId: string; keywords: string[] };
        return jsonResult(
          await callApi(cfg(), "POST", `/websites/${encodeURIComponent(websiteId)}/keywords`, {
            body: { keywords },
            signal,
          }),
        );
      },
    });
  },
});
