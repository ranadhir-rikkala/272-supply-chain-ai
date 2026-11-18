import { useEffect, useState } from "react";

const NAMES = ["--accent", "--muted", "--ink", "--line", "--high", "--medium", "--low", "--surface"] as const;
type Tokens = Record<(typeof NAMES)[number], string>;

function read(): Tokens {
  const style = getComputedStyle(document.documentElement);
  return Object.fromEntries(NAMES.map((name) => [name, style.getPropertyValue(name).trim() || "#888"])) as Tokens;
}

export function useTokens(): Tokens {
  const [tokens, setTokens] = useState<Tokens>(read);
  useEffect(() => {
    const refresh = () => setTokens(read());
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", refresh);
    const observer = new MutationObserver(refresh);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => {
      media.removeEventListener("change", refresh);
      observer.disconnect();
    };
  }, []);
  return tokens;
}
