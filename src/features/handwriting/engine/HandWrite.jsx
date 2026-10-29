"use client";

import React, { useId, useMemo } from "react";
import { bezier, interpolate } from "./anim";
import { HAND_FONTS } from "./fonts";
import { buildTrack, distanceAtTime, layoutWords, makeWobble, ribbon, sampleAt, smoothstep } from "./geometry";
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" };
const penEase = bezier(0.45, 0, 0.55, 1);
// A line of handwriting drawn as one continuous stroke, like a path being
// trimmed open in Figma: the pen sweeps in, forms each letter, runs out
// past the last one into a flourish, wiggles while it sits, and leaves the
// way it came — its start chasing the end — or dissolves.
export const HandWrite = ({ look = "write", morphFrames = 16, words, x, y, align = "left", size, font = "felix", color = "#FFFFFF", weight, speed, tracking, wordGap = 0.9, connect, wordConnect = 0, lead = 0.5, tail = { length: 0.9, drop: 0.12 }, wiggle = 1, boil = 3, texture = 1, exit, shadow = "drop-shadow(0 0 6px rgba(20,12,10,0.55)) drop-shadow(0 3px 10px rgba(20,12,10,0.35))", seed = "hand", frame, }) => {
  const filterId = `hw-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  // A built-in font name, or a font object (for example one converted from an upload).
  const hand = typeof font === "string" ? HAND_FONTS[font] ?? HAND_FONTS.reenieBeanie : font;
  // Real fonts already join their letters; the plotter fonts need help.
  const traced = hand.spacing === "advance";
  const letterGap = tracking ?? (traced ? 0 : 0.05);
  const joins = connect ?? (traced ? 1 : 0.55);
  const texts = words.map((w) => w.text).join("\u0000");
  const layout = useMemo(() => layoutWords(hand, texts.split("\u0000"), size, letterGap, wordGap), [hand, texts, size, letterGap, wordGap]);
  const track = useMemo(() => buildTrack(layout.words, size, { connect: joins, wordConnect, lead, tail }), [layout, size, joins, wordConnect, lead, tail.length, tail.drop]);
  const pen = speed ?? size * 1.1;
  const fast = pen * 2.5;
  // When the pen reaches each point: on time for each spoken word, never
  // faster than `fast` between words, at `pen` speed through a word.
  const keys = useMemo(() => {
    const f = [];
    const d = [];
    const add = (frameAt, dist) => {
      const last = f.length ? f[f.length - 1] : -Infinity;
      f.push(Math.max(frameAt, last + 0.01));
      d.push(dist);
    };
    const first = track.wordStart[0] ?? 0;
    add(words[0].frame - first / fast, 0);
    track.wordStart.forEach((start, i) => {
      if (i > 0) {
        const prevEnd = track.wordEnd[i - 1];
        const reach = f[f.length - 1] + (start - prevEnd) / fast;
        add(Math.max(words[i].frame, reach), start);
      }
      else {
        add(words[0].frame, start);
      }
      add(f[f.length - 1] + (track.wordEnd[i] - start) / pen, track.wordEnd[i]);
    });
    add(f[f.length - 1] + (track.duration - track.textEnd) / (pen * 1.1), track.duration);
    return { f, d };
  }, [track, words, pen, fast]);
  if (look === "blob") {
    return (<BlobWords layout={layout} words={words} frame={frame} x={x} y={y} align={align} size={size} color={color} stroke={size * (weight ?? hand.stem ?? 0.05)} morphFrames={morphFrames} wiggle={wiggle} boil={boil} texture={texture} exit={exit} shadow={shadow} seed={seed} filterId={filterId}/>);
  }
  if (frame < keys.f[0])
    return null;
  // Keyframes are in pen time; convert to distance along the line.
  const head = distanceAtTime(track, interpolate(frame, keys.f, keys.d, clamp));
  let from = 0;
  let opacity = 1;
  let blur = 0;
  if (exit) {
    if (exit.type === "unwrite") {
      const frames = Math.max(6, track.duration / (exit.speed ?? pen * 2));
      const leave = interpolate(frame, [exit.frame, exit.frame + frames], [0, track.duration], {
        ...clamp,
        easing: penEase,
      });
      if (leave >= track.duration - 0.5)
        return null;
      from = distanceAtTime(track, leave);
    }
    else {
      const p = interpolate(frame, [exit.frame, exit.frame + (exit.frames ?? 14)], [0, 1], clamp);
      if (p >= 1)
        return null;
      opacity = 1 - p;
      blur = p * size * 0.08;
    }
  }
  // While leaving, the pen keeps going to the end of the flourish.
  const to = from > 0 ? Math.max(head, Math.min(track.length, from + track.tailLength + size)) : head;
  const boilStep = Math.floor(frame / boil);
  const offsetAt = makeWobble(seed, boilStep, size * 0.8, size * 0.007 * wiggle);
  const stroke = size * (weight ?? hand.stem ?? 0.05);
  const taper = size * 0.3;
  const tailLen = Math.max(size * 0.1, track.tailLength);
  const pressureA = (boilStep % 7) * 0.13;
  const d = ribbon(track, from, to, (s) => {
    const ink = sampleAt(track, track.join, s);
    // Lands thin, and the flourish thins out to a point.
    const start = 0.15 + 0.85 * smoothstep(0, taper, s);
    const end = track.tailLength > 0 ? 0.08 + 0.92 * smoothstep(0, tailLen, track.length - s) : 1;
    // The moving tip and the leaving end stay pointed.
    const tip = to < track.length ? 0.1 + 0.9 * smoothstep(0, taper, to - s) : 1;
    const back = from > 0 ? 0.1 + 0.9 * smoothstep(0, taper, s - from) : 1;
    const pressure = 0.88 + 0.24 * Math.sin(s / (size * 0.4) + pressureA);
    return stroke * ink * pressure * start * end * tip * back;
  }, offsetAt);
  if (!d)
    return null;
  const dx = align === "left" ? 0 : align === "right" ? -layout.width : -layout.width / 2;
  return (<svg width={1} height={1} style={{
      position: "absolute",
      left: x + dx,
      top: y,
      overflow: "visible",
      opacity,
      filter: blur > 0 ? `${shadow} blur(${blur.toFixed(2)}px)` : shadow,
    }}>
   {texture > 0 && (<defs>
     <filter id={filterId} x="-10%" y="-60%" width="120%" height="220%">
      <feTurbulence type="fractalNoise" baseFrequency={0.9} numOctaves={2} seed={boilStep % 97} result="n"/>
      <feDisplacementMap in="SourceGraphic" in2="n" scale={size * 0.02 * texture}/>
     </filter>
    </defs>)}
   <path d={d} fill={color} filter={texture > 0 ? `url(#${filterId})` : undefined}/>
  </svg>);
};
const morphEase = bezier(0.2, 0.8, 0.3, 1);
// The "blob" look: each word starts as a drop of ink and pulls itself into
// its letters. Done with a goo filter: the strokes are drawn fat and blurred,
// then the edge is sharpened back up, so nearby ink melts into one shape.
// As the blur and the extra weight go away, the letters separate out.
const BlobWords = ({ layout, words, frame, x, y, align, size, color, stroke, morphFrames, wiggle, boil, texture, exit, shadow, seed, filterId }) => {
  const boilStep = Math.floor(frame / boil);
  const dx = align === "left" ? 0 : align === "right" ? -layout.width : -layout.width / 2;
  const defs = [];
  const groups = [];
  layout.words.forEach((word, wi) => {
    const start = words[wi].frame;
    if (frame < start || word.strokes.length === 0)
      return;
    let p = interpolate(frame, [start, start + morphFrames], [0, 1], { ...clamp, easing: morphEase });
    let opacity = 1;
    if (exit) {
      const at = exit.frame + wi * 2;
      if (exit.type === "unwrite") {
        // Melt back into a blob and shrink away.
        const q = interpolate(frame, [at, at + morphFrames * 0.8], [0, 1], { ...clamp, easing: penEase });
        if (q >= 1)
          return;
        p = Math.min(p, 1 - q);
        opacity = interpolate(q, [0.6, 1], [1, 0], clamp);
      }
      else {
        const q = interpolate(frame, [at, at + (exit.frames ?? 14)], [0, 1], clamp);
        if (q >= 1)
          return;
        opacity = 1 - q;
      }
    }
    opacity *= interpolate(p, [0, 0.15], [0, 1], clamp);
    const melt = 1 - p;
    const blur = size * 0.11 * melt;
    const fat = 1 + 3.2 * melt;
    // The blob grows out of the middle of the word.
    const cx = word.x + word.width / 2;
    const cy = -size * 0.15;
    const scale = 0.35 + 0.65 * p;
    const offsetAt = makeWobble(`${seed}-${wi}`, boilStep, size * 0.8, size * 0.007 * wiggle);
    const d = word.strokes
      .map((st, si) => {
      const pressureA = si * 1.7;
      return ribbon(st, 0, st.length, (s) => {
        const ends = 0.35 + 0.65 * smoothstep(0, Math.min(size * 0.06, st.length * 0.25), Math.min(s, st.length - s));
        const pressure = 0.88 + 0.24 * Math.sin(s / (size * 0.4) + pressureA);
        return stroke * fat * pressure * (melt > 0.02 ? 1 : ends);
      }, offsetAt);
    })
      .join(" ");
    const goo = `${filterId}-goo${wi}`;
    if (melt > 0.01) {
      defs.push(<filter key={goo} id={goo} x="-60%" y="-120%" width="220%" height="340%">
     <feGaussianBlur in="SourceGraphic" stdDeviation={blur.toFixed(2)} result="b"/>
     <feColorMatrix in="b" mode="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 22 -9"/>
    </filter>);
    }
    groups.push(<g key={wi} opacity={opacity} transform={`translate(${cx.toFixed(2)} ${cy.toFixed(2)}) scale(${scale.toFixed(4)}) translate(${(-cx).toFixed(2)} ${(-cy).toFixed(2)})`}>
    <g filter={melt > 0.01 ? `url(#${goo})` : undefined}>
     <path d={d} fill={color}/>
    </g>
   </g>);
  });
  if (groups.length === 0)
    return null;
  return (<svg width={1} height={1} style={{ position: "absolute", left: x + dx, top: y, overflow: "visible", filter: shadow }}>
   <defs>
    {texture > 0 && (<filter id={filterId} x="-10%" y="-60%" width="120%" height="220%">
      <feTurbulence type="fractalNoise" baseFrequency={0.9} numOctaves={2} seed={boilStep % 97} result="n"/>
      <feDisplacementMap in="SourceGraphic" in2="n" scale={size * 0.02 * texture}/>
     </filter>)}
    {defs}
   </defs>
   <g filter={texture > 0 ? `url(#${filterId})` : undefined}>{groups}</g>
  </svg>);
};
