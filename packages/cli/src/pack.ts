/**
 * Where the pack comes from.
 *
 * ## There is no bundled default, deliberately
 *
 * The obvious design has a fallback: try what the user configured, and if
 * nothing is there, load a copy of the example pack that ships with the
 * binary. A spec review killed it, and the argument is the whole reason this
 * file exists.
 *
 * **A fallback turns the most likely mistake into an invisible one.** Nothing
 * sets `TAMACLAUDE_PACK` in production today — `BUILD_PLAN.md` still has the
 * launchd agent and the `brew` formula unstarted, and `packages/hooks` says in
 * as many words that it does not install a launchd agent. So the likeliest way
 * this daemon starts on 23 September is a person typing the command they have
 * typed a hundred times, without the variable. With a fallback that hands back
 * a panel which works, looks right, and carries the example pack's generic
 * quips and no `birthday` at all. Nothing is red. Nobody finds out until the
 * day after.
 *
 * Without one it is `no pack configured` on stderr, exit 2, fixed in fifteen
 * seconds. And the glass is not blank in the meantime: the boot splash is
 * baked into the firmware and draws itself with no host attached.
 *
 * ## Explicit and implicit, not absent and invalid
 *
 * The first draft said "absent falls through, invalid is fatal". That cut is
 * unimplementable: a directory someone created but left empty, and a dangling
 * symlink into a moved checkout, both arrive as `ENOENT` — and both are
 * mistakes, not absences. The distinction that survives contact is whether the
 * path was *named*:
 *
 * | Source                        | Missing means                    |
 * | ----------------------------- | -------------------------------- |
 * | `TAMACLAUDE_PACK`             | you told me a path and it is not there — fatal |
 * | `~/.tamaclaude/pack/`         | nothing configured — fatal, with instructions |
 *
 * Both ends are fatal, so there is no fall-through to get wrong. The only
 * difference is which sentence gets printed.
 *
 * ## Not a config file, and that reopens a decision
 *
 * `.claude/research/foundations/brief.md` §Packs says "`config.json` picks
 * one". This is not that, and the departure is deliberate rather than an
 * oversight: a JSON file holding a single string is a second schema, a second
 * trust boundary and a second set of tests, to do what one environment
 * variable already does — and the launchd plist that will set it in production
 * is a config file already. If a pack ever needs more than one knob, that is
 * the moment to revisit this, not before.
 *
 * ## A pack is a directory
 *
 * Not a manifest file. `BUILD_PLAN.md` puts a logo and a pet sprite in the
 * pack, so the directory is the unit and `manifest.json` is a file inside it.
 * Resolving to the file now would leave the sibling-asset question to be
 * answered ad hoc later.
 */
import { lstatSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';

/** Where a resolved pack came from, so `tamaclaude pack` can say. */
type PackSource = 'TAMACLAUDE_PACK' | 'default';

export type ResolvedPack = {
  /** The pack directory. */
  readonly directory: string;
  /** The manifest inside it, still unparsed — the daemon is the validator. */
  readonly manifest: unknown;
  readonly source: PackSource;
};

type Lookup = {
  readonly env?: Readonly<Partial<Record<string, string>>>;
  readonly home?: string;
};

/**
 * The default pack directory, matching `socket-path.ts` and `install.ts`.
 *
 * `~/.tamaclaude/` already holds the socket, so this is the second thing in a
 * directory that exists. It earns its place over the environment variable
 * alone for one reason: an env var set inside a launchd plist cannot be read
 * back out of a running agent, but `ls ~/.tamaclaude/pack/` answers the
 * question from any terminal.
 */
function defaultDirectory(home: string): string {
  return join(home, '.tamaclaude', 'pack');
}

/**
 * Whether anything at all occupies this path.
 *
 * `lstat`, not `existsSync`, and that is the whole point: `existsSync` follows
 * symlinks, so a dangling one — the shape a moved checkout leaves behind —
 * reads as "nothing here" and would produce `no pack configured` for a path
 * somebody deliberately created. `lstat` sees the link itself. Same reasoning
 * as `socket-path.ts`, which uses `lstat` so that "I cannot tell" never
 * resolves to the destructive answer.
 *
 * So an empty directory, a dangling link and a regular file all count as
 * *something*, and all of them go on to fail with a message naming the path
 * rather than falling through.
 */
function somethingIsThere(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

/** Read and JSON-parse a manifest, or say which file and why not. */
function readManifest(directory: string, source: PackSource): unknown {
  const manifest = join(directory, 'manifest.json');
  try {
    return JSON.parse(readFileSync(manifest, 'utf8')) as unknown;
  } catch (cause) {
    // Named rather than left as a bare ENOENT or a JSON syntax error, both of
    // which point at Node's internals instead of at the file — the same reason
    // `index.ts` gives for wrapping its own read.
    const how =
      source === 'TAMACLAUDE_PACK'
        ? 'TAMACLAUDE_PACK names this directory'
        : 'this is the default pack directory';
    throw new Error(`could not read the pack at ${manifest} (${how})`, {
      cause,
    });
  }
}

/**
 * Find the pack, or throw a sentence a person can act on.
 *
 * `env` and `home` are injectable so a test can point the whole resolution at
 * a temporary directory rather than at whoever is running the suite — the same
 * reason `TAMACLAUDE_SOCKET` exists.
 */
export function resolvePack(lookup: Lookup = {}): ResolvedPack {
  const env = lookup.env ?? process.env;
  const home = lookup.home ?? homedir();

  const named = env.TAMACLAUDE_PACK;
  if (named !== undefined && named !== '') {
    return {
      directory: named,
      manifest: readManifest(named, 'TAMACLAUDE_PACK'),
      source: 'TAMACLAUDE_PACK',
    };
  }

  const fallback = defaultDirectory(home);
  if (!somethingIsThere(fallback)) {
    throw new Error(
      `no pack configured: set TAMACLAUDE_PACK, or put a pack at ${fallback}`,
    );
  }
  return {
    directory: fallback,
    manifest: readManifest(fallback, 'default'),
    source: 'default',
  };
}
