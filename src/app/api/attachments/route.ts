import { apiError, authenticatedUser, enforceRequestLimit, getAttachment, attachmentResponse } from '@/lib/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: Request) {
  try {
    const user = await authenticatedUser(request);
    await enforceRequestLimit(user, 'media');
    const query = new URL(request.url).searchParams;
    const { file, bytes } = await getAttachment(user, query.get('messageId'), query.get('index'));
    return attachmentResponse(file, bytes);
  } catch (error) { return apiError(error); }
}
