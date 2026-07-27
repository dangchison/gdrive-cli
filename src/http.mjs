// Lớp transport: fetch + chuẩn hoá lỗi.
//
// HỢP ĐỒNG LỖI — load-bearing, đừng đổi:
// packflow/scripts/lib/sheets-retry.mjs phân loại lỗi tạm thời bằng
//   Number(error?.code ?? error?.response?.status)
// nên lỗi ném ra BẮT BUỘC có `.code` là SỐ và `.response.status`. Sai shape thì mọi lỗi
// bị coi là non-transient, packflow mất cơ chế retry mà test vẫn xanh.

export class GoogleApiError extends Error {
  constructor(status, body, { url, method } = {}) {
    const raw = body && typeof body === 'object' ? body.error : null;
    // Endpoint OAuth trả `{error: "invalid_grant", error_description: "..."}` (error là
    // CHUỖI), còn REST API trả `{error: {message, errors[]}}` (error là OBJECT).
    const isOauthShape = typeof raw === 'string';
    const apiError = isOauthShape ? null : raw;
    const message =
      (isOauthShape && (body.error_description || raw)) ||
      (apiError && (apiError.message || apiError.error_description)) ||
      (typeof body === 'string' && body.trim()) ||
      `HTTP ${status}`;
    super(message);
    this.name = 'GoogleApiError';
    this.code = status; // SỐ — sheets-retry.mjs đọc field này trước tiên
    this.status = status;
    this.response = { status, data: body };
    this.errors = (apiError && apiError.errors) || [];
    this.reason = this.errors[0]?.reason ?? apiError?.status ?? (isOauthShape ? raw : null);
    this.url = url;
    this.method = method;
  }
}

const TRANSIENT_STATUS = new Set([408, 429, 500, 502, 503, 504]);
const TRANSIENT_MESSAGE_RE =
  /ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|EPIPE|ENOTFOUND|socket hang up|network ?error|fetch failed/i;

export function isTransient(error) {
  if (TRANSIENT_STATUS.has(Number(error?.code ?? error?.response?.status ?? NaN))) return true;
  return TRANSIENT_MESSAGE_RE.test(String(error?.message ?? error ?? ''));
}

/** Bỏ key undefined/null rồi build query string. */
export function buildQuery(params = {}) {
  const usp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const item of value) usp.append(key, String(item));
    } else {
      usp.append(key, String(value));
    }
  }
  const qs = usp.toString();
  return qs ? `?${qs}` : '';
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Gọi một endpoint Google REST.
 *
 * `retries` mặc định 0: packflow tự bọc withSheetsRetry ở tầng trên, retry cả hai tầng sẽ
 * nhân số lần gọi. CLI thì truyền retries=2.
 *
 * @param {object} opts
 * @param {string} opts.url            URL đầy đủ (đã kèm query nếu có)
 * @param {string} [opts.method]
 * @param {string} [opts.token]        access token
 * @param {object|string|Uint8Array} [opts.body]
 * @param {Record<string,string>} [opts.headers]
 * @param {'json'|'buffer'|'text'} [opts.responseType]
 * @param {number} [opts.retries]
 * @param {typeof fetch} [opts.fetchImpl]
 */
export async function request({
  url,
  method = 'GET',
  token,
  body,
  headers = {},
  responseType = 'json',
  retries = 0,
  baseDelayMs = 500,
  fetchImpl = fetch,
  sleepImpl = sleep,
}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await once({ url, method, token, body, headers, responseType, fetchImpl });
    } catch (error) {
      lastError = error;
      if (attempt === retries || !isTransient(error)) throw error;
      await sleepImpl(baseDelayMs * 3 ** attempt);
    }
  }
  throw lastError;
}

async function once({ url, method, token, body, headers, responseType, fetchImpl }) {
  const finalHeaders = { ...headers };
  if (token) finalHeaders.authorization = `Bearer ${token}`;

  let payload = body;
  const isBinary = body instanceof Uint8Array || body instanceof ArrayBuffer;
  if (body !== undefined && body !== null && !isBinary && typeof body !== 'string') {
    payload = JSON.stringify(body);
    finalHeaders['content-type'] ??= 'application/json; charset=UTF-8';
  }

  const res = await fetchImpl(url, { method, headers: finalHeaders, body: payload });

  if (!res.ok) {
    // Lỗi của Google luôn là JSON, nhưng 5xx từ load balancer có thể là HTML.
    const text = await res.text().catch(() => '');
    let parsed = text;
    try {
      parsed = JSON.parse(text);
    } catch {
      /* giữ nguyên text */
    }
    throw new GoogleApiError(res.status, parsed, { url, method });
  }

  // 'raw' cho những chỗ cần header (upload resumable đọc Location).
  if (responseType === 'raw') return res;
  if (responseType === 'buffer') return Buffer.from(await res.arrayBuffer());
  if (responseType === 'text') return res.text();
  const text = await res.text();
  return text ? JSON.parse(text) : {};
}
