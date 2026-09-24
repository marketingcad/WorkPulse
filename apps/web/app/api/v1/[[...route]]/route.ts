import { getApi } from '@/lib/server/deps';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

async function handler(req: Request): Promise<Response> {
  const { app } = await getApi();
  return app.fetch(req);
}

export { handler as GET, handler as POST, handler as PUT, handler as PATCH, handler as DELETE, handler as OPTIONS };
