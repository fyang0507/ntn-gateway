// Pure content-shaping for `page get`. Given the full rendered Markdown body and a set of
// read options, return { content, meta } where meta carries the flags the CLI merges into
// the page-get result (content_truncated, content_lines_total, content_note, etc.). Kept as a
// standalone, side-effect-free module so it can be unit-tested without touching the CLI/Notion.

const PREVIEW_CHARS = 400;
const FIND_CONTEXT = 2;

// Named so the CLI response can point an agent at the escape hatches without the skill doc.
const CONTENT_NOTE =
  "Content was shaped for token efficiency. Read more with --max-content-chars N, --head-lines N, --tail-lines N, --section <text>, or --find <text>; omit all shaping flags (or pass --content full) for the whole body.";

const CONTENT_HINT =
  "Body omitted. Read part of it with --content preview, --head-lines N, --tail-lines N, --section <text>, or --find <text>; pass --content full for the whole body.";

// A Markdown heading line and its level (number of leading '#').
function headingLevel(line) {
  const match = /^(#{1,6})\s+/.exec(line);
  return match ? match[1].length : 0;
}

// Cut `text` to at most `max` chars, preferring the last newline before the limit so we do not
// slice mid-line when a clean line boundary is close enough (within the trailing 40%).
function cutOnLineBoundary(text, max) {
  if (text.length <= max) return text;
  const hard = text.slice(0, max);
  const lastNewline = hard.lastIndexOf("\n");
  if (lastNewline > max * 0.6) return hard.slice(0, lastNewline);
  return hard;
}

function fullBodyStats(markdown) {
  return {
    content_lines_total: markdown === "" ? 0 : markdown.split("\n").length,
    content_chars_total: markdown.length,
  };
}

// Build the shared "trimmed away from full" metadata block.
function trimMeta(markdown) {
  return {
    content_truncated: true,
    ...fullBodyStats(markdown),
    content_note: CONTENT_NOTE,
  };
}

function shapeContent(markdown, options = {}) {
  const body = typeof markdown === "string" ? markdown : "";

  if (options.content === "none") {
    return {
      content: undefined,
      meta: {
        content_omitted: true,
        content_hint: CONTENT_HINT,
        ...fullBodyStats(body),
      },
    };
  }

  if (options.content === "preview") {
    const preview = cutOnLineBoundary(body, PREVIEW_CHARS);
    const truncated = preview.length < body.length;
    return {
      content: preview,
      meta: truncated ? trimMeta(body) : {},
    };
  }

  if (options.maxContentChars !== undefined) {
    const cut = body.slice(0, options.maxContentChars);
    const truncated = cut.length < body.length;
    return { content: cut, meta: truncated ? trimMeta(body) : {} };
  }

  if (options.headLines !== undefined) {
    const lines = body.split("\n");
    const cut = lines.slice(0, options.headLines).join("\n");
    const truncated = options.headLines < lines.length;
    return { content: cut, meta: truncated ? trimMeta(body) : {} };
  }

  if (options.tailLines !== undefined) {
    const lines = body.split("\n");
    const cut = lines.slice(Math.max(0, lines.length - options.tailLines)).join("\n");
    const truncated = options.tailLines < lines.length;
    return { content: cut, meta: truncated ? trimMeta(body) : {} };
  }

  if (options.section !== undefined) {
    return shapeSection(body, options.section);
  }

  if (options.find !== undefined) {
    return shapeFind(body, options.find);
  }

  // Default: full body, byte-for-byte unchanged.
  return { content: body, meta: {} };
}

function shapeSection(body, needle) {
  const lines = body.split("\n");
  const target = String(needle).toLowerCase();
  let startIndex = -1;
  let startLevel = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const level = headingLevel(lines[i]);
    if (level > 0 && lines[i].toLowerCase().includes(target)) {
      startIndex = i;
      startLevel = level;
      break;
    }
  }
  if (startIndex === -1) {
    return {
      content: "",
      meta: { content_section_found: false, ...fullBodyStats(body) },
    };
  }
  let endIndex = lines.length;
  for (let i = startIndex + 1; i < lines.length; i += 1) {
    const level = headingLevel(lines[i]);
    // Next heading of the same or higher level (same-or-fewer '#') ends the section.
    if (level > 0 && level <= startLevel) {
      endIndex = i;
      break;
    }
  }
  const section = lines.slice(startIndex, endIndex).join("\n");
  const truncated = section.length < body.length;
  return {
    content: section,
    meta: {
      content_section_found: true,
      ...(truncated ? trimMeta(body) : {}),
    },
  };
}

function shapeFind(body, needle) {
  const lines = body.split("\n");
  const target = String(needle).toLowerCase();
  const matchLineIndexes = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].toLowerCase().includes(target)) matchLineIndexes.push(i);
  }

  if (matchLineIndexes.length === 0) {
    return {
      content: "",
      meta: { content_find_matches: 0, ...trimMeta(body) },
    };
  }

  // Expand each match to +/- FIND_CONTEXT lines, then merge overlapping/adjacent ranges.
  const ranges = [];
  for (const index of matchLineIndexes) {
    const start = Math.max(0, index - FIND_CONTEXT);
    const end = Math.min(lines.length - 1, index + FIND_CONTEXT);
    const last = ranges[ranges.length - 1];
    if (last && start <= last.end + 1) {
      last.end = Math.max(last.end, end);
    } else {
      ranges.push({ start, end });
    }
  }

  const groups = ranges.map((range) => lines.slice(range.start, range.end + 1).join("\n"));
  // Separate non-adjacent groups with a blank-line-delimited marker so the agent can tell them apart.
  const content = groups.join("\n\n...\n\n");
  // Truncation must be judged by line coverage, not string length: the "\n\n...\n\n" separators
  // inflate content.length above body.length even when real lines were dropped between groups.
  const linesEmitted = ranges.reduce((sum, range) => sum + (range.end - range.start + 1), 0);
  const truncated = linesEmitted < lines.length;
  return {
    content,
    meta: {
      content_find_matches: matchLineIndexes.length,
      ...(truncated ? trimMeta(body) : {}),
    },
  };
}

module.exports = { shapeContent, CONTENT_NOTE, CONTENT_HINT };
