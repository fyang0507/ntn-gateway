const test = require("node:test");
const assert = require("node:assert/strict");
const { lineDiff } = require("../src/diff");

test("lineDiff marks every line as added when the before text is empty", () => {
  assert.deepEqual(lineDiff("", "alpha\nbeta"), ["+alpha", "+beta"]);
});

test("lineDiff marks every line as removed when the after text is empty", () => {
  assert.deepEqual(lineDiff("alpha\nbeta", ""), ["-alpha", "-beta"]);
});

test("lineDiff keeps context and reports a mixed change", () => {
  assert.deepEqual(
    lineDiff("alpha\nbeta\ngamma", "alpha\ndelta\ngamma"),
    [" alpha", "-beta", "+delta", " gamma"]
  );
});
