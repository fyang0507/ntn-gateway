const { loadConfig } = require("./config");
const { createNotionClient, NotionGatewayApi } = require("./notion");
const { GatewayService } = require("./gateway");
const { CommandHandlers } = require("./commands");
const { runWithOutput } = require("./output");
const { GatewayError } = require("./errors");
const { parseGlobalArgs, parseFlags, requireFlag, requireArg } = require("./args");
const { HELP } = require("./help");

async function buildHandlers(context) {
  if (context.handlers) return context.handlers;
  const config = loadConfig({ cwd: context.cwd || process.cwd(), env: context.env || process.env });
  const client = context.client || await createNotionClient(config.notionApiKey);
  const api = new NotionGatewayApi(client);
  const gateway = new GatewayService(api, config);
  return new CommandHandlers({ api, gateway, stdin: context.stdin });
}

// Parse and validate the `page get` content-shaping flags. Exactly one shaping mode is allowed
// at a time; supplying two or more throws argument_conflict naming them.
function parsePageGetContentOptions(flags) {
  const parsePositiveInt = (name) => {
    const raw = flags[name];
    if (raw === undefined) return undefined;
    if (raw === true) {
      throw new GatewayError("argument_invalid", `--${name.replaceAll("_", "-")} requires a positive integer.`);
    }
    const value = Number.parseInt(raw, 10);
    if (!Number.isInteger(value) || value < 1 || String(value) !== String(raw).trim()) {
      throw new GatewayError("argument_invalid", `--${name.replaceAll("_", "-")} must be a positive integer.`);
    }
    return value;
  };

  const options = {};
  const active = [];

  if (flags.content !== undefined) {
    if (flags.content === true || !["full", "none", "preview"].includes(flags.content)) {
      throw new GatewayError("argument_invalid", "--content must be one of full, none, preview.");
    }
    // full is the default no-op; only non-full modes count as an active shaping option.
    if (flags.content !== "full") {
      options.content = flags.content;
      active.push("--content");
    }
  }

  const maxContentChars = parsePositiveInt("max_content_chars");
  if (maxContentChars !== undefined) {
    options.maxContentChars = maxContentChars;
    active.push("--max-content-chars");
  }

  const headLines = parsePositiveInt("head_lines");
  if (headLines !== undefined) {
    options.headLines = headLines;
    active.push("--head-lines");
  }

  const tailLines = parsePositiveInt("tail_lines");
  if (tailLines !== undefined) {
    options.tailLines = tailLines;
    active.push("--tail-lines");
  }

  if (flags.section !== undefined) {
    if (flags.section === true) {
      throw new GatewayError("argument_invalid", "--section requires the heading text to match.");
    }
    options.section = flags.section;
    active.push("--section");
  }

  if (flags.find !== undefined) {
    if (flags.find === true) {
      throw new GatewayError("argument_invalid", "--find requires the text to search for.");
    }
    options.find = flags.find;
    active.push("--find");
  }

  if (active.length > 1) {
    throw new GatewayError(
      "argument_conflict",
      `Only one content-shaping option is allowed at a time; received ${active.join(", ")}.`,
      { conflict: active }
    );
  }

  return options;
}

async function dispatch(args, context, options = {}) {
  const handlers = await buildHandlers(context);
  const verbose = Boolean(options.verbose);
  const [noun, verb, subcommand, ...rest] = args;

  if (noun === "show") return handlers.show();

  if (noun === "database" && verb === "schema") {
    return handlers.schema(requireArg(subcommand, "data-source-id"));
  }

  if (noun === "database" && verb === "create") {
    const { flags } = parseFlags([subcommand, ...rest].filter(Boolean));
    return handlers.databaseCreate(requireFlag(flags, "title"), Boolean(flags.dry_run));
  }

  if (noun === "page" && verb === "get") {
    const pageId = requireArg(subcommand, "page-id");
    const { flags } = parseFlags(rest);
    return handlers.pageGet(pageId, parsePageGetContentOptions(flags));
  }

  if (noun === "page" && verb === "create") {
    const { flags } = parseFlags([subcommand, ...rest].filter(Boolean));
    return handlers.pageCreate(requireFlag(flags, "database"), requireFlag(flags, "title"), flags.properties, {
      dryRun: Boolean(flags.dry_run),
      content: flags.content,
      stdin: Boolean(flags.stdin),
      allowNewOptions: Boolean(flags.allow_new_options),
      verbose,
    });
  }

  if (noun === "page" && verb === "properties" && subcommand === "update") {
    const pageId = requireArg(rest[0], "page-id");
    const { flags } = parseFlags(rest.slice(1));
    return handlers.pagePropertiesUpdate(pageId, requireFlag(flags, "properties"), Boolean(flags.dry_run), verbose, Boolean(flags.allow_new_options));
  }

  if (noun === "page" && verb === "body" && subcommand === "replace") {
    const pageId = requireArg(rest[0], "page-id");
    const { flags } = parseFlags(rest.slice(1));
    return handlers.pageBodyReplace(pageId, {
      content: flags.content,
      stdin: Boolean(flags.stdin),
      dryRun: Boolean(flags.dry_run),
      confirm: Boolean(flags.confirm),
      verbose,
    });
  }

  if (noun === "page" && verb === "update") {
    const pageId = requireArg(subcommand, "page-id");
    const { flags } = parseFlags(rest);
    return handlers.pagePropertiesUpdate(pageId, requireFlag(flags, "properties"), Boolean(flags.dry_run), verbose, Boolean(flags.allow_new_options));
  }

  if (noun === "block" && verb === "append") {
    const pageId = requireArg(subcommand, "page-id");
    const { flags } = parseFlags(rest);
    return handlers.blockAppend(pageId, {
      content: flags.content,
      stdin: Boolean(flags.stdin),
      dryRun: Boolean(flags.dry_run),
      verbose,
    });
  }

  if (noun === "aggregate" && verb === "pages") {
    const { flags } = parseFlags([subcommand, ...rest].filter(Boolean));
    if (flags.database) {
      throw new GatewayError(
        "argument_invalid",
        "aggregate pages is a cross-database command. Use --databases <id|title,...> to scope to specific Gateway databases, or official ntn datasources query for one-database ad hoc searches."
      );
    }
    if (flags.databases === true) {
      throw new GatewayError("argument_invalid", "--databases requires a comma-separated list of Gateway data source IDs or titles.");
    }
    let limit;
    if (flags.limit !== undefined && flags.limit !== true) {
      limit = Number.parseInt(flags.limit, 10);
      if (!Number.isInteger(limit) || limit < 1) {
        throw new GatewayError("argument_invalid", "--limit must be a positive integer.");
      }
    }
    if (flags.date_filter === true) {
      throw new GatewayError("argument_invalid", '--date-filter requires a JSON object (inline or @file.json), e.g. \'{"start":{"after":"2026-01-01"}}\'. Run --help for the field list.');
    }
    return handlers.aggregatePages({
      status: flags.status,
      allStatus: Boolean(flags.all),
      dateFilter: typeof flags.date_filter === "string" ? flags.date_filter : undefined,
      databases: typeof flags.databases === "string" ? flags.databases : undefined,
      limit,
      verbose,
    });
  }

  throw new GatewayError("command_unknown", "Unknown command. Run ntn-gateway --help for usage.", { args });
}

async function main(argv, context) {
  const { args, options } = parseGlobalArgs(argv);
  if (options.help || args.length === 0) {
    context.stdout.write(HELP);
    return 0;
  }

  const exitCode = await runWithOutput(context.stdout, options, () => dispatch(args, context, options));
  return exitCode;
}

module.exports = { main, dispatch, buildHandlers };
