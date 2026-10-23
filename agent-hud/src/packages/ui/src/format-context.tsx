// The interface language and calendar every formatter takes, provided once at
// the root of each window from the app's language setting.
import { createContext, useContext, useMemo, type ReactNode } from "react";
import { resolveLanguage, systemCalendar, type FormatSettings } from "./format";

const systemLocale = () =>
  typeof navigator === "undefined" ? "en-US" : navigator.language;

const FormatContext = createContext<FormatSettings>({
  language: resolveLanguage("system", systemLocale()),
  calendar: systemCalendar(systemLocale()),
});

/** Provides the language for `setting` ("system", "en", "zh-Hans" …) and this machine's calendar. */
export function FormatProvider({
  setting,
  children,
}: {
  setting: string | null | undefined;
  children: ReactNode;
}) {
  const value = useMemo<FormatSettings>(() => {
    const locale = systemLocale();
    return {
      language: resolveLanguage(setting, locale),
      calendar: systemCalendar(locale),
    };
  }, [setting]);
  return (
    <FormatContext.Provider value={value}>{children}</FormatContext.Provider>
  );
}

export function useFormat(): FormatSettings {
  return useContext(FormatContext);
}
