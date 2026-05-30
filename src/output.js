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

async function runWithOutput(stream, options, fn) {
  try {
    const payload = ok(await fn());
    stream.write(options.format === "human" ? formatHuman(payload) : `${JSON.stringify(payload, null, 2)}\n`);
    return 0;
  } catch (error) {
    const normalized = error instanceof GatewayError ? error : new GatewayError("unexpected_error", error.message || String(error));
    stream.write(`${JSON.stringify(errorPayload(normalized), null, 2)}\n`);
    return normalized.exitCode || 1;
  }
}

module.exports = { ok, errorPayload, runWithOutput };
