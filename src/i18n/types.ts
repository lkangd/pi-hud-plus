export type MessageKey =
  // Labels
  | "label.context"
  | "label.usage"
  | "label.weekly"
  | "label.monthly"
  | "label.approxRam"
  | "label.promptCache"
  | "label.estimatedCost"
  | "label.cost"
  | "label.tokens"
  | "label.sessionStarted"
  | "label.lastReply"
  | "label.skills"
  | "label.prompts"
  // Status
  | "status.expired"
  | "status.limitReached"
  // Format
  | "format.resets"
  | "format.resetsIn"
  | "format.at"
  | "format.in"
  | "format.cache"
  | "format.out"
  | "format.tok"
  | "format.tokPerSec"
  | "format.justNow"
  | "format.ago";

export type Messages = Record<MessageKey, string>;

export type Language = "en" | "zh" | "zh-Hans";
