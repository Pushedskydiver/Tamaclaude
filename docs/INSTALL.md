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
- **pnpm 10.32.1** — exact, and it checks

If you already use [mise](https://mise.jdx.dev), the repo pins both and
`mise install` in the project folder does it. Otherwise install Node 24 from
[nodejs.org](https://nodejs.org) and then run `corepack enable pnpm`.

Nothing here compiles anything, so you do not need Xcode or its command line
tools — unless you use `git` to fetch the project, which on macOS usually comes
from them.

## 1. Build it

From inside the project folder:

```bash
pnpm install
pnpm build
```

`pnpm install` fetches a few hundred packages, nearly all of them tooling for
working on the project rather than running it — the program itself uses exactly
one third-party library. If pnpm asks about build scripts, you can decline;
nothing needed to run the panel builds anything.

You do **not** need `pnpm exec playwright install`. That line is in the
README for people working on the artwork; the animations are already drawn and
baked into the code.

## 2. Give it a pack

A _pack_ is a folder holding the colours and the things Clawd says. There is no
built-in default — with no pack the program stops and tells you so, rather than
starting up looking correct with somebody else's colours.

```bash
mkdir -p ~/.tamaclaude/pack
cp -R packs/example/ ~/.tamaclaude/pack/
```

If you were given a pack of your own, copy that into `~/.tamaclaude/pack/`
instead. Check it took:

```bash
pnpm tamaclaude pack
```

It should name the pack and say whether it has a birthday in it.

## 3. Plug the panel in

Use the USB cable, into the Mac itself rather than a hub if you have the
choice. Do this before the next step — the program finds the panel by looking
for it, so it needs to already be there.

You should see the boot screen: Clawd waving next to the name.

## 4. Start it

```bash
pnpm tamaclaude daemon
```

The boot screen should be replaced by Clawd beside his rock pool. Leave this
running and
open a second Terminal tab for the rest, or press `Ctrl-C` and carry on — the
next step makes it start on its own.

## 5. Make it start when you log in

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

## 6. Connect it to Claude Code

The panel reacts to Claude Code by being told what it is doing. This step wires
that up, and like the last one it shows you the change before making it:

```bash
pnpm install-hooks
pnpm install-hooks --apply
```

Then start a Claude Code session and watch — Clawd should start typing.

## When it stops working

Two things account for almost all of it.

**You upgraded or moved Node.** The startup entry points at the exact Node it
was installed with, because the system's own startup runner has a minimal
`PATH` and cannot find a version-managed one. Move Node and the panel goes
quiet. This is the common one:

```bash
pnpm tamaclaude status          # says so, if this is why
pnpm tamaclaude install-agent --apply   # re-points it
```

**The panel is not plugged in**, or went in after the program started. Unplug
and replug it, then `pnpm tamaclaude status`.

If neither helps, the log is at `~/.tamaclaude/daemon.log`.

To stop it starting at login:

```bash
pnpm tamaclaude uninstall-agent
```

## A note on the commands

`pnpm tamaclaude …` works from inside the project folder and installs nothing
globally. Every command in this guide is written that way.

If you would rather type `tamaclaude` from anywhere, pnpm can put it on your
`PATH` — but it needs a one-time setup first, and without it you get
`ERR_PNPM_NO_GLOBAL_BIN_DIR`:

```bash
pnpm setup                    # then open a new Terminal window
cd packages/cli && pnpm link
```

Everything above works either way; this only changes what you type.
