/**
 * Add-in API v0 (src/lib/addins.js) — board T05, PRD ADD-001.
 *   node --test test/addins.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  validateManifest, manifestHash, trustState, appliesTo, evalWhen, badge,
  mayCall, visibleActions, panelRows, runAction, listAddins,
} from '../src/lib/addins.js';
import { createMeeting } from '../src/lib/notes-schema.js';

const load = (id) => JSON.parse(readFileSync(new URL(`../src/addins/${id}/manifest.json`, import.meta.url), 'utf8'));
const FLAG = load('flag-decision');
const ACTIONS = load('actions');

const meeting = (over = {}) =>
  createMeeting({
    id: 'MOM-K3-W2', seriesId: 'komite-k3', seq: 2, title: 'Komite K3', date: '2026-09-02', locale: 'en',
    projectType: 'hse',
    items: [
      { ref: 'W2-001', type: 'decision', text: { en: 'Secure cranes' }, status: 'closed' },
      { ref: 'W2-002', type: 'action', text: { en: 'Issue checklist' }, status: 'open', owner: 'Lai' },
      { ref: 'W2-003', type: 'action', text: { en: 'Close audit' }, status: 'open' },
      { ref: 'W2-004', type: 'action', text: { en: 'Done thing' }, status: 'closed' },
    ],
    ...over,
  });

const base = () => ({ manifest: 0, id: 'demo', name: 'Demo', version: '1', appliesTo: 'always' });

test('the two shipped manifests are valid', () => {
  assert.equal(validateManifest(FLAG).ok, true);
  assert.equal(validateManifest(ACTIONS).ok, true);
});

test('validateManifest: bad and missing fields give a code, not a throw', () => {
  const cases = [
    [null, 'not-object'],
    [[], 'not-object'],
    [{ ...base(), manifest: 1 }, 'bad-version'],
    [{ ...base(), id: undefined }, 'bad-id'],
    [{ ...base(), id: 'Has Space' }, 'bad-id'],
    [{ ...base(), name: '' }, 'bad-name'],
    [{ ...base(), appliesTo: undefined }, 'bad-applies-to'],
    [{ ...base(), appliesTo: {} }, 'bad-applies-to'],
    [{ ...base(), appliesTo: { projectType: ['nope'] } }, 'bad-applies-to'],
    [{ ...base(), extra: 1 }, 'unknown-field'],
    [{ ...base(), actions: 'x' }, 'bad-actions'],
    [{ ...base(), actions: [{ id: 'a', label: 'A' }] }, 'bad-action'],
    [{ ...base(), actions: [{ id: 'a', label: 'A', do: { call: 'addItem', type: 'risk', text: 'x' } }] }, 'bad-action'],
    [{ ...base(), actions: [{ id: 'a', label: 'A', do: { call: 'addItem', type: 'info', text: '' } }] }, 'bad-action'],
    [{ ...base(), actions: [{ id: 'a', label: 'A', when: 'rm -rf', do: { call: 'addItem', type: 'info', text: 'x' } }] }, 'bad-expr'],
    [{ ...base(), actions: [{ id: 'a', label: 'A', badge: 'secrets', do: { call: 'addItem', type: 'info', text: 'x' } }] }, 'bad-expr'],
    [{ ...base(), panels: [{ id: 'p', title: 'P', source: 'fetch' }] }, 'bad-panel'],
    [{ ...base(), hooks: [{ on: 'line', do: { call: 'addItem', type: 'info', text: 'x' } }] }, 'bad-hook'],
  ];
  for (const [json, code] of cases) {
    const r = validateManifest(json);
    assert.equal(r.ok, false, JSON.stringify(json));
    assert.equal(r.code, code, JSON.stringify(json));
    assert.ok(r.error);
  }
});

test('unknown action and shell-like calls are refused', () => {
  for (const call of ['run', 'shell', 'fetch', 'eval', 'exec']) {
    const r = validateManifest({ ...base(), actions: [{ id: 'a', label: 'A', do: { call, cmd: 'sync.sh' } }] });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'unknown-call');
  }
  // a hook cannot smuggle a shell command either
  const h = validateManifest({ ...base(), hooks: [{ on: 'meeting.end', do: { call: 'run', file: 'sync.sh' } }] });
  assert.equal(h.code, 'unknown-call');
});

test('openUrl accepts https:// only', () => {
  const act = (url) => ({ ...base(), actions: [{ id: 'o', label: 'Open', do: { call: 'openUrl', url } }] });
  assert.equal(validateManifest(act('https://client.example/up')).ok, true);
  for (const bad of ['http://client.example', 'javascript:alert(1)', 'file:///c:/x', '//evil.example', 'https:evil', 'HTTPS://x.example/ y', '']) {
    const r = validateManifest(act(bad));
    assert.equal(r.ok, false, bad);
    assert.equal(r.code, 'not-https', bad);
  }
});

test('manifestHash is stable across key order and changes with content', () => {
  const a = { ...base(), actions: [{ id: 'a', label: 'A', do: { call: 'addItem', type: 'info', text: 'x' } }] };
  const b = JSON.parse(JSON.stringify(a));
  const reordered = { actions: [{ do: { text: 'x', type: 'info', call: 'addItem' }, label: 'A', id: 'a' }], appliesTo: 'always', version: '1', name: 'Demo', id: 'demo', manifest: 0 };
  assert.equal(manifestHash(a), manifestHash(b));
  assert.equal(manifestHash(a), manifestHash(reordered));
  assert.match(manifestHash(a), /^[0-9a-f]{16}$/);
  b.actions[0].do.text = 'y';
  assert.notEqual(manifestHash(a), manifestHash(b));
});

test('trustState: needs-trust, enabled, changed, broken, removed', () => {
  const h = manifestHash(FLAG);
  assert.equal(trustState(FLAG, {}), 'needs-trust');
  assert.equal(trustState(FLAG, { [FLAG.id]: h }), 'enabled');
  // trust recorded for another id never counts
  assert.equal(trustState(FLAG, { other: h }), 'needs-trust');
  // the file changed after the user trusted it: not enabled until re-trusted
  const edited = { ...FLAG, version: '2' };
  assert.equal(trustState(edited, { [FLAG.id]: h }), 'changed');
  assert.equal(trustState(edited, { [FLAG.id]: manifestHash(edited) }), 'enabled');
  // broken wins over a trust record, and never reaches enabled
  const broken = { ...base(), hooks: [{ on: 'line', do: { call: 'run' } }] };
  assert.equal(trustState(broken, { demo: manifestHash(broken) }), 'broken');
  assert.equal(trustState(null, {}), 'broken');
  // removed wins over everything valid
  assert.equal(trustState(FLAG, { [FLAG.id]: h }, [FLAG.id]), 'removed');
});

test('appliesTo scopes by projectType or seriesId', () => {
  const hse = meeting();
  const sales = meeting({ projectType: 'sales', seriesId: 'pipe' });
  assert.equal(appliesTo(FLAG, hse), true);
  assert.equal(appliesTo(FLAG, sales), false);
  assert.equal(appliesTo(FLAG, null), false);
  assert.equal(appliesTo(ACTIONS, sales), true); // always
  const bySeries = { ...base(), appliesTo: { seriesId: ['komite-k3'] } };
  assert.equal(appliesTo(bySeries, sales), false);
  assert.equal(appliesTo(bySeries, hse), true);
});

test('evalWhen and badge read counts from the meeting, no code', () => {
  const m = meeting();
  assert.equal(badge('openActions', m), 2);
  assert.equal(badge('decisions', m), 1);
  assert.equal(badge('items', m), 4);
  assert.equal(evalWhen('always', m), true);
  assert.equal(evalWhen(undefined, m), true);
  assert.equal(evalWhen('openActions > 0', m), true);
  assert.equal(evalWhen('openActions > 2', m), false);
  assert.equal(evalWhen('openActions >= 2', m), true);
  assert.equal(evalWhen('decisions == 1', m), true);
  assert.equal(evalWhen('risks < 1', m), true);
  // anything outside the fixed set is false, never evaluated
  assert.equal(evalWhen('process.exit()', m), false);
  assert.equal(evalWhen('constructor > 0', m), false);
  assert.equal(badge('constructor', m), 0);
});

test('mayCall lists exactly what the manifest asks, shell and network stay refused', () => {
  const rows = mayCall(FLAG);
  assert.ok(rows.some((r) => r.ok && /add item/i.test(r.label)));
  assert.ok(rows.some((r) => !r.ok && /shell/i.test(r.label)));
  assert.ok(rows.some((r) => !r.ok && /network/i.test(r.label)));
  const pan = mayCall(ACTIONS);
  assert.ok(pan.some((r) => r.ok && /open actions/i.test(r.label)));
  const url = mayCall({ ...base(), actions: [{ id: 'o', label: 'Open', do: { call: 'openUrl', url: 'https://client.example/up' } }] });
  assert.ok(url.some((r) => r.ok && /https:\/\/client\.example/.test(r.label)));
});

test('visibleActions shows a chip only for enabled, scoped add-ins', () => {
  const m = meeting();
  const sales = meeting({ projectType: 'sales', seriesId: 'pipe' });
  const enabled = [FLAG, ACTIONS];
  const chips = visibleActions(enabled, m);
  assert.deepEqual(chips.map((c) => [c.addinId, c.actionId, c.label]), [['flag-decision', 'flag', 'Flag decision']]);
  assert.equal(chips[0].badge, 1);
  assert.deepEqual(visibleActions(enabled, sales), []);
  assert.deepEqual(visibleActions([], m), []);
});

test('Flag decision end-to-end: the chip writes a decision through addItem', () => {
  const m = meeting();
  const before = m.items.length;
  const r = runAction(FLAG, 'flag', m, { lang: 'en' });
  assert.equal(r.kind, 'meeting');
  assert.equal(r.meeting.items.length, before + 1);
  const added = r.meeting.items.at(-1);
  assert.equal(added.type, 'decision');
  assert.ok(added.text.en.length > 3);
  assert.equal(m.items.length, before, 'input meeting is not mutated');
  assert.ok(r.log.includes(added.ref));
  // an issued meeting is frozen: the engine refuses, runAction passes the error up
  assert.throws(() => runAction(FLAG, 'flag', meeting({ issuedAt: '2026-09-03' }), { lang: 'en' }), /diterbitkan|issued/i);
  assert.throws(() => runAction(FLAG, 'nope', m, { lang: 'en' }), /action/i);
});

test('Actions panel end-to-end: open actions come from seriesSummary', () => {
  const w1 = meeting({ id: 'MOM-K3-W1', seq: 1, items: [{ ref: 'W1-001', type: 'action', text: { en: 'Old open' }, status: 'open', openedAt: '2026-08-26' }] });
  const w2 = meeting();
  const rows = panelRows(ACTIONS, 'actions', [w1, w2], { lang: 'en', now: new Date('2026-09-03T00:00:00Z') });
  assert.deepEqual(rows.map((r) => r.ref).sort(), ['W1-001', 'W2-002', 'W2-003']);
  assert.ok(rows.every((r) => r.text));
  assert.equal(rows[0].ref, 'W1-001', 'oldest first, as seriesSummary orders them');
});

test('listAddins: bundled raw manifests become entries with state, broken ones keep their error', () => {
  const bad = { manifest: 0, id: 'glossary-sync', name: 'Glossary sync', version: '1', appliesTo: 'always', hooks: [{ on: 'meeting.end', do: { call: 'run', file: 'sync.sh' } }] };
  const trusted = { [FLAG.id]: manifestHash(FLAG) };
  const out = listAddins([FLAG, ACTIONS, bad, { junk: true }], trusted, []);
  assert.deepEqual(out.map((e) => [e.id, e.state]), [
    ['flag-decision', 'enabled'], ['actions', 'needs-trust'], ['glossary-sync', 'broken'], ['unknown-3', 'broken'],
  ]);
  assert.match(out[2].error, /run/);
  assert.equal(out[0].manifest.name, 'Flag decision');
  assert.equal(out[2].manifest, null);
});
