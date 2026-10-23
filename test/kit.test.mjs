import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { readConfig } from '../lib/config.mjs';
import { renderDashboard } from '../lib/dashboard.mjs';

const kit = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bin = name => path.join(kit, 'bin', name);
function repo(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
  git('init', '-b', 'main');
  git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '--allow-empty', '-m', 'Base');
  fs.copyFileSync(path.join(kit, 'relay.config.example.yaml'), path.join(dir, 'relay.config.yaml'));
  return dir;
}
const run = (dir, name, args = [], env = {}) => spawnSync(process.execPath, [bin(name), ...args], { cwd: dir, encoding: 'utf8', env: { ...process.env, ...env } });
const config = dir => JSON.parse(fs.readFileSync(path.join(dir, 'relay.config.yaml'), 'utf8'));
const save = (dir, c) => fs.writeFileSync(path.join(dir, 'relay.config.yaml'), JSON.stringify(c));
async function until(predicate) {
  for (let i = 0; i < 100; i++) { if (predicate()) return; await delay(50); }
  throw new Error('Timed out waiting for test process.');
}
function start(t, dir, slug, code, extra = {}) {
  const child = spawn(process.execPath, [bin('build-slot'), slug, '--', process.execPath, '-e', code], {
    cwd: dir, env: { ...process.env, RELAY_BUILD_SLOTS: '2', RELAY_TEST_DATA: path.join(dir, `data-${slug}`), ...extra }, stdio: ['ignore', 'pipe', 'pipe']
  });
  let stderr = '';
  child.stderr.on('data', b => { stderr += b; });
  const done = new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', (code, signal) => resolve({ code, signal, stderr })); });
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM'); });
  return { child, done };
}
const slotDir = dir => path.join(dir, '.git', 'relay-build-slots');
const held = dir => fs.readdirSync(slotDir(dir)).filter(n => n.startsWith('slot-'));

test('all example configurations validate', () => {
  for (const name of ['relay.config.example.yaml', 'examples/swift-ios.yaml', 'examples/nextjs.yaml']) assert.equal(readConfig(path.join(kit, name)).version, 1);
});

test('config rejects unsafe or unsupported setup policies', t => {
  const dir = repo(t), baseline = config(dir);
  const edits = [c => { c.workerCap = 0; }, c => { c.release.ownerApprovalRequired = false; }, c => { c.lanes.product.ops = true; }, c => { c.models.reviewer = c.models.worker; }, c => { c.errors.source = 'custom'; }, c => { c.notifications.webhookEnv = 'bad value'; }, c => { c.schedules.timezone = 'unknown'; }];
  for (const edit of edits) {
    const c = structuredClone(baseline); edit(c); save(dir, c);
    const result = run(dir, 'relay', ['init', '--write']);
    assert.notEqual(result.status, 0, result.stdout);
    assert.equal(fs.existsSync(path.join(dir, '.relay')), false);
  }
  fs.writeFileSync(path.join(dir, 'relay.config.yaml'), 'version: 1');
  assert.match(run(dir, 'relay', ['init']).stderr, /JSON syntax/);
});

test('dry run has complete role and structured schedule plans without side effects', t => {
  const dir = repo(t);
  const c = config(dir);
  c.commands.test = 'touch should-never-exist'; save(dir, c);
  const result = run(dir, 'relay', ['init']);
  assert.equal(result.status, 0, result.stderr);
  const plan = JSON.parse(result.stdout);
  assert.equal(plan.threads.length, 6);
  assert.equal(plan.schedules.length, 4);
  assert.equal(plan.schedules[0].schedule.type, 'interval');
  assert.equal(plan.schedules[3].schedule.type, 'fixed_time');
  assert.equal(plan.schedules[3].timezone, c.schedules.timezone);
  assert.match(plan.threads[2].message, /User experience/);
  assert.equal(fs.existsSync(path.join(dir, '.relay')), false);
  assert.equal(fs.existsSync(path.join(dir, 'should-never-exist')), false);
});

test('write creates private state, excludes it from Git and refuses overwrite', t => {
  const dir = repo(t);
  assert.equal(run(dir, 'relay', ['init', '--write']).status, 0);
  const state = path.join(dir, '.relay');
  assert.equal(fs.statSync(state).mode & 0o777, 0o700);
  assert.equal(fs.readdirSync(path.join(state, 'prompts')).length, 6);
  assert.equal(fs.readdirSync(path.join(state, 'roles')).length, 6);
  assert.ok(fs.existsSync(path.join(state, 'dashboard.html')));
  fs.appendFileSync(path.join(state, 'decisions.md'), 'Keep this decision.\n');
  assert.notEqual(run(dir, 'relay', ['init', '--write']).status, 0);
  assert.match(fs.readFileSync(path.join(state, 'decisions.md'), 'utf8'), /Keep this decision/);
  assert.equal(execFileSync('git', ['status', '--porcelain'], { cwd: dir, encoding: 'utf8' }), '');
  assert.equal(run(dir, 'dashboard', [state]).status, 0);
});

test('missing base and bad arguments fail before creating state', t => {
  const dir = repo(t), c = config(dir); c.baseRef = 'absent-base'; save(dir, c);
  assert.notEqual(run(dir, 'relay', ['init', '--write']).status, 0);
  assert.equal(fs.existsSync(path.join(dir, '.relay')), false);
  assert.notEqual(run(dir, 'relay', ['init', '--config']).status, 0);
  assert.equal(run(dir, 'relay', ['--help']).status, 0);
});

test('dashboard escapes untrusted ledger content and embeds no active scripts', t => {
  const dir = repo(t); run(dir, 'relay', ['init', '--write']);
  const state = path.join(dir, '.relay');
  fs.appendFileSync(path.join(state, 'ownership.md'), '| feature/demo | web | local | <img src=x onerror=alert(1)> | blocked | pending |\n');
  fs.appendFileSync(path.join(state, 'decisions.md'), '<script>alert(1)</script>');
  const html = renderDashboard(state);
  assert.ok(html.includes('&lt;img'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('<img'));
});

test('owner-active stub blocks live work as unknown', () => {
  const result = spawnSync('bash', [bin('owner-active')], { encoding: 'utf8' });
  assert.equal(result.status, 2); assert.match(result.stdout, /unknown/);
});

test('build slots require isolated data and reject nesting or limit mismatch', t => {
  const dir = repo(t);
  assert.notEqual(run(dir, 'build-slot', ['demo', '--', 'true'], { RELAY_TEST_DATA: '' }).status, 0);
  assert.notEqual(run(dir, 'build-slot', ['demo', '--', 'true'], { RELAY_SLOT_HELD: '1' }).status, 0);
  assert.notEqual(run(dir, 'build-slot', ['status'], { RELAY_BUILD_SLOTS: '3' }).status, 0);
});

test('build slots enforce shared capacity across Git worktrees', async t => {
  const dir = repo(t), worktree = path.join(dir, 'second-tree');
  execFileSync('git', ['worktree', 'add', '-b', 'second', worktree], { cwd: dir, stdio: 'ignore' });
  const events = path.join(dir, 'events');
  const code = `const fs=require('node:fs'); const f=${JSON.stringify(events)}; fs.appendFileSync(f,'start\\n'); setTimeout(()=>{fs.appendFileSync(f,'end\\n')},150);`;
  const jobs = Array.from({ length: 6 }, (_, i) => start(t, i % 2 ? worktree : dir, `job-${i}`, code));
  for (const result of await Promise.all(jobs.map(j => j.done))) assert.equal(result.code, 0, result.stderr);
  let active = 0, peak = 0;
  for (const line of fs.readFileSync(events, 'utf8').trim().split('\n')) { active += line === 'start' ? 1 : -1; peak = Math.max(peak, active); assert.ok(active >= 0 && active <= 2); }
  assert.equal(active, 0); assert.equal(peak, 2); assert.equal(held(dir).length, 0);
});

test('command failure and launch failure release slots and preserve exit codes', async t => {
  const dir = repo(t);
  assert.equal((await start(t, dir, 'fail', 'process.exit(7)').done).code, 7);
  assert.equal((await start(t, dir, 'killed', "process.kill(process.pid, 'SIGKILL')").done).code, 137);
  const result = run(dir, 'build-slot', ['missing', '--', 'no-such-relay-command'], { RELAY_TEST_DATA: path.join(dir, 'data') });
  assert.notEqual(result.status, 0); assert.equal(held(dir).length, 0);
});

test('termination stops the owned process group before releasing its slot', async t => {
  const dir = repo(t), marker = path.join(dir, 'ready');
  const code = `const fs=require('node:fs'); const {spawn}=require('node:child_process'); const sub=spawn(process.execPath,['-e','setInterval(()=>{},1000)']); sub.on('spawn',()=>fs.writeFileSync(${JSON.stringify(marker)},String(sub.pid))); process.on('SIGTERM',()=>{}); sub.on('exit',()=>process.exit(0)); setInterval(()=>{},1000);`;
  const job = start(t, dir, 'signal', code);
  await until(() => fs.existsSync(marker));
  const subPid = Number(fs.readFileSync(marker, 'utf8'));
  job.child.kill('SIGTERM');
  const result = await job.done;
  assert.equal(result.code, 143, result.stderr);
  assert.throws(() => process.kill(subPid, 0), /ESRCH/);
  assert.equal(held(dir).length, 0);
});

test('a hard-killed wrapper leaves its slot held for explicit recovery', async t => {
  const dir = repo(t), marker = path.join(dir, 'hard-ready');
  const job = start(t, dir, 'hard', `require('node:fs').writeFileSync(${JSON.stringify(marker)},String(process.pid)); setInterval(()=>{},1000);`);
  await until(() => fs.existsSync(marker));
  const group = Number(fs.readFileSync(marker, 'utf8'));
  t.after(() => { try { process.kill(-group, 'SIGKILL'); } catch {} });
  job.child.kill('SIGKILL'); await job.done;
  assert.equal(held(dir).length, 1);
  process.kill(-group, 'SIGTERM');
  const status = run(dir, 'build-slot', ['status']);
  assert.match(status.stdout, /hard/);
  assert.equal(held(dir).length, 1);
});

test('init from a nested directory resolves default config and writes at the Git root', t => {
  const dir = repo(t), nested = path.join(dir, 'src', 'nested');
  fs.mkdirSync(nested, { recursive: true });
  const result = run(nested, 'relay', ['init', '--write']);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(fs.existsSync(path.join(dir, '.relay', 'dashboard.html')));
  assert.equal(fs.existsSync(path.join(nested, '.relay')), false);
  assert.deepEqual(fs.readdirSync(dir).filter(n => n.startsWith('.relay-init-')), []);
  const rerun = run(nested, 'relay', ['init', '--write']);
  assert.match(rerun.stderr, /delete \.relay and retry/);
});

test('init preserves an existing empty state directory', t => {
  const dir = repo(t), state = path.join(dir, '.relay');
  fs.mkdirSync(state);
  const result = run(dir, 'relay', ['init', '--write']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /delete \.relay and retry/);
  assert.deepEqual(fs.readdirSync(state), []);
  fs.rmdirSync(state);
  fs.symlinkSync(path.join(dir, 'missing-state'), state);
  assert.match(run(dir, 'relay', ['init', '--write']).stderr, /delete \.relay and retry/);
});

test('generation failure leaves no partial state or temporary output', t => {
  const dir = repo(t), hook = path.join(dir, 'fail-write.mjs');
  fs.writeFileSync(hook, `import fs from 'node:fs';
const write = fs.writeFileSync;
fs.writeFileSync = function(file, ...args) {
  if (String(file).endsWith('/dashboard.html')) throw new Error('simulated disk failure');
  return write.call(this, file, ...args);
};`);
  const result = spawnSync(process.execPath, ['--import', hook, bin('relay'), 'init', '--write'], { cwd: dir, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /simulated disk failure/);
  assert.equal(fs.existsSync(path.join(dir, '.relay')), false);
  assert.deepEqual(fs.readdirSync(dir).filter(n => n.startsWith('.relay-init-')), []);
});

test('concurrent initializers publish one complete directory and preserve the winner', async t => {
  const dir = repo(t);
  const launch = () => new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [bin('relay'), 'init', '--write'], { cwd: dir, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = ''; p.stderr.on('data', chunk => { stderr += chunk; });
    p.once('error', reject); p.once('exit', code => resolve({ code, stderr }));
  });
  const results = await Promise.all([launch(), launch()]);
  assert.deepEqual(results.map(r => r.code).sort(), [0, 1]);
  assert.match(results.find(r => r.code === 1).stderr, /delete \.relay and retry/);
  assert.equal(fs.readdirSync(path.join(dir, '.relay', 'prompts')).length, 6);
  assert.ok(fs.existsSync(path.join(dir, '.relay', 'dashboard.html')));
  assert.deepEqual(fs.readdirSync(dir).filter(n => n.startsWith('.relay-init-')), []);
});

test('dashboard preserves escaped table pipes without shifting cells', t => {
  const dir = repo(t); run(dir, 'relay', ['init', '--write']);
  const state = path.join(dir, '.relay');
  fs.appendFileSync(path.join(state, 'ownership.md'), '| feature/demo | web | local | left \\| right and a&#124;b | blocked | proof \\| checked |\n');
  const html = renderDashboard(state);
  assert.ok(html.includes('<p>left &#124; right and a&#124;b</p>'));
  assert.ok(html.includes('web · blocked'));
  assert.ok(html.includes('proof &#124; checked'));
});

test('slot wait timeout prints one hint and never starts the command', t => {
  const dir = repo(t); run(dir, 'build-slot', ['status']);
  for (const n of [1, 2]) {
    const slot = path.join(slotDir(dir), `slot-${n}`); fs.mkdirSync(slot);
    fs.writeFileSync(path.join(slot, 'owner.json'), JSON.stringify({ pid: process.pid, group: process.pid }));
  }
  const command = ['waiting', '--', process.execPath, '-e', "require('node:fs').writeFileSync('should-not-run','ran')"];
  const env = { RELAY_TEST_DATA: path.join(dir, 'data'), RELAY_SLOT_TIMEOUT: '0.15' };
  for (const args of [command, ['--timeout', '0.15', ...command]]) {
    const result = run(dir, 'build-slot', args, env);
    assert.equal(result.status, 124, result.stderr);
    assert.equal(result.stderr.split('waiting for slot; run `build-slot status`').length - 1, 1);
    assert.equal(fs.existsSync(path.join(dir, 'should-not-run')), false);
    assert.equal(held(dir).length, 2);
  }
  const invalid = run(dir, 'build-slot', ['--timeout', '-1', ...command], env);
  assert.notEqual(invalid.status, 0); assert.match(invalid.stderr, /nonnegative/);
});

test('timeout flag overrides the environment and command arguments remain untouched', t => {
  const dir = repo(t);
  const result = run(dir, 'build-slot', ['--timeout', '1', 'args', '--', process.execPath, '-e', 'process.stdout.write(process.argv[1])', '--', '--timeout'], { RELAY_TEST_DATA: path.join(dir, 'data'), RELAY_SLOT_TIMEOUT: 'invalid' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '--timeout');
  assert.equal(result.stderr, '');
});

test('Ops release refuses live or uncertain ownership and removes only a dead slot', async t => {
  const dir = repo(t); run(dir, 'build-slot', ['status']);
  const dead = Number(execFileSync(process.execPath, ['-e', 'console.log(process.pid)'], { encoding: 'utf8' }).trim());
  const slot = path.join(slotDir(dir), 'slot-1'); fs.mkdirSync(slot);
  const owner = path.join(slot, 'owner.json');
  const live = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { detached: true, stdio: 'ignore' });
  await new Promise((resolve, reject) => { live.once('spawn', resolve); live.once('error', reject); });
  t.after(async () => {
    const done = new Promise(resolve => live.once('exit', resolve));
    process.kill(-live.pid, 'SIGTERM');
    await done;
  });
  for (const receipt of [{ pid: process.pid, group: dead }, { pid: dead, group: live.pid }, { pid: dead, group: null }]) {
    fs.writeFileSync(owner, JSON.stringify(receipt));
    assert.notEqual(run(dir, 'build-slot', ['release', '1']).status, 0);
    assert.ok(fs.existsSync(slot));
  }
  fs.writeFileSync(owner, 'invalid receipt');
  assert.match(run(dir, 'build-slot', ['release', '1']).stderr, /Unverifiable/);
  const untouched = path.join(slotDir(dir), 'slot-2'); fs.mkdirSync(untouched);
  fs.writeFileSync(owner, JSON.stringify({ pid: dead, group: dead }));
  const result = run(dir, 'build-slot', ['release', '1']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Released slot-1/);
  assert.equal(fs.existsSync(slot), false);
  assert.equal(fs.existsSync(untouched), true);
  assert.equal(fs.existsSync(path.join(slotDir(dir), 'release-1')), false);
  assert.notEqual(run(dir, 'build-slot', ['release', '../2']).status, 0);
});

test('minimal README config validates and logs is an accepted adapter', t => {
  const dir = repo(t);
  const readme = fs.readFileSync(path.join(kit, 'README.md'), 'utf8');
  const section = readme.split('## Minimal config')[1];
  const c = JSON.parse(section.match(/```json\n([\s\S]+?)\n```/)[1]);
  c.errors = { source: 'logs', pollCommand: './scripts/read-logs' };
  save(dir, c);
  assert.equal(readConfig(path.join(dir, 'relay.config.yaml')).errors.source, 'logs');
});
