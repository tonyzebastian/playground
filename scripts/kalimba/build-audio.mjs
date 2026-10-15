import {copyFile,mkdir} from 'node:fs/promises';
const target=new URL('../../public/kalimba-audio/',import.meta.url);
await mkdir(target,{recursive:true});
for(const name of ['analysis','listening','pitch'])await copyFile(new URL(`../../src/features/kalimba/${name}.mjs`,import.meta.url),new URL(`${name}.mjs`,target));
