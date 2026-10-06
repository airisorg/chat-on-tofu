import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { PGlite } from '@electric-sql/pglite';
import type { User } from '@supabase/supabase-js';
import { applySchema, getChat, mutateChat } from '../src/lib/server';
import { sqlAdapter } from '../tests/helpers/pglite-sql';
import type { Attachment } from '../src/lib/types';

async function main() {
  const pg = new PGlite();
  const sql = sqlAdapter(pg, callback => pg.transaction(tx => callback(tx)));
  const samples = new Map<string, number[]>();
  const measure = async <T,>(name: string, work: () => Promise<T>) => {
    const start = performance.now();
    const result = await work();
    samples.set(name, [...(samples.get(name) ?? []), performance.now() - start]);
    return result;
  };
  const profile = (id: string, email: string): User => ({ id, email, email_confirmed_at: '2026-10-05T00:00:00Z', aud: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-10-05T00:00:00Z' });
  const sender = profile('bench-sender', 'sender@example.com');
  const recipient = profile('bench-recipient', 'recipient@example.com');
  const image = Buffer.alloc(32 * 1024); Buffer.from([137,80,78,71,13,10,26,10]).copy(image);
  const voice = Buffer.alloc(64 * 1024); Buffer.from([0x1a,0x45,0xdf,0xa3]).copy(voice);
  const attachment = (name: string, type: string, bytes: Buffer): Attachment => ({ name, type, size: bytes.length, url: `data:${type};base64,${bytes.toString('base64')}` });
  try {
    await pg.waitReady;
    await measure('initial_schema_install', () => applySchema(sql));
    for (let i = 0; i < 24; i++) await measure('existing_schema_check', () => applySchema(sql));
    await getChat(sender, sql);
    const created = await mutateChat(sender, { type: 'create', name: 'Friends', kind: 'dm', emails: [recipient.email!] }, sql);
    const conversationId = created.id!;
    await getChat(recipient, sql);
    // Two warm-up exchanges avoid counting query compiler initialization.
    for (let i = 0; i < 2; i++) await mutateChat(sender, { type: 'send', conversationId, text: 'Warmup' }, sql);
    for (let i = 0; i < 24; i++) {
      await measure('send_text', () => mutateChat(sender, { type: 'send', conversationId, text: `Hello friend ${i}` }, sql));
      await measure('send_32KiB_image', () => mutateChat(sender, { type: 'send', conversationId, text: '', attachments: [attachment('picture.png','image/png',image)] }, sql));
      const note = await measure('send_64KiB_voice', () => mutateChat(sender, { type: 'send', conversationId, text: '', attachments: [attachment('voice.webm','audio/webm',voice)] }, sql));
      const received = await measure('recipient_load', () => getChat(recipient, sql));
      assert.equal(received.messages.some(message => message.id === note.id && message.attachments[0]?.size === voice.length), true);
      await measure('recipient_reaction', () => mutateChat(recipient, { type: 'react', messageId: note.id, emoji: '👍' }, sql));
    }
    const report = Object.fromEntries([...samples].map(([name, values]) => {
      const ordered = [...values].sort((a,b) => a-b);
      const percentile = (p: number) => Number(ordered[Math.max(0,Math.ceil(p * ordered.length)-1)].toFixed(2));
      return [name, { samples: values.length, median_ms: percentile(0.5), p95_ms: percentile(0.95) }];
    }));
    console.log(JSON.stringify({ scope: 'Local in-memory PostgreSQL server operations; excludes network, browser, Google OAuth, production TLS and polling delay.', media: 'Synthetic safe-signature 32 KiB image and 64 KiB voice payloads; fixture storage, not media decoder testing.', metrics: report }, null, 2));
  } finally { await pg.close(); }
}

void main().catch(error => { console.error(error instanceof Error ? error.message : 'Local benchmark failed.'); process.exitCode = 1; });
