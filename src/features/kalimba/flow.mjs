import { SONGS, mapSong } from './music.mjs';
export const firstMissingKey=keys=>Array.from({length:9},(_,id)=>id).find(id=>!keys.some(key=>key.id===id))??null;
export function initialSong(keys,preferred){
  const previous=SONGS.find(song=>song.id===preferred);
  if(previous&&mapSong(previous,keys))return previous;
  if(preferred==='free')return null;
  return SONGS.find(song=>mapSong(song,keys))??null;
}
export const nextSetupKey=(keys,current,recordAll=false)=>recordAll?(current<8?current+1:null):firstMissingKey(keys);
