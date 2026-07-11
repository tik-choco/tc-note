import { parseTable, serializeTable, type TableModel } from "../lib/table";
import { useT } from "../hooks/useAppSettings";
import { Icon } from "./Icon";

// Editable grid UI for a block whose content is a markdown table. Persists
// every edit straight back through `onChange` as a re-serialized markdown
// string — the block's storage format stays plain markdown, this is just a
// friendlier front end for it than hand-typed pipe syntax.
export function TableBlock(props: { text: string; onChange: (value: string) => void; onEditRaw: () => void }) {
  const { text, onChange, onEditRaw } = props;
  const t = useT();
  const model = parseTable(text);
  if (!model) return null;

  function commit(next: TableModel) {
    onChange(serializeTable(next));
  }

  function updateHeader(i: number, value: string) {
    const headers = model!.headers.slice();
    headers[i] = value;
    commit({ ...model!, headers });
  }

  function updateCell(r: number, c: number, value: string) {
    const rows = model!.rows.map((row) => row.slice());
    if (!rows[r]) rows[r] = model!.headers.map(() => "");
    rows[r][c] = value;
    commit({ ...model!, rows });
  }

  function addColumn() {
    commit({
      headers: [...model!.headers, t("tableBlock.newColumnHeader", { n: model!.headers.length + 1 })],
      aligns: [...model!.aligns, null],
      rows: model!.rows.map((r) => [...r, ""]),
    });
  }

  function removeColumn(i: number) {
    if (model!.headers.length <= 1) return;
    commit({
      headers: model!.headers.filter((_, idx) => idx !== i),
      aligns: model!.aligns.filter((_, idx) => idx !== i),
      rows: model!.rows.map((r) => r.filter((_, idx) => idx !== i)),
    });
  }

  function addRow() {
    commit({ ...model!, rows: [...model!.rows, model!.headers.map(() => "")] });
  }

  function removeRow(r: number) {
    commit({ ...model!, rows: model!.rows.filter((_, idx) => idx !== r) });
  }

  return (
    <div class="table-block">
      <table class="table-block-grid">
        <thead>
          <tr>
            {model.headers.map((h, i) => (
              <th key={i}>
                <div class="table-cell-wrap">
                  <input
                    class="table-cell-input table-cell-input--header"
                    value={h}
                    onInput={(e) => updateHeader(i, (e.target as HTMLInputElement).value)}
                  />
                  <button type="button" class="table-col-remove" title={t("tableBlock.deleteColumn")} onClick={() => removeColumn(i)}>
                    <Icon name="delete" size={15} />
                  </button>
                </div>
              </th>
            ))}
            <th class="table-col-add-cell">
              <button type="button" class="table-col-add" title={t("tableBlock.addColumn")} onClick={addColumn}>
                <Icon name="add" size={16} />
              </button>
            </th>
          </tr>
        </thead>
        <tbody>
          {model.rows.map((row, r) => (
            <tr key={r}>
              {model.headers.map((_, c) => (
                <td key={c}>
                  <input
                    class="table-cell-input"
                    value={row[c] ?? ""}
                    onInput={(e) => updateCell(r, c, (e.target as HTMLInputElement).value)}
                  />
                </td>
              ))}
              <td class="table-row-remove-cell">
                <button type="button" class="table-row-remove" title={t("tableBlock.deleteRow")} onClick={() => removeRow(r)}>
                  <Icon name="delete" size={15} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div class="table-block-actions">
        <button type="button" class="table-add-row" onClick={addRow}>
          {t("tableBlock.addRowButton")}
        </button>
        <button type="button" class="table-edit-raw" onClick={onEditRaw} title={t("tableBlock.editAsMarkdownTitle")}>
          {t("tableBlock.editAsMarkdownButton")}
        </button>
      </div>
    </div>
  );
}
