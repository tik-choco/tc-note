import { bibtexSource, parseBibtex } from "../lib/bibtex";
import { useT } from "../hooks/useAppSettings";

// Renders a ```bibtex fenced block as a small bibliography card list.
// Mirrors MermaidBlock's click-anywhere-to-edit convention: there's no
// interactive child yet, so a plain onClick on the wrapper drops back into
// raw markdown editing.
export function BibtexBlock(props: { text: string; onEditRaw: () => void }) {
  const { text, onEditRaw } = props;
  const t = useT();
  const entries = parseBibtex(bibtexSource(text));

  if (entries.length === 0) {
    return (
      <div class="bibtex-block bibtex-block--empty" onClick={onEditRaw} title={t("bibtexBlock.clickToEdit")}>
        {t("bibtexBlock.noEntries")}
      </div>
    );
  }

  return (
    <div class="bibtex-block" onClick={onEditRaw} title={t("bibtexBlock.clickToEdit")}>
      {entries.map((entry) => {
        const venue = entry.fields.journal || entry.fields.booktitle;
        const meta = [entry.fields.author, entry.fields.year, venue].filter(Boolean).join(" · ");
        return (
          <div class="bibtex-entry" key={entry.key}>
            <div class="bibtex-entry-title">{entry.fields.title || entry.key}</div>
            {meta && <div class="bibtex-entry-meta">{meta}</div>}
            <span class="bibtex-entry-key">{entry.key}</span>
          </div>
        );
      })}
    </div>
  );
}
