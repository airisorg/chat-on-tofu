import { MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS, UPLOAD_CHUNK_BYTES } from './media-limits';
import type { ChatAction } from './types';
import type { UploadChunk } from './server';

// Stable send IDs keep chunk reservations and final message retries consistent.
// File bytes remain only in the existing draft; no extra private browser storage.
export async function uploadAttachments(
  action: Extract<ChatAction, { type: 'send' }>,
  postChunk: (chunk: UploadChunk) => Promise<void>,
  signal: AbortSignal,
): Promise<Extract<ChatAction, { type: 'send' }>> {
  const files = action.attachments ?? [];
  if (!files.length) return action;
  if (!action.clientMessageId || files.length > MAX_ATTACHMENTS) throw new Error('This message is not ready to send.');
  const attachments = [];
  for (let attachmentIndex = 0; attachmentIndex < files.length; attachmentIndex++) {
    signal.throwIfAborted();
    const file = files[attachmentIndex], prefix = `data:${file.type};base64,`;
    if (!Number.isInteger(file.size) || file.size < 1 || file.size > MAX_ATTACHMENT_BYTES || !file.url.startsWith(prefix)) throw new Error('Use a file up to 5 MB.');
    const encoded = file.url.slice(prefix.length);
    if (encoded.length !== 4 * Math.ceil(file.size / 3) || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw new Error('This file is unavailable. Select it again.');
    const binary = atob(encoded);
    if (binary.length !== file.size) throw new Error('This file is unavailable. Select it again.');
    const totalChunks = Math.ceil(file.size / UPLOAD_CHUNK_BYTES);
    for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
      signal.throwIfAborted();
      await postChunk({ clientMessageId: action.clientMessageId, conversationId: action.conversationId, attachmentIndex,
        name: file.name, type: file.type, size: file.size, chunkIndex, totalChunks,
        data: btoa(binary.slice(chunkIndex * UPLOAD_CHUNK_BYTES, (chunkIndex + 1) * UPLOAD_CHUNK_BYTES)) });
    }
    attachments.push({ name: file.name, type: file.type, size: file.size, url: `upload:${action.clientMessageId}:${attachmentIndex}` });
  }
  signal.throwIfAborted();
  return { ...action, attachments };
}
