const path = require('node:path');

function isPathInside(parent, candidate) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
}

function createCiProfileSmokeFetch({
  env,
  isPackaged,
  platform,
  apiOrigin,
  nodeFetch,
}) {
  if (
    !isPackaged ||
    platform !== 'win32' ||
    env.CI !== 'true' ||
    env.GITHUB_ACTIONS !== 'true' ||
    env.LSN_WINDOWS_PROFILE_SMOKE !== '1' ||
    typeof env.NODE_EXTRA_CA_CERTS !== 'string' ||
    typeof env.RUNNER_TEMP !== 'string' ||
    !isPathInside(env.RUNNER_TEMP, env.NODE_EXTRA_CA_CERTS) ||
    typeof nodeFetch !== 'function'
  ) {
    return null;
  }

  const origin = new URL(apiOrigin);
  if (origin.protocol !== 'https:' || origin.hostname !== 'localhost') {
    return null;
  }

  return (url, options) => {
    const target = new URL(url);
    if (target.origin !== origin.origin) {
      throw new Error('CI profile-smoke fetch is restricted to the fixed localhost API origin');
    }
    return nodeFetch(target, options);
  };
}

module.exports = { createCiProfileSmokeFetch };