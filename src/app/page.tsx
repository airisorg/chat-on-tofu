import ChatApp from '@/components/ChatApp';
// Nonces must be generated with the document request, never baked into a shared page.
export const dynamic = 'force-dynamic';
export default function Page() { return <ChatApp />; }
