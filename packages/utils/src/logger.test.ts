import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLogger } from './logger.js';

const captureStderr = () => vi.spyOn(console, 'error').mockImplementation(() => {});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createLogger', () => {
  it('suppresses messages below the current level', () => {
    const spy = captureStderr();
    const log = createLogger('warn');

    log.error('e');
    log.warn('w');
    log.info('i');
    log.debug('d');

    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('emits everything at debug level', () => {
    const spy = captureStderr();
    const log = createLogger('debug');

    log.error('e');
    log.warn('w');
    log.info('i');
    log.debug('d');

    expect(spy).toHaveBeenCalledTimes(4);
  });

  it('emits nothing at silent level', () => {
    const spy = captureStderr();
    const log = createLogger('silent');

    log.error('e');
    log.warn('w');

    expect(spy).not.toHaveBeenCalled();
  });

  it('honours setLevel after construction', () => {
    const spy = captureStderr();
    const log = createLogger('error');

    log.debug('hidden');
    log.setLevel('debug');
    log.debug('shown');

    expect(spy).toHaveBeenCalledTimes(1);
    expect(log.getLevel()).toBe('debug');
  });

  it('writes diagnostics to stderr so stdout stays pipeable', () => {
    const stdout = vi.spyOn(console, 'log').mockImplementation(() => {});
    const stderr = captureStderr();

    createLogger('info').info('hello');

    expect(stderr).toHaveBeenCalled();
    expect(stdout).not.toHaveBeenCalled();
  });

  // A terminal that colours stderr red rendered a successful login entirely in red, so the line
  // the user was waiting for looked like the failure. Success is a result, not commentary.
  it('writes success to stdout, not stderr', () => {
    const stdout = vi.spyOn(console, 'log').mockImplementation(() => {});
    const stderr = captureStderr();

    createLogger('info').success('Authorized.');

    expect(stdout).toHaveBeenCalledWith('Authorized.');
    expect(stderr).not.toHaveBeenCalled();
  });

  it('silences success along with everything else', () => {
    const stdout = vi.spyOn(console, 'log').mockImplementation(() => {});

    createLogger('silent').success('Authorized.');

    expect(stdout).not.toHaveBeenCalled();
  });
});
