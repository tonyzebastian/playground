'use client';

export default function KalimbaInstrument({art,keys,active,target,upcoming,onKey,editing,disabled}){
  return <div className="kalimba-drawing">
    <svg viewBox={`0 0 ${art.width} ${art.height}`} aria-label="Nine-key kalimba. Keys 1 to 9 from left to right.">
      <g dangerouslySetInnerHTML={{__html:art.base}}/>
      {editing&&Number.isInteger(target)&&<path className="kalimba-key-leader" aria-hidden="true"
        d={`M${art.keys[target].tip[0]+(target<4?-15:15)} ${art.keys[target].tip[1]}H${target<4?0:art.width}`}/>}
      {art.keys.map(key=>{
        const recorded=keys.find(k=>k.id===key.id);
        return <g key={key.id} role="button" tabIndex={disabled?-1:0} aria-disabled={disabled||undefined}
          aria-label={`Key ${key.id+1}${recorded?`, ${recorded.label}`:', not recorded'}`}
          className={`kalimba-tine ${target===key.id?'is-target':''} ${upcoming===key.id?'is-upcoming':''}`}
          onClick={()=>{if(!disabled)onKey(key.id);}} onKeyDown={event=>{if(!disabled&&(event.key==='Enter'||event.key===' ')){event.preventDefault();onKey(key.id);}}}>
          <g dangerouslySetInnerHTML={{__html:key.tail}}/>
          <g key={active?.id===key.id?active.serial:'rest'} className={active?.id===key.id?'kalimba-vibration':''}
            style={{transformOrigin:`${key.origin[0]}px ${key.origin[1]}px`}}
          ><g dangerouslySetInnerHTML={{__html:key.blade}}/>
            <text x={key.tip[0]} y={key.tip[1]-7} textAnchor="middle" className="kalimba-key-number" pointerEvents="none">{key.id+1}</text>
          </g>
          <path d={key.hit} fill="transparent" className="kalimba-hit"/>
          {editing&&recorded&&target!==key.id&&<circle cx={key.marker[0]} cy={key.marker[1]} r="3" className="kalimba-saved-dot"/>}
        </g>;
      })}
      <g pointerEvents="none" dangerouslySetInnerHTML={{__html:art.bridge}}/>
    </svg>
  </div>;
}
