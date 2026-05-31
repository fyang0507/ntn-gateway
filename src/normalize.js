const { plainTextFromRichText, titleFromObject } = require("./text");

function normalizeOption(option) {
  if (!option) return undefined;
  return { id: option.id, name: option.name, color: option.color };
}

function normalizeSchema(dataSource) {
  const properties = {};
  for (const [name, property] of Object.entries(dataSource.properties || {})) {
    const type = property.type;
    const config = property[type] || {};
    properties[name] = {
      id: property.id,
      name,
      type,
      writable: !["created_time", "created_by", "last_edited_time", "last_edited_by", "formula", "rollup", "unique_id", "verification"].includes(type),
      options: Array.isArray(config.options) ? config.options.map(normalizeOption) : undefined,
      relation: config.data_source_id || config.database_id ? {
        data_source_id: config.data_source_id,
        database_id: config.database_id,
      } : undefined,
    };
  }

  return {
    id: dataSource.id,
    kind: dataSource.object === "database" ? "database" : "data_source",
    title: titleFromObject(dataSource),
    url: dataSource.url,
    parent: dataSource.parent,
    properties,
  };
}

function compactProperty(property) {
  if (!property) return null;
  switch (property.type) {
    case "title":
      return plainTextFromRichText(property.title);
    case "rich_text":
      return plainTextFromRichText(property.rich_text);
    case "select":
      return property.select?.name || null;
    case "status":
      return property.status?.name || null;
    case "multi_select":
      return (property.multi_select || []).map((option) => option.name);
    case "date":
      return property.date || null;
    case "checkbox":
      return Boolean(property.checkbox);
    case "number":
      return property.number ?? null;
    case "url":
    case "email":
    case "phone_number":
      return property[property.type] || null;
    case "relation":
      return (property.relation || []).map((item) => item.id);
    case "people":
      return (property.people || []).map((person) => ({ id: person.id, name: person.name }));
    default:
      return property[property.type] ?? null;
  }
}

function normalizePage(page, body = {}) {
  const properties = {};
  for (const [name, property] of Object.entries(page.properties || {})) {
    properties[name] = { type: property.type, value: compactProperty(property) };
  }

  const { content = null } = body;
  return {
    id: page.id,
    url: page.url,
    parent: page.parent,
    archived: Boolean(page.archived),
    properties,
    content,
    last_edited_time: page.last_edited_time,
  };
}

function titlePropertyName(schema) {
  const entry = Object.entries(schema.properties || {}).find(([, property]) => property.type === "title");
  return entry ? entry[0] : "Name";
}

module.exports = { normalizeSchema, normalizePage, titlePropertyName, compactProperty };
