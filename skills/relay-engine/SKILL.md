---
name: relay-engine
description: Run one scoped development assignment through reproduction, fix, tests, lead-owned second-model review, proof and reporting in T3 Code.
license: MIT
---

# Relay Engine worker loop

Read project rules, the active config, .relay/decisions.md, ownership.md and your role brief. Owner instructions win. Never infer fresh permission from an old message. Work on one assignment; workers do not launch workers. Your lead owns coordination and review.

1. **Attest and reproduce.** Record the checkout, branch, base and head. Confirm file ownership and current decision revision with the lead. Reproduce the user scenario with a small fixture or regression check. Distinguish a confirmed failure from a plausible explanation.
2. **Fix.** Change the smallest shared cause and its callers. Use the assigned isolated worktree. Do not edit another task's area without an explicit lead-to-lead agreement. Stage named paths only. Preserve unrelated changes.
3. **Test.** Run configured checks through build-slot with dedicated data, output and cache directories. The project harness must actually consume RELAY_TEST_DATA or map it to the application's isolation setting. The variable alone does not isolate an app. Keep fixtures, accounts, ports, preferences and conversations separate from owner data. Use synthetic data.
4. **Second-model review.** Send the lead the brief, exact head, diff and test results. The lead launches a reviewer on the configured second model, with a new delegated task and distinct request receipt for each round. Include prior findings, responses and unresolved objections. Fix accepted findings; explain rejected findings. Re-review changed code. Never claim review from your own inspection.
5. **Proof.** Exercise the original path at the reviewed head. For visible changes attach before/after captures and inspect recording frames. Attest the served process or installed artifact. Record source inspection, automated tests, simulator, live provider, physical device and release acceptance separately. Missing lanes are UNTESTED with the prerequisite. A successful tool launch is not delivery proof.
6. **Report.** Send your lead `READY <slug> <branch@commit>` or `BLOCKED <slug>: <prerequisite>` via t3_thread_send mode queue with a stable request identifier. Include root cause, changed files, test counts, reviewer disposition, proof locations, remaining risk and cleanup. Update your ownership row through your lead. Never call a pending review READY without qualification.

## Operating boundaries

- No merge, push, publish, version bump or deployment without the project's designated approval. Release approval belongs to the owner and must identify the exact target. A schedule is not approval.
- Do not print credentials, endpoints containing credentials, client payloads or private runtime identifiers in public reports. Request secrets through T3's private secret entry; store references or environment variable names in config.
- Live testing defaults off. Before each live step check blackouts, explicit clearance, owner-active and the project beforeStepHook. Hook exit 0 from owner-active means active; 1 alone means idle; 2 or any error means unknown and blocks. Voice use counts as activity. A device lock grants exclusivity, not permission.
- On stop, owner return or failed gate, abort owned test processes and run restoreHook. Back up touched settings before the session, restore them, verify the owner's environment, and report any failed restoration. Never send test messages into an owner's conversation.
- For an owner-app rebuild, require exact approval, an atomic exclusive app lock, verified idle window and blackout clearance. Back up the installed artifact, reject test-stamped artifacts, restore on failure, and release only your own lock. The kit deliberately provides no automatic owner-app rebuild.
- Own resources explicitly: process groups, worktrees, build output and dedicated simulators. Delete your own dedicated simulator and task caches when done; retain proof per project policy. Never delete shared devices, another worker's worktree or data. Ops inspects before reclaiming crash locks.
- Keep reads bounded and incremental. Persist task receipts and reconcile uncertain dispatches before retrying. A stalled worker is diagnosed before it is restarted; preserve its commits and holds.
