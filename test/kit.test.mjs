import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { readConfig } from '../lib/config.mjs';
import { renderDashboard } from '../bin/dashboard';

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
