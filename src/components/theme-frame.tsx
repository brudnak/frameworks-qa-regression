"use client";

import { useEffect, useState } from "react";

type ThemeFrameProps = {
  children: React.ReactNode;
};

type ThemeOption = {
  id: string;
  label: string;
  tone: string;
};

const defaultTheme = "tokyo-neon";

const themeOptions: ThemeOption[] = [
  {
    id: "light-ranch-house",
    label: "Warm Light",
    tone: "light",
  },
  {
    id: "dark-suse-green",
    label: "SUSE Green",
    tone: "dark",
  },
  {
    id: "dark-rancher-blue",
    label: "Rancher Blue",
    tone: "dark",
  },
  {
    id: "tokyo-neon",
    label: "Midnight Tokyo",
    tone: "dark",
  },
];

function isKnownTheme(value: string | null): value is string {
  return !!value && themeOptions.some((theme) => theme.id === value);
}

export function ThemeFrame({ children }: ThemeFrameProps) {
  const [theme, setTheme] = useState(() => {
    if (typeof window === "undefined") {
      return defaultTheme;
    }

    const storedTheme = window.localStorage.getItem("qa-launcher-theme");
    return isKnownTheme(storedTheme) ? storedTheme : defaultTheme;
  });

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem("qa-launcher-theme", theme);
  }, [theme]);

  return (
    <>
      <div className="theme-bar">
        <div>
          <p className="theme-kicker">Visual Theme</p>
          <p className="theme-caption">
            Switch between the default Tokyo neon view, a warm light mode, and
            two ranch-flavored dark palettes.
          </p>
        </div>

        <div className="theme-pill-row" role="tablist" aria-label="Color themes">
          {themeOptions.map((option) => (
            <button
              aria-selected={theme === option.id}
              className={`theme-pill ${theme === option.id ? "active" : ""}`}
              key={option.id}
              onClick={() => setTheme(option.id)}
              role="tab"
              type="button"
            >
              <span>{option.label}</span>
              <small>{option.tone}</small>
            </button>
          ))}
        </div>
      </div>

      {children}
    </>
  );
}
