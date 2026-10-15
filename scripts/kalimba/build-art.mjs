// Face-on construction follows the photographed body, tapered steel tines,
// staggered tails, round retaining bar, thin fulcrum, and tapered painted face.
import { writeFileSync } from 'node:fs';
const ends=[430,466,493,548,585,507,476,441,404];
const tails=[100,104,96,83,116,85,96,70,77];
const body='M260 18A243 352 0 1 1 260 722A243 352 0 1 1 260 18Z';
// The painted face is a broad arched mask that tapers into a rounded chin.
const face='M260 340C183 340 109 361 60 392C43 474 104 598 162 659C191 685 225 697 260 697C295 697 329 685 358 659C416 598 477 474 460 392C411 361 337 340 260 340Z';
const faceInset='M260 351C187 351 118 371 72 399C56 476 115 597 170 651C196 676 228 686 260 686C292 686 324 676 350 651C405 597 464 476 448 399C402 371 333 351 260 351Z';
const base=`<defs>
<linearGradient id="kalimba-wood" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#f0eee7"/><stop offset="1" stop-color="#e6e3d9"/></linearGradient>
<linearGradient id="kalimba-metal" x1="0" y1="0" x2="1" y2="0"><stop stop-color="#c5c8bf"/><stop offset=".32" stop-color="#fafaf7"/><stop offset=".7" stop-color="#eeefea"/><stop offset="1" stop-color="#c5c8bf"/></linearGradient>
<linearGradient id="kalimba-bar" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#f7f8f2"/><stop offset=".38" stop-color="#eeefea"/><stop offset="1" stop-color="#b5bcb0"/></linearGradient>
<radialGradient id="kalimba-hole-depth" cx=".52" cy=".85" r=".9"><stop stop-color="#b6bbab"/><stop offset=".56" stop-color="#939f83"/><stop offset="1" stop-color="#758367"/></radialGradient>
<linearGradient id="kalimba-rim" x1="0" y1="0" x2=".8" y2="1"><stop stop-color="#f1f0e8"/><stop offset=".55" stop-color="#dedecf"/><stop offset="1" stop-color="#bdbeaf"/></linearGradient>
<clipPath id="kalimba-opening"><ellipse cx="260" cy="574" rx="40" ry="45"/></clipPath>
</defs>
<path d="${body}" fill="url(#kalimba-wood)" stroke="#b5b4a9" stroke-width="1.2"/>
<path d="${body}" transform="translate(260 370) scale(.975) translate(-260 -370)" fill="none" stroke="#d3d0c5"/>
<path d="${face}" fill="#f1f0e8" stroke="#c5c7b9" stroke-width="1.2"/>
<path d="${faceInset}" fill="#d9dacf"/>
<path d="M77 460Q136 414 195 460Q136 500 77 460Z M325 460Q384 414 443 460Q384 500 325 460Z" fill="#f1f0e8"/>
<ellipse cx="137" cy="459" rx="16" ry="22" fill="#aeb4a2"/><ellipse cx="383" cy="459" rx="16" ry="22" fill="#aeb4a2"/>
<ellipse cx="260" cy="574" rx="55" ry="60" fill="url(#kalimba-rim)" stroke="#bdbeaf" stroke-width="1.2"/>
<ellipse cx="260" cy="574" rx="49" ry="54" fill="url(#kalimba-wood)" stroke="#d6d7c9" stroke-width="1"/>
<ellipse cx="260" cy="574" rx="40" ry="45" fill="url(#kalimba-hole-depth)" stroke="#929d83" stroke-width="1.4"/>
<g clip-path="url(#kalimba-opening)">
<ellipse cx="260" cy="582" rx="33" ry="36" fill="#8b987b" opacity=".45"/>
</g>
<path d="M214 597Q260 636 306 597" fill="none" stroke="#f1f0e8" stroke-width="1.8"/>
<rect x="48" y="183" width="424" height="9" rx="4.5" fill="#aeb3a5"/>
<rect x="38" y="279" width="444" height="3" rx="1.5" fill="url(#kalimba-metal)" stroke="#a9afa0" stroke-width=".6"/>`;
const keys=ends.map((end,id)=>{
 const x=84+id*44,top=tails[id],slope=(id-4)*.045;
 // Each tine is straight, but fans away from the centre as it extends down.
 const at=y=>Number((x+slope*(y-280)).toFixed(2));
 return {id,tip:[at(end),end],origin:[at(281),281],marker:[at(119),119],
 tail:`<path class="kalimba-tail" d="M${at(top)-7} ${top}Q${at(top)} ${top-4} ${at(top)+7} ${top}L${at(top+30)+3.5} ${top+30}L${at(282)+3.5} 282H${at(282)-3.5}L${at(top+30)-3.5} ${top+30}Z" fill="url(#kalimba-metal)" stroke="#a9afa0" stroke-width=".8"/>`,
 blade:`<path class="kalimba-blade" d="M${at(280)-3.5} 280H${at(280)+3.5}L${at(end-37)+3.5} ${end-37}Q${at(end-20)+3.5} ${end-20} ${at(end-10)+12} ${end-10}Q${at(end+2)+15} ${end+2} ${at(end+3)} ${end+3}Q${at(end+2)-15} ${end+2} ${at(end-10)-12} ${end-10}Q${at(end-20)-3.5} ${end-20} ${at(end-37)-3.5} ${end-37}Z" fill="url(#kalimba-metal)" stroke="#a6ad9c" stroke-width=".9"/>`,
 hit:`M${at(top-4)-14} ${top-4}H${at(top-4)+14}L${at(280)+19} 280L${at(end+6)+22} ${end+6}H${at(end+6)-22}L${at(280)-19} 280Z`};
});
const bridge=`<ellipse cx="44" cy="217" rx="8" ry="17" fill="url(#kalimba-metal)" stroke="#a9afa0"/><ellipse cx="476" cy="217" rx="8" ry="17" fill="url(#kalimba-metal)" stroke="#a9afa0"/>
<rect x="43" y="206" width="434" height="22" rx="11" fill="url(#kalimba-bar)" stroke="#a9afa0"/>
${[44,188,332,475].map(x=>`<ellipse cx="${x}" cy="217" rx="5" ry="17" fill="url(#kalimba-metal)" stroke="#a9afa0" stroke-width=".9"/>`).join('')}`;
writeFileSync(new URL('../../src/features/kalimba/instrument-art.json',import.meta.url),JSON.stringify({width:520,height:740,base,keys,bridge}));
console.log('Generated photographed front-face proportions.');
