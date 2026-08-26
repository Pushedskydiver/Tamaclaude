# Setting it up

A small panel that sits on your desk and shows what Claude Code is doing. A
pixel crab called Clawd lives on it: he types while Claude types, thinks while
it thinks, and sleeps when nothing has happened for a while.

This is everything needed to get it running, in order. Most of the waiting is
one download.

> **The panel needs your Mac.** Every frame is drawn on the computer and sent
> to the device over USB — the panel itself holds no pictures. Plugged into a
> plain power adapter it shows its boot screen and waits. That is why there is
> software to install at all.

## What you need first

Two tools, neither of which macOS ships:

- **Node 24** — the version this is pinned to is 24.16.0
- **pnpm 10.32.1** — the project pins this exactly, and a different pnpm will
  switch itself to it rather than complain

If you already use [mise](https://mise.jdx.dev), the repo pins both, and
`mise trust && mise install` in the project folder does it — the `trust` is
needed because mise ignores a freshly cloned repo's tool versions until you
allow them. Otherwise install Node 24 from
[nodejs.org](https://nodejs.org) and then run `corepack enable pnpm`.

Nothing in the project compiles on install, so Xcode itself is not needed.
Apple's command line tools probably are, because `git` on macOS usually comes
from them — the first `git` command offers to install them. This is the one
prerequisite nobody has yet tested on a Mac that has never had them.

## 1. Get the project

If it is not already on your Mac, clone it — the address is on the card, and
`git` will ask to install Apple's command line tools the first time if you have
never used it:

```bash
git clone <the repo address>
cd tamaclaude
```

If somebody handed you the folder instead, put it somewhere permanent before
going on. Both later steps record where it lives, and moving it afterwards
stops the panel.

## 2. Build it

From inside the project folder:

```bash
pnpm install
pnpm build
```

`pnpm install` fetches a few hundred packages, nearly all of them tooling for
working on the project rather than running it — the program itself uses exactly
one third-party library. pnpm will print a warning that it
ignored a build script and suggest `pnpm approve-builds`; you can leave it
alone, because nothing needed to run the panel builds anything.

You do **not** need `pnpm exec playwright install`. That line is in the
README because `pnpm test` needs a headless browser — but running a panel does
not, and you are not running the tests. The animations are already drawn and
baked into the code.

## 3. Give it a pack

A _pack_ is a folder holding the colours and the things Clawd says. There is no
built-in default — with no pack the program stops and tells you so, rather than
starting up looking correct with somebody else's colours.

**Use the pack you were given**, not the example one. Copy its contents into
`~/.tamaclaude/pack/` so that `manifest.json` sits directly inside:

```bash
mkdir -p ~/.tamaclaude/pack
cp -R /path/to/your-pack/ ~/.tamaclaude/pack/
```

Then check:

```bash
pnpm tamaclaude pack
```

**It should name your pack — not `example` — and it should say a birthday is
in it.** If it says `example`, or `birthday: none in this pack`, the wrong
folder got copied. That combination is worth stopping for: the panel will look
completely correct and quietly do the wrong thing on the one day it matters.

There is an example pack in the project (`packs/example/`) with placeholder
colours and no birthday. It is there so the software has something to test
against — copy it only if you have not been given a pack yet, and expect to
replace it.

## 4. Plug the panel in

Use the USB cable, into the Mac itself rather than a hub if you have the
choice. Do this before the next step — the program finds the panel by looking
for it, so it needs to already be there.

You should see the boot screen: Clawd waving next to the name.

## 5. Start it

```bash
pnpm tamaclaude daemon
```

The boot screen should be replaced by Clawd beside his rock pool.

**Then press `Ctrl-C` to stop it before going on.** The next step starts the
same program automatically, and if this one is still running the automatic one
cannot claim the panel — it dies and retries every thirty seconds, quietly,
while everything looks installed.

## 6. Make it start when you log in

```bash
pnpm tamaclaude install-agent
```

That prints what it _would_ do and changes nothing. When it looks right:

```bash
pnpm tamaclaude install-agent --apply
```

Now it starts whenever you log in. Check:

```bash
pnpm tamaclaude status
```

It asks the system whether the thing is genuinely running, rather than assuming
it is.

## 7. Connect it to Claude Code

The panel reacts to Claude Code by being told what it is doing. This step wires
that up, and like the last one it shows you the change before making it:

```bash
pnpm install-hooks
pnpm install-hooks --apply
```

Then ask Claude Code to edit a file, and watch — Clawd should start typing.
Merely opening a session is not enough to see it: a new session puts him at
rest, and typing is what he does while Claude edits or writes.

## Do not move the project folder

Both the login entry and the Claude Code wiring store the full path to this
folder. Moving, renaming or deleting it stops the panel with no message. If you
do move it, run steps 6 and 7 again from the new location and both will
re-point themselves.

## When it stops working

Start here:

```bash
pnpm tamaclaude status
```

It asks the system whether the program is genuinely running, rather than
assuming. Three things account for almost everything.

**Clawd stopped reacting, but the panel is still on.** The Claude Code wiring
also stores the full path to Node, and it is deliberately silent when that path
breaks — it must never interrupt a session, so a failure prints nothing
anywhere. `status` will look fine. Re-point it:

```bash
pnpm install-hooks --apply
```

**The panel went blank or never came back after a restart.** Usually the login
entry pointing at a Node that has moved or been upgraded — same cause,
different half:

```bash
pnpm tamaclaude status                   # says so, if this is why
pnpm tamaclaude install-agent --apply    # re-points it
```

**The panel is not plugged in**, or went in after the program started. Note
`status` cannot see the panel — it reports the program, not the hardware. To
check the panel is found, use the dry run, which prints the device it would
use:

```bash
pnpm tamaclaude install-agent
```

If none of those, the log is at `~/.tamaclaude/daemon.log` — written only by
the automatic startup from step 6, so it will not exist if you never got that
far.

## Changing your pack

Replace the **contents** of `~/.tamaclaude/pack/` and restart the panel. Do not
set `TAMACLAUDE_PACK` in your shell to point somewhere else — the login entry
carries its own copy of that setting, so the panel would go on using the old
pack while `pnpm tamaclaude pack` cheerfully reports the new one. If you do
want it somewhere else, change it and re-run `install-agent --apply`.

## Turning it off

```bash
pnpm tamaclaude uninstall-agent
```

That stops it running and stops it coming back. It leaves the Claude Code
wiring in place, which is harmless — the hook finds nothing listening and gives
up — but it does run on every event. There is no automatic way to remove it
yet; edit `~/.claude/settings.json` and delete the `tamaclaude` entries if you
want it gone entirely.

## A note on the commands

`pnpm tamaclaude …` works from inside the project folder and installs nothing
globally. Every command in this guide is written that way.

If you would rather type `tamaclaude` from anywhere, pnpm can put it on your
`PATH` — but it needs a one-time setup first, and without it you get
`ERR_PNPM_NO_GLOBAL_BIN_DIR`:

```bash
pnpm setup                    # then open a new Terminal window
cd packages/cli && pnpm link
cd ../..                      # the pnpm commands only work from the top
```

Everything above works either way; this only changes what you type.
