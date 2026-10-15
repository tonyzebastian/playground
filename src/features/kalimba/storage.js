import { assertUniqueKey } from './calibration.mjs';
const DATABASE='kalimba-local-v1';
function openDatabase(){
  return new Promise((resolve,reject)=>{
    const request=indexedDB.open(DATABASE,1);
    request.onupgradeneeded=()=>request.result.createObjectStore('keys',{keyPath:'id'});
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error);
  });
}
async function transaction(mode,action){
  const db=await openDatabase();
  try{return await new Promise((resolve,reject)=>{
    const tx=db.transaction('keys',mode);const request=action(tx.objectStore('keys'));
    tx.oncomplete=()=>resolve(request.result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('Storage interrupted.'));
  });}finally{db.close();}
}
export const loadKeys=()=>transaction('readonly',store=>store.getAll());
export const saveKey=key=>transaction('readwrite',store=>store.put(key));
export const saveAllKeys=async keys=>{
  const db=await openDatabase();
  try{await new Promise((resolve,reject)=>{
    const tx=db.transaction('keys','readwrite');const store=tx.objectStore('keys');
    store.clear();keys.forEach(key=>store.put(key));
    tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
  });}finally{db.close();}
};
export async function exportKeys(keys){
  const data=await Promise.all(keys.map(async key=>({...key,blob:undefined,audio:key.blob?await new Promise((resolve,reject)=>{
    const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(reader.error);reader.readAsDataURL(key.blob);
  }):null})));
  return new Blob([JSON.stringify({version:1,keys:data})],{type:'application/json'});
}
export async function importKeys(file){
  if(file.size>20*1024*1024) throw new Error('Choose a kalimba backup smaller than 20 MB.');
  const data=JSON.parse(await file.text());
  if(data.version!==1 || !Array.isArray(data.keys) || data.keys.length>9) throw new Error('This isn’t a kalimba backup.');
  const ids=new Set();
  const keys=await Promise.all(data.keys.map(async key=>{
    if(!Number.isInteger(key.id)||key.id<0||key.id>8||ids.has(key.id)||!Number.isInteger(key.midi)||key.midi<30||key.midi>110||!(key.frequency>=100&&key.frequency<=2200)) throw new Error('This backup contains invalid keys.');
    ids.add(key.id);
    if(key.audio && !/^data:audio\/(wav|webm|mp4|ogg|mpeg)[;,]/.test(key.audio)) throw new Error('This backup contains unsupported audio.');
    const blob=key.audio?await(await fetch(key.audio)).blob():null;
    const profile=key.profile;
    if(profile&&(!Array.isArray(profile.harmonics)||profile.harmonics.length!==3||!profile.harmonics.every(value=>Number.isFinite(value)&&value>=0&&value<=10)||!Number.isFinite(profile.decayMs)||profile.decayMs<0||profile.decayMs>10000))throw new Error('This backup contains an invalid sound profile.');
    return {id:key.id,midi:key.midi,frequency:key.frequency,blob,profile,recordedAt:key.recordedAt};
  }));
  keys.forEach(key=>assertUniqueKey(key,keys));
  await saveAllKeys(keys);return keys;
}
