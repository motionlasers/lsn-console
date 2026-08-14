import { describe, expect, it } from 'vitest';
import { getRouterRuntimeConfig } from '../src/lib/router';

describe('renderer routing by runtime protocol', () => {
  it('uses hash routing with no pathname base for packaged Electron file URLs', () => {
    expect(getRouterRuntimeConfig('file:', './')).toEqual({
      useHashLocation: true,
    });
  });

  it('retains pathname routing and the injected artifact base for web previews', () => {
    expect(getRouterRuntimeConfig('https:', '/lsn-console/')).toEqual({
      useHashLocation: false,
      base: '/lsn-console',
    });
  });

  it('uses root pathname routing for a root-mounted web artifact', () => {
    expect(getRouterRuntimeConfig('http:', '/')).toEqual({
      useHashLocation: false,
      base: undefined,
    });
  });
});