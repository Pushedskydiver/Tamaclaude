/**
 * A Claude Code hook event, as forwarded by `@tamaclaude/hooks` to the daemon.
 *
 * `tool` is present only for tool-scoped events (`PreToolUse`); it is the
 * `tool_name` field Claude Code supplies, and it is what the daemon maps to an
 * animation.
 */
export type HookEvent = {
  readonly sessionId: string;
  readonly kind: string;
  readonly tool?: string;
};
