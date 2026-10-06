import { publicConfig } from '@/lib/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export function GET() {
  return Response.json(publicConfig(), { headers: { 'Cache-Control': 'no-store' } });
}
