import { test } from "node:test";
import assert from "node:assert/strict";
import { csvCell } from "../src/lib/api";

test("csv escaping and formula injection guard", () => {
  assert.equal(csvCell("plain"), "plain");
  assert.equal(csvCell('a "quoted", value'), '"a ""quoted"", value"');
  assert.equal(csvCell("=HYPERLINK(1)"), "'=HYPERLINK(1)");
  assert.equal(csvCell("-5"), "'-5");
  assert.equal(csvCell(null), "");
  assert.equal(csvCell(12.5), "12.5");
});
