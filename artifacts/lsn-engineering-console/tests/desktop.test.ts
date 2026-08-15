import { describe, expect, it } from 'vitest';
import { getDefaultRuntimeMode } from '../src/lib/desktop';

describe('desktop runtime defaults', () => {
  it('defaults only the packaged Windows app to Hardware Mode', () => {
    expect(
      getDefaultRuntimeMode({
        platform: 'win32',
        packaged: true,
        appVersion: '0.2.1',
      }),
    ).toBe('hardware');
    expect(
      getDefaultRuntimeMode({ platform: 'win32', packaged: false }),
    ).toBeNull();
    expect(
      getDefaultRuntimeMode({ platform: 'linux', packaged: true }),
    ).toBeNull();
  });
});