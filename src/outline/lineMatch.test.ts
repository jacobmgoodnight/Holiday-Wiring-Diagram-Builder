import { describe, expect, it } from 'vitest';
import { matchLines, similarity } from './lineMatch';

describe('matchLines', () => {
  it('matches unchanged lines around an insertion', () => {
    expect(matchLines(['a', 'b', 'c'], ['a', 'x', 'b', 'c'])).toEqual([0, undefined, 1, 2]);
  });

  it('pairs a single in-place edit', () => {
    expect(matchLines(['a', 'Fan', 'c'], ['a', 'Totally different', 'c'])).toEqual([0, 1, 2]);
  });

  it('pairs edits by similarity when lines were also inserted', () => {
    expect(matchLines(['a', 'Orange spotlight', 'z'], ['a', 'New inflatable', 'Orange spotlight 60W', 'z'])).toEqual([0, undefined, 1, 2]);
  });

  it('ignores indentation and matches moved lines', () => {
    expect(matchLines(['a', '  b', 'c', 'd'], ['a', 'c', 'd', '    b'])).toEqual([0, 2, 3, 1]);
  });

  it('never matches blank lines', () => {
    expect(matchLines(['a', '', 'b'], ['a', '', 'b'])).toEqual([0, undefined, 2]);
  });

  it('scores similarity between 0 and 1', () => {
    expect(similarity('abc', 'abc')).toBe(1);
    expect(similarity('Fan', 'Box fan 40W')).toBeLessThan(0.5);
    expect(similarity('Orange spotlight', 'Orange spotlight 60W')).toBeGreaterThan(0.8);
  });
});
