import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { messages, type Locale, type MessageKey } from "./messages";

type LocalePreference = Locale | "system";

type MessageValues = Record<string, number | string>;

type I18nContextValue = {
  locale: Locale;
  localePreference: LocalePreference;
  systemLocale: Locale;
  setLocalePreference: (preference: LocalePreference) => void;
  t: (key: MessageKey, values?: MessageValues) => string;
  formatNumber: (value: number) => string;
};

const I18nContext = createContext<I18nContextValue | null>(null);

function normalizeLocale(locale: string | undefined): Locale | null {
  if (!locale) return null;
  const normalized = locale.toLowerCase();
  if (normalized.startsWith("ko")) return "ko";
  if (normalized.startsWith("en")) return "en";
  return null;
}

function detectSystemLocale(): Locale {
  if (typeof navigator === "undefined") return "en";

  const candidates = [...navigator.languages, navigator.language];
  for (const candidate of candidates) {
    const matched = normalizeLocale(candidate);
    if (matched) return matched;
  }

  return "en";
}

function formatMessage(template: string, values?: MessageValues) {
  if (!values) return template;
  return template.replace(/\{(\w+)\}/g, (full, key: string) => {
    const value = values[key];
    return value === undefined ? full : String(value);
  });
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const systemLocale = useMemo(() => detectSystemLocale(), []);
  const [localePreference, setLocalePreference] = useState<LocalePreference>("system");

  const locale = localePreference === "system" ? systemLocale : localePreference;

  const numberFormatter = useMemo(() => new Intl.NumberFormat(locale), [locale]);

  const formatNumber = useCallback(
    (value: number) => numberFormatter.format(value),
    [numberFormatter],
  );

  const t = useCallback(
    (key: MessageKey, values?: MessageValues) => {
      const localized = messages[locale][key];
      if (localized !== undefined) {
        return formatMessage(localized, values);
      }

      if (import.meta.env.DEV) {
        console.warn(
          `[i18n] Missing key "${key}" for locale "${locale}". Falling back to "en".`,
        );
      }

      return formatMessage(messages.en[key] ?? key, values);
    },
    [locale],
  );

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const value = useMemo<I18nContextValue>(
    () => ({
      locale,
      localePreference,
      systemLocale,
      setLocalePreference,
      t,
      formatNumber,
    }),
    [formatNumber, locale, localePreference, systemLocale, t],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error("useI18n must be used inside I18nProvider.");
  }
  return context;
}

export type { LocalePreference };
