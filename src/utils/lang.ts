const LANGUAGE_MAP: Record<string, string> = {
  en: "en-US",
  "en-us": "en-US",
  "en-gb": "en-GB",
  es: "es-ES",
  fr: "fr-FR",
  de: "de-DE",
  it: "it-IT",
  pt: "pt-PT",
  "pt-br": "pt-BR",
  ja: "ja-JP",
  ko: "ko-KR",
  zh: "zh-CN",
  "zh-cn": "zh-CN",
  ru: "ru-RU"
};

export function normalizeLanguageCode(code: string | undefined): string {
  if (!code) {
    return "en-US";
  }
  const normalized = LANGUAGE_MAP[code.toLowerCase()];
  if (normalized) {
    return normalized;
  }
  if (/^[a-z]{2,3}(-[A-Za-z]{2})?$/.test(code)) {
    const [lang, region] = code.split("-");
    return region ? `${lang.toLowerCase()}-${region.toUpperCase()}` : lang.toLowerCase();
  }
  return code;
}
