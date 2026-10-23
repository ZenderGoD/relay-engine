# Relay Engine

Relay Engine is a reusable multi-agent development pipeline built on T3 Code. An owner sets direction; a CTO coordinates three leads; leads own workers, reviews and acceptance. A backup handles confirmed CTO provider outages. Ops manages delivery while a separate OPs intake deduplicates errors.

This kit contains role instructions, a validated project config, a local setup generator, shared build slots and a static dashboard. It creates no external resources and has no runtime dependencies beyond Node, Bash and Git.

```text
Owner
  │ priorities, decisions, release approval
  CTO ◀──────▶ Backup CTO
  ├── Product lead ───── workers / reviewer / tester
  ├── Platform lead ──── workers / reviewer / tester
  └── Delivery lead (Ops) ── workers / reviewer / tester
          ▲        │ integration, watchdog, ship preparation
          │        ▼
       OPs intake ─── issue ledger and error triage
```

Lane names are configurable. The third lead need not be named delivery: exactly one lane is marked `ops`. OPs intake is a distinct standing role. `workerCap` limits all active delegated tasks per lead, including reviewers and testers; workers never spawn workers.

## Work flow

1. The CTO records the current decision and assigns a lane. The lead reserves files and gives one worker a self-contained brief at a committed base.
2. The worker reproduces, fixes and tests in its own T3-bound worktree and isolated data. Heavy jobs share build slots across worktrees.
3. The lead launches a second-model review, resolves findings, then starts independent acceptance at the reviewed commit. Each review round is a new delegated task with the prior findings included.
4. The lead reports reviewed READY or a concrete BLOCKED result. Ops prepares integration and release evidence; the CTO obtains exact owner approval before release. The kit grants no automatic merge, push or deployment permission.
5. OPs deduplicates incoming issues, routes them to the Ops lead and records confirmed lifecycle outcomes. Failed acceptance returns to the same lane; repeated bounces escalate.

Source inspection, automated tests, simulator proof, live provider checks, physical device checks and release delivery are separate evidence lanes. Missing checks stay UNTESTED. A tool acknowledgment is not a delivery receipt.

## Requirements

- T3 Code with its MCP orchestration tools: capability discovery, thread launch/read/send, delegated tasks and status, schedule creation/listing, and private secret entry when needed.
- A target Git repository with a committed base branch.
- Node 22 or newer, Bash, Git and a local macOS or Linux host for build slots. No dependency installation is needed for this kit.
- Codex and/or Claude configured in T3. Workers and reviewers use different models; a backup on another provider is preferable. The sample model identifiers are examples: resolve them against the live catalog and verify options.
- Project-specific build/test tools, error adapters and live-test hooks when enabled. T3 schedules require the app running and connected; this kit is not an always-on service.

## Quick start

Keep the kit checkout next to the target project. From the target repo:

```sh
cp ../relay-engine/relay.config.example.yaml relay.config.yaml
# Edit project, baseRef, lane scopes, commands, model selections and policies.
../relay-engine/bin/relay init --config relay.config.yaml
../relay-engine/bin/relay init --config relay.config.yaml --write
../relay-engine/bin/dashboard .relay
```

`relay init` prints a complete setup plan without executing commands. `--write` exclusively creates `.relay/` with prompts for CTO, backup, three leads and OPs, a setup plan, four schedule definitions, decisions, ownership, issue/takeover ledgers and `dashboard.html`. Rerunning `--write` fails rather than replacing state. The target repo's local Git exclusions hide `.relay/` and `relay.config.yaml`. Run from the project root and keep config/runtime state private. Review custom config paths before staging them.

Ask the project CTO to apply `.relay/setup.json` in T3 after review. The plan explains capability resolution, workspace binding, role routing and schedule receipts. The generator does not call T3. Standing roles use top-level conversations; implementation uses app-owned delegated worktrees. Retain launch receipts and inspect after uncertain results before retrying. Register schedules from the owning role conversation, compare existing timers, and verify cadence, binding and next run. Ship time includes an explicit project timezone: the current T3 wall-clock scheduler uses local time, so configure and verify the equivalent before enabling it.

Open `.relay/dashboard.html` locally. It shows ownership, decisions and planned schedules as an escaped, offline snapshot. Regenerate it after ledger changes; it makes no claims about live thread health or completed shipping.

## Configuration

The `.yaml` files use **JSON syntax, valid YAML 1.2**. This deliberate subset avoids a parser dependency; comments, anchors and ordinary indentation-style YAML are unsupported. Config commands are trusted project instructions displayed to agents, never executed by `init`. Unknown extra fields are not interpreted. Use `examples/swift-ios.yaml` or `examples/nextjs.yaml` as starting points; replace sample schemes, scripts and hooks with real project commands.

Config covers three lead lanes, build/test/typecheck, worker and build caps, per-role models/options, live-test hooks and blackouts, error source (`none`, `sentry`, `convex`, `custom`), release steps, four schedules and an optional notification environment reference. Enabled error sources require a project-provided, read-only, redacting `pollCommand`. Notifications require a project sender and explicit authorization; the kit sends none. Store environment variable names, never credential values, in config.

`liveTest.enabled` defaults false. Enabling it alone grants no clearance. The owner-active stub exits 2 (unknown); replace it before live tests. Exit 0 means active, 1 means idle, and errors/unknown block. The project must implement `beforeStepHook` and `restoreHook`, blackout enforcement, isolated accounts/data/ports and abort-on-owner-return behavior. Hooks are policy contracts for agents and the project harness; this kit does not implement an autonomous live-test runner. Never point them at the owner's app or conversations. Owner-app rebuilds need separate approval, an exclusive lock, an artifact backup, test-stamp rejection and verified restoration on failure.

## Shared build slots

```sh
export RELAY_TEST_DATA="$(mktemp -d)"
# Match buildSlots from your config. All worktrees must use the same shared limit.
export RELAY_BUILD_SLOTS=2
../relay-engine/bin/build-slot fix-example -- npm test
../relay-engine/bin/build-slot status
# After retaining required proof, remove only this task's temporary data.
```

Map `RELAY_TEST_DATA` into the application's real data setting and harness. Requiring the variable does not itself isolate project storage. Swift examples isolate build output but still require the project's fixture/data adapter. Build-slot requires a dedicated absolute directory for every command; use separate task directories and cache/output roots.

Slots live under Git's common directory, shared by its worktrees. `RELAY_SLOT_DIR` can choose another single shared directory on the same host. The persisted limit rejects inconsistent callers; Ops drains all jobs before changing it. Nested wrappers fail to avoid deadlock. Commands run in a separate process group; termination is forwarded, with escalation, before the slot is released. Exit codes propagate. Do not daemonize or detach descendants from the command's group.

Locks use atomic directories without extra utilities. A hard-killed wrapper or host crash leaves the lock held deliberately. `status` shows wrapper and process-group receipts; Ops verifies both have ended before removing that specific slot directory. Never auto-reclaim by age or wrapper PID alone. This favors safe capacity over automatic crash recovery; use an external lock service for multiple hosts.

## Lessons from running the pipeline

- **Crossed messages:** a decision can arrive after a newer reversal. The active CTO alone writes revisioned `decisions.md`; leads acknowledge it and stop on conflicts. Owner instructions remain authoritative.
- **Test-data isolation:** a separate binary can still share preferences, ports or synced conversations. Isolate all of them, restore touched settings and attest the actual process.
- **Build slots:** worker count does not limit expensive builds. One shared pool prevents concurrent worktrees from exhausting memory or disk.
- **Urgent decisions:** a queued message can sit behind a long lead turn. Interrupt the lead with the complete current brief when an urgent reversal must stop work, and verify acknowledgment.
- **Lead-owned reviews:** the lead owns independent second-model rounds and findings. Workers fix; they do not certify themselves or forward review coordination through the CTO.
- **Stalled-worker recovery:** inspect receipts, recent activity and commits first. Distinguish held work from provider failure, preserve ownership, and never duplicate an active worker.
- **Disk hygiene:** dedicated simulators, build directories and test data accumulate fast. Track task-owned resources; delete dedicated devices as well as shutting them down. Preserve shared resources and retained proof.

## Development

Run `npm test` (or `node --test`) in this kit. Tests cover config rejection, safe initialization, dashboard escaping, shared slot capacity, command failures and process termination. No test contacts a provider, creates a T3 resource or launches an owner application. MIT licensed; contributions start in CONTRIBUTING.md.
