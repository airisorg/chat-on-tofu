'use client';
import {useEffect, useRef, useState} from 'react';
import {Mic, Square, RotateCcw, Check} from 'lucide-react';
import type {Attachment} from '@/lib/types';
import styles from './VoiceRecorder.module.css';
export default function VoiceRecorder({onRecorded,onClose}:{onRecorded:(attachment:Attachment)=>void;onClose:()=>void}) {
 const [recording,setRecording]=useState(false), [seconds,setSeconds]=useState(0), [error,setError]=useState(''), [attachment,setAttachment]=useState<Attachment|null>(null), [pending,setPending]=useState(false);
 const recorder=useRef<MediaRecorder|null>(null), stream=useRef<MediaStream|null>(null), timer=useRef<ReturnType<typeof setInterval>|null>(null), alive=useRef(true), chunks=useRef<Blob[]>([]), started=useRef(0);
 const cleanup=()=>{if(timer.current)clearInterval(timer.current);timer.current=null;stream.current?.getTracks().forEach(track=>track.stop());stream.current=null;};
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;if(recorder.current?.state==='recording')recorder.current.stop();cleanup();};},[]);
 const stop=()=>{if(recorder.current?.state==='recording')recorder.current.stop();};
 const start=async()=>{
  setError('');setAttachment(null);setSeconds(0);setPending(true);
  if(!navigator.mediaDevices?.getUserMedia||typeof MediaRecorder==='undefined'){setError('Voice recording is unavailable in this browser. Use Safari or Chrome, or attach an audio file.');setPending(false);return;}
  try {
   const microphone=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true},video:false});
   if(!alive.current){microphone.getTracks().forEach(track=>track.stop());return;}
   stream.current=microphone;
   const candidate=['audio/mp4','audio/webm;codecs=opus','audio/webm','audio/ogg;codecs=opus'].find(type=>MediaRecorder.isTypeSupported(type));
   if(!candidate){cleanup();setError('This browser cannot record a supported audio format. Try Safari or Chrome.');setPending(false);return;}
   const media=new MediaRecorder(microphone,{mimeType:candidate,audioBitsPerSecond:48000});recorder.current=media;chunks.current=[];
   media.ondataavailable=event=>{if(event.data.size)chunks.current.push(event.data);if(chunks.current.reduce((sum,part)=>sum+part.size,0)>1048576&&media.state==='recording')media.stop();};
   media.onstop=()=>{
    cleanup();if(!alive.current)return;setRecording(false);
    const type=media.mimeType.split(';')[0];const blob=new Blob(chunks.current,{type});
    if(!blob.size||blob.size>1048576){setError('Recording could not be saved. Please record a shorter voice message.');return;}
    const reader=new FileReader();reader.onload=()=>{if(alive.current&&typeof reader.result==='string')setAttachment({name:`Voice message.${type==='audio/mp4'?'m4a':type==='audio/ogg'?'ogg':'webm'}`,type,url:reader.result,size:blob.size});};reader.onerror=()=>{if(alive.current)setError('Unable to save this recording. Please try again.');};reader.readAsDataURL(blob);
   };
   media.onerror=()=>{cleanup();if(alive.current){setRecording(false);setError('Recording stopped. Please try again.');}};
   started.current=Date.now();media.start(500);setRecording(true);setPending(false);
   timer.current=setInterval(()=>{const elapsed=Math.floor((Date.now()-started.current)/1000);if(alive.current)setSeconds(elapsed);if(elapsed>=60&&media.state==='recording')media.stop();},250);
  } catch (failure) {
   cleanup();if(!alive.current)return;setPending(false);setRecording(false);
   setError(failure instanceof DOMException&&failure.name==='NotAllowedError'?'Microphone access was denied. Allow it in your browser settings, then try again.':'Unable to open the microphone. Check that it is available and try again.');
  }
 };
 return <div className={styles.recorder}>
  <div className={`${styles.visual} ${recording?styles.active:''}`}><Mic size={32}/></div>
  <p className={styles.timer}>{String(Math.floor(seconds/60)).padStart(2,'0')}:{String(seconds%60).padStart(2,'0')}</p>
  <p>{recording?'Recording… tap stop when you’re done.':attachment?'Listen before adding your voice message.':'Record a voice message up to 60 seconds.'}</p>
  {error&&<p role="alert" className={styles.error}>{error}</p>}
  {attachment&&<audio controls src={attachment.url} aria-label="Voice message preview" className={styles.audio}/>}
  <div className={styles.actions}>
   {recording?<button type="button" className={styles.primary} onClick={stop}><Square size={18}/>Stop recording</button>:attachment?<><button type="button" onClick={()=>{setAttachment(null);setSeconds(0);setError('');}}><RotateCcw size={18}/>Record again</button><button type="button" className={styles.primary} onClick={()=>{onRecorded(attachment);onClose();}}><Check size={18}/>Use recording</button></>:<button type="button" className={styles.primary} onClick={()=>void start()} disabled={pending}><Mic size={18}/>{pending?'Opening microphone…':'Start recording'}</button>}
  </div>
  <small>Your microphone is used only while recording. The file is sent when you tap Send.</small>
 </div>;
}
