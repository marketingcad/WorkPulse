'use client';
import { ApiError } from '@/lib/api';

/** POST to an export endpoint and save the returned file using the server's filename. */
export async function downloadExport(path: string, body: unknown, fallbackName: string): Promise<void> {
  const res = await fetch(`/api/v1${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    credentials: 'same-origin',
  });
  if (!res.ok) {
    let p: { title?: string; code?: string; request_id?: string } = {};
    try {
      p = await res.json();
    } catch {
      /* not json */
    }
    throw new ApiError(res.status, p.code ?? 'error', p.title ?? `Export failed (${res.status})`, p.request_id);
  }
  const cd = res.headers.get('Content-Disposition') ?? '';
  const m = /filename\*=UTF-8''([^;]+)|filename="?([^";]+)"?/i.exec(cd);
  const name = m ? decodeURIComponent(m[1] ?? m[2] ?? fallbackName) : fallbackName;
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
