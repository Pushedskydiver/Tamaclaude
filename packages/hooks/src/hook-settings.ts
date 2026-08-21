/**
 * Planning the patch to `~/.claude/settings.json`.
 *
 * Pure and separate from the installer that applies it, because the risky part
 * of this job is not writing a file — it is deciding what the file should say
 * about someone else's editor. A pure planner can be tested against a dozen
 * awkward existing files without one of them being real.
 *
 * The shape is Claude Code's, from code.claude.com/docs/en/hooks.md — three
 * levels of nesting, and the middle one is the part people get wrong:
 *
 * ```json
 * {
 *   "hooks": {
 *     "PreToolUse": [
 *       { "matcher": "*", "hooks": [{ "type": "command", "command": "…" }] }
 *     ]
 *   }
 * }
 * ```
 *
 * Event -> a list of matcher groups -> a list of handlers. An omitted matcher
 * and `"*"` both mean "everything", and a handful of events (`UserPromptSubmit`
 * and `Stop` among them) take no matcher at all, so the table below carries one
 * only where the docs say it is read.
 *
 * There is no zod here, and it is not an oversight. `packages/hooks` declares
 * exactly one dependency and a test asserts that, because Claude Code runs this
 * package's other binary on every hook event. A dependency is per-package, not
 * per-binary. If the validation this file hand-rolls ever needs to be real
 * validation, the installer belongs in `packages/cli`, not the schema library
 * in here.
 */

/** An event we ask Claude Code to tell us about, and why we want it. */
type RegisteredEvent = {
  readonly event: string;
  /** Omitted where the docs say the event takes no matcher. */
  readonly matcher?: string;
  /** Printed by the installer's dry run, so the file it writes explains itself. */
  readonly why: string;
};

/**
 * What we register, and nothing else.
 *
 * `PreToolUse` and `PostToolUse` match every tool rather than the five in the
 * state table. The mapping from a tool to an animation belongs to the daemon —
 * putting a matcher list here would copy that table into a second place, on
 * someone else's machine, in a file we only touch at install time. It would
 * then drift the first time a state is added, and the symptom would be a panel
 * that quietly never shows the new one. The cost of matching everything is a
 * few percent more spawns of a binary that takes 30 ms.
 *
 * `PreCompact` is deliberately absent: the sweeping animation it would drive is
 * Stage 4 work, and registering an event nothing consumes would be describing
 * behaviour that does not exist.
 *
 * Every event in `HANDLED_HOOK_EVENTS` must appear below, and nothing else may.
 * The list lives in `protocol` because this package and the daemon cannot see
 * each other; see the note there for the two ways they drifted apart.
 */
const HOOK_EVENTS: readonly RegisteredEvent[] = [
  {
    event: 'SessionStart',
    matcher: '*',
    why: 'a session exists — Clawd wakes',
  },
  { event: 'UserPromptSubmit', why: 'thinking' },
  {
    event: 'PreToolUse',
    matcher: '*',
    why: 'every tool — the daemon owns the tool→state mapping, not this file',
  },
  {
    event: 'PostToolUse',
    matcher: '*',
    why: 'the tool finished — towards idle',
  },
  {
    event: 'PermissionRequest',
    matcher: '*',
    why: 'the NEEDS_PERMISSION quip',
  },
  {
    event: 'StopFailure',
    matcher: '*',
    why: 'the FAILED quip — error_type says which',
  },
  {
    event: 'Stop',
    why: 'a response ended. Fires on every response, not at task completion',
  },
  {
    event: 'Notification',
    why: 'Claude is waiting on the person — the WAITING state',
  },
  { event: 'SubagentStart', matcher: '*', why: 'the subagent badge counts up' },
  { event: 'SubagentStop', matcher: '*', why: 'and down' },
  {
    event: 'SessionEnd',
    matcher: '*',
    why: 'the session is gone before the five-minute sleep would notice',
  },
];

/**
 * Claude Code's own cap on the hook, in seconds.
 *
 * `tamaclaude-notify` gives itself 150 ms and is measured at 30 ms round trip,
 * so this is not the working timeout — it is the outer guard for the case its
 * own deadline cannot cover, a process wedged before it runs any of its code.
 * Five seconds rather than one so a loaded machine cannot make a healthy
 * install look broken, and rather than the 600 s default so a broken one cannot
 * stall a turn.
 */
const HOOK_TIMEOUT_SECONDS = 5;

/**
 * How we recognise our own handler in a file we did not write.
 *
 * The installed path differs between a repo checkout
 * (`…/packages/hooks/dist/index.js`) and a package install
 * (`…/@tamaclaude/hooks/dist/index.js`), so the stable part is the tail; the
 * binary name covers the future where a brew formula puts it on `PATH`.
 * Getting this wrong does not corrupt anything — it adds a second handler, and
 * the panel gets every event twice.
 */
const MARKERS = ['tamaclaude-notify', 'hooks/dist/index.js'] as const;

type JsonRecord = Record<string, unknown>;

export type HookInstallPlan = {
  /** The whole settings object as it should be written. */
  readonly settings: JsonRecord;
  /** One line per event that would change. Empty means nothing to do. */
  readonly changes: readonly string[];
};

function asRecord(value: unknown): JsonRecord | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : undefined;
}

function asArray(value: unknown): readonly unknown[] | undefined {
  return Array.isArray(value) ? (value as readonly unknown[]) : undefined;
}

/**
 * The command Claude Code will run, as a shell line.
 *
 * Two guards that look like paranoia and are not. `2>/dev/null` keeps Node's
 * own output — a missing module after the repo moves, a deprecation warning
 * from a future runtime — out of the user's transcript, and `|| true` keeps a
 * failure to start the binary at all from becoming an error they see. The
 * binary itself already exits 0 on every path; this covers the case where it
 * never gets to run. The cost is that a broken install is silent rather than
 * loud, which is the right trade for a display and the wrong one for a tool
 * that matters — and re-running this installer prints the registered path, so
 * the diagnosis is one command.
 *
 * Paths are single-quoted because a Mac's home directory is allowed spaces. A
 * path containing a single quote is refused rather than escaped: this string
 * is handed to a shell, and there is no reason to be clever about it.
 */
export function hookCommand(node: string, script: string): string {
  const quoted = [node, script].filter((path) => path.includes("'"));
  if (quoted.length > 0) {
    throw new Error(
      `refusing to build a shell command from a path containing a quote: ${quoted.join(', ')}`,
    );
  }
  return `'${node}' '${script}' 2>/dev/null || true`;
}

function isOurs(handler: unknown): boolean {
  const command = asRecord(handler)?.command;
  return (
    typeof command === 'string' &&
    MARKERS.some((marker) => command.includes(marker))
  );
}

/** The command we already registered for this event, if we registered one. */
function currentCommand(groups: readonly unknown[]): string | undefined {
  const handlers = groups.flatMap(
    (group) => asArray(asRecord(group)?.hooks) ?? [],
  );
  const command = asRecord(
    handlers.find((handler) => isOurs(handler)),
  )?.command;
  return typeof command === 'string' ? command : undefined;
}

function newGroup(entry: RegisteredEvent, command: string): JsonRecord {
  return {
    ...(entry.matcher === undefined ? {} : { matcher: entry.matcher }),
    hooks: [{ type: 'command', command, timeout: HOOK_TIMEOUT_SECONDS }],
  };
}

/** Point our existing handler at a new path, leaving every other one alone. */
function retarget(group: unknown, command: string): unknown {
  const record = asRecord(group);
  const handlers = asArray(record?.hooks);
  if (record === undefined || handlers === undefined) return group;
  return {
    ...record,
    hooks: handlers.map((handler) =>
      isOurs(handler) ? { ...asRecord(handler), command } : handler,
    ),
  };
}

type EventPatch = {
  readonly groups: readonly unknown[];
  readonly change?: string;
};

function patchGroups(
  groups: readonly unknown[],
  entry: RegisteredEvent,
  command: string,
): EventPatch {
  const current = currentCommand(groups);
  if (current === command) return { groups };
  if (current === undefined) {
    return {
      groups: [...groups, newGroup(entry, command)],
      change: `+ ${entry.event} — ${entry.why}`,
    };
  }
  // Repointed rather than appended. Appending is the failure that matters
  // here: two handlers means two processes per event, for ever, and nothing
  // in Claude Code would complain about it.
  return {
    groups: groups.map((group) => retarget(group, command)),
    change: `~ ${entry.event} — repointed from ${current}`,
  };
}

function patchHooks(
  hooks: JsonRecord,
  entry: RegisteredEvent,
  command: string,
): { readonly hooks: JsonRecord; readonly change?: string } {
  const existing = hooks[entry.event];
  const groups = asArray(existing);
  if (existing !== undefined && groups === undefined) {
    // Present but not a list: this file is not shaped the way the docs
    // describe, so we do not understand it well enough to edit it. Left
    // untouched and reported, rather than replaced — the one outcome nobody
    // would forgive is losing a setting we did not recognise.
    return {
      hooks,
      change: `! ${entry.event} — left alone, its existing entry is not a list`,
    };
  }
  const patch = patchGroups(groups ?? [], entry, command);
  return {
    hooks: { ...hooks, [entry.event]: patch.groups },
    ...(patch.change === undefined ? {} : { change: patch.change }),
  };
}

/**
 * Work out what `settings.json` should say, given what it says now.
 *
 * Everything not ours is carried through untouched: unrelated top-level keys,
 * other tools' hooks on the same events, other matcher groups. `settings` is
 * `unknown` because it came off disk — a missing file arrives here as `{}`,
 * and one that failed to parse never arrives at all.
 */
export function planHookInstall(
  settings: unknown,
  command: string,
): HookInstallPlan {
  const base = asRecord(settings) ?? {};
  const start = { hooks: asRecord(base.hooks) ?? {}, changes: [] as string[] };
  const patched = HOOK_EVENTS.reduce((accumulated, entry) => {
    const patch = patchHooks(accumulated.hooks, entry, command);
    return {
      hooks: patch.hooks,
      changes:
        patch.change === undefined
          ? accumulated.changes
          : [...accumulated.changes, patch.change],
    };
  }, start);
  return {
    // Spreading `base` first keeps `hooks` wherever it already sat in the file.
    settings: { ...base, hooks: patched.hooks },
    changes: patched.changes,
  };
}
