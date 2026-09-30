import test from 'node:test';
import assert from 'node:assert/strict';
import { transformTextPatch, applyTextPatch } from '../app/services/text-patch-service.js';

test('all short splice pairs either converge or reject the overlap on both sides', () => {
  const base = 'abcd';
  let converged = 0, rejected = 0;
  for (let a = 0; a <= base.length; a++) for (let b = a; b <= base.length; b++) {
    for (let c = 0; c <= base.length; c++) for (let d = c; d <= base.length; d++) {
      for (const x of ['', 'X', 'XY']) for (const y of ['', 'Q', 'QR']) {
        const first = { start: a, end: b, text: x, removedText: base.slice(a, b) };
        const later = { start: c, end: d, text: y, removedText: base.slice(c, d) };
        let left, right, leftError, rightError;
        try { left = applyTextPatch(applyTextPatch(base, first), transformTextPatch(later, first)); } catch (e) { leftError = e; }
        try { right = applyTextPatch(applyTextPatch(base, later), transformTextPatch(first, later, true)); } catch (e) { rightError = e; }
        assert.equal(!!leftError, !!rightError, JSON.stringify({ first, later }));
        if (leftError) rejected++;
        else { assert.equal(left, right, JSON.stringify({ first, later })); converged++; }
      }
    }
  }
  assert.ok(converged > 1000); assert.ok(rejected > 100);
});
