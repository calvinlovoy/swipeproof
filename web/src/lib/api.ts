import type { Report, ReportBody } from '@shared/engine';
import type { Errors } from '@shared/validate';

export type ToolId = 'video' | 'hook' | 'script';
export interface Tool { id: ToolId; name: string; desc: string; cta: string }
export interface Plan { id: string; name: string; price: number; who: string; recommended: boolean; features: string[] }
export interface Platform { id: string; name: string; line: string; tips: { title: string; body: string }[] }
export interface Content {
  tools: Tool[];
  plans: Plan[];
  steps: { title: string; body: string }[];
  samples: { at: string; tag: string; prob: string; fix: string }[];
  faq: { q: string; a: string }[];
  platforms: Platform[];
}
export interface PostSummary { slug: string; title: string; category: string; publishedOn: string; minutes: number; tool: ToolId; excerpt: string }
export interface Post extends PostSummary { body: string[]; older: { slug: string; title: string } | null; newer: { slug: string; title: string } | null }
export interface PostPage { items: PostSummary[]; total: number; page: number; pages: number; pageSize: number; categories: string[] }
export interface Me { plan: string | null; affiliateCode: string | null; waitlist: string | null }
export interface User { id: string; email: string; name: string; createdAt: string }
export interface Capabilities { fullAnalysis: boolean; transcription: boolean; feedback: boolean; demo: boolean; maxUploadMb: number; maxSeconds: number; dailyLimit: number }
export interface Job { id: string; status: 'queued' | 'running' | 'done' | 'failed'; stage: string; fileName: string; reportId: string | null; error: string | null }

export class ApiError extends Error {
  constructor(public status: number, message: string, public errors: Errors = {}) { super(message); }
}

/** Random id for this browser. It owns reports made before signing in; an account claims them at sign-up or log-in. */
const clientId = (() => {
  const fresh = () => (crypto.randomUUID ? crypto.randomUUID() : `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);
  try {
    let id = localStorage.getItem('sp:cid');
    if (!id) { id = fresh(); localStorage.setItem('sp:cid', id); }
    return id;
  } catch { return fresh(); }
})();

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: { 'x-client-id': clientId, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'Could not reach the server. Check your connection and try again.');
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data?.message ?? 'Something went wrong. Try again.', data?.errors ?? {});
  return data as T;
}

/** Uploads a video for full analysis. Uses XMLHttpRequest because fetch cannot report upload progress. */
function uploadVideo(file: File, onProgress: (fraction: number) => void): Promise<Job> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/analyses');
    xhr.setRequestHeader('x-client-id', clientId);
    xhr.responseType = 'json';
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
    xhr.onload = () => {
      const data = xhr.response as (Job & { message?: string; errors?: Errors }) | null;
      if (xhr.status >= 200 && xhr.status < 300 && data) resolve(data);
      else reject(new ApiError(xhr.status, data?.message ?? 'The upload failed. Try again.', data?.errors ?? {}));
    };
    xhr.onerror = () => reject(new ApiError(0, 'Could not reach the server. Check your connection and try again.'));
    const form = new FormData();
    form.append('video', file);
    xhr.send(form);
  });
}

export const api = {
  auth: {
    me: () => req<{ user: User | null }>('GET', '/auth/me'),
    signup: (v: Record<string, string>) => req<{ user: User }>('POST', '/auth/signup', v),
    login: (v: Record<string, string>) => req<{ user: User }>('POST', '/auth/login', v),
    logout: () => req<void>('POST', '/auth/logout'),
    deleteAccount: (password: string) => req<void>('DELETE', '/auth/account', { password }),
  },
  capabilities: () => req<Capabilities>('GET', '/capabilities'),
  analyses: {
    start: uploadVideo,
    get: (id: string) => req<Job>('GET', `/analyses/${encodeURIComponent(id)}`),
  },
  content: () => req<Content>('GET', '/content'),
  posts: (p: { q: string; category: string; page: number }) =>
    req<PostPage>('GET', `/posts?${new URLSearchParams({ q: p.q, category: p.category, page: String(p.page) })}`),
  post: (slug: string) => req<Post>('GET', `/posts/${encodeURIComponent(slug)}`),
  reports: {
    list: () => req<Report[]>('GET', '/reports'),
    get: (id: string) => req<Report>('GET', `/reports/${encodeURIComponent(id)}`),
    remove: (id: string) => req<void>('DELETE', `/reports/${encodeURIComponent(id)}`),
    clear: () => req<void>('DELETE', '/reports'),
    hook: (text: string) => req<Report>('POST', '/reports/hook', { text }),
    script: (text: string) => req<Report>('POST', '/reports/script', { text }),
    videoLink: (url: string) => req<Report>('POST', '/reports/video-link', { url }),
    videoUpload: (body: ReportBody) => req<Report>('POST', '/reports/video-upload', body),
  },
  me: () => req<Me>('GET', '/me'),
  contact: (v: Record<string, string>) => req<{ topic: string }>('POST', '/contact', v),
  joinWaitlist: (v: Record<string, string>) => req<{ device: string }>('POST', '/waitlist', v),
  leaveWaitlist: () => req<void>('DELETE', '/waitlist'),
  joinAffiliates: (v: Record<string, string>) => req<{ code: string }>('POST', '/affiliates', v),
  leaveAffiliates: () => req<void>('DELETE', '/affiliates'),
  checkout: (v: Record<string, string>) => req<{ plan: string }>('POST', '/checkout', v),
};
