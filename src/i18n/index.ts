import type { Language, MessageKey, Messages } from "./types.ts";
import { en } from "./en.ts";
import { zhHans } from "./zh-Hans.ts";

export type { Language, MessageKey, Messages };

type CanonicalLanguage = "en" | "zh-Hans";

const locales: Record<CanonicalLanguage, Messages> = { en, "zh-Hans": zhHans };

// Resolve short language tags to canonical BCP 47 forms.
// Based on CLDR likely subtags: zh → zh-Hans-CN
// https://www.unicode.org/cldr/charts/latest/supplemental/likely_subtags.html
const CANONICAL: Record<Language, CanonicalLanguage> = {
  "en": "en",
  "zh": "zh-Hans",
  "zh-Hans": "zh-Hans",
};

let currentLanguage: Language = "en";

export function setLanguage(lang: Language): void {
  currentLanguage = lang;
}

export function getLanguage(): Language {
  return currentLanguage;
}

// https://www.rfc-editor.org/info/bcp47
export function getCanonicalLanguage(): CanonicalLanguage {
  return CANONICAL[currentLanguage] ?? "en";
}

export function t(key: MessageKey): string {
  const canon = getCanonicalLanguage();
  return locales[canon]?.[key] ?? en[key] ?? key;
}
