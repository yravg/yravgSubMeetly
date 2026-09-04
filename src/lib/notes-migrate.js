/**
 * SERVICE — konversi v1 → v2. Mekanika murni, tanpa aturan domain.
 * Service layer: pure v1 -> v2 conversion mechanics. No domain policy here.
 */
import {
  NOTE_SCHEMA_VERSION,
  createMeeting,
  createMinuteItem,
} from './notes-schema.js';

/** Rapat v1 tidak punya provenance. Jangan mengarang timestamp. */
const NO_SOURCE = null;

/**
 * @param {object} v1  MeetingNote v1
 * @returns {import('./notes-schema.js').Meeting}
 */
export function migrateNoteV1(v1) {
  const locale = String(v1?.locale || 'id');
  const date = String(v1?.generatedAt || new Date().toISOString()).slice(0, 10);
  const seq = 1;
  const prefix = 'V1';
  const items = [];
  let n = 0;
  const ref = () => `${prefix}-${String(++n).padStart(3, '0')}`;

  if (v1?.summary) {
    items.push(
      createMinuteItem(
        {
          ref: ref(),
          type: 'info',
          topic: 'summary',
          text: { [locale]: String(v1.summary) },
          status: 'closed',
          review: 'ai',
          confidence: 0,
          src: NO_SOURCE,
        },
        { locale },
      ),
    );
  }

  for (const d of Array.isArray(v1?.decisions) ? v1.decisions : []) {
    if (!String(d || '').trim()) continue;
    items.push(
      createMinuteItem(
        {
          ref: ref(),
          type: 'decision',
          topic: 'general',
          text: { [locale]: String(d) },
          status: 'closed',
          review: 'ai',
          confidence: 0,
          src: NO_SOURCE,
        },
        { locale },
      ),
    );
  }

  for (const a of Array.isArray(v1?.actions) ? v1.actions : []) {
    if (!a || !String(a.text || '').trim()) continue;
    items.push(
      createMinuteItem(
        {
          ref: ref(),
          type: 'action',
          topic: 'general',
          text: { [locale]: String(a.text) },
          owner: a.owner ?? null,
          due: a.due ?? null,
          status: a.status === 'done' ? 'closed' : 'open',
          openedAt: date,
          review: 'ai',
          confidence: 0,
          src: NO_SOURCE,
        },
        { locale },
      ),
    );
  }

  const meeting = createMeeting({
    id: String(v1?.id || `MOM-${date}`),
    seriesId: 'imported-v1',
    seq,
    title: String(v1?.title || 'Imported meeting'),
    date,
    generatedAt: v1?.generatedAt,
    locale,
    items,
    topics: {
      summary: { en: 'Summary', id: 'Ringkasan' },
      general: { en: 'General', id: 'Umum' },
    },
  });
  meeting.legacyPreview = String(v1?.transcriptPreview || '');
  meeting.legacySource = String(v1?.source || '');
  return meeting;
}

/**
 * Naikkan envelope penyimpanan apa pun ke bentuk v2.
 * Idempoten: envelope v2 dikembalikan apa adanya.
 * @returns {{schemaVersion:number, updatedAt:string|null, meetings:object[], migrated:number}}
 */
export function migrateStore(raw) {
  if (!raw || typeof raw !== 'object') {
    return { schemaVersion: NOTE_SCHEMA_VERSION, updatedAt: null, meetings: [], migrated: 0 };
  }
  if (Number(raw.schemaVersion) >= NOTE_SCHEMA_VERSION && Array.isArray(raw.meetings)) {
    return {
      schemaVersion: NOTE_SCHEMA_VERSION,
      updatedAt: raw.updatedAt ?? null,
      meetings: raw.meetings,
      migrated: 0,
    };
  }
  const legacy = Array.isArray(raw.notes) ? raw.notes : [];
  const meetings = legacy.map((n) => migrateNoteV1(n));
  return {
    schemaVersion: NOTE_SCHEMA_VERSION,
    updatedAt: raw.updatedAt ?? null,
    meetings,
    migrated: meetings.length,
  };
}

export function needsMigration(raw) {
  return !!raw && Number(raw.schemaVersion || 1) < NOTE_SCHEMA_VERSION;
}
