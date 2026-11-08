/**
 * Add-in API extensions for Recap email, Glossary and Due dates to calendar (src/lib/addins.js).
 *   node --test test/addins-meeting-kit.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  validateManifest, trustState, manifestHash, mayCall, visibleActions, visiblePanels, runAction, actionMutates, hookActive,
} from '../src/lib/addins.js';
import { createMeeting } from '../src/lib/notes-schema.js';

const load = (id) => JSON.parse(readFileSync(new URL(`../src/addins/${id}/manifest.json`, import.meta.url), 'utf8'));
const RECAP = load('recap-email');
const GLOSS = load('glossary');
const ICS = load('due-to-calendar');
const base = () => ({ manifest: 0, id: 'demo', name: 'Demo', version: '1', appliesTo: 'always' });

const meeting = (over = {}) => createMeeting({
  id: 'MOM-K3-W2', seriesId: 'komite-k3', seq: 2, title: 'Komite K3', date: '2026-09-02', locale: 'en',
  attendees: [{ name: 'Lai', org: 'HSE', email: 'lai@example.com' }],
  items: [
    { ref: 'W2-001', type: 'decision', text: { en: 'Secure cranes' }, status: 'closed' },
    { ref: 'W2-002', type: 'action', text: { en: 'Issue checklist' }, status: 'open', owner: 'Lai', due: '2026-09-10' },
    { ref: 'W2-003', type: 'action', text: { en: 'Close audit' }, status: 'open' },
  ],
  ...over,
});

test('the three shipped manifests are valid, and a fresh one waits for trust', () => {
  for (const m of [RECAP, GLOSS, ICS]) {
    assert.equal(validateManifest(m).ok, true, m.id);
    assert.equal(trustState(m, {}), 'needs-trust');
    assert.equal(trustState(m, { [m.id]: manifestHash(m) }), 'enabled');
  }
});

test('the new calls take no arguments and are never smuggled in', () => {
  for (const call of ['recapEmail', 'exportIcs']) {
    assert.equal(validateManifest({ ...base(), actions: [{ id: 'a', label: 'A', do: { call } }] }).ok, true);
    const r = validateManifest({ ...base(), actions: [{ id: 'a', label: 'A', do: { call, to: 'x@y.com' } }] });
    assert.equal(r.code, 'bad-action');
  }
  // the glossary rewrite is a hook, not a button; hooks and call must pair up
  assert.equal(validateManifest({ ...base(), actions: [{ id: 'a', label: 'A', do: { call: 'applyGlossary' } }] }).code, 'bad-action');
  assert.equal(validateManifest({ ...base(), hooks: [{ on: 'caption.final', do: { call: 'exportIcs' } }] }).code, 'bad-hook');
  assert.equal(validateManifest({ ...base(), hooks: [{ on: 'meeting.end', do: { call: 'applyGlossary' } }] }).code, 'bad-hook');
  assert.equal(validateManifest({ ...base(), hooks: [{ on: 'caption.final', do: { call: 'applyGlossary' }, url: 'x' }] }).code, 'bad-hook');
  assert.equal(validateManifest({ ...base(), panels: [{ id: 'p', title: 'P', source: 'network' }] }).code, 'bad-panel');
});

test('mayCall states each new capability in words, and keeps shell and network refused', () => {
  const r = mayCall(RECAP);
  assert.ok(r.some((x) => x.ok && /mail/i.test(x.label) && /nothing is sent/i.test(x.label)));
  assert.ok(r.some((x) => !x.ok && /network/i.test(x.label)));
  assert.ok(mayCall(ICS).some((x) => x.ok && /\.ics/.test(x.label)));
  const g = mayCall(GLOSS);
  assert.ok(g.some((x) => x.ok && /glossary/i.test(x.label)));
  assert.ok(g.some((x) => x.ok && /rewrite/i.test(x.label)));
  assert.ok(!g.some((x) => /open actions/i.test(x.label)), 'a glossary panel does not read the register');
});

test('chips know whether they change the meeting; the glossary panel reports its source', () => {
  const m = meeting();
  const chips = visibleActions([RECAP, ICS], m);
  assert.deepEqual(chips.map((c) => [c.actionId, c.call, c.mutates, c.badge]), [['recap', 'recapEmail', false, 2], ['ics', 'exportIcs', false, 2]]);
  assert.deepEqual(visiblePanels([GLOSS], m).map((p) => [p.panelId, p.source]), [['terms', 'glossary']]);
  assert.equal(actionMutates(RECAP, 'recap'), false);
});

test('runAction recapEmail returns the recap and a mailto link, and does not touch the meeting', () => {
  const m = meeting();
  const before = JSON.stringify(m);
  const r = runAction(RECAP, 'recap', m, { lang: 'en' });
  assert.equal(r.kind, 'recap');
  assert.equal(r.recap.subject, 'Recap: Komite K3 (2026-09-02)');
  assert.deepEqual(r.recap.to, ['lai@example.com']);
  assert.match(r.recap.url, /^mailto:lai@example\.com\?subject=/);
  assert.equal(JSON.stringify(m), before);
  assert.match(r.log, /1 recipient$/);
});

test('runAction recapEmail on an issued meeting still works (reading is allowed after issue)', () => {
  const r = runAction(RECAP, 'recap', meeting({ issuedAt: '2026-09-03T00:00:00Z' }), {});
  assert.equal(r.kind, 'recap');
});

test('runAction exportIcs reads the whole series: a later meeting still exports an earlier open action', () => {
  const w1 = meeting({ id: 'MOM-K3-W1', seq: 1, date: '2026-08-26', items: [{ ref: 'W1-001', type: 'action', text: { en: 'Old one' }, status: 'open', owner: 'Dewi', due: '2026-09-03' }] });
  const w2 = meeting();
  const other = meeting({ id: 'MOM-X', seriesId: 'other', items: [{ ref: 'X-1', type: 'action', text: { en: 'Elsewhere' }, status: 'open', due: '2026-09-04' }] });
  const r = runAction(ICS, 'ics', w2, { meetings: [w1, w2, other], now: new Date('2026-09-02T00:00:00Z') });
  assert.equal(r.kind, 'ics');
  assert.equal(r.ics.count, 2);
  assert.equal(r.ics.skipped, 1);
  assert.equal(r.ics.filename, 'actions-komite-k3.ics');
  assert.match(r.ics.text, /UID:MOM-K3-W1-W1-001@submeetly/);
  assert.ok(!r.ics.text.includes('Elsewhere'));
});

test('runAction exportIcs with nothing dated gives no file, only the counts', () => {
  const r = runAction(ICS, 'ics', meeting({ items: [{ ref: 'A-1', type: 'action', text: { en: 'x' }, status: 'open' }] }), {});
  assert.equal(r.ics.text, null);
  assert.equal(r.ics.count, 0);
  assert.equal(r.ics.skipped, 1);
});

test('hookActive: needs an enabled add-in that hooks the event and an open meeting', () => {
  const m = meeting();
  assert.equal(hookActive([GLOSS], 'caption.final', m), true);
  assert.equal(hookActive([GLOSS], 'meeting.draft', m), true);
  assert.equal(hookActive([RECAP], 'caption.final', m), false);
  assert.equal(hookActive([GLOSS], 'caption.final', null), false);
  assert.equal(hookActive([], 'caption.final', m), false);
});
