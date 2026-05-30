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

async function dispatch(args, context) {
  const handlers = await buildHandlers(context);
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
    return handlers.pageGet(requireArg(subcommand, "page-id"));
  }

  if (noun === "page" && verb === "create") {
    const { flags } = parseFlags([subcommand, ...rest].filter(Boolean));
    return handlers.pageCreate(requireFlag(flags, "database"), requireFlag(flags, "title"), flags.properties, {
      dryRun: Boolean(flags.dry_run),
      content: flags.content,
      stdin: Boolean(flags.stdin),
    });
  }

  if (noun === "page" && verb === "properties" && subcommand === "update") {
    const pageId = requireArg(rest[0], "page-id");
    const { flags } = parseFlags(rest.slice(1));
    return handlers.pagePropertiesUpdate(pageId, requireFlag(flags, "properties"), Boolean(flags.dry_run));
  }

  if (noun === "page" && verb === "update") {
    const pageId = requireArg(subcommand, "page-id");
    const { flags } = parseFlags(rest);
    return handlers.pagePropertiesUpdate(pageId, requireFlag(flags, "properties"), Boolean(flags.dry_run));
  }

  if (noun === "block" && verb === "append") {
    const pageId = requireArg(subcommand, "page-id");
    const { flags } = parseFlags(rest);
    return handlers.blockAppend(pageId, {
      content: flags.content,
      stdin: Boolean(flags.stdin),
      dryRun: Boolean(flags.dry_run),
    });
  }

  if (noun === "aggregate" && verb === "pages") {
    const { flags } = parseFlags([subcommand, ...rest].filter(Boolean));
    if (flags.database) {
      throw new GatewayError(
        "argument_invalid",
        "aggregate pages is a cross-database command and does not accept --database. Use official ntn datasources query for one-database ad hoc searches."
      );
    }
    return handlers.aggregatePages({
      status: flags.status,
      since: flags.since,
      until: flags.until,
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

  const exitCode = await runWithOutput(context.stdout, options, () => dispatch(args, context));
  return exitCode;
}

module.exports = { main, dispatch, buildHandlers };
