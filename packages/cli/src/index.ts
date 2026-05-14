#!/usr/bin/env bun
import { loadConfig, runProxy } from "@mcp-shield/core";

type Argv = {
  configPath: string;
  upstream: string[];
};

function parseArgv(argv: string[]): Argv {
  let configPath = "./mcp-shield.config.ts";
  const upstream: string[] = [];
  let sawSeparator = false;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (sawSeparator) {
      upstream.push(a);
      continue;
    }
    if (a === "--") {
      sawSeparator = true;
      continue;
    }
    if (a === "--config" || a === "-c") {
      const next = argv[i + 1];
      if (!next) die("--config requires a value");
      configPath = next;
      i++;
      continue;
    }
    if (a === "-h" || a === "--help") {
      printHelp();
      process.exit(0);
    }
    die(`unknown argument: ${a}`);
  }

  if (!upstream.length) die("missing upstream command (pass after --)");
  return { configPath, upstream };
}

function printHelp(): void {
  process.stderr.write(
    [
      "mcp-shield — security proxy for MCP servers",
      "",
      "Usage:",
      "  mcp-shield [--config <path>] -- <upstream-command> [args...]",
      "",
      "Env:",
      "  MCP_SHIELD_KEY   API key for this session (set by MCP client config)",
      "",
      "Example:",
      "  mcp-shield --config ./mcp-shield.config.ts -- \\",
      "    npx @modelcontextprotocol/server-filesystem /tmp",
      "",
    ].join("\n"),
  );
}

function die(msg: string): never {
  process.stderr.write(`mcp-shield: ${msg}\n`);
  printHelp();
  process.exit(1);
}

async function main(): Promise<void> {
  const { configPath, upstream } = parseArgv(process.argv.slice(2));
  const config = await loadConfig(configPath);
  const sessionKey = process.env.MCP_SHIELD_KEY;

  const code = await runProxy({ config, upstreamCmd: upstream, sessionKey });
  process.exit(code);
}

main().catch((e) => {
  process.stderr.write(`mcp-shield: fatal: ${(e as Error).stack ?? e}\n`);
  process.exit(1);
});
