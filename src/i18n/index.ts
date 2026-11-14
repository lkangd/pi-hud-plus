import type { Language, MessageKey, Messages } from "./types.ts";
import { en } from "./en.ts";

export type { Language, MessageKey, Messages };

type CanonicalLanguage = "en" | "zh-Hans";

// shortcut: only the en table is ported, so zh-Hans falls back to en until the i18n ticket adds its table.
const locales: Partial<Record<CanonicalLanguage, Messages>> = { en };

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
