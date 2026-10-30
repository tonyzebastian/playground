'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Dialog } from '@base-ui/react/dialog';
import { Check, CaretDown, DownloadSimple, Microphone, Pause, ArrowCounterClockwise, SlidersHorizontal, UploadSimple, X, PencilSimple, Play } from '@phosphor-icons/react';
import KalimbaInstrument from './KalimbaInstrument';
import RecordingPanel from './RecordingPanel';
import ListeningWave from './ListeningWave';
import { KalimbaAudio } from './audio';
import { loadKeys,saveKey,exportKeys,importKeys } from './storage';
import { SONGS,noteName,nearestKey,playableSong } from './music.mjs';
import { initialSong, nextSetupKey } from './flow.mjs';
import { analyseCalibration, assertUniqueKey, toneProfile, calibrationMatch } from './calibration.mjs';
import { CAPTURE_FORMAT, CUE_MS, captureScript, encodeWav } from './capture.mjs';

const PREFERENCES='kalimba-preferences-v2';
const preferences=()=>{try{return JSON.parse(localStorage.getItem(PREFERENCES)||'{}');}catch{return {};}};
const decorate=keys=>keys.map(key=>({...key,label:noteName(key.midi)}));
const EMPTY_SEQUENCE=[];
const asDataUrl=blob=>new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(reader.error);reader.readAsDataURL(blob);});
// What a capture keeps from each detection: enough to compare with an offline replay.
const detection=frame=>({time:frame.time,onset:frame.onset,keyId:frame.keyId,frequency:frame.frequency,confidence:frame.confidence});

// Song progress drawn as the button's outline filling clockwise from the top.
function ProgressRing({value}){
  const amount=Math.max(0,Math.min(1,value||0));
  return <svg className="kalimba-ring" viewBox="0 0 100 100" aria-hidden="true">
    <circle className="kalimba-ring-track" cx="50" cy="50" r="49"/>
    <circle className="kalimba-ring-fill" cx="50" cy="50" r="49" pathLength="1" strokeDasharray="1" strokeDashoffset={1-amount} opacity={amount>0?1:0}/>
  </svg>;
}

export default function KalimbaApp({art}){
  const [editing,setEditing]=useState(null),[sheet,setSheet]=useState(null),[recordAll,setRecordAll]=useState(false);
  const [keys,setKeys]=useState([]),[loaded,setLoaded]=useState(false);
  const [selected,setSelected]=useState(null),[active,setActive]=useState(null);
  const [recording,setRecording]=useState(false),[pending,setPending]=useState(false),[saving,setSaving]=useState(false);
  const [candidate,setCandidate]=useState(null),[captureCount,setCaptureCount]=useState(0),[captureHint,setCaptureHint]=useState(''),[captureMatch,setCaptureMatch]=useState(null);
  const [listening,setListening]=useState(false),[signal,setSignal]=useState(0),[heard,setHeard]=useState(null);
  const [message,setMessage]=useState(''),[error,setError]=useState('');
  const [songId,setSongId]=useState(null),[step,setStep]=useState(0),[running,setRunning]=useState(false);
  const [playing,setPlaying]=useState(false),[tempo,setTempo]=useState(76),[mode,setMode]=useState('wait'),[loop,setLoop]=useState(false);
  const [hits,setHits]=useState(0),[finished,setFinished]=useState(false),[pausedAt,setPausedAt]=useState(null);
  const [captureOn,setCaptureOn]=useState(false),[captureFile,setCaptureFile]=useState(null),[cueKey,setCueKey]=useState(null);
  const audio=useRef(null),timer=useRef(null),captureTimer=useRef(null),captureFrames=useRef([]),capturePlucks=useRef([]),captureTones=useRef([]),captureFinishing=useRef(false),captureReady=useRef(false),onHear=useRef(()=>{});
  const epoch=useRef(0),alive=useRef(true),recordToken=useRef(0),finishedRef=useRef(false);
  const fileInput=useRef(null),root=useRef(null),recordFocus=useRef(null);
  const timedHit=useRef(null),captureFinish=useRef(null),level=useRef(0);
  const engine=()=>audio.current||(audio.current=new KalimbaAudio());
  const complete=keys.length===9;
  const displayKeys=keys;
  const song=SONGS.find(s=>s.id===songId);
  const mapped=useMemo(()=>song?playableSong(song,displayKeys):null,[song,displayKeys]);
  const sequence=mapped?.sequence||EMPTY_SEQUENCE;
  const animate=useCallback(id=>setActive({id,serial:performance.now()}),[]);

  const stop=useCallback(()=>{
    epoch.current++;recordToken.current++;clearTimeout(timer.current);clearTimeout(captureTimer.current);
    audio.current?.stopListening();audio.current?.stopPlayback();
    captureFinish.current=null;setCueKey(null);
    setListening(false);setPending(false);setRecording(false);setPlaying(false);setRunning(false);setSignal(0);level.current=0;
  },[]);
  useEffect(()=>{
    alive.current=true;
    loadKeys().then(data=>{
      if(!alive.current)return;
      const saved=decorate(data),prefs=preferences();setKeys(saved);
      setMode(prefs.mode==='time'?'time':'wait');setLoop(prefs.loop===true);
      if(saved.length===9){const first=initialSong(saved,prefs.songId);setSongId(first?.id??null);setTempo(Number.isFinite(prefs.tempo)?Math.max(35,Math.min(140,prefs.tempo)):(first?.bpm??76));}
      else{setEditing('setup');setSelected(null);}
    }).catch(()=>{if(alive.current)setError('Storage is unavailable. Try a regular Safari or Chrome tab.');}).finally(()=>{if(alive.current)setLoaded(true);});
    const visibility=()=>{if(document.hidden){stop();setMessage('Paused while you were away. Tap to resume.');}};
    document.addEventListener('visibilitychange',visibility);
    return()=>{alive.current=false;stop();audio.current?.dispose();audio.current=null;document.removeEventListener('visibilitychange',visibility);};
  },[stop]);

  // Hidden capture mode for accuracy testing: Control+Option+Shift+K, or ?capture on phones.
  useEffect(()=>{
    if(new URLSearchParams(window.location.search).has('capture'))setCaptureOn(true);
    const toggle=event=>{if(event.ctrlKey&&event.altKey&&event.shiftKey&&event.code==='KeyK'){event.preventDefault();setCaptureOn(on=>!on);}};
    window.addEventListener('keydown',toggle);
    return()=>window.removeEventListener('keydown',toggle);
  },[]);
  useEffect(()=>{
    if(!loaded||!complete)return;
    try{localStorage.setItem(PREFERENCES,JSON.stringify({songId:songId??'free',tempo,mode,loop}));}catch{}
  },[loaded,complete,songId,tempo,mode,loop]);
  function chooseSong(next){
    stop();setPausedAt(null);setSongId(next?.id??null);setTempo(next?.bpm??76);setStep(0);setHits(0);
    timedHit.current=null;setFinished(false);finishedRef.current=false;setSheet(null);setMessage(next&&playableSong(next,keys)?.adapted?'Adapted to your keys. Follow the highlighted tines.':'');
  }
  function openSheet(next){stop();setSheet(next);setError('');}
  function editKeys(all=false){stop();setSheet(null);setEditing(all?'setup':'edit');setRecordAll(all);setSelected(null);setCandidate(null);setMessage('');setError('');}
  function finishEditing(){stop();setEditing(null);setCandidate(null);setMessage('');setError('');if(song&&!playableSong(song,keys))chooseSong(initialSong(keys));}
  const advance=useCallback(()=>{
    setStep(current=>{
      timedHit.current=null;
      if(current+1>=sequence.length){
        if(loop)return 0;
        finishedRef.current=true;setFinished(true);setRunning(false);setListening(false);setMessage('Phrase complete. Take a breath, then try it again.');audio.current?.stopListening();return current;
      }
      return current+1;
    });
  },[loop,sequence.length]);
  useEffect(()=>{
    onHear.current=result=>{
      level.current=Math.min(1,result.rms*12);setSignal(level.current);
      if(result.ambiguous&&!result.pluck){setMessage('Sounds overlap. Try one clear pluck.');return;}
      if(!result.pluck || !result.frequency)return;
      const key=Number.isInteger(result.keyId)?keys.find(k=>k.id===result.keyId):nearestKey(result.frequency,keys);
      if(!key){setMessage('Try one clear pluck.');return;}
      animate(key.id);setHeard(key.label);
      if(song&&running&&!finishedRef.current){
        if(key.id===sequence[step]?.key){if(mode==='wait'||timedHit.current!==step){setHits(n=>n+1);timedHit.current=step;}setMessage('That’s it.');if(mode==='wait')advance();}
        else setMessage(`You played key ${key.id+1}. Try key ${(sequence[step]?.key??0)+1}.`);
      }else setMessage(`Key ${key.id+1} · ${key.label}`);
    };
  },[keys,song,running,sequence,step,mode,advance,animate]);
  useEffect(()=>{
    if(!running||mode!=='time'||finished||!song)return;
    const id=setTimeout(advance,(sequence[step]?.beats||1)*60000/tempo);
    return()=>clearTimeout(id);
  },[running,mode,finished,step,tempo,sequence,advance,song]);

  async function startListening(practice=false){
    // A paused demonstration's position isn't the player's: practice starts from the top.
    if(pausedAt!==null){setStep(0);setHits(0);}
    stop();setPausedAt(null);setError('');setMessage('');setPending(true);finishedRef.current=false;
    const token=epoch.current;
    try{
      let warmed=false;
      if(await engine().listen(result=>{
        if(token!==epoch.current)return;
        if(result.checking){setMessage('Checking room noise. Keep quiet for a moment…');return;}
        if(!warmed){warmed=true;setMessage('Listening…');if(practice)setRunning(true);}
        onHear.current(result);
      },()=>{setListening(false);setRunning(false);setMessage('Microphone disconnected. Tap Listen to reconnect.');},keys) && token===epoch.current){
        setListening(true);if(practice){if(finished){setStep(0);setHits(0);}setFinished(false);}
      }
    }catch(err){if(token===epoch.current)setError(err.message);}
    finally{if(token===epoch.current)setPending(false);}
  }
  async function saveCapture(raw,details){
    const backup=JSON.parse(await (await exportKeys(keys)).text());
    const audioData=await asDataUrl(new Blob([encodeWav(raw.samples,raw.rate)],{type:'audio/wav'}));
    const file={format:CAPTURE_FORMAT,createdAt:new Date().toISOString(),userAgent:navigator.userAgent,rate:raw.rate,settings:raw.settings,seconds:+(raw.samples.length/raw.rate).toFixed(2),...details,keys:backup.keys,audio:audioData};
    const stamp=file.createdAt.slice(0,19).replace(/[:T]/g,'-');
    setCaptureFile({blob:new Blob([JSON.stringify(file)],{type:'application/json'}),name:`kalimba-capture-${details.mode}${details.mode==='setup'?`-key${details.key+1}`:''}-${stamp}.json`,mode:details.mode,key:details.key});
  }
  function downloadCapture(){
    if(!captureFile)return;
    const url=URL.createObjectURL(captureFile.blob),a=document.createElement('a');a.href=url;a.download=captureFile.name;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);
  }
  // Guided capture: highlight one key every two seconds and record raw audio alongside
  // each cue's time, so recognition can be scored offline against what was asked.
  async function startCapture(){
    stop();setError('');setCaptureFile(null);setPending(true);
    const token=epoch.current,cues=captureScript(keys),log={cues:[],detections:[]};
    let started=false;
    const finish=async()=>{
      if(token!==epoch.current)return;
      captureFinish.current=null;clearTimeout(timer.current);audio.current?.stopListening();
      const raw=audio.current?.takeCapture();setListening(false);setCueKey(null);setSignal(0);
      if(!raw){setError('Nothing was captured. Please try again.');return;}
      setMessage('Preparing capture…');
      try{await saveCapture(raw,{mode:'listen',cueMs:CUE_MS,...log});if(token===epoch.current)setMessage(`Capture ready: ${log.cues.length} cues. Save it and share the file.`);}
      catch{if(token===epoch.current)setError('Couldn’t prepare the capture.');}
    };
    const cue=index=>{
      if(token!==epoch.current)return;
      if(index>=cues.length){setCueKey(null);setMessage('Done. Let the last note ring…');timer.current=setTimeout(finish,1500);return;}
      const key=cues[index];log.cues.push({key,time:engine().captureClock()});
      setCueKey(key);setMessage(`Capture ${index+1}/${cues.length} · pluck key ${key+1}`);
      timer.current=setTimeout(()=>cue(index+1),CUE_MS);
    };
    try{
      const ok=await engine().listen(result=>{
        if(token!==epoch.current)return;
        level.current=Math.min(1,result.rms*12);setSignal(level.current);
        if(result.checking){setMessage('Checking room noise. Keep quiet for a moment…');return;}
        if(result.pluck){log.detections.push(detection(result));if(Number.isInteger(result.keyId))animate(result.keyId);}
        if(!started){
          started=true;setMessage('Get ready: pluck each highlighted key once, as soon as it lights up.');
          const count=n=>{if(token!==epoch.current)return;if(!n){cue(0);return;}setMessage(`Starting in ${n}… first key ${cues[0]+1}`);timer.current=setTimeout(()=>count(n-1),1000);};
          timer.current=setTimeout(()=>count(3),2500);
        }
      },()=>{setListening(false);setCueKey(null);setMessage('Microphone disconnected. Capture stopped.');},keys,{capture:true});
      if(ok&&token===epoch.current){setListening(true);captureFinish.current=finish;}
    }catch(err){if(token===epoch.current)setError(err.message);}
    finally{if(token===epoch.current)setPending(false);}
  }
  async function tapKey(id){
    if(editing){if(!recording&&!pending&&!saving){setSelected(id);setCandidate(null);setCaptureCount(0);setCaptureMatch(null);setError('');recordFocus.current=id;setSheet('record');}return;}
    if(playing||pending)return;
    animate(id);
    if(listening)return;
    const key=displayKeys.find(k=>k.id===id);
    if(!key){setMessage('Record this key in setup to hear it.');return;}
    try{await engine().play(key);}catch(err){setError(err.message);}
    setHeard(key.label);
    if(song&&!finished){
      if(sequence[step]?.key===id){setHits(n=>n+1);setMessage('That’s it.');advance();}
      else setMessage(`Try the highlighted key ${(sequence[step]?.key??0)+1}.`);
    }
  }
  async function startRecording(){
    if(!Number.isInteger(selected))return;
    stop();setCandidate(null);setError('');setMessage('');setCaptureMatch(null);setCaptureCount(0);setCaptureHint('Keep quiet for a moment…');setPending(true);captureFrames.current=[];capturePlucks.current=[];captureTones.current=[];captureFinishing.current=false;captureReady.current=false;
    const token=recordToken.current;
    try{
      const started=await engine().listen(result=>{
        if(token!==recordToken.current||captureFinishing.current||captureReady.current)return;
        level.current=Math.min(1,result.rms*12);setSignal(level.current);
        if(result.checking){setCaptureHint('Checking the room. Keep quiet…');return;}
        const count=capturePlucks.current.length;
        setCaptureHint(result.quality==='clipping'?'A little gentler…':result.quality==='quiet'&&result.time>3000&&!count?'Move the phone a little closer':count>=3?'Keep the good plucks. Try another.':count?`Pluck ${count+1} of 3 when you’re ready`:'Ready for your first pluck');
        if(result.quality==='clipping')return;
        if(result.frequency&&result.confidence>.87){
          captureFrames.current.push(result.frequency);captureTones.current.push(result);
        }
        if(result.pluck&&result.frequency){
          capturePlucks.current.push(result);animate(selected);setCaptureCount(capturePlucks.current.length);
          const match=calibrationMatch(capturePlucks.current);setCaptureMatch(match);
          if(match.accepted||capturePlucks.current.length>=6){
            captureReady.current=true;setCaptureHint(match.accepted?'Good match. Finishing…':'Checking your six plucks…');
            clearTimeout(captureTimer.current);
            // Let the last pluck ring so its sample is long enough to learn from.
            captureTimer.current=setTimeout(()=>finishRecording(token),match.accepted?1200:250);
          }
        }
      },undefined,[],{capture:captureOn});
      if(!started||token!==recordToken.current)return;
      engine().startRecording();setRecording(true);
      captureTimer.current=setTimeout(()=>finishRecording(token),22000);
    }catch(err){if(token===recordToken.current){audio.current?.stopListening();setError(err.message);}}
    finally{if(token===recordToken.current)setPending(false);}
  }
  async function finishRecording(token=recordToken.current){
    if(token!==recordToken.current||captureFinishing.current)return;
    captureFinishing.current=true;clearTimeout(captureTimer.current);setRecording(false);setPending(true);
    let raw=null,outcome='saved as a candidate';
    try{
      const blob=await engine().finishRecording();audio.current?.stopListening();setSignal(0);
      raw=audio.current?.takeCapture()??null;
      if(token!==recordToken.current)return;
      if(!blob?.size)throw new Error('The recording was empty. Please try again.');
      const match=analyseCalibration(captureFrames.current,capturePlucks.current);
      const {midi,frequency}=match;
      assertUniqueKey({id:selected,midi,frequency},keys);
      const plucks=capturePlucks.current;
      // onset marks the window in which the attack appeared; time is when pitch was confirmed.
      const at=pluck=>pluck.onset??pluck.time;
      // Cut the sample from the matching pluck with the most ring before the
      // next sound: preferably the first with ~1 s, else the longest.
      const options=match.indexes.map(index=>({pluck:plucks[index],ring:plucks[index+1]?at(plucks[index+1])-at(plucks[index]):Infinity}));
      const {pluck:chosen,ring}=options.find(option=>option.ring>=1000)??options.reduce((best,option)=>option.ring>best.ring?option:best);
      const startSeconds=Math.max(0,(at(chosen)-(chosen.onset!=null?60:120))/1000);
      const duration=Number.isFinite(ring)?Math.min(1.5,ring/1000-.05):1.5;
      const sample=await engine().sample(blob,{startSeconds,duration});
      if(token!==recordToken.current)return;
      setCandidate({id:selected,midi,frequency,match:match.match,profile:toneProfile(captureTones.current.filter(frame=>Math.abs(1200*Math.log2(frame.frequency/frequency))<=85)),blob:sample,recordedAt:new Date().toISOString()});
      setMessage('');
    }catch(err){outcome=err.message;audio.current?.stopListening();if(token===recordToken.current)setError(err.message);}
    finally{if(token===recordToken.current)setPending(false);}
    if(raw&&token===recordToken.current){
      try{await saveCapture(raw,{mode:'setup',key:selected,outcome,plucks:capturePlucks.current.map(detection)});}
      catch{setError('Couldn’t prepare the capture.');}
    }
  }
  async function acceptRecording(){
    if(!candidate)return;
    try{assertUniqueKey(candidate,keys);}catch(err){setError(err.message);return;}
    setSaving(true);setError('');
    try{
      await saveKey(candidate);
      const next=decorate([...keys.filter(k=>k.id!==candidate.id),candidate].sort((a,b)=>a.id-b.id));setKeys(next);setCandidate(null);
      if(editing==='setup'){
        const nextKey=nextSetupKey(next,selected,recordAll);
        if(nextKey===null){setEditing(null);setRecordAll(false);chooseSong(initialSong(next));setMessage('Ready to play.');}
        else{setSelected(nextKey);setCaptureCount(0);setCaptureMatch(null);setError('');setMessage('');}
      }else{setSelected(null);setSheet(null);setMessage('Key saved.');}
      navigator.storage?.persist?.().catch(()=>{});
    }catch{setError('Couldn’t save this key. Your browser storage may be full or unavailable.');}
    finally{setSaving(false);}
  }
  async function demonstrate(from=0){
    if(!sequence.length)return;
    stop();setError('');setPausedAt(null);setPlaying(true);setFinished(false);finishedRef.current=false;setStep(from);setHits(0);
    const token=epoch.current;
    try{
      await engine().unlock();
      const playAt=async index=>{
        if(token!==epoch.current||!alive.current)return;
        if(index>=sequence.length){setPlaying(false);setStep(0);setPausedAt(null);return;}
        const item=sequence[index];setStep(index);animate(item.key);
        try{await engine().play(displayKeys.find(k=>k.id===item.key));}catch(err){setError(err.message);setPlaying(false);return;}
        if(token!==epoch.current){audio.current?.stopPlayback();return;}
        timer.current=setTimeout(()=>playAt(index+1),item.beats*60000/tempo);
      };
      await playAt(from);
    }catch(err){setError(err.message);setPlaying(false);}
  }
  async function backup(){
    try{const blob=await exportKeys(keys);const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='my-kalimba.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);setMessage('Backup downloaded. Keep it somewhere safe.');}catch{setError('Couldn’t create a backup. Please try again.');}
  }
  async function restore(event){
    const file=event.target.files?.[0];if(!file)return;stop();setSaving(true);setError('');
    try{const restored=await importKeys(file);setKeys(decorate(restored));setCandidate(null);setSheet(null);setRecordAll(false);if(restored.length===9){setEditing(null);chooseSong(initialSong(restored));}else{setEditing('setup');setSelected(null);}setMessage('Backup restored.');}catch(err){setError(err.message);}finally{setSaving(false);event.target.value='';}
  }

  const busy=recording||pending||saving;
  const savedKey=keys.find(key=>key.id===selected);
  const currentKey=candidate||savedKey;
  // While capturing, only the capture's cues light up, never the song's.
  const capturing=!!captureFinish.current;
  const target=capturing?(cueKey??undefined):editing?selected:song&&!finished?sequence[step]?.key:undefined;
  const upcoming=capturing?undefined:cueKey==null&&!editing&&song&&!finished?sequence[step+1]?.key:undefined;
  const total=sequence.length||1;
  const playProgress=playing?(step+1)/total:pausedAt!==null?pausedAt/total:0;
  const practiceProgress=song?(finished?1:step/total):0;
  const practising=listening||pending;

  return <main ref={root} className="kalimba-app" data-editing={editing||undefined}>
    <header className="kalimba-header">
      <span className="kalimba-wordmark">Kalimba</span>
      <div className="kalimba-header-right">
        {editing&&complete&&<button className="kalimba-done" onClick={finishEditing} disabled={busy}>Done <Check weight="bold" size={14}/></button>}
        <button className="kalimba-header-settings" onClick={()=>openSheet('settings')} disabled={busy}><SlidersHorizontal weight="bold" size={18}/><span>Settings</span></button>
      </div>
    </header>

    <div className="kalimba-song-selection"/>

    <div className="kalimba-workspace">
    <div className="kalimba-device">
      <KalimbaInstrument art={art} keys={keys} active={active} target={target} upcoming={upcoming} onKey={tapKey} editing={!!editing} disabled={!loaded||busy}/>
    </div>
    </div>

    {!editing&&loaded&&<div className="kalimba-controls">
        <ListeningWave level={level} active={listening} waiting={pending}/>
        <button className="kalimba-song-trigger" onClick={()=>openSheet('songs')} aria-label="Choose song or free play"><span>{song?.title??'Free play'}</span><CaretDown weight="bold" size={15}/></button>
        <div className="kalimba-device-playback">
        {song&&<button className="kalimba-device-small" data-ring={playing||pausedAt!==null||undefined} aria-label={playing?'Pause melody':pausedAt!==null?'Resume melody':'Play melody'} onClick={()=>{if(playing){setPausedAt(step);stop();}else demonstrate(pausedAt??0);}} disabled={pending}>
          <ProgressRing value={playProgress}/>{playing?<Pause weight="fill" size={17}/>:<Play weight="fill" size={17}/>}
        </button>}
        <button className="kalimba-device-start" data-active={practising||undefined} onClick={()=>listening||pending?(captureFinish.current?captureFinish.current():stop()):captureOn&&complete?startCapture():startListening(!!song)} aria-label={pending?'Cancel microphone request':listening?(captureFinish.current?'Finish capture':'Pause listening'):captureOn&&complete?'Start accuracy capture':song?'Start song practice':'Start free play'}>
          {practising&&<ProgressRing value={practiceProgress}/>}{listening?<Pause weight="bold" size={21}/>:pending?<X weight="bold" size={20}/>:<Microphone weight="bold" size={21}/>}
        </button>
        {song&&<button className="kalimba-device-small" aria-label="Restart song" onClick={()=>{stop();setPausedAt(null);setStep(0);setHits(0);setFinished(false);finishedRef.current=false;setMessage('');}} disabled={pending}><ArrowCounterClockwise weight="bold" size={17}/></button>}
      </div></div>}

    {(!loaded||editing)&&<p className="kalimba-top-hint kalimba-setup-hint">{!loaded?'Opening your instrument…':editing==='setup'?`Tap a key to record · ${keys.length}/9 saved`:'Tap a key to change its sound.'}</p>}

    <div className="kalimba-bottom-status">
      {error&&!editing?<p role="alert" className="kalimba-error">{error}</p>:<p role="status">{message||(editing?'':finished?'Finished. Nicely played.':listening?(song?`Key ${(target??0)+1} next`:heard?`Heard ${heard}`:'Play any key.'):'')}</p>}
      {captureOn&&<div className="kalimba-capture"><span>Capture mode</span>{captureFile&&<button onClick={downloadCapture}><DownloadSimple weight="bold" size={14}/> Save capture</button>}</div>}
    </div>

    <Dialog.Root open={!!sheet} onOpenChange={open=>{if(!open){if(saving)return;if(sheet==='record'){stop();setSelected(null);setCandidate(null);setError('');}setSheet(null);}}}>
      <Dialog.Portal container={root.current}>
        <Dialog.Backdrop className="kalimba-sheet-overlay"/>
        <Dialog.Popup className={`kalimba-sheet ${sheet==='record'?'kalimba-recording-sheet':''}`} finalFocus={()=>{const id=recordFocus.current;if(Number.isInteger(id)){recordFocus.current=null;return root.current?.querySelector(`[aria-label^="Key ${id+1},"]`)||true;}return true;}}>
          <div className="kalimba-sheet-heading"><Dialog.Title>{sheet==='record'?`Key ${selected+1}`:sheet==='songs'?'Play something':'Your instrument'}</Dialog.Title><Dialog.Close className="kalimba-sheet-close" aria-label="Close" disabled={saving}><X weight="bold" size={18}/></Dialog.Close></div>
          <Dialog.Description className="kalimba-sr-only">{sheet==='record'?'Record three plucks of this key. We compare pitch consistency and keep the best matches.':sheet==='songs'?'Choose a melody that fits your recorded notes, or free play.':'Edit recorded keys, adjust practice, and manage your saved instrument.'}</Dialog.Description>
          {sheet==='record'&&Number.isInteger(selected)?<RecordingPanel
            selected={selected} setup={editing==='setup'} keys={keys} currentKey={currentKey} candidate={candidate} recording={recording} pending={pending} saving={saving}
            signal={signal} count={captureCount} hint={captureHint} match={captureMatch} error={error}
            onNote={midi=>{setCandidate({...currentKey,midi});setError('');}}
            onRecord={startRecording} onFinish={()=>finishRecording()} onSave={acceptRecording}
            onReplay={()=>engine().play(currentKey).catch(err=>setError(err.message))} onCancel={stop}
            capture={captureOn} onSaveCapture={captureFile?.mode==='setup'&&captureFile.key===selected?downloadCapture:null}
          />:sheet==='songs'?<div className="kalimba-song-list">
            <button onClick={()=>chooseSong(null)} aria-pressed={!song}><span><strong>Free play</strong><small>No song. Just your instrument.</small></span>{!song&&<Check weight="bold" size={16}/>}</button>
            {SONGS.map(item=>{const arrangement=playableSong(item,keys);return <button key={item.id} disabled={!arrangement} aria-pressed={songId===item.id} onClick={()=>chooseSong(item)}><span><strong>{item.title}</strong><small>{arrangement?.adapted?'Adapted to your recorded keys':arrangement?item.detail:'Finish recording your keys'}</small></span>{songId===item.id&&<Check weight="bold" size={16}/>}</button>;})}
          </div>:<div className="kalimba-settings-content">
            <button className="kalimba-settings-edit" disabled={!loaded} onClick={()=>editKeys(false)}><span><PencilSimple weight="bold" size={16}/> Edit keys</span><span>{keys.length}/9 recorded</span></button>
            {complete&&<div className="kalimba-settings-group">
              <label>Practice mode<select value={mode} onChange={event=>setMode(event.target.value)}><option value="wait">Wait for me</option><option value="time">Keep time</option></select></label>
              <label>Tempo <span>{tempo} BPM</span><input aria-label="Tempo" type="range" min="35" max="140" value={tempo} onChange={event=>setTempo(Number(event.target.value))}/></label>
              <label className="kalimba-check-label">Loop song<input type="checkbox" checked={loop} onChange={event=>setLoop(event.target.checked)}/></label>
            </div>}
            <div className="kalimba-settings-group">
              <label className="kalimba-check-label"><span className="kalimba-check-text">Capture mode<small>Records raw audio while you play so accuracy can be tested later.</small></span><input type="checkbox" checked={captureOn} onChange={event=>setCaptureOn(event.target.checked)}/></label>
            </div>
            <div className="kalimba-settings-group kalimba-storage-actions">
              <button onClick={backup} disabled={!keys.length||saving}><DownloadSimple weight="bold" size={16}/> Download backup</button>
              <button onClick={()=>fileInput.current?.click()} disabled={saving}><UploadSimple weight="bold" size={16}/> Restore backup</button>
              <input ref={fileInput} type="file" accept="application/json,.json" hidden onChange={restore}/>
              <button onClick={()=>editKeys(true)} disabled={!loaded}><ArrowCounterClockwise weight="bold" size={16}/> Record all keys again</button>
            </div>
            <p className="kalimba-storage-note">Saved in this browser. A backup keeps a copy if website data is cleared. Restoring replaces the saved instrument.</p>
          </div>}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  </main>;
}
