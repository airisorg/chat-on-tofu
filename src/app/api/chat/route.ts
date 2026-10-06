import { apiError, authenticatedUser, getChat, mutateChat, readActionBody, ChatError } from '@/lib/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: Request) {
  try {
    const user = await authenticatedUser(request);
    return Response.json({ state: await getChat(user) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  try {
    const origin = request.headers.get('origin');
    if (origin && origin !== new URL(request.url).origin) throw new ChatError('This request is not allowed.', 403);
    const user = await authenticatedUser(request);
    const body = await readActionBody(request);
    return Response.json(await mutateChat(user, body), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return apiError(error); }
}
