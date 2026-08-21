/**
 * A Claude Code hook event, as forwarded by `@tamaclaude/hooks` to the daemon.
 *
 * Field names are ours, not Claude Code's: the wire carries `session_id`,
 * `hook_event_name` and `tool_name`. The intent is that `packages/hooks`
 * translates once at the boundary, so everything downstream speaks one shape
 * and an upstream payload change lands in one file — **but that translation is
 * not written yet**. `packages/hooks` currently reads nothing from stdin and
 * emits a hardcoded placeholder. This is the target shape, not a live one.
 *
 * Verified against code.claude.com/docs/en/hooks.md rather than assumed —
 * `BUILD_PLAN.md` Stage 3 gated the state machine on exactly that, because a
 * hook that does not fire fails silently.
 */
export type HookEvent = {
  /** Claude Code's `session_id`. Stable across every event of one session. */
  readonly sessionId: string;
  /** Claude Code's `hook_event_name`, e.g. `PreToolUse`, `SubagentStart`. */
  readonly kind: string;
  /** `tool_name`, on the tool-scoped events. What the daemon maps to a state. */
  readonly tool?: string;
  /**
   * `agent_id`, present inside a subagent — **and also on a top-level run
   * started with `--agent`**, which is the trap.
   *
   * Subagents are not a separate event stream; they carry these fields on the
   * ordinary events. So presence alone cannot mean "this is a subagent": a
   * `--agent` session would be counted as one, and the badge would read one
   * too many for the whole session. Pair it with `SubagentStart` and
   * `SubagentStop` rather than treating the field as the discriminator.
   */
  readonly agentId?: string;
  /** `agent_type` — `Explore`, `Plan`, or a custom agent's name. */
  readonly agentType?: string;
  /**
   * `error_type` on `StopFailure`: `rate_limit`, `overloaded`,
   * `authentication_failed` and so on. More specific than the single failure
   * state the plan assumed, and worth keeping — a rate limit and an auth
   * failure deserve different quips.
   */
  readonly errorType?: string;
};
