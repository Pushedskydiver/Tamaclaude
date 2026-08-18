# Devil's-advocate review

For reviewing a PR. **Dispatch from a fresh context — never from the context
that wrote the code.** Writer and reviewer are separate roles on purpose; a
context that just wrote something cannot see what it assumed.

The `da-review` agent (`.claude/agents/da-review.md`) automates this. Its
findings come back in-chat, not as PR comments.

## Approval standard

Approve when you would be happy to own this code. Not "I can't see anything
wrong" — that's the absence of a finding, not the presence of confidence.

Report at **BLOCKING** / **MATERIAL** / **LOW**. Every finding cites
`file:line`, and you must read the file before citing it.

## Red flags

- **Architecture.** Does an import cross a boundary the graph forbids? If
  `boundaries` had to be edited, was that deliberate or was it to make an error
  go away?
- **`hooks` growing.** Any new dependency in `packages/hooks` is a finding
  until proven otherwise. It runs on every hook event.
- **Protocol changes without round-trip tests.** Encoder changes are silent
  corruption waiting to happen; the display just looks slightly wrong.
- **Mutation leaking out of `protocol`/`renderer`.** Those two have the
  functional rules disabled for framebuffer work. Mutation appearing in
  `daemon` or `packs` means the rule was fought, not followed.
- **Untrusted input reaching code unvalidated.** Pack manifests and hook
  payloads are attacker-controlled in the general case and hand-edited in
  practice.
- **Scope creep against `BUILD_PLAN.md`.** A deferred item quietly landing is
  a finding. So is a stage's exit criteria being weakened rather than met.
- **Claims about the rest of the repo.** New prose asserting what another
  package does — grep it before believing it.

## Required disciplines

- **Verify every `file:line` before citing it.** A fabricated citation is
  worse than a missed finding, because it costs trust in every other finding.
- **Don't dismiss with "another layer handles it."** Review layers are
  additive, not exclusive.
- **Mark speculation as speculation.** "This might race" is useful when
  labelled and corrosive when stated as fact.
- **Zero findings is a legitimate outcome.** Don't invent a nit to justify the
  round.
- **Report in-chat, not as PR comments.** Posting clutters the timeline.

## Rationalisations to catch

These are the reasons a finding gets dismissed when it shouldn't be:

| Rationalisation                                      | Why it's wrong                                                          |
| ---------------------------------------------------- | ----------------------------------------------------------------------- |
| "It's a gift project, it doesn't need to be perfect" | It needs to work on 23 September on someone else's machine, unattended. |
| "The deadline is tight, we'll fix it after"          | There is no after. It ships and it's gone.                              |
| "It's only test code"                                | Test code that lies is worse than no test.                              |
| "TypeScript catches that"                            | Not across a trust boundary it doesn't.                                 |
| "It's obvious from the code"                         | Then the comment costs one line and helps the next reader.              |
