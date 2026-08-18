/**
 * A Claude Code hook event, as forwarded by `@tamaclaude/hooks` to the daemon.
 *
 * `tool` is present for tool-scoped events — `PreToolUse` and `PostToolUse`
 * both carry Claude Code's `tool_name` — and it is what the daemon maps to an
 * animation. `BUILD_PLAN.md` Stage 3 gates confirming the hook names and
 * payload shapes against live documentation before the state machine is built
 * on them; treat this as the intended shape, not a verified one.
 */
export type HookEvent = {
  readonly sessionId: string;
  readonly kind: string;
  readonly tool?: string;
};
