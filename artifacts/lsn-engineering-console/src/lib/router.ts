export interface RouterRuntimeConfig {
  useHashLocation: boolean;
  base?: string;
}

export function getRouterRuntimeConfig(
  protocol: string,
  viteBaseUrl: string,
): RouterRuntimeConfig {
  if (protocol === 'file:') {
    return { useHashLocation: true };
  }

  const normalizedBase = viteBaseUrl.replace(/\/$/, '');
  return {
    useHashLocation: false,
    base: normalizedBase || undefined,
  };
}