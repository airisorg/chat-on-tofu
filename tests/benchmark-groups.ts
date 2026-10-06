import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import type { User } from '@supabase/supabase-js';
import { applySchema, getChat, getChatResult, getAttachment, mutateChat, stageUpload } from '../src/lib/server';
import { sqlAdapter } from './helpers/pglite-sql';
import type { ChatAction } from '../src/lib/types';
import { UPLOAD_CHUNK_BYTES } from '../src/lib/media-limits';

const stage = process.argv[2] || 'baseline';
const directory = process.env.CHAT_EVIDENCE_DIR ? resolve(process.env.CHAT_EVIDENCE_DIR) : resolve('test-results/group-performance');
mkdirSync(directory,{recursive:true});
type Sample={ms:number,queries:number,bytes:number,events:number};
type Row={action:string,samples:number,medianMs:number,p95Ms:number,minMs:number,maxMs:number,medianQueries:number,medianResponseBytes:number,eventsPerAction:number[]};
const percentile=(values:number[],fraction:number)=>[...values].sort((a,b)=>a-b)[Math.max(0,Math.ceil(values.length*fraction)-1)];
const rounded=(value:number)=>Math.round(value*100)/100;
const report:{scope:string,stage:string,groups:unknown[],sources:string[]}={scope:'Disposable local PGlite PostgreSQL via actual server functions; excludes browser, auth verification, HTTP/TLS, hosting, production I/O and concurrent multi-connection load.',stage,groups:[],sources:['https://www.postgresql.org/docs/current/using-explain.html','https://www.postgresql.org/docs/current/indexes-multicolumn.html','https://www.postgresql.org/docs/current/indexes-partial.html']};

async function main(){
for(const people of [10,30]){
  const pg=new PGlite();
  let recording=false,queries=0;
  const captured=new Map<string,{query:string,parameters?:unknown[]}>();
  const observe=(engine:{query:typeof pg.query})=>({query:async(query:string,parameters?:unknown[])=>{
    if(recording)queries++;
    if(/with (recent|selected) as/.test(query))captured.set('history',{query,parameters});
    if(/select c\.\*,p\.pinned/.test(query))captured.set('conversations',{query,parameters});
    return engine.query(query,parameters);
  }});
  const sql=sqlAdapter(observe(pg),callback=>pg.transaction(tx=>callback(observe(tx))));
  const users:User[]=Array.from({length:people},(_,index)=>({id:crypto.randomUUID(),email:`member-${index}@group-benchmark.invalid`,email_confirmed_at:new Date().toISOString(),aud:'authenticated',app_metadata:{},user_metadata:{full_name:`Member ${index}`},created_at:new Date().toISOString()}));
  const owner=users[0],last=users.at(-1)!;
  const receipt=(action:Exclude<ChatAction,{type:'send'}>)=>({...action,clientActionId:crypto.randomUUID(),clientActionCreatedAt:new Date().toISOString()});
  const rows:Row[]=[];
  let groupId='',messageId='';
  const measure=async(action:string,work:(index:number)=>Promise<unknown>,count=20,before?:()=>Promise<void>,after?:(result:unknown)=>Promise<void>)=>{
    const samples:Sample[]=[];
    for(let index=-1;index<count;index++){
      if(before)await before();
      const eventsBefore=(await pg.query<{count:number}>('select count(*)::int as count from relay.events')).rows[0].count;
      queries=0;recording=true;const start=performance.now();
      const result=await work(index);const ms=performance.now()-start;recording=false;
      const eventsAfter=(await pg.query<{count:number}>('select count(*)::int as count from relay.events')).rows[0].count;
      const bytes=result&&typeof result==='object'&&'bytes' in result ? Number((result as {bytes:Buffer}).bytes.length):Buffer.byteLength(JSON.stringify(result));
      if(index>=0)samples.push({ms,queries,bytes,events:eventsAfter-eventsBefore});
      if(after)await after(result);
    }
    rows.push({action,samples:count,medianMs:rounded(percentile(samples.map(s=>s.ms),.5)),p95Ms:rounded(percentile(samples.map(s=>s.ms),.95)),minMs:rounded(Math.min(...samples.map(s=>s.ms))),maxMs:rounded(Math.max(...samples.map(s=>s.ms))),medianQueries:percentile(samples.map(s=>s.queries),.5),medianResponseBytes:percentile(samples.map(s=>s.bytes),.5),eventsPerAction:[...new Set(samples.map(s=>s.events))]});
  };
  try{
    await applySchema(sql);for(const user of users)await getChat(user,sql);
    groupId=(await mutateChat(owner,receipt({type:'create',name:`Group ${people}`,kind:'group',emails:users.slice(1).map(user=>user.email!)}),sql)).id!;
    assert.equal((await getChat(owner,sql)).conversations[0].members.length,people);
    messageId=(await mutateChat(owner,{type:'send',conversationId:groupId,text:'Benchmark parent'},sql)).id!;
    await pg.query("insert into relay.messages(id,conversation_id,author_id,text,created_at) select gen_random_uuid(),$1,$2,'Seeded history '||number,now()-number*interval '1 second' from generate_series(1,1999) number",[groupId,owner.id]);
    await pg.exec('ANALYZE relay.messages; ANALYZE relay.participants; ANALYZE relay.profiles;');
    await measure('get history2000',()=>getChat(owner,sql));
    await measure('send text',index=>mutateChat(owner,{type:'send',conversationId:groupId,text:`Text ${index}`,clientMessageId:crypto.randomUUID()},sql));
    await measure('send thread reply',index=>mutateChat(owner,{type:'send',conversationId:groupId,text:`Reply ${index}`,parentId:messageId,clientMessageId:crypto.randomUUID()},sql));
    await measure('react desired state',index=>mutateChat(owner,receipt({type:'react',messageId,emoji:'👍',active:index%2===0}),sql));
    await measure('star desired state',index=>mutateChat(owner,receipt({type:'star',messageId,starred:index%2===0}),sql));
    await measure('mark read',()=>mutateChat(owner,receipt({type:'read',conversationId:groupId,unread:false}),sql));
    await measure('mark unread',()=>mutateChat(owner,receipt({type:'read',conversationId:groupId,unread:true}),sql));
    await measure('pin',index=>mutateChat(owner,receipt({type:'conversation',conversationId:groupId,pinned:index%2===0}),sql));
    await measure('mute',index=>mutateChat(owner,receipt({type:'conversation',conversationId:groupId,muted:index%2===0}),sql));
    await measure('section',index=>mutateChat(owner,receipt({type:'conversation',conversationId:groupId,section:`Section ${index}`}),sql));
    await measure('rename',index=>mutateChat(owner,receipt({type:'conversation',conversationId:groupId,name:`Name ${index}`}),sql));
    await measure('description',index=>mutateChat(owner,receipt({type:'conversation',conversationId:groupId,description:`Description ${index}`}),sql));
    await measure('profile name',index=>mutateChat(owner,receipt({type:'profile',name:`Owner ${index}`}),sql));
    await measure('profile status',index=>mutateChat(owner,receipt({type:'profile',status:`Status ${index}`}),sql));
    await measure('edit',index=>mutateChat(owner,receipt({type:'edit',messageId,text:`Edited ${index}`}),sql));
    let deletedId='';
    await measure('delete',()=>mutateChat(owner,receipt({type:'delete',messageId:deletedId}),sql),20,async()=>{deletedId=(await mutateChat(owner,{type:'send',conversationId:groupId,text:'Disposable delete'},sql)).id!;});
    await measure('create group',index=>mutateChat(owner,receipt({type:'create',name:`Created ${index}`,kind:'group',emails:users.slice(1).map(user=>user.email!)}),sql),20,undefined,async result=>{await pg.query('delete from relay.conversations where id=$1',[(result as {id:string}).id]);});
    await measure('leave',()=>mutateChat(last,receipt({type:'leave',conversationId:groupId}),sql),20,async()=>{await mutateChat(owner,receipt({type:'invite',conversationId:groupId,emails:[last.email!]}),sql);});
    await measure('invite one member',()=>mutateChat(owner,receipt({type:'invite',conversationId:groupId,emails:[last.email!]}),sql),20,async()=>{const present=(await getChat(last,sql)).conversations.some(c=>c.id===groupId);if(present)await mutateChat(last,receipt({type:'leave',conversationId:groupId}),sql);});
    const replay=receipt({type:'conversation',conversationId:groupId,pinned:true});await mutateChat(owner,replay,sql);
    await measure('operation replay',()=>mutateChat(owner,replay,sql));
    await measure('receipt confirmation',()=>getChatResult(owner,replay.clientActionId,sql));
    const sent={type:'send' as const,conversationId:groupId,text:'Retry message',clientMessageId:crypto.randomUUID()};await mutateChat(owner,sent,sql);
    await measure('message replay',()=>mutateChat(owner,sent,sql));
    let mediaId='';
    for(const size of [1024*1024,5*1024*1024]){
      const bytes=Buffer.alloc(size,7);Buffer.from([137,80,78,71,13,10,26,10]).copy(bytes);
      await measure(`image ${size/1024/1024}MiB chunk+send`,async()=>{
        mediaId=crypto.randomUUID();const totalChunks=Math.ceil(size/UPLOAD_CHUNK_BYTES);
        for(let chunkIndex=0;chunkIndex<totalChunks;chunkIndex++)await stageUpload(owner,{clientMessageId:mediaId,conversationId:groupId,attachmentIndex:0,name:'benchmark.png',type:'image/png',size,chunkIndex,totalChunks,data:bytes.subarray(chunkIndex*UPLOAD_CHUNK_BYTES,(chunkIndex+1)*UPLOAD_CHUNK_BYTES).toString('base64')},sql);
        return mutateChat(owner,{type:'send',conversationId:groupId,text:'Image',clientMessageId:mediaId,attachments:[{name:'benchmark.png',type:'image/png',size,url:`upload:${mediaId}:0`}]},sql);
      },8,undefined,async()=>{await pg.query('delete from relay.messages where id=$1',[mediaId]);});
      mediaId=crypto.randomUUID();
      await mutateChat(owner,{type:'send',conversationId:groupId,text:'Download fixture',clientMessageId:mediaId,attachments:[{name:'benchmark.png',type:'image/png',size,url:`data:image/png;base64,${bytes.toString('base64')}`}]},sql);
      await measure(`get history with ${size/1024/1024}MiB image`,()=>getChat(owner,sql));
      await measure(`protected download ${size/1024/1024}MiB`,()=>getAttachment(last,mediaId,0,sql),8);
      await pg.query('delete from relay.messages where id=$1',[mediaId]);
    }
    const foreign={...owner,id:crypto.randomUUID(),email:'foreign@group-benchmark.invalid'};await getChat(foreign,sql);
    const foreignId=(await mutateChat(foreign,{type:'create',name:'Foreign',kind:'space',emails:[]},sql)).id!;
    await pg.query("insert into relay.messages(id,conversation_id,author_id,text) select gen_random_uuid(),$1,$2,'Foreign history'||number from generate_series(1,50000) number",[foreignId,foreign.id]);
    await pg.exec('ANALYZE relay.messages; ANALYZE relay.participants;');
    await measure('get own history beside50000foreign rows',()=>getChat(owner,sql));
    const plans:Record<string,unknown>={};
    for(const [name,query]of captured)plans[name]=(await pg.query(`EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) ${query.query}`,query.parameters)).rows;
    const stored=(await pg.query<{messages:number,events:number,operations:number}>('select (select count(*)::int from relay.messages) as messages,(select count(*)::int from relay.events) as events,(select count(*)::int from relay.operations) as operations')).rows[0];
    report.groups.push({people,ownHistoryReturned:(await getChat(owner,sql)).messages.length,stored,rows,plans});
    console.log(JSON.stringify({stage,people,actions:rows.length,create:rows.find(row=>row.action==='create group'),history:rows.find(row=>row.action==='get own history beside50000foreign rows')}));
  }finally{await pg.close();}
}
writeFileSync(resolve(directory,`${stage}.json`),JSON.stringify(report,null,2)+'\n');
console.log(`Saved ${stage} benchmark with local-only scope.`);
}
void main().catch(error=>{console.error(error instanceof Error?error.message:'Benchmark failed.');process.exitCode=1;});
