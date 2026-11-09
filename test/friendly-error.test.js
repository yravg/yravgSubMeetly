// Raw pipeline errors must map to a stable, user-facing category.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyError } from '../src/lib/friendly-error.js';

test('capture restrictions map to captureBlocked with the manual picker as recovery', () => {
  const r = classifyError(new Error('Extension has not been invoked for the current page (activeTab)'));
  assert.equal(r.key, 'captureBlocked');
  assert.equal(r.action, 'pick');
});

test('native helper transport failures map to nativeOffline', () => {
  assert.equal(classifyError('native /transcribe 502: bad gateway').key, 'nativeOffline');
  assert.equal(classifyError(new TypeError('Failed to fetch')).key, 'nativeOffline');
});

test('file, model, and memory failures are distinguished', () => {
  assert.equal(classifyError('Files over 1.5 GB need ffmpeg installed on your Mac').key, 'fileTooLarge');
  assert.equal(classifyError('NotReadableError: The requested file could not be read').key, 'fileRead');
  assert.equal(classifyError('ASR model not loaded').key, 'modelLoad');
  assert.equal(classifyError('RangeError: WebAssembly.Memory(): could not allocate memory').key, 'outOfMemory');
});

test('cancellation is neutral and unknown errors fall back to generic with the raw detail', () => {
  assert.equal(classifyError('Cancelled').key, 'cancelled');
  const g = classifyError('something odd happened');
  assert.equal(g.key, 'generic');
  assert.equal(g.detail, 'something odd happened');
});

test('an engine without the model is modelMissing with Download, not nativeOffline', () => {
  const r = classifyError(new Error('model-not-downloaded openai/whisper-small'));
  assert.equal(r.key, 'modelMissing');
  assert.equal(r.action, 'download');
});
