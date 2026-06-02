const { GatewayError } = require("./errors");
const { titlePropertyName } = require("./normalize");

function optionNames(schemaProperty) {
  return new Set((schemaProperty.options || []).map((option) => option.name));
}

// Pull the submitted option name(s) out of a select/status/multi_select value, accepting
// either the bare string/array shorthand or an already-shaped Notion property object.
function submittedOptionNames(schemaProperty, value) {
  if (schemaProperty.type === "multi_select") {
    const values = Array.isArray(value) ? value : value?.multi_select || [];
    return values.map((item) => (typeof item === "string" ? item : item?.name)).filter(Boolean);
  }
  const raw = typeof value === "string" ? value : value?.name || value?.[schemaProperty.type]?.name;
  return raw ? [raw] : [];
}

// Compute which submitted select/multi_select values are NOT yet live options, per property.
// Used both to gate writes (property_new_option) and to preview new_options in the dry-run plan.
// status is intentionally excluded: the Notion API cannot create status options.
function newOptionsForInput(schema, input) {
  const result = [];
  for (const [name, value] of Object.entries(input)) {
    const schemaProperty = schema.properties[name];
    if (!schemaProperty || !schemaProperty.options) continue;
    if (schemaProperty.type !== "select" && schemaProperty.type !== "multi_select") continue;
    const allowed = optionNames(schemaProperty);
    const values = [...new Set(submittedOptionNames(schemaProperty, value).filter((item) => !allowed.has(item)))];
    if (values.length) result.push({ property: name, values });
  }
  return result;
}

function validateProperties(schema, input, allowNewOptions = false) {
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

    // status stays strict: the Notion API cannot create status options (they are UI-managed),
    // so an unrecognized status value is always a hard error regardless of --allow-new-options.
    if (schemaProperty.type === "status") {
      const raw = typeof value === "string" ? value : value?.name || value?.status?.name;
      const allowed = optionNames(schemaProperty);
      if (raw && schemaProperty.options && !allowed.has(raw)) {
        throw new GatewayError("property_option_invalid", `Invalid option for ${name}.`, {
          property: name,
          value: raw,
          allowed: [...allowed],
        });
      }
    }

    // select/multi_select: unrecognized values are *candidate new options*. Notion auto-creates
    // them by name on write, so allow them through when the caller opted in with allowNewOptions;
    // otherwise bounce with both the new values and the existing options so the agent can reuse
    // an existing option instead of inventing a near-duplicate.
    if (schemaProperty.type === "select" || schemaProperty.type === "multi_select") {
      const allowed = optionNames(schemaProperty);
      const names = submittedOptionNames(schemaProperty, value);
      const fresh = [...new Set(names.filter((item) => schemaProperty.options && !allowed.has(item)))];
      if (fresh.length && !allowNewOptions) {
        throw new GatewayError(
          "property_new_option",
          `${name} has option value(s) not in the live schema. If an existing option fits, use it; otherwise re-run with --allow-new-options to create the new option(s).`,
          {
            property: name,
            new: fresh,
            existing: [...allowed],
          }
        );
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

function buildPageProperties(schema, title, input = {}, allowNewOptions = false) {
  const titleName = titlePropertyName(schema);
  const merged = { ...input };
  if (title !== undefined && title !== null && title !== "") {
    merged[titleName] = title;
  }

  validateProperties(schema, merged, allowNewOptions);

  const properties = {};
  for (const [name, value] of Object.entries(merged)) {
    properties[name] = coerceProperty({ ...schema.properties[name], name }, value);
  }
  return properties;
}

module.exports = { buildPageProperties, validateProperties, newOptionsForInput };
