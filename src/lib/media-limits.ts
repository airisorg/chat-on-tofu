// Binary attachment sizes use MiB. Base64 adds roughly one third to their
// transport size; leave room for three full files and JSON/message metadata.
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
export const MAX_ATTACHMENTS = 3;
export const MAX_ATTACHMENT_BASE64_LENGTH = 4 * Math.ceil(MAX_ATTACHMENT_BYTES / 3);
export const MAX_ACTION_BODY_BYTES = 22 * 1024 * 1024;
// Every hosted upload request remains below Vercel's 4.5 MB function limit.
export const UPLOAD_CHUNK_BYTES = 1024 * 1024;
export const MAX_UPLOAD_BODY_BYTES = 2 * 1024 * 1024;
export const MAX_STAGED_ATTACHMENT_BYTES = 20 * 1024 * 1024;
export const MAX_STAGED_ATTACHMENTS = 6;
export const UPLOAD_TTL_SECONDS = 15 * 60;

// History contains file metadata and protected references, never inline media.
export const MAX_HISTORY_PAYLOAD_BYTES = 3 * 1024 * 1024;
export const MAX_DEMO_STORAGE_LENGTH = MAX_ACTION_BODY_BYTES;
