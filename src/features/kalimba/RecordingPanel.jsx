'use client';

import { Check, DownloadSimple, Microphone, ArrowCounterClockwise, SpeakerHigh, X } from '@phosphor-icons/react';
import {noteName} from './music.mjs';

export default function RecordingPanel({selected,setup,keys,currentKey,candidate,recording,pending,saving,signal,count,hint,match,error,onNote,onRecord,onFinish,onSave,onReplay,onCancel,capture=false,onSaveCapture=null}){
  const busy=recording||pending||saving;
  const slots=match?.accepted?count:count>=3?6:3;
  return <div className="kalimba-recording-panel">
    <div className="kalimba-recording-meta"><span>{keys.length}/9 keys saved</span>
      {currentKey?<select aria-label={`Note for key ${selected+1}`} disabled={busy} value={currentKey.midi} onChange={event=>onNote(Number(event.target.value))}>
        {Array.from({length:73},(_,i)=>i+36).map(midi=><option key={midi} value={midi}>{noteName(midi)}</option>)}
      </select>:<span>Not recorded</span>}
    </div>
    <div className="kalimba-capture-wave" data-listening={recording||undefined} data-captured={count>0||undefined} style={{'--wave-level':Math.max(.12,signal)}} aria-hidden="true">
      <div key={count} className={count?'kalimba-wave-pulse':''}/>
      {Array.from({length:25},(_,i)=><span key={i} style={{'--bar-height':`${12+Math.sin(i*.73)**2*38}px`,'--bar-delay':`${i*-.065}s`}}/>)}
    </div>
    <ol className="kalimba-capture-slots" aria-label="Captured plucks">
      {Array.from({length:slots},(_,i)=>{
        const captured=i<count,good=match?.accepted&&match.indexes.includes(i);
        return <li key={i} data-captured={captured||undefined} data-good={good||undefined}>
          <span>{captured?<Check weight="bold" size={16}/>:i+1}</span>
          <small>{captured&&match?.similarities.length>1?`${match.similarities[i]}%`:'—'}</small>
        </li>;
      })}
    </ol>
    <div className="kalimba-capture-feedback" role="status" aria-live="polite">
      <strong>{candidate?'Good match · Ready to save':saving?'Saving your key…':pending?'Preparing…':recording?hint:count>=6?'Let’s try a fresh set':currentKey?'Your saved sound':'Three gentle plucks'}</strong>
      <p>{candidate?Number.isFinite(candidate.match)?`${candidate.match}% consistency across the best three plucks.`:'Updated note. Ready to save.':recording?(match?.match!==null&&match?.match!==undefined?`${match.match}% pitch consistency · ${count} captured`:'Let the sound settle between plucks.'):count>=6?'Keep the phone nearby and pluck this key only.':currentKey?'Listen to your key, or record it again.':'We’ll keep the good plucks if one sounds different.'}</p>
    </div>
    {error&&<p role="alert" className="kalimba-recording-error">{error}</p>}
    <div className="kalimba-recording-actions">
      {recording?<button className="kalimba-primary" onClick={onFinish} disabled={count<3&&!capture}><Check weight="bold" size={16}/> Finish</button>:candidate?<button className="kalimba-primary" onClick={onSave} disabled={busy}><Check weight="bold" size={16}/> {setup?'Save & next':'Save'}</button>:<button className="kalimba-primary" onClick={onRecord} disabled={busy}><Microphone weight="bold" size={16}/>{count?'Try again':currentKey?'Re-record':'Start recording'}</button>}
      {currentKey&&!busy&&<button aria-label={`Replay key ${selected+1}`} onClick={onReplay}><SpeakerHigh weight="bold" size={18}/></button>}
      {candidate&&!busy&&<button aria-label="Retry recording" onClick={onRecord}><ArrowCounterClockwise weight="bold" size={17}/></button>}
      {(pending||recording)&&<button aria-label="Cancel recording" onClick={onCancel}><X weight="bold" size={18}/></button>}
    </div>
    {capture&&<p className="kalimba-match-caption kalimba-capture-note">Capture mode: this recording’s raw audio is kept for testing.{onSaveCapture&&!busy&&<button onClick={onSaveCapture}><DownloadSimple weight="bold" size={13}/> Save capture</button>}</p>}
    {count>1&&<p className="kalimba-match-caption">Match compares pitch consistency, not loudness.</p>}
  </div>;
}
