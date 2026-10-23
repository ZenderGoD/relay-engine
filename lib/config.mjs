import fs from 'node:fs';

// shortcut: JSON syntax is YAML 1.2; use a YAML parser only if broader syntax is needed.
export function readConfig(file) {
  let c;
  try { c = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { throw new Error('Config must use JSON syntax, a subset of YAML 1.2.'); }
  const check = (ok, message) => { if (!ok) throw new Error(message); };
  const text = v => typeof v === 'string' && v.trim().length > 0;
  check(c && c.version === 1, 'Expected config version 1.');
  check(text(c.project) && text(c.baseRef), 'project and baseRef are required.');
  check(c.lanes && Object.keys(c.lanes).length === 3, 'Configure exactly three lead lanes.');
  for (const [id, lane] of Object.entries(c.lanes)) {
    check(/^[a-z][a-z0-9-]*$/.test(id) && text(lane.scope), 'Each lane needs a safe identifier and scope.');
  }
  check(Object.values(c.lanes).filter(l => l.ops === true).length === 1, 'Exactly one lead lane must have ops: true.');
  for (const k of ['build', 'test', 'typecheck']) check(text(c.commands?.[k]), `commands.${k} is required.`);
  for (const k of ['workerCap', 'buildSlots']) check(Number.isInteger(c[k]) && c[k] > 0 && c[k] <= 32, `${k} must be an integer from 1 to 32.`);
  for (const role of ['cto', 'backup', 'lead', 'worker', 'reviewer', 'tester', 'ops']) {
    const m = c.models?.[role];
    check(text(m?.provider) && text(m?.model) && m.options && typeof m.options === 'object' && !Array.isArray(m.options), `models.${role} requires provider, model and options.`);
  }
  check(c.models.worker.provider !== c.models.reviewer.provider || c.models.worker.model !== c.models.reviewer.model, 'reviewer must use a second model.');
  check(typeof c.liveTest?.enabled === 'boolean' && text(c.liveTest.ownerActiveHook) && text(c.liveTest.beforeStepHook) && text(c.liveTest.restoreHook), 'liveTest requires enabled and all policy hooks.');
  check(Array.isArray(c.liveTest.blackouts) && c.liveTest.blackouts.every(text), 'liveTest.blackouts must be a list of policy windows.');
  check(['none', 'sentry', 'logs', 'custom'].includes(c.errors?.source), 'Unsupported error source.');
  check(typeof c.errors.pollCommand === 'string' && (c.errors.source === 'none' || text(c.errors.pollCommand)), 'An enabled error source needs a read-only pollCommand adapter.');
  check(Array.isArray(c.release?.steps) && c.release.steps.length > 0 && c.release.steps.every(text) && c.release.ownerApprovalRequired === true, 'release requires steps and ownerApprovalRequired: true.');
  check(typeof c.notifications?.webhookEnv === 'string' && (!c.notifications.webhookEnv || /^[A-Z][A-Z0-9_]*$/.test(c.notifications.webhookEnv)), 'notifications.webhookEnv must be empty or an environment variable name.');
  for (const k of ['watchdogMinutes', 'triageMinutes', 'failoverMinutes']) check(Number.isInteger(c.schedules?.[k]) && c.schedules[k] > 0, `schedules.${k} must be a positive integer.`);
  check(/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(c.schedules.shipTime) && text(c.schedules.timezone), 'shipTime must be HH:MM and timezone is required.');
  try { new Intl.DateTimeFormat('en', { timeZone: c.schedules.timezone }); }
  catch { throw new Error('Unknown schedules.timezone.'); }
  return c;
}
