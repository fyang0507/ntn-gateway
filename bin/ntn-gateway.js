#!/usr/bin/env node

const { main } = require("../src/cli");

main(process.argv.slice(2), {
  stdin: process.stdin,
  stdout: process.stdout,
  stderr: process.stderr,
}).then((exitCode) => {
  process.exitCode = exitCode;
}).catch((error) => {
  const payload = {
    ok: false,
    error: {
      code: error.code || "unexpected_error",
      message: error.message || String(error),
      details: error.details,
    },
  };
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  process.exitCode = error.exitCode || 1;
});
