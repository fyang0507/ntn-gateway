function plainTextFromRichText(richText = []) {
  return richText.map((part) => part.plain_text || part.text?.content || "").join("");
}

function titleFromObject(object = {}) {
  if (Array.isArray(object.title)) {
    return plainTextFromRichText(object.title);
  }
  if (typeof object.title === "string") {
    return object.title;
  }
  return "";
}

function blockPlainText(block) {
  const value = block[block.type];
  if (!value) return "";
  if (Array.isArray(value.rich_text)) return plainTextFromRichText(value.rich_text);
  if (Array.isArray(value.cells)) {
    return value.cells.map((cell) => plainTextFromRichText(cell)).join(" | ");
  }
  if (typeof value.title === "string") return value.title;
  return "";
}

function compactId(id = "") {
  return id.replaceAll("-", "");
}

function canonicalId(id = "") {
  const compact = compactId(id);
  if (compact.length !== 32) return id;
  return [
    compact.slice(0, 8),
    compact.slice(8, 12),
    compact.slice(12, 16),
    compact.slice(16, 20),
    compact.slice(20),
  ].join("-");
}

module.exports = { plainTextFromRichText, titleFromObject, blockPlainText, compactId, canonicalId };
