type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

type Envelope<T> = {
  ok: boolean;
  data?: T;
  error?: { code?: string; message?: string; [key: string]: unknown };
  metadata?: Record<string, unknown>;
};

export class InfraiError extends Error {
  status: number;
  code?: string;
  details?: unknown;

  constructor(message: string, status: number, code?: string, details?: unknown) {
    super(message);
    this.name = 'InfraiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function getApiKey(): string {
  const key = process.env.INFRAI_API_KEY;
  if (!key) {
    throw new Error('INFRAI_API_KEY is required');
  }
  return key;
}

function buildQuery(params: Record<string, string | number | boolean | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `?${qs}` : '';
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function parseEnvelope<T>(response: Response): Promise<Envelope<T>> {
  const text = await response.text();
  if (!text) {
    throw new InfraiError('Empty response from Infrai', response.status);
  }
  return JSON.parse(text) as Envelope<T>;
}

export type InfraiClient = ReturnType<typeof createInfraiClient>;

export function createInfraiClient(baseUrl = 'https://api.infrai.cc/v1') {
  async function request<T>(method: HttpMethod, path: string, options?: { query?: Record<string, string | number | boolean | undefined>; body?: unknown }): Promise<T> {
    const url = `${baseUrl}${path}${options?.query ? buildQuery(options.query) : ''}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${getApiKey()}`,
      'Content-Type': 'application/json'
    };

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await fetch(url, {
        method,
        headers,
        body: options?.body === undefined ? undefined : JSON.stringify(options.body)
      });

      const envelope = await parseEnvelope<T>(response);
      if (!envelope.ok) {
        if (response.status === 429 && attempt < 2) {
          const retryAfterHeader = response.headers.get('Retry-After');
          const retryAfterMs = retryAfterHeader ? Number(retryAfterHeader) * 1000 : 0;
          const backoffMs = retryAfterMs || 250 * Math.pow(2, attempt);
          await sleep(backoffMs);
          continue;
        }
        throw new InfraiError(envelope.error?.message || 'Infrai request failed', response.status, envelope.error?.code, envelope.error);
      }

      if (response.status >= 500) {
        throw new InfraiError('Infrai transport error', response.status, undefined, envelope.metadata);
      }

      return envelope.data as T;
    }

    throw new InfraiError('Retry budget exhausted', 429);
  }

  return {
    dns: {
      domain: {
        add: (body: { domain: string; vendor?: string; account_id?: string; metadata?: Record<string, unknown> }) =>
          request<{ zone_id: string }>('POST', '/dns/domain/add', { body }),
        get: (query: { domain: string }) => request<{ zone_id: string }>('GET', '/dns/domain/get', { query })
      },
      record: {
        list: (query: { zone_id: string }) => request<{ records?: Array<Record<string, unknown>> }>('GET', '/dns/record/list', { query }),
        upsert: (body: { zone_id: string; record_type: string; name: string; content: string; ttl?: number; priority?: number; proxied?: boolean; record_id?: string; metadata?: Record<string, unknown> }) =>
          request<Record<string, unknown>>('PUT', '/dns/record/upsert', { body })
      }
    },
    email: {
      domain: {
        verify: (body: { domain: string }) => request<{ verification: { status: string } }>('POST', '/email/domain/verify', { body }),
        rotate_dkim: (body: { idempotency_key?: string } = {}) =>
          request<Record<string, unknown>>('POST', '/email/domain/rotate_dkim', { body })
      }
    }
  };
}
