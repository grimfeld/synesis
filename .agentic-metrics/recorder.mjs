// The agentic-metrics recorder: a Claude Code hook that leaves a session record
// on the commits a session makes, so its counts travel with the repo instead of
// staying in a transcript on one device (docs/adr/0001 in grimfeld/agentic-metrics).
//
// `agentic-metrics init` copies this file into a measured repo and registers it
// in `.claude/settings.json` for UserPromptSubmit, PreToolUse (Bash),
// PostToolUse, Stop and SubagentStop. It is self-contained: Node and nothing
// else, so it runs in a cloud container as on a laptop.
//
// On every event it updates the session's counters, kept in an uncommitted
// state file under the repo's `.git/agentic-metrics/`:
//   started   the session's first event;
//   active    the gaps between its events, each capped at 5 minutes;
//   human     the prompts a person typed;
//   agents    the sub-agents it spawned (each has counters of its own).
// When the agent runs `git commit`, or `git merge` with a message, it rewrites
// the command to add the record as a trailer:
//   Session-Record: v1 k=<key> active=<seconds> human=<n> agents=<n> started=<time> [parent=<key>]
// Counts only: the key is a hash, and no session id, path or text is written.
//
// It returns no permission decision, so the rewritten command goes through the
// session's own permission flow, and it never blocks or fails anything: on any
// error it prints nothing and exits 0.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

export const RECORDER_VERSION = 1;
const TRAILER = "Session-Record";
/** A gap between two events longer than this counts as this much: the rest is idle. */
const IDLE_CAP_MS = 5 * 60 * 1000;
/** State files older than this are left by sessions long over. */
const STALE_MS = 30 * 24 * 3600 * 1000;

/** The opaque key of a session, or of one of its sub-agents. `collect` computes the same from a transcript. */
function keyOf(sessionId, agentId) {
  const name = agentId === undefined ? sessionId : `${sessionId}:${agentId}`;
  return createHash("sha256").update(`agentic-metrics:${name}`).digest("hex").slice(0, 12);
}

/** `<repo>/.git/agentic-metrics`, shared by the repo's worktrees; undefined outside a git repo. */
function stateDir(projectDir) {
  if (process.env.AGENTIC_METRICS_STATE_DIR) return process.env.AGENTIC_METRICS_STATE_DIR;
  const dotGit = join(projectDir, ".git");
  if (!existsSync(dotGit)) return undefined;
  if (statSync(dotGit).isDirectory()) return join(dotGit, "agentic-metrics");
  // A worktree: `.git` is a file naming its git dir, which names the repo's common one.
  const gitDir = /^gitdir:\s*(.+)$/m.exec(readFileSync(dotGit, "utf8"))?.[1]?.trim();
  if (!gitDir) return undefined;
  const absolute = isAbsolute(gitDir) ? gitDir : resolve(projectDir, gitDir);
  const commonFile = join(absolute, "commondir");
  const common = existsSync(commonFile) ? resolve(absolute, readFileSync(commonFile, "utf8").trim()) : absolute;
  return join(common, "agentic-metrics");
}

function readState(file) {
  try {
    const state = JSON.parse(readFileSync(file, "utf8"));
    if (typeof state.started === "number" && typeof state.last === "number" && typeof state.activeMs === "number") {
      return { started: state.started, last: state.last, activeMs: state.activeMs, human: Number(state.human) || 0 };
    }
  } catch {
    // No state yet, or an unreadable one: the session starts now.
  }
  return undefined;
}

function writeState(file, state) {
  const tmp = `${file}.${String(process.pid)}.tmp`;
  writeFileSync(tmp, JSON.stringify(state));
  renameSync(tmp, file);
}

function prune(dir, now) {
  for (const name of readdirSync(dir)) {
    const file = join(dir, name);
    try {
      if (now - statSync(file).mtimeMs > STALE_MS) unlinkSync(file);
    } catch {
      // Another session removed it first.
    }
  }
}

/** A prompt a person typed: not a slash command, a shell escape, or text the tooling or another agent wrote. */
function isHumanPrompt(prompt) {
  return typeof prompt === "string" && prompt.trim() !== "" && !/^[</!]/.test(prompt.trim());
}

/** `2026-11-10T18:00:00Z`: to the second. */
function isoSeconds(ms) {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
}

// `git commit` or `git merge` as a command of its own, with any `VAR=x` before
// it and `-C dir`, `-c key=value` or `--git-dir` options between.
const GIT = /(?:[A-Za-z_][A-Za-z0-9_]*=\S*[ \t]+)*git(?:[ \t]+(?:-[cC][ \t]+\S+|--(?:git-dir|work-tree|namespace)(?:=|[ \t]+)\S+|--no-pager|--bare))*[ \t]+(commit|merge)(?=[ \t\n;&|)]|$)/y;
/** A merge that makes no commit, or none of its own message, is left alone. */
const NO_MERGE_COMMIT = /(?:^|\s)--(?:abort|continue|quit|squash|no-commit|ff-only)(?=\s|$)/;
const HAS_MESSAGE = /(?:^|\s)(?:-[a-zA-Z]*m|--message)(?=[\s=]|$)/;

/**
 * `command` with the trailer added to each `git commit` and each `git merge`
 * that has a message; unchanged when it holds neither. Text inside quotes or a
 * heredoc body is never touched: a commit message that mentions `git commit`
 * is not a command.
 */
export function addTrailer(command, trailer) {
  const insertions = [];
  /** A merge found in the simple command being read: where it started, to add `-m` at its end. */
  let merge;
  let quote;
  let commandStart = true;
  const endOfCommand = (index) => {
    if (merge === undefined) return;
    const segment = command.slice(merge, index);
    // After its last argument, so the record is the message's last paragraph: its trailers.
    if (HAS_MESSAGE.test(segment) && !NO_MERGE_COMMIT.test(segment)) insertions.push({ at: merge + segment.trimEnd().length, text: ` -m "${trailer}"` });
    merge = undefined;
  };

  for (let i = 0; i < command.length; i++) {
    const char = command[i];
    if (quote === "'") {
      if (char === "'") quote = undefined;
      continue;
    }
    if (char === "\\") {
      i++;
      continue;
    }
    // A heredoc: skip its body, whatever it quotes.
    if (char === "<" && command[i + 1] === "<" && command[i + 2] !== "<") {
      const opener = /^<<(-?)[ \t]*(?:'([^'\n]+)'|"([^"\n]+)"|\\?([A-Za-z_][A-Za-z0-9_]*))/.exec(command.slice(i));
      const delimiter = opener && (opener[2] ?? opener[3] ?? opener[4]);
      const bodyStart = command.indexOf("\n", i);
      if (delimiter && bodyStart !== -1) {
        const lines = command.slice(bodyStart + 1).split("\n");
        let offset = bodyStart + 1;
        let closed = false;
        for (const line of lines) {
          if ((opener[1] ? line.replace(/^\t+/, "") : line) === delimiter) {
            closed = true;
            break;
          }
          offset += line.length + 1;
        }
        if (!closed) return command;
        // Resume on the delimiter line: what follows it is shell again.
        i = offset + delimiter.length - 1;
        continue;
      }
    }
    if (quote === '"') {
      if (char === '"') quote = undefined;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      commandStart = false;
      continue;
    }
    // `2>&1` and `&>file` redirect: their `&` ends no command.
    if (char === "&" && (command[i - 1] === ">" || command[i + 1] === ">")) continue;
    if (char === ";" || char === "&" || char === "|" || char === "\n" || char === "(") {
      endOfCommand(i);
      commandStart = true;
      continue;
    }
    if (char === " " || char === "\t") continue;
    if (commandStart) {
      GIT.lastIndex = i;
      const match = GIT.exec(command);
      if (match) {
        const end = i + match[0].length;
        if (match[1] === "commit") insertions.push({ at: end, text: ` --trailer "${trailer}"` });
        else merge = i;
        i = end - 1;
      }
    }
    commandStart = false;
  }
  if (quote !== undefined) return command;
  endOfCommand(command.length);

  let out = command;
  for (const { at, text } of insertions.sort((a, b) => b.at - a.at)) out = out.slice(0, at) + text + out.slice(at);
  return out;
}

/** `--trailer` came with git 2.32: an older git would fail the commit. */
function gitAddsTrailers() {
  try {
    const version = /(\d+)\.(\d+)/.exec(execFileSync("git", ["--version"], { encoding: "utf8", timeout: 2000 }));
    return version ? Number(version[1]) > 2 || (Number(version[1]) === 2 && Number(version[2]) >= 32) : false;
  } catch {
    return false;
  }
}

function record(event) {
  const sessionId = event.session_id;
  if (typeof sessionId !== "string" || sessionId === "") return undefined;
  const dir = stateDir(process.env.CLAUDE_PROJECT_DIR || event.cwd || process.cwd());
  if (!dir) return undefined;
  const agentId = typeof event.agent_id === "string" && event.agent_id !== "" ? event.agent_id : undefined;
  const now = Number.isFinite(Date.parse(process.env.AGENTIC_METRICS_NOW ?? "")) ? Date.parse(process.env.AGENTIC_METRICS_NOW) : Date.now();
  const sessionKey = keyOf(sessionId);
  const key = agentId === undefined ? sessionKey : keyOf(sessionId, agentId);
  // A sub-agent's file carries its parent's key, so the parent's are counted by name.
  const file = join(dir, agentId === undefined ? `${key}.json` : `${sessionKey}.${key}.json`);

  mkdirSync(dir, { recursive: true });
  let state = readState(file);
  if (!state) {
    prune(dir, now);
    state = { started: now, last: now, activeMs: 0, human: 0 };
  }
  state.activeMs += Math.min(Math.max(now - state.last, 0), IDLE_CAP_MS);
  state.last = Math.max(now, state.last);
  if (agentId === undefined && event.hook_event_name === "UserPromptSubmit" && isHumanPrompt(event.prompt)) state.human++;
  writeState(file, state);

  const agents = agentId === undefined ? readdirSync(dir).filter((name) => name.startsWith(`${sessionKey}.`) && name.endsWith(".json") && name !== `${sessionKey}.json`).length : 0;
  const parts = [`v${String(RECORDER_VERSION)}`, `k=${key}`, `active=${String(Math.round(state.activeMs / 1000))}`, `human=${String(state.human)}`, `agents=${String(agents)}`, `started=${isoSeconds(state.started)}`];
  if (agentId !== undefined) parts.push(`parent=${sessionKey}`);
  return `${TRAILER}: ${parts.join(" ")}`;
}

function run(input) {
  const event = JSON.parse(input);
  if (event === null || typeof event !== "object") return;
  const trailer = record(event);
  if (!trailer || event.hook_event_name !== "PreToolUse" || event.tool_name !== "Bash") return;
  const command = event.tool_input?.command;
  if (typeof command !== "string" || !/\bgit\b/.test(command) || command.includes(`${TRAILER}:`)) return;
  const rewritten = addTrailer(command, trailer);
  if (rewritten === command || !gitAddsTrailers()) return;
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", updatedInput: { ...event.tool_input, command: rewritten } } }));
}

// Run as a hook, not when imported. import.meta.url has symlinks resolved
// (macOS: /var is /private/var), so argv[1] is resolved the same way.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(resolve(process.argv[1]))).href) {
  try {
    run(readFileSync(0, "utf8"));
  } catch {
    // Never fail a prompt, a tool call or a commit over a metric.
  }
}
