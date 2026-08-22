'use strict';

const authRoutes = [
  { pattern: /^\/api\/auth\/session$/, methods: new Set(['GET']) },
  { pattern: /^\/api\/auth\/login$/, methods: new Set(['POST']) },
  { pattern: /^\/api\/auth\/logout$/, methods: new Set(['POST']) },
  { pattern: /^\/api\/auth\/change-password$/, methods: new Set(['POST']) },
  { pattern: /^\/api\/admin\/users$/, methods: new Set(['GET', 'POST']) },
  { pattern: /^\/api\/admin\/users\/\d+$/, methods: new Set(['PUT', 'DELETE']) },
  { pattern: /^\/api\/activity\/events$/, methods: new Set(['POST']) },
  { pattern: /^\/api\/profiles$/, methods: new Set(['GET', 'POST']) },
  { pattern: /^\/api\/profiles\/\d+$/, methods: new Set(['GET']) },
  { pattern: /^\/api\/profiles\/\d+\/draft$/, methods: new Set(['GET', 'PUT']) },
  { pattern: /^\/api\/profiles\/\d+\/submit$/, methods: new Set(['POST']) },
  { pattern: /^\/api\/profiles\/\d+\/reviews$/, methods: new Set(['GET']) },
  { pattern: /^\/api\/profiles\/\d+\/versions$/, methods: new Set(['GET']) },
  { pattern: /^\/api\/profiles\/\d+\/publications$/, methods: new Set(['GET']) },
  { pattern: /^\/api\/profiles\/\d+\/audit$/, methods: new Set(['GET']) },
  { pattern: /^\/api\/profiles\/\d+\/rollback$/, methods: new Set(['POST']) },
  { pattern: /^\/api\/profiles\/\d+\/sandbox$/, methods: new Set(['GET', 'PUT', 'DELETE']) },
  { pattern: /^\/api\/profiles\/reviews\/\d+$/, methods: new Set(['GET']) },
  { pattern: /^\/api\/profiles\/reviews\/\d+\/comments$/, methods: new Set(['POST']) },
  { pattern: /^\/api\/profiles\/reviews\/\d+\/decision$/, methods: new Set(['POST']) },
  { pattern: /^\/api\/profiles\/versions\/\d+$/, methods: new Set(['GET']) },
  { pattern: /^\/api\/profiles\/versions\/\d+\/validations$/, methods: new Set(['GET']) },
  { pattern: /^\/api\/profiles\/versions\/\d+\/simulation$/, methods: new Set(['POST']) },
  { pattern: /^\/api\/profiles\/versions\/\d+\/publish$/, methods: new Set(['POST']) },
  { pattern: /^\/api\/profiles\/versions\/\d+\/verify-hardware$/, methods: new Set(['POST']) },
  { pattern: /^\/api\/profiles\/versions\/\d+\/promote$/, methods: new Set(['POST']) },
  { pattern: /^\/api\/profiles\/diff\?from=\d+&to=\d+$/, methods: new Set(['GET']) },
];

const readerValidators = {
  page: (value) => /^\d{1,10}$/.test(value),
  pageSize: (value) => /^\d{1,3}$/.test(value),
  actorId: (value) => /^\d{1,10}$/.test(value),
  category: (value) =>
    ['AUTH', 'SECURITY', 'USER_MANAGEMENT', 'PROFILE_GOVERNANCE', 'CLIENT_EVENT', 'DOWNLOAD'].includes(value),
  action: (value) => /^[A-Z_]{1,80}$/.test(value),
  outcome: (value) => ['SUCCESS', 'FAILURE', 'DENIED'].includes(value),
  targetType: (value) => /^[A-Za-z0-9_./:-]{1,80}$/.test(value),
  targetId: (value) => /^[A-Za-z0-9_./:-]{1,160}$/.test(value),
  from: (value) => value.length <= 40 && !Number.isNaN(Date.parse(value)),
  to: (value) => value.length <= 40 && !Number.isNaN(Date.parse(value)),
};

function isAllowedActivityReader(requestPath, method) {
  if (method !== 'GET' || typeof requestPath !== 'string') return false;
  let url;
  try {
    url = new URL(requestPath, 'https://desktop.invalid');
  } catch {
    return false;
  }
  if (
    url.origin !== 'https://desktop.invalid' ||
    url.pathname !== '/api/admin/activity' ||
    url.hash
  ) {
    return false;
  }
  const seen = new Set();
  for (const [key, value] of url.searchParams) {
    const validate = readerValidators[key];
    if (!validate || seen.has(key) || !validate(value)) return false;
    seen.add(key);
  }
  return true;
}

function isAllowedAuthRequest(requestPath, method) {
  if (isAllowedActivityReader(requestPath, method)) return true;
  return authRoutes.some(
    (route) => route.pattern.test(requestPath) && route.methods.has(method),
  );
}

module.exports = {
  isAllowedAuthRequest,
};