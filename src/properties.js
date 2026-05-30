const { GatewayError } = require("./errors");
const { titlePropertyName } = require("./normalize");

function optionNames(schemaProperty) {
  return new Set((schemaProperty.options || []).map((option) => option.name));
}

function validateProperties(schema, input) {
  const unknown = Object.keys(input).filter((name) => !schema.properties[name]);
  if (unknown.length) {
    throw new GatewayError("property_unknown", "Properties are not present in the live schema.", { unknown });
  }

  const readOnly = Object.keys(input).filter((name) => schema.properties[name] && !schema.properties[name].writable);
  if (readOnly.length) {
    throw new GatewayError("property_read_only", "Properties are not writable.", { readOnly });
  }

  for (const [name, value] of Object.entries(input)) {
    const schemaProperty = schema.properties[name];
    if (!schemaProperty) continue;

    if (schemaProperty.type === "select" || schemaProperty.type === "status") {
      const raw = typeof value === "string" ? value : value?.name || value?.[schemaProperty.type]?.name;
      const allowed = optionNames(schemaProperty);
      if (raw && schemaProperty.options && !allowed.has(raw)) {
        throw new GatewayError("property_option_invalid", `Invalid option for ${name}.`, {
          property: name,
          value: raw,
          allowed: [...allowed],
        });
      }
    }

    if (schemaProperty.type === "multi_select") {
      const values = Array.isArray(value) ? value : value?.multi_select || [];
      const names = values.map((item) => (typeof item === "string" ? item : item.name)).filter(Boolean);
      const allowed = optionNames(schemaProperty);
      const invalid = names.filter((item) => schemaProperty.options && !allowed.has(item));
      if (invalid.length) {
        throw new GatewayError("property_option_invalid", `Invalid multi-select option for ${name}.`, {
          property: name,
          invalid,
          allowed: [...allowed],
        });
      }
    }
  }
}

function notionRichText(value) {
  return [{ type: "text", text: { content: String(value) } }];
}

function isAlreadyNotionProperty(value, type) {
  return value && typeof value === "object" && Object.prototype.hasOwnProperty.call(value, type);
}

function coerceProperty(schemaProperty, value) {
  const type = schemaProperty.type;
  if (isAlreadyNotionProperty(value, type)) return value;

  switch (type) {
    case "title":
      return { title: notionRichText(value) };
    case "rich_text":
      return { rich_text: notionRichText(value) };
    case "select":
      return { select: value ? { name: typeof value === "string" ? value : value.name } : null };
    case "status":
      return { status: value ? { name: typeof value === "string" ? value : value.name } : null };
    case "multi_select":
      return { multi_select: (Array.isArray(value) ? value : []).map((item) => ({ name: typeof item === "string" ? item : item.name })) };
    case "date":
      return { date: typeof value === "string" ? { start: value } : value };
    case "checkbox":
      return { checkbox: Boolean(value) };
    case "number":
      return { number: value === null ? null : Number(value) };
    case "url":
    case "email":
    case "phone_number":
      return { [type]: value || null };
    case "relation":
      return { relation: (Array.isArray(value) ? value : []).map((id) => (typeof id === "string" ? { id } : id)) };
    case "people":
      return { people: (Array.isArray(value) ? value : []).map((id) => (typeof id === "string" ? { id } : id)) };
    default:
      throw new GatewayError("property_type_unsupported", `Property type ${type} is not supported for writes.`, {
        property: schemaProperty.name,
        type,
      });
  }
}

function buildPageProperties(schema, title, input = {}) {
  const titleName = titlePropertyName(schema);
  const merged = { ...input };
  if (title !== undefined && title !== null && title !== "") {
    merged[titleName] = title;
  }

  validateProperties(schema, merged);

  const properties = {};
  for (const [name, value] of Object.entries(merged)) {
    properties[name] = coerceProperty({ ...schema.properties[name], name }, value);
  }
  return properties;
}

module.exports = { buildPageProperties, validateProperties };
