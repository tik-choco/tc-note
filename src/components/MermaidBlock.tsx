import { useEffect, useState } from "preact/hooks";
import { mermaidSource } from "../lib/mermaidDetect";
import { useAppSettings, useT } from "../hooks/useAppSettings";

let mermaidIdCounter = 0;

// Renders a ```mermaid fenced block as a diagram. mermaid is dynamically
// imported so it doesn't bloat the main bundle for notes that never use it;
// a render failure (bad syntax mid-edit, etc.) falls back to the raw source
// plus the error rather than breaking the block.
export function MermaidBlock(props: { text: string; onEditRaw: () => void }) {
  const { text, onEditRaw } = props;
  const t = useT();
  const source = mermaidSource(text);
  const dark = useAppSettings().resolvedTheme === "dark";
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSvg(null);
    setError(null);
    import("mermaid")
      .then(async (mod) => {
        const mermaid = mod.default;
        mermaid.initialize({ startOnLoad: false, theme: dark ? "dark" : "neutral", securityLevel: "strict" });
        const id = `mermaid-${++mermaidIdCounter}`;
        const { svg: rendered } = await mermaid.render(id, source);
        if (!cancelled) setSvg(rendered);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [source, dark]);

  if (error) {
    return (
      <div class="mermaid-block mermaid-block--error" onClick={onEditRaw} title={t("mermaidBlock.clickToEdit")}>
        <div class="mermaid-error">{t("mermaidBlock.renderError", { error: error ?? "" })}</div>
        <pre class="mermaid-raw">{source}</pre>
      </div>
    );
  }

  if (!svg) {
    return (
      <div class="mermaid-block mermaid-block--loading" onClick={onEditRaw} title={t("mermaidBlock.clickToEdit")}>
        {t("mermaidBlock.rendering")}
      </div>
    );
  }

  return <div class="mermaid-block" onClick={onEditRaw} title={t("mermaidBlock.clickToEdit")} dangerouslySetInnerHTML={{ __html: svg }} />;
}
