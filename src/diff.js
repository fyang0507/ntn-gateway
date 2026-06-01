// A small, dependency-free unified line diff.
//
// Compares two texts line by line and returns an array of strings, each prefixed with
// " " (unchanged/context), "+" (added), or "-" (removed). The line ordering follows a
// standard LCS backtrace so unchanged lines stay anchored between edits.

function splitLines(text) {
  if (text === "" || text === undefined || text === null) return [];
  return String(text).split("\n");
}

function lcsTable(before, after) {
  const rows = before.length + 1;
  const cols = after.length + 1;
  const table = Array.from({ length: rows }, () => new Array(cols).fill(0));
  for (let i = before.length - 1; i >= 0; i--) {
    for (let j = after.length - 1; j >= 0; j--) {
      table[i][j] = before[i] === after[j]
        ? table[i + 1][j + 1] + 1
        : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  return table;
}

function lineDiff(beforeText, afterText) {
  const before = splitLines(beforeText);
  const after = splitLines(afterText);
  const table = lcsTable(before, after);
  const diff = [];

  let i = 0;
  let j = 0;
  while (i < before.length && j < after.length) {
    if (before[i] === after[j]) {
      diff.push(` ${before[i]}`);
      i++;
      j++;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      diff.push(`-${before[i]}`);
      i++;
    } else {
      diff.push(`+${after[j]}`);
      j++;
    }
  }
  while (i < before.length) diff.push(`-${before[i++]}`);
  while (j < after.length) diff.push(`+${after[j++]}`);

  return diff;
}

module.exports = { lineDiff };
