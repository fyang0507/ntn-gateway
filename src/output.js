const { GatewayError } = require("./errors");

function ok(data) {
  return { ok: true, data };
}

function errorPayload(error) {
  return {
    ok: false,
    error: {
      code: error.code || "unexpected_error",
      message: error.message || String(error),
      details: error.details,
    },
  };
}

function formatHuman(payload) {
  if (!payload.ok) {
    return `Error: ${payload.error.message}\n`;
  }
  return `${JSON.stringify(payload.data, null, 2)}\n`;
}

// Default `json` is compact (no indentation) to save agent tokens; `human` is indented for people.
function format(payload, options) {
  if (options.format === "human") return formatHuman(payload);
  return `${JSON.stringify(payload)}\n`;
}

async function runWithOutput(stream, options, fn) {
  try {
    stream.write(format(ok(await fn()), options));
    return 0;
  } catch (error) {
    const normalized = error instanceof GatewayError ? error : new GatewayError("unexpected_error", error.message || String(error));
    stream.write(format(errorPayload(normalized), options));
    return normalized.exitCode || 1;
  }
}

module.exports = { ok, errorPayload, runWithOutput };
