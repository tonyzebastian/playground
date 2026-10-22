'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Dialog } from '@base-ui/react/dialog';
import { Check, CaretDown, DownloadSimple, Microphone, Pause, ArrowCounterClockwise, SlidersHorizontal, UploadSimple, SpeakerHigh, X, PencilSimple } from '@phosphor-icons/react';
import KalimbaInstrument from './KalimbaInstrument';
import RecordingPanel from './RecordingPanel';
import { KalimbaAudio } from './audio';
import { loadKeys,saveKey,exportKeys,importKeys } from './storage';
import { SONGS,noteName,nearestKey,playableSong } from './music.mjs';
import { initialSong, nextSetupKey } from './flow.mjs';
import { analyseCalibration, assertUniqueKey, toneProfile, calibrationMatch } from './calibration.mjs';

const PREFERENCES='kalimba-preferences-v2';
const preferences=()=>{try{return JSON.parse(localStorage.getItem(PREFERENCES)||'{}');}catch{return {};}};
const decorate=keys=>keys.map(key=>({...key,label:noteName(key.midi)}));
const EMPTY_SEQUENCE=[];

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
  const [hits,setHits]=useState(0),[finished,setFinished]=useState(false);
  const audio=useRef(null),timer=useRef(null),captureTimer=useRef(null),captureFrames=useRef([]),capturePlucks=useRef([]),captureTones=useRef([]),captureFinishing=useRef(false),captureReady=useRef(false),onHear=useRef(()=>{});
  const epoch=useRef(0),alive=useRef(true),recordToken=useRef(0),finishedRef=useRef(false);
  const fileInput=useRef(null),root=useRef(null),recordFocus=useRef(null);
  const timedHit=useRef(null);
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
    setListening(false);setPending(false);setRecording(false);setPlaying(false);setRunning(false);setSignal(0);
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

  useEffect(()=>{
    if(!loaded||!complete)return;
    try{localStorage.setItem(PREFERENCES,JSON.stringify({songId:songId??'free',tempo,mode,loop}));}catch{}
  },[loaded,complete,songId,tempo,mode,loop]);
  function chooseSong(next){
    stop();setSongId(next?.id??null);setTempo(next?.bpm??76);setStep(0);setHits(0);
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
      setSignal(Math.min(1,result.rms*12));
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
    stop();setError('');setMessage('');setPending(true);finishedRef.current=false;
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
        setSignal(Math.min(1,result.rms*12));
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
            captureTimer.current=setTimeout(()=>finishRecording(token),250);
          }
        }
      });
      if(!started||token!==recordToken.current)return;
      engine().startRecording();setRecording(true);
      captureTimer.current=setTimeout(()=>finishRecording(token),22000);
    }catch(err){if(token===recordToken.current){audio.current?.stopListening();setError(err.message);}}
    finally{if(token===recordToken.current)setPending(false);}
  }
  async function finishRecording(token=recordToken.current){
    if(token!==recordToken.current||captureFinishing.current)return;
    captureFinishing.current=true;clearTimeout(captureTimer.current);setRecording(false);setPending(true);
    try{
      const blob=await engine().finishRecording();audio.current?.stopListening();setSignal(0);
      if(token!==recordToken.current)return;
      if(!blob?.size)throw new Error('The recording was empty. Please try again.');
      const match=analyseCalibration(captureFrames.current,capturePlucks.current);
      const {midi,frequency}=match;
      assertUniqueKey({id:selected,midi,frequency},keys);
      const chosen=capturePlucks.current[match.indexes[0]];
      const following=capturePlucks.current[match.indexes[0]+1];
      const startSeconds=Math.max(0,(chosen.time-120)/1000);
      const duration=following?Math.min(1.5,(following.time-chosen.time)/1000-.05):1.5;
      const sample=await engine().sample(blob,{startSeconds,duration});
      if(token!==recordToken.current)return;
      setCandidate({id:selected,midi,frequency,match:match.match,profile:toneProfile(captureTones.current.filter(frame=>Math.abs(1200*Math.log2(frame.frequency/frequency))<=85)),blob:sample,recordedAt:new Date().toISOString()});
      setMessage('');
    }catch(err){audio.current?.stopListening();if(token===recordToken.current)setError(err.message);}
    finally{if(token===recordToken.current)setPending(false);}
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
  async function demonstrate(){
    if(!sequence.length)return;
    stop();setError('');setPlaying(true);setFinished(false);finishedRef.current=false;setStep(0);setHits(0);
    const token=epoch.current;
    try{
      await engine().unlock();
      const playAt=async index=>{
        if(token!==epoch.current||!alive.current)return;
        if(index>=sequence.length){setPlaying(false);setStep(0);return;}
        const item=sequence[index];setStep(index);animate(item.key);
        try{await engine().play(displayKeys.find(k=>k.id===item.key));}catch(err){setError(err.message);setPlaying(false);return;}
        if(token!==epoch.current){audio.current?.stopPlayback();return;}
        timer.current=setTimeout(()=>playAt(index+1),item.beats*60000/tempo);
      };
      await playAt(0);
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
  const target=editing?selected:song&&!finished?sequence[step]?.key:undefined;
  const upcoming=!editing&&song&&!finished?sequence[step+1]?.key:undefined;
  const progress=sequence.length?(finished?100:step/sequence.length*100):0;

  return <main ref={root} className="kalimba-app" data-editing={editing||undefined}>
    <header className="kalimba-header">
      <span className="kalimba-wordmark">Kalimba</span>
      <div className="kalimba-header-right">
        {editing&&complete&&<button className="kalimba-done" onClick={finishEditing} disabled={busy}>Done <Check weight="bold" size={14}/></button>}
        <button className="kalimba-header-settings" aria-label="Instrument settings" onClick={()=>openSheet('settings')} disabled={busy}><SlidersHorizontal weight="bold" size={18}/></button>
      </div>
    </header>

    <div className="kalimba-song-selection">
      {!loaded?<span className="kalimba-top-hint">Opening your instrument…</span>:editing?<span className="kalimba-top-hint">{editing==='setup'?`Tap a key to record · ${keys.length}/9 saved`:'Tap a key to change its sound.'}</span>:<button className="kalimba-song-trigger" onClick={()=>openSheet('songs')} aria-label="Choose song or free play"><span>{song?.title??'Free play'}{mapped?.adapted&&<small>Adapted to your keys</small>}</span><CaretDown weight="bold" size={15}/></button>}
    </div>

    <div className="kalimba-workspace">
    <div className="kalimba-device">
      <KalimbaInstrument art={art} keys={keys} active={active} target={target} upcoming={upcoming} onKey={tapKey} editing={!!editing} disabled={!loaded||busy}/>



      {!editing&&loaded&&<div className="kalimba-device-playback">
        {song&&<button className="kalimba-device-small" aria-label={playing?'Stop melody':'Hear melody'} onClick={()=>playing?stop():demonstrate()} disabled={pending}><SpeakerHigh weight="bold" size={18}/></button>}
        <button className="kalimba-device-start" onClick={()=>listening||pending?stop():startListening(!!song)} aria-label={pending?'Cancel microphone request':listening?'Pause listening':song?'Start song practice':'Start free play'}>
          {listening?<Pause weight="bold" size={21}/>:pending?<X weight="bold" size={20}/>:<Microphone weight="bold" size={21}/>}
        </button>
        {song&&<button className="kalimba-device-small" aria-label="Restart song" onClick={()=>{stop();setStep(0);setHits(0);setFinished(false);finishedRef.current=false;setMessage('');}} disabled={pending}><ArrowCounterClockwise weight="bold" size={17}/></button>}
        <span className="kalimba-device-caption">{pending?'Connecting…':listening?'Listening':finished?'Play again':song?'Start practice':'Start listening'}</span>
      </div>}

    </div>


    </div>

    <div className="kalimba-bottom-status">
      {error&&!editing?<p role="alert" className="kalimba-error">{error}</p>:<p role="status">{message||(editing?'':finished?'Finished. Nicely played.':listening?(song?`Key ${(target??0)+1} next`:heard?`Heard ${heard}`:'Play any key.'):'Tap a key to hear it.')}</p>}
      {!editing&&song&&<div className="kalimba-song-progress" role="progressbar" aria-label="Song progress" aria-valuenow={Math.round(progress)} aria-valuemin={0} aria-valuemax={100}><span style={{width:`${progress}%`}}/></div>}
      {(recording||listening)&&<div className="kalimba-level" aria-hidden="true"><span style={{width:`${signal*100}%`}}/></div>}
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
