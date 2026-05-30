function statusFilter(name, rawValues, schemaProperty) {
  const values = rawValues.split(",").map((value) => value.trim()).filter(Boolean);
  const allowed = Array.isArray(schemaProperty?.options) ? new Set(schemaProperty.options.map((option) => option.name)) : undefined;
  const usable = allowed ? values.filter((value) => allowed.has(value)) : values;
  if (usable.length === 0) return { skip: true };
  if (usable.length === 1) {
    return { property: name, [schemaProperty?.type || "status"]: { equals: usable[0] } };
  }
  return { or: usable.map((value) => ({ property: name, [schemaProperty?.type || "status"]: { equals: value } })) };
}

function dateFilter(name, since, until) {
  const parts = [];
  if (since) parts.push({ property: name, date: { on_or_after: since } });
  if (until) parts.push({ property: name, date: { on_or_before: until } });
  if (parts.length === 0) return undefined;
  return parts.length === 1 ? parts[0] : { and: parts };
}

function combineFilters(filters) {
  const present = filters.filter(Boolean);
  if (present.length === 0) return undefined;
  return present.length === 1 ? present[0] : { and: present };
}

function firstPropertyOfType(schema, type, preferredNames = []) {
  for (const name of preferredNames) {
    if (schema.properties[name]?.type === type) return name;
  }
  const found = Object.entries(schema.properties).find(([, property]) => property.type === type);
  return found ? found[0] : undefined;
}

function buildAggregateQuery(schema, options) {
  const statusName = firstPropertyOfType(schema, "status", ["Status"]) || firstPropertyOfType(schema, "select", ["Status"]);
  const dateName = firstPropertyOfType(schema, "date", ["Date", "Start Date", "Due", "Completed"]);
  const status = options.status && statusName ? statusFilter(statusName, options.status, schema.properties[statusName]) : undefined;
  if (status?.skip) {
    return { __skip: true };
  }
  const filter = combineFilters([
    status,
    dateName ? dateFilter(dateName, options.since, options.until) : undefined,
  ]);
  return filter ? { filter } : {};
}

module.exports = { buildAggregateQuery, firstPropertyOfType };
