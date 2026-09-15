# Public delegation is always asynchronous

Approved requirement: remove the public `async` choice, rather than reject synchronous calls and ask the model to retry.

- The public subagent schema has no `async` argument. Public normalization supplies the internal `async: true` invariant for single-child, script, named-resource, RPC, slash, and scheduled calls.
- Workflow-internal sequencing still awaits child results inside the background coordinator; it does not hold the interactive parent tool call open.
- The public `bg_wait` tool accepts `id` and an optional subscription deadline. It always arms a nonblocking wake subscription. There is no public blocking mode or fallback.
- Native subagent completion already wakes the parent; use an explicit subscription only for work without native notifications.
- Parent input is not automatically forwarded to a child. The parent keeps run identities and decides whether to steer, stop, or continue.
- Long-lived RPC is required in a chat host to retain the parent and deliver later completion. This patch does not alter Gateway deployment/configuration.

## Validation

`pnpm run typecheck` and focused schema/public execution/slash/renderer/supervisor/wait tests pass.

Baseline bd03854 full unit suite: 39 failures and 23 cancelled. Changed suite has the same failure names; it is not reported as a green full suite. Repo integration suite cannot launch children using its Pi test shim because it lacks chord runtime peers, and timed out after 180 seconds.

For the real runtime test, use an installed Pi package, not the unit-test shim:

```sh
PI_SMOKE_HOST_PACKAGE=/absolute/path/to/@earendil-works/pi-coding-agent pnpm exec node test/manual/parent-responsive-smoke.mjs
```

This uses a deterministic local provider with no network, credentials, production sessions, or settings. It launches one actual child without an async argument, waits until the child enters a controlled gate, sends another prompt to the same parent while the child remains gated, verifies the parent responds before releasing the child, then verifies native completion reaches that parent. Artifacts are retained in the reported temporary directory.

Verified against the installed Pi release: `parentAnsweredBeforeChildReleased: true`, `nativeCompletionDelivered: true`.

No installed package was patched. No Gateway or Pi runtime was switched.
