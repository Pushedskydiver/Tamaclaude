/**
 * A Claude Code hook event, as forwarded by `@tamaclaude/hooks` to the daemon.
 *
 * Field names are ours, not Claude Code's: the wire carries `session_id`,
 * `hook_event_name` and `tool_name`, and `packages/hooks` translates once at
 * the boundary. Everything downstream then speaks one shape, and a change to
 * the upstream payload lands in one file.
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
   * `agent_id`, present only inside a subagent.
   *
   * Subagents are not a separate event stream — they carry these fields on the
   * ordinary events — so this is how the counter badge tells a subagent's
   * `SubagentStart` from the main agent's activity.
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
