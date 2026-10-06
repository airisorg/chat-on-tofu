import { apiError, authenticatedUser, ChatError, readActionBody, stageUpload } from '@/lib/server';
import { MAX_UPLOAD_BODY_BYTES } from '@/lib/media-limits';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const origin = request.headers.get('origin');
    if (origin && origin !== new URL(request.url).origin) throw new ChatError('This request is not allowed.', 403);
    const user = await authenticatedUser(request);
    const input = await readActionBody(request, MAX_UPLOAD_BODY_BYTES);
    return Response.json(await stageUpload(user, input), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return apiError(error); }
}
