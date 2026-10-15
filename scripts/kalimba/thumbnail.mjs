import sharp from 'sharp';
import { readFileSync } from 'node:fs';
const art=JSON.parse(readFileSync(new URL('../../src/features/kalimba/instrument-art.json',import.meta.url),'utf8'));
const svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${art.width} ${art.height}"><rect width="${art.width}" height="${art.height}" fill="#fafaf9"/>${art.base}${art.keys.map(k=>k.tail+k.blade+`<text x="${k.tip[0]}" y="${k.tip[1]-7}" text-anchor="middle" font-size="16" fill="#747e69">${k.id+1}</text>`).join('')}${art.bridge}</svg>`;
await sharp(Buffer.from(svg)).resize(400,570).png().toFile(new URL('../../public/thumbnails/kalimba.png',import.meta.url).pathname);
