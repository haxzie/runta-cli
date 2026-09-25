import { describe, expect, it } from 'vitest';
import { CliError, fail, isCliError } from './errors.js';

describe('CliError', () => {
  it('defaults to exit code 1', () => {
    expect(new CliError('boom').exitCode).toBe(1);
  });

  it('carries an exit code, hint and cause', () => {
    const cause = new Error('underlying');
    const error = new CliError('boom', { exitCode: 3, hint: 'try this', cause });
    expect(error.exitCode).toBe(3);
    expect(error.hint).toBe('try this');
    expect(error.cause).toBe(cause);
  });

  it('is recognised by isCliError, unlike a plain Error', () => {
    expect(isCliError(new CliError('boom'))).toBe(true);
    expect(isCliError(new Error('boom'))).toBe(false);
    expect(isCliError('boom')).toBe(false);
  });
});

describe('fail', () => {
  it('throws a CliError', () => {
    expect(() => fail('nope', { exitCode: 2 })).toThrowError(CliError);
  });
});
