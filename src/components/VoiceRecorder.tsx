'use client';
import {useEffect, useRef, useState} from 'react';
import {Mic, Square, RotateCcw, Check} from 'lucide-react';
import type {Attachment} from '@/lib/types';
import {MAX_ATTACHMENT_BYTES, MAX_RECORDING_SECONDS} from '@/lib/media-limits';
import {announceAudioPlayback} from './AudioPlayer';
import styles from './VoiceRecorder.module.css';
export default function VoiceRecorder({onRecorded,onClose}:{onRecorded:(attachment:Attachment)=>void;onClose:()=>void}) {
 const [recording,setRecording]=useState(false), [seconds,setSeconds]=useState(0), [error,setError]=useState(''), [attachment,setAttachment]=useState<Attachment|null>(null), [pending,setPending]=useState(false), [preparing,setPreparing]=useState(false);
 const recorder=useRef<MediaRecorder|null>(null), stream=useRef<MediaStream|null>(null), timer=useRef<ReturnType<typeof setInterval>|null>(null), alive=useRef(true), chunks=useRef<Blob[]>([]), started=useRef(0);
 const generation=useRef(0), readerRef=useRef<FileReader|null>(null), preview=useRef<HTMLAudioElement|null>(null);
 const cleanup=()=>{if(timer.current)clearInterval(timer.current);timer.current=null;stream.current?.getTracks().forEach(track=>track.stop());stream.current=null;};
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;generation.current++;readerRef.current?.abort();preview.current?.pause();if(recorder.current?.state==='recording')recorder.current.stop();cleanup();};},[]);
 useEffect(()=>{const element=preview.current;return()=>element?.pause();},[attachment?.url]);
 const stop=()=>{if(recorder.current?.state==='recording')recorder.current.stop();};
 const start=async()=>{
  if(pending||preparing||recording)return;
  const ticket=++generation.current, current=()=>alive.current&&generation.current===ticket;
  setError('');setAttachment(null);setSeconds(0);setPending(true);
  if(!navigator.mediaDevices?.getUserMedia||typeof MediaRecorder==='undefined'){setError('Voice recording is unavailable in this browser. Use Safari or Chrome, or attach an audio file.');setPending(false);return;}
  try {
   const microphone=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true},video:false});
   if(!current()){microphone.getTracks().forEach(track=>track.stop());return;}
   stream.current=microphone;
   const candidate=['audio/mp4','audio/webm;codecs=opus','audio/webm','audio/ogg;codecs=opus'].find(type=>MediaRecorder.isTypeSupported(type));
   if(!candidate){cleanup();setError('This browser cannot record a supported audio format. Try Safari or Chrome.');setPending(false);return;}
   const media=new MediaRecorder(microphone,{mimeType:candidate,audioBitsPerSecond:48000});recorder.current=media;chunks.current=[];
   media.ondataavailable=event=>{if(!current())return;if(event.data.size)chunks.current.push(event.data);if(chunks.current.reduce((sum,part)=>sum+part.size,0)>MAX_ATTACHMENT_BYTES&&media.state==='recording')media.stop();};
   media.onstop=()=>{
    if(!current()){microphone.getTracks().forEach(track=>track.stop());return;}cleanup();setRecording(false);
    const type=media.mimeType.split(';')[0];const blob=new Blob(chunks.current,{type});
    if(!blob.size||blob.size>MAX_ATTACHMENT_BYTES){setError('Recording could not be saved within the 5 MB limit. Please record a shorter voice message.');return;}
    // Stop releases the microphone; a second capture waits for the file read.
    setPreparing(true);const reader=new FileReader();readerRef.current=reader;
    reader.onload=()=>{if(!current())return;readerRef.current=null;setPreparing(false);if(typeof reader.result==='string')setAttachment({name:`Voice message.${type==='audio/mp4'?'m4a':type==='audio/ogg'?'ogg':'webm'}`,type,url:reader.result,size:blob.size});};
    reader.onerror=()=>{if(!current())return;readerRef.current=null;setPreparing(false);setError('Unable to save this recording. Please try again.');};reader.readAsDataURL(blob);
   };
   media.onerror=()=>{if(!current())return;generation.current++;cleanup();setRecording(false);setPreparing(false);setPending(false);setError('Recording stopped. Please try again.');};
   started.current=Date.now();media.start(500);setRecording(true);setPending(false);
   timer.current=setInterval(()=>{const elapsed=Math.floor((Date.now()-started.current)/1000);if(current())setSeconds(elapsed);if(elapsed>=MAX_RECORDING_SECONDS&&media.state==='recording')media.stop();},250);
  } catch (failure) {
   if(!current())return;cleanup();setPending(false);setPreparing(false);setRecording(false);
   setError(failure instanceof DOMException&&failure.name==='NotAllowedError'?'Microphone access was denied. Allow it in your browser settings, then try again.':'Unable to open the microphone. Check that it is available and try again.');
  }
 };
 return <div className={styles.recorder}>
  <div className={`${styles.visual} ${recording?styles.active:''}`}><Mic size={32}/></div>
  <p className={styles.timer}>{String(Math.floor(seconds/60)).padStart(2,'0')}:{String(seconds%60).padStart(2,'0')}</p>
  <p>{recording?'Recording… tap stop when you’re done.':preparing?'Preparing your voice message…':attachment?'Listen before adding your voice message.':'Record a voice message up to 2 minutes (5 MB).'}</p>
  {error&&<p role="alert" className={styles.error}>{error}</p>}
  {attachment&&<audio ref={preview} controls src={attachment.url} aria-label="Voice message preview" className={styles.audio} onPlay={event=>announceAudioPlayback(event.currentTarget)}/>}
  <div className={styles.actions}>
   {recording?<button type="button" className={styles.primary} onClick={stop}><Square size={18}/>Stop recording</button>:attachment?<><button type="button" onClick={()=>{preview.current?.pause();setAttachment(null);setSeconds(0);setError('');}}><RotateCcw size={18}/>Record again</button><button type="button" className={styles.primary} onClick={()=>{preview.current?.pause();onRecorded(attachment);onClose();}}><Check size={18}/>Use recording</button></>:<button type="button" className={styles.primary} onClick={()=>void start()} disabled={pending||preparing}><Mic size={18}/>{preparing?'Preparing recording…':pending?'Opening microphone…':'Start recording'}</button>}
  </div>
  <small>Your microphone is used only while recording. The file is sent when you tap Send.</small>
 </div>;
}
