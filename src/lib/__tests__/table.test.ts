import { describe, it, expect } from "vitest";
import { isTableMarkdown, parseTable, serializeTable, type TableModel } from "../table";

describe("isTableMarkdown", () => {
  it("accepts a basic table", () => {
    expect(isTableMarkdown("| a | b |\n| --- | --- |\n| 1 | 2 |")).toBe(true);
  });

  it("accepts alignment delimiters", () => {
    expect(isTableMarkdown("| a | b |\n| :--- | ---: |\n| 1 | 2 |")).toBe(true);
  });

  it("rejects empty input", () => {
    expect(isTableMarkdown("")).toBe(false);
    expect(isTableMarkdown("   ")).toBe(false);
  });

  it("rejects a single line", () => {
    expect(isTableMarkdown("| a | b |")).toBe(false);
  });

  it("rejects a header line without a pipe", () => {
    expect(isTableMarkdown("hello\n| --- | --- |")).toBe(false);
  });

  it("rejects when the second line is not a delimiter row", () => {
    expect(isTableMarkdown("| a | b |\n| 1 | 2 |")).toBe(false);
  });

  it("rejects arbitrary non-table text", () => {
    expect(isTableMarkdown("# heading\n\nsome paragraph text")).toBe(false);
  });
});

describe("parseTable", () => {
  it("returns null for non-table input", () => {
    expect(parseTable("not a table")).toBeNull();
  });

  it("parses headers, aligns, and rows", () => {
    const model = parseTable("| a | b |\n| :--- | ---: |\n| 1 | 2 |");
    expect(model).toEqual({
      headers: ["a", "b"],
      aligns: ["left", "right"],
      rows: [["1", "2"]],
    });
  });

  it("parses center alignment", () => {
    const model = parseTable("| a |\n| :---: |\n| 1 |");
    expect(model?.aligns).toEqual(["center"]);
  });

  it("parses null alignment when no colons are present", () => {
    const model = parseTable("| a |\n| --- |\n| 1 |");
    expect(model?.aligns).toEqual([null]);
  });

  it("unescapes escaped pipes within cells", () => {
    const model = parseTable("| a | b |\n| --- | --- |\n| x\\|y | z |");
    expect(model?.rows).toEqual([["x|y", "z"]]);
  });

  it("keeps irregular (short/long) row lengths as parsed rather than padding them", () => {
    const model = parseTable("| a | b | c |\n| --- | --- | --- |\n| 1 |\n| 1 | 2 | 3 | 4 |");
    expect(model?.rows).toEqual([["1"], ["1", "2", "3", "4"]]);
  });

  it("handles tables with no data rows", () => {
    const model = parseTable("| a | b |\n| --- | --- |");
    expect(model?.rows).toEqual([]);
  });
});

describe("serializeTable", () => {
  it("round-trips a simple table through parse/serialize", () => {
    const original = "| a | b |\n| --- | --- |\n| 1 | 2 |";
    const model = parseTable(original);
    expect(model).not.toBeNull();
    expect(serializeTable(model as TableModel)).toBe(original);
  });

  it("round-trips alignment markers", () => {
    const original = "| a | b | c |\n| :--- | :---: | ---: |\n| 1 | 2 | 3 |";
    const model = parseTable(original);
    expect(serializeTable(model as TableModel)).toBe(original);
  });

  it("escapes pipe characters in cell content", () => {
    const model: TableModel = { headers: ["a"], aligns: [null], rows: [["x|y"]] };
    expect(serializeTable(model)).toBe("| a |\n| --- |\n| x\\|y |");
  });

  it("collapses newlines within a cell to a single space", () => {
    const model: TableModel = { headers: ["a"], aligns: [null], rows: [["x\ny"]] };
    expect(serializeTable(model)).toBe("| a |\n| --- |\n| x y |");
  });

  it("fills missing cells with an empty string when a row is shorter than the headers", () => {
    const model: TableModel = { headers: ["a", "b"], aligns: [null, null], rows: [["1"]] };
    expect(serializeTable(model)).toBe("| a | b |\n| --- | --- |\n| 1 |  |");
  });
});
