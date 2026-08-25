/**
 * A Claude Code hook event, as forwarded by `@tamaclaude/hooks` to the daemon.
 *
 * Field names are ours, not Claude Code's: the wire carries `session_id`,
 * `hook_event_name` and `tool_name`. The intent is that `packages/hooks`
 * translates once at the boundary, so everything downstream speaks one shape
 * and an upstream payload change lands in one file. That is now live:
 * `translate()` in `packages/hooks/src/index.ts` reads stdin and maps
 * `session_id`, `hook_event_name`, `tool_name`, `agent_id`, `agent_type` and
 * `error` onto the fields below. This block said the translation was unwritten
 * and the shape aspirational for as long as it has been neither.
 *
 * It then said `error_type` after that stopped being true, which is worse:
 * `errorType` below records that reading `error_type` was a real defect which
 * emptied every `StopFailure` silently, and this header went on naming the
 * wrong key while `errorType`'s own doc block, further down this file, spelt
 * out that the wire name is `error`. Not a stale
 * description of stale code — the header was accurate while `packages/hooks`
 * still read `error_type`, and went wrong the moment that was fixed on 24 Aug.
 * A file that corrects itself in one place and not the other is the shape a
 * reader trusts least.
 *
 * Verified against code.claude.com/docs/en/hooks.md rather than assumed —
 * `BUILD_PLAN.md` Stage 3 gated the state machine on exactly that, because a
 * hook that does not fire fails silently.
 */
export type HookEvent = {
  /** Claude Code's `session_id`. Stable across every event of one session. */
  readonly sessionId: string;
  /**
   * Claude Code's `hook_event_name`.
   *
   * A plain string, not the `HANDLED_HOOK_EVENTS` union: Claude Code sends
   * around thirty events and this system acts on eleven. Narrowing here would
   * make an unhandled event a type error at the boundary that receives it,
   * which is the wrong place to be strict — the hook's job is to forward
   * whatever arrives, and the daemon's is to ignore what it does not know.
   */
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
   * The error on `StopFailure`. Ten documented values, verified against
   * code.claude.com/docs/en/hooks.md rather than inferred from the three this
   * comment used to name followed by "and so on": `rate_limit`, `overloaded`,
   * `authentication_failed`, `oauth_org_not_allowed`, `billing_error`,
   * `invalid_request`, `model_not_found`, `server_error`, `max_output_tokens`,
   * `unknown`. It is a matcher field there, so a hook may register for one of
   * them; this package registers `*` and reads the value off the payload.
   *
   * More specific than the single failure state the plan assumed.
   *
   * **Read since 24 Aug.** `rate_limit` and `overloaded` draw their own screen
   * and can carry their own quip; the other eight keep `dizzy` and the `FAILED`
   * line. The reason for storing it — that it arrives exactly once and cannot
   * be recovered afterwards — is why the option was still open three weeks
   * later when something wanted it.
   *
   * **The wire name is `error`.** This field is ours; the translation lives in
   * `packages/hooks`, which read `error_type` until 24 Aug. `error_type`
   * appears nowhere in the hook documentation, so every real payload arrived
   * with nothing here — and no test noticed, because the fixtures were written
   * from the same assumption.
   */
  readonly errorType?: string;
};

/**
 * The hook events this system acts on.
 *
 * Canonical, and here rather than in either package that uses it, because
 * `hooks` and `daemon` cannot see each other — `eslint-plugin-boundaries`
 * forbids it, deliberately — and `protocol` is the only thing both import.
 *
 * They disagreed twice, and neither package could have noticed alone. The
 * daemon grew a `WAITING` state driven by `Notification`, which the installer
 * never registered, so a state, a timeout, a field and four tests described
 * behaviour production could not produce. And the installer registered
 * `SessionEnd` on the grounds that "the session is gone before the five-minute
 * sleep would notice", while the daemon had no entry for it — so it fell
 * through to the default and *refreshed* the session's proof of life,
 * postponing the sleep it was registered to trigger.
 *
 * Deriving both sides from this list makes the first kind impossible and the
 * second kind testable.
 */
export const HANDLED_HOOK_EVENTS = [
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'PermissionRequest',
  'StopFailure',
  'Stop',
  'Notification',
  'SubagentStart',
  'SubagentStop',
  'SessionEnd',
] as const;
