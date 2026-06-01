const { GatewayError } = require("./errors");

const DONE_STATUS_NAMES = new Set(["done", "complete", "completed"]);

// The four date fields --date-filter accepts. start/end map to the workspace's canonical
// ticketing date properties; created/edited map to Notion's built-in row timestamps (always
// present, no schema dependency). We reference property names directly and let Notion reject
// a query against a database that lacks them, rather than pre-checking the schema.
const DATE_FIELDS = {
  start: { kind: "property", property: "Start Date" },
  end: { kind: "property", property: "End Date" },
  created: { kind: "timestamp", timestamp: "created_time" },
  edited: { kind: "timestamp", timestamp: "last_edited_time" },
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isDoneStatus(name) {
  return DONE_STATUS_NAMES.has(String(name || "").trim().toLowerCase());
}

// Validates the parsed --date-filter object, throwing argument_invalid on any malformed
// field/bound so the agent gets an actionable message before we ever hit Notion.
function validateDateFilter(dateFilter) {
  if (dateFilter === undefined || dateFilter === null) return;
  if (typeof dateFilter !== "object" || Array.isArray(dateFilter)) {
    throw new GatewayError("argument_invalid", `--date-filter must be a JSON object keyed by date field (one of: ${Object.keys(DATE_FIELDS).join(", ")}).`);
  }
  for (const [field, spec] of Object.entries(dateFilter)) {
    if (!DATE_FIELDS[field]) {
      throw new GatewayError("argument_invalid", `Unknown date field "${field}". Allowed fields: ${Object.keys(DATE_FIELDS).join(", ")}.`);
    }
    if (typeof spec !== "object" || spec === null || Array.isArray(spec)) {
      throw new GatewayError("argument_invalid", `--date-filter.${field} must be an object with optional "after"/"before" dates.`);
    }
    for (const [bound, value] of Object.entries(spec)) {
      if (bound !== "after" && bound !== "before") {
        throw new GatewayError("argument_invalid", `--date-filter.${field}.${bound} is not a valid bound; use "after" and/or "before".`);
      }
      if (typeof value !== "string" || !ISO_DATE.test(value)) {
        throw new GatewayError("argument_invalid", `--date-filter.${field}.${bound} must be a YYYY-MM-DD date.`);
      }
    }
  }
}

// Turns the parsed --date-filter object into a flat list of Notion filter clauses. Each
// after/before bound is a separate clause (a Notion date condition holds only one operator),
// AND-combined later with the status filter.
function dateFilterClauses(dateFilter) {
  const clauses = [];
  if (!dateFilter) return clauses;
  for (const [field, spec] of Object.entries(dateFilter)) {
    const def = DATE_FIELDS[field];
    const make = (op, value) =>
      def.kind === "timestamp"
        ? { timestamp: def.timestamp, [def.timestamp]: { [op]: value } }
        : { property: def.property, date: { [op]: value } };
    if (spec.after) clauses.push(make("on_or_after", spec.after));
    if (spec.before) clauses.push(make("on_or_before", spec.before));
  }
  return clauses;
}

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

  let status;
  if (statusName) {
    if (options.status) {
      status = statusFilter(statusName, options.status, schema.properties[statusName]);
    } else if (!options.allStatus) {
      // Default working view hides completed work: include only the non-done status options.
      const active = (schema.properties[statusName].options || [])
        .map((option) => option.name)
        .filter((name) => !isDoneStatus(name));
      if (active.length > 0) {
        status = statusFilter(statusName, active.join(","), schema.properties[statusName]);
      }
    }
  }
  if (status?.skip) {
    return { __skip: true };
  }
  const filter = combineFilters([status, ...dateFilterClauses(options.dateFilter)]);
  // Most-recently-edited first so a truncated sample surfaces the freshest, most relevant rows.
  const sorts = [{ timestamp: "last_edited_time", direction: "descending" }];
  return filter ? { filter, sorts } : { sorts };
}

module.exports = { buildAggregateQuery, firstPropertyOfType, validateDateFilter, dateFilterClauses, DATE_FIELDS };
