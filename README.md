# Relay Engine

Relay Engine is a reusable multi-agent development pipeline built on T3 Code. An owner sets direction, a CTO coordinates three leads, and leads own workers, reviews and acceptance.

[T3 Code](https://github.com/pingdotgg/t3code) is a desktop workspace for running coding agents and coordinating their conversations, tools and Git worktrees.

The kit provides role instructions, validated config, a setup generator, shared build slots and an offline dashboard. It creates no external resources and needs no dependency installation.

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

Lane names are configurable; exactly one lead has `ops: true`. OPs intake is a separate standing role. `workerCap` counts all active delegated tasks per lead, including reviews and testers. Workers never spawn workers.

## Work flow

1. The CTO records a decision and assigns a lane. The lead reserves files and briefs one worker at a committed base.
2. The worker reproduces, fixes and tests in an isolated T3-bound worktree. Heavy jobs share build slots.
3. The lead launches second-model review, resolves findings, then starts independent acceptance at the reviewed commit. Each review round gets a new delegated task with prior findings included.
4. The lead reports READY or BLOCKED. Ops prepares integration and evidence; the CTO obtains exact owner release approval.
5. OPs deduplicates errors and routes fixes through the Ops lead. Acceptance failures return to the same lane; repeated failures escalate.

Source inspection, automated tests, simulator, live provider, physical device and release delivery are separate evidence lanes. Missing checks stay UNTESTED. A launch acknowledgment is not delivery proof.

## Requirements

- T3 Code with MCP capability discovery, thread launch/read/send, delegated tasks/status, schedule creation/listing and private secret entry when needed.
- A target Git repo with a committed base branch.
- Node 22 or newer and Git. Build slots support local macOS/Linux hosts. The optional owner-active stub uses Bash.
- Codex and/or Claude in T3. Worker and reviewer models must differ; a backup on another provider is preferable. Verify sample model identifiers and options against the live catalog.
- The project's build/test tools and any enabled adapters or hooks. Schedules need T3 running and connected.

## Quick start

Keep the kit beside the target project. From the target repo root:

```sh
cp ../relay-engine/relay.config.example.yaml relay.config.yaml
# Edit the config at the target Git root.
../relay-engine/bin/relay init
../relay-engine/bin/relay init --write
```

Adjust the kit path when running from a subdirectory. Default config is read from the Git root. An explicit `--config file` resolves relative to your current directory.

`relay init` prints the full plan without running commands. Its output includes entries like this (excerpt):

```json
{
  "project": "sample-project",
  "threads": [{
    "role": "cto",
    "workspaceStrategy": { "type": "root" },
    "promptFile": "prompts/cto.md"
  }],
  "schedules": [{
    "role": "lead-delivery",
    "title": "Relay watchdog",
    "schedule": { "type": "interval", "everyMs": 600000 }
  }]
}
```

`--write` creates `.relay/` at the Git root, regardless of your current directory. Output:

```text
Created .relay: setup.json, prompts, roles, schedules, decisions, ownership, ledgers and dashboard.
Private state excluded locally. No T3 resources created; no project commands executed.
```

Generation uses a private temporary sibling directory, then renames it atomically. Existing state is preserved with the message `delete .relay and retry`; back up decisions and receipts before doing that. Git locally excludes `.relay/`, temporary output and `relay.config.yaml`. Review custom config paths before staging.

Have the CTO review and apply `.relay/setup.json` in T3. It contains six standing-role prompts and four schedule plans. Resolve capabilities and workspace bindings, retain launch receipts and check existing timers before creating any. Verify each schedule's cadence, destination and next run.

Ship time uses a project timezone. T3's wall-clock scheduler uses local time: configure and verify the equivalent before enabling it. The generator never calls T3 or grants merge, push or deployment authority.

From the target root, run `../relay-engine/bin/dashboard .relay` and open `.relay/dashboard.html`. Regenerate after ledger changes. It shows local ownership, decisions and planned schedules, without inferring live health or completed shipping. Escape ownership table cell pipes as `\|` or `&#124;`.

## Minimal config

The `.yaml` files use **JSON syntax, valid YAML 1.2**, to avoid a parser dependency. Indentation-style YAML, comments and anchors are unsupported. This is a complete small config; replace model selections and commands for your project:

```json
{
  "version": 1,
  "project": "sample-project",
  "baseRef": "main",
  "lanes": {
    "product": { "scope": "Client" },
    "platform": { "scope": "Services" },
    "delivery": { "scope": "Delivery", "ops": true }
  },
  "commands": { "build": "npm run build", "test": "npm test", "typecheck": "npm run typecheck" },
  "workerCap": 4,
  "buildSlots": 2,
  "models": {
    "cto": { "provider": "codex", "model": "gpt-6.1-sol", "options": {} },
    "backup": { "provider": "codex", "model": "gpt-6.1-sol", "options": {} },
    "lead": { "provider": "codex", "model": "gpt-6.1-sol", "options": {} },
    "worker": { "provider": "codex", "model": "gpt-6.1-sol", "options": {} },
    "reviewer": { "provider": "codex", "model": "gpt-6-astra", "options": {} },
    "tester": { "provider": "codex", "model": "gpt-6.1-sol", "options": {} },
    "ops": { "provider": "codex", "model": "gpt-6.1-sol", "options": {} }
  },
  "liveTest": {
    "enabled": false, "blackouts": [], "ownerActiveHook": "bin/owner-active",
    "beforeStepHook": "./scripts/relay-live-check", "restoreHook": "./scripts/relay-live-restore"
  },
  "errors": { "source": "none", "pollCommand": "" },
  "release": { "ownerApprovalRequired": true, "steps": ["Prepare proof, obtain owner approval, then follow the project release procedure"] },
  "notifications": { "webhookEnv": "" },
  "schedules": { "watchdogMinutes": 10, "triageMinutes": 15, "failoverMinutes": 5, "shipTime": "09:00", "timezone": "Etc/UTC" }
}
```

`relay.config.example.yaml` includes fuller model options and release steps. `examples/swift-ios.yaml` and `examples/nextjs.yaml` supply project-specific starting points. Replace sample schemes, scripts and hooks.

Error sources are `none`, `sentry`, `logs` or `custom`. Enabled sources need a project-provided read-only, redacting `pollCommand`. Notifications need a project sender and explicit authorization. Store environment variable names, never credential values.

Config commands are trusted project instructions displayed to agents; `init` never runs them. Unknown extra fields are not interpreted.

## Live-test policy

Live testing defaults off. Enabling it does not grant clearance. Replace the owner-active stub first: exit 0 means active, 1 means idle, and 2/errors mean unknown and block testing. Include voice activity, not just keyboard/mouse input.

The project implements `beforeStepHook`, `restoreHook`, blackouts and abort-on-owner-return behavior. Isolate accounts, data, preferences and ports. Never test against the owner's app or conversations. These hooks are contracts for agents and the project harness; the kit has no autonomous live-test runner.

Owner-app rebuilds need separate approval, an exclusive lock, artifact backup, test-stamp rejection and verified restoration on failure.

## Shared build slots

```sh
export RELAY_TEST_DATA="$(mktemp -d)"
export RELAY_BUILD_SLOTS=2  # Match buildSlots across all worktrees.
../relay-engine/bin/build-slot --timeout 300 fix-example -- npm test
../relay-engine/bin/build-slot status
```

Map `RELAY_TEST_DATA` to the application's actual data setting. The variable alone does not isolate storage. Use dedicated task data, cache and output directories. Retain proof, then clean only your own resources.

`--timeout` sets slot-wait seconds and overrides `RELAY_SLOT_TIMEOUT`. The default, 0, waits indefinitely. A waiting job prints one hint; a timeout exits 124 without running the command. It does not limit an acquired command's runtime.

The exact default lock path is `$(git rev-parse --git-common-dir)/relay-build-slots/slot-<n>/owner.json`. In a normal checkout that is `.git/relay-build-slots/slot-<n>/owner.json`. Worktrees share the common directory. `RELAY_SLOT_DIR` overrides the pool directory on the same host.

The shared `limit` file rejects inconsistent caps; Ops drains all jobs before changing it. Nested wrappers fail. Commands run in an owned process group; signals propagate and descendants are stopped before release. Do not daemonize or detach descendants.

Hard kills leave locks held. Ops can release a slot after inspecting `status`:

```sh
../relay-engine/bin/build-slot release 1
```

Release refuses a live wrapper, a live process group or an incomplete receipt. It checks only that numbered slot and serializes concurrent release attempts. Unknown ownership needs manual Ops inspection at the exact path above; never reclaim by age alone. An interrupted release can leave `release-<n>/` beside the slot: verify no release command remains before removing that guard. Use an external lock service for multiple hosts.

## Lessons from running the pipeline

- **Crossed messages:** CTO-written, revisioned `decisions.md` overrides stale messages. Leads acknowledge revisions; owner instructions remain authoritative.
- **Test-data isolation:** a separate binary can still share preferences, ports or synced conversations. Isolate them and attest the actual process.
- **Build slots:** a shared pool prevents concurrent worktrees from exhausting memory and disk.
- **Urgent decisions:** interrupt a lead with the complete current brief when a queued reversal cannot wait; verify acknowledgment.
- **Lead-owned reviews:** leads coordinate second-model rounds. Workers fix findings rather than certify themselves.
- **Stalled workers:** inspect receipts, activity and commits before restarting. Preserve holds and ownership; never duplicate active work.
- **Disk hygiene:** track and delete task-owned simulators, caches and data. Preserve shared resources and proof.

## Development

Run `npm test` or `node --test`. Checks cover initialization, config, dashboard escaping, slot capacity and recovery. They do not contact providers or launch an owner app.

Distribution is by Git checkout; `private: true` prevents package publication. MIT licensed. See CONTRIBUTING.md.
