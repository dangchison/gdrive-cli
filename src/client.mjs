// Gộp credential + token + transport thành một hàm gọi API duy nhất.

import { createTokenSource } from './auth.mjs';
import { resolveCredentials, scopesForMode } from './credentials.mjs';
import { request } from './http.mjs';

/**
 * @param {object} [opts]
 * @param {object} [opts.credentials]  {clientEmail, privateKey} hoặc {accessToken} — bỏ qua thì tự dò
 * @param {'readonly'|'readwrite'} [opts.mode]
 * @param {number} [opts.retries]  số lần thử lại cho lỗi tạm thời (CLI dùng 2, thư viện dùng 0)
 * @param {boolean} [opts.allowAdc]  cho phép fallback ADC/gcloud khi dùng như thư viện
 */
export function createClient({
  credentials = null,
  mode = 'readwrite',
  retries = 0,
  allowAdc = false,
  env = process.env,
  home = undefined,
  fetchImpl = fetch,
  now = Date.now,
} = {}) {
  const resolved = resolveCredentials({ explicit: credentials, env, allowAdc, ...(home ? { home } : {}) });
  const scopes = scopesForMode(mode);
  const tokenSource = createTokenSource(resolved, { fetchImpl, now });

  async function api(opts) {
    const headers = { ...(opts.headers ?? {}) };
    // ADC của người dùng cần quota project, nếu không Google trả 403 SERVICE_DISABLED.
    if (tokenSource.quotaProjectId) headers['x-goog-user-project'] = tokenSource.quotaProjectId;

    const send = async () => {
      const token = await tokenSource.getToken(scopes);
      return request({ ...opts, token, headers, retries, fetchImpl });
    };

    try {
      return await send();
    } catch (err) {
      // Token bị thu hồi giữa chừng (xoay key, gcloud logout). Vứt cache, thử đúng 1 lần.
      if (Number(err?.code) === 401) {
        tokenSource.invalidate(scopes);
        return send();
      }
      throw err;
    }
  }

  return { api, tokenSource, scopes, mode, credentials: resolved };
}
