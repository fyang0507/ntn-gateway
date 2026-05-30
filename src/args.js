const { GatewayError } = require("./errors");

function parseGlobalArgs(argv) {
  const args = [];
  const options = { format: "json" };

  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    if (value === "--format") {
      options.format = argv[++i];
    } else if (value === "--human") {
      options.format = "human";
    } else if (value === "--help" || value === "-h") {
      options.help = true;
    } else {
      args.push(value);
    }
  }

  if (!["json", "human"].includes(options.format)) {
    throw new GatewayError("argument_invalid", "Format must be json or human.");
  }

  return { args, options };
}

function parseFlags(args) {
  const positionals = [];
  const flags = {};

  for (let i = 0; i < args.length; i += 1) {
    const value = args[i];
    if (value.startsWith("--")) {
      const key = value.slice(2).replaceAll("-", "_");
      if (args[i + 1] && !args[i + 1].startsWith("--")) {
        flags[key] = args[++i];
      } else {
        flags[key] = true;
      }
    } else {
      positionals.push(value);
    }
  }

  return { positionals, flags };
}

function requireFlag(flags, name) {
  if (!flags[name]) {
    throw new GatewayError("argument_missing", `--${name.replaceAll("_", "-")} is required.`);
  }
  return flags[name];
}

function requireArg(value, description) {
  if (!value) {
    throw new GatewayError("argument_missing", `${description} is required.`);
  }
  return value;
}

module.exports = { parseGlobalArgs, parseFlags, requireFlag, requireArg };
