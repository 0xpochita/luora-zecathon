"use client";

import { useLayoutEffect, useSyncExternalStore } from "react";
import { Desktop, Moon, Sun } from "@phosphor-icons/react";
import { applyTheme, nextTheme, readTheme, writeTheme, type Theme } from "@/lib/theme";

const LABEL: Record<Theme, string> = { system: "System", light: "Light", dark: "Dark" };
const ICON = { system: Desktop, light: Sun, dark: Moon } as const;

const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, readTheme, () => "system" as Theme);
  const next = nextTheme(theme);
  const Icon = ICON[theme];

  useLayoutEffect(() => applyTheme(readTheme()), [theme]);

  return (
    <button
      type="button"
      onClick={() => {
        writeTheme(next);
        listeners.forEach((listener) => listener());
      }}
      aria-label={`Theme: ${LABEL[theme]}. Switch to ${LABEL[next]}`}
      title={`Theme: ${LABEL[theme]}`}
      className="inline-flex size-8 flex-none items-center justify-center rounded-tile bg-raised text-muted transition-colors outline-none hover:bg-hover hover:text-fg focus-visible:ring-2 focus-visible:ring-overlay/25"
    >
      <Icon size={16} />
    </button>
  );
}
