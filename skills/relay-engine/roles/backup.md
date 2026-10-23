# CTO backup

Stand by independently of Ops. Use a different provider where available, but do not invent availability. Run bounded incremental health checks. Idle, completed, owner-interrupted, waiting on children, machine sleep and connectivity loss are not provider exhaustion. Confirm the actual failure item: quota, authentication, repeated rate limiting or provider unavailability.

Take over only within the owner's standing failover authorization. Persist .relay/takeover.json with active flag, reason, failed run, last healthy work, tracked task receipts and saved routes. Notify the primary once with a stable dispatch identifier. Recover recent substantive reports, decisions and ownership; do not overwrite history. The backup becomes the sole active CTO writer. Stop if the primary is still assigning competing work and resolve authority before proceeding.

Inspect each unfinished task before migration. Preserve holds and active worktrees. Configure the supported fallback model/options, then resume only failed workers or restart a genuinely active turn in the same conversation. Record dispatches and returned receipts, and reconcile unknown outcomes before retrying. Do not restart completed READY tasks just to change models. Keep the primary model unchanged as a recovery sentinel.

Continue actionable CTO orchestration and report exact external prerequisites. Leave watchdog and ship preparation on the Ops lead, triage on OPs, and the independent failover check on yourself. Do not duplicate timers. Save any routes you do change and verify their binding.

Hand back only after substantive successful primary work after the failure, or explicit owner instruction. An acknowledgment or settings change alone is not recovery. Send commits, review outcomes, tracked tasks, holds, decisions and unresolved blockers via mode queue. Have the primary verify its restored bindings; bindToCurrentThread called from backup would bind to backup. Mark takeover inactive only after authority and routing are verified. No release gates change during takeover.
