"""Builds the sound set for Flock in Flight into public/sounds/flock/.

  python3 scripts/flock/build_sounds.py

Recordings are CC0 field recordings found through Openverse (hosted by
Freesound); each is cut around its loudest moment and levelled with ffmpeg.
Designed cues (whoosh, chime, hit) are rendered from the earshot sound bank
(MIT, https://github.com/Leonxlnx/earshot), which needs `uvx`.
"""
import array, os, subprocess, sys, tempfile, urllib.request

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "../..")
OUT = os.path.join(ROOT, "public/sounds/flock")
CDN = "https://cdn.freesound.org/previews/"

# name: (freesound preview, title, kind, lead-in before the peak, length, fade out)
RECORDINGS = {
    "wind": ("181/181250_499617-hq.mp3", "a gentle breeze, wind 1", "bed", 15, 26, 0),
    "rain": ("321/321885_4458028-hq.mp3", "Steady Rainstorm", "bed", 3, 24, 0),
    "meadow": ("440/440807_8523759-hq.mp3", "Meadow.wav", "bed", 8, 26, 0),
    "thunder": ("672/672776_1357949-hq.mp3", "Thunder Clap", "shot", 0.2, 7, 3),
    "jet": ("721/721250_5829168-hq.mp3", "Jet Flyby", "shot", 4.5, 8.5, 2.5),
    "prop": ("648/648720_2397507-hq.mp3", "Bi-plane flyby.wav", "shot", 4, 8, 2.5),
    "hawk": ("582/582183_723384-hq.mp3", "hawk.wav", "shot", 0.3, 1.8, 0.4),
    "shot": ("473/473846_6142149-hq.mp3", "Shotgun Shot 03.wav", "shot", 0.04, 1.7, 1.0),
    "boom": ("275/275196_4838986-hq.mp3", "distant explosion.wav", "shot", 0.15, 5.5, 3),
    "call": ("548/548491_2762515-hq.mp3", "Crane bird calling.wav", "shot", 0.5, 3.2, 1.2),
}
# name: (freesound preview, title). Whole pieces, kept in stereo. Chosen by ear
# with `earshot rank` from the CC0 music Openverse returned.
MUSIC = {
    "music_piano": ("572/572447_10713160-hq.mp3", "Frozen Ripples"),
    "music_guitar": ("449/449812_1696610-hq.mp3", "Acoustic Guitar and Keys - Plains Soundtrack"),
}
# name: (earshot bank id, extra arguments)
DESIGNED = {
    "dive": ("whoosh_big/gust", []),
    "join": ("pluck/kalimba_ring", ["--pitch", "D5"]),
    "hit": ("cut_hit/air", []),
    "over": ("pluck/kalimba_soft", ["--pitch", "D4"]),
}


def run(*args):
    subprocess.run(args, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def loudest(path):
    """Seconds into the file where a 0.2 s window is loudest."""
    raw = subprocess.run(["ffmpeg", "-v", "quiet", "-i", path, "-ac", "1", "-ar", "8000", "-f", "s16le", "-"], check=True, capture_output=True).stdout
    pcm = array.array("h")
    pcm.frombytes(raw[: len(raw) // 2 * 2])
    win, best, at = 1600, -1, 0
    for i in range(0, max(1, len(pcm) - win), 400):
        e = sum(v * v for v in pcm[i:i + win])
        if e > best:
            best, at = e, i
    return at / 8000


def encode(src, name, start, length, fade_out):
    fades = "afade=t=in:d=0.02" + (f",afade=t=out:st={max(0, length - fade_out)}:d={fade_out}" if fade_out else "")
    run("ffmpeg", "-y", "-ss", f"{max(0, start):.3f}", "-t", str(length), "-i", src, "-ac", "1", "-ar", "44100",
        "-af", f"{fades},loudnorm=I=-20:TP=-3", "-codec:a", "libmp3lame", "-q:a", "5", os.path.join(OUT, name + ".mp3"))


os.makedirs(OUT, exist_ok=True)
with tempfile.TemporaryDirectory() as tmp:
    for name, (path, title, kind, lead, length, fade) in RECORDINGS.items():
        src = os.path.join(tmp, name + ".mp3")
        req = urllib.request.Request(CDN + path, headers={"User-Agent": "flock-in-flight-sound-build"})
        with urllib.request.urlopen(req, timeout=60) as r, open(src, "wb") as f:
            f.write(r.read())
        start = lead if kind == "bed" else loudest(src) - lead
        encode(src, name, start, length, fade)
        print(f"{name:8} {title} (from {max(0, start):.1f}s)")
    for name, (path, title) in MUSIC.items():
        src = os.path.join(tmp, name + ".mp3")
        req = urllib.request.Request(CDN + path, headers={"User-Agent": "flock-in-flight-sound-build"})
        with urllib.request.urlopen(req, timeout=90) as r, open(src, "wb") as f:
            f.write(r.read())
        run("ffmpeg", "-y", "-i", src, "-ac", "2", "-ar", "44100", "-af", "loudnorm=I=-22:TP=-3", "-codec:a", "libmp3lame", "-q:a", "5",
            os.path.join(OUT, name + ".mp3"))
        print(f"{name:8} {title}")
    for name, (sound, extra) in DESIGNED.items():
        wav = os.path.join(tmp, name + ".wav")
        try:
            run("uvx", "--python", "3.12", "--from", "git+https://github.com/Leonxlnx/earshot", "earshot", "sfx", "render", sound, "-o", wav, *extra)
        except Exception as error:
            sys.exit(f"earshot render failed for {sound}: {error}")
        run("ffmpeg", "-y", "-i", wav, "-ac", "1", "-ar", "44100", "-codec:a", "libmp3lame", "-q:a", "4", os.path.join(OUT, name + ".mp3"))
        print(f"{name:8} earshot {sound}")

with open(os.path.join(OUT, "CREDITS.md"), "w") as f:
    f.write("# Flock in Flight sound credits\n\nField recordings, CC0, from Freesound via Openverse:\n\n")
    for name, (path, title, *_rest) in RECORDINGS.items():
        f.write(f"- `{name}.mp3`: \"{title}\", https://freesound.org/s/{path.split('/')[1].split('_')[0]}/\n")
    f.write("\nMusic, CC0, from Freesound via Openverse:\n\n")
    for name, (path, title) in MUSIC.items():
        f.write(f"- `{name}.mp3`: \"{title}\", https://freesound.org/s/{path.split('/')[1].split('_')[0]}/\n")
    f.write("\nDesigned cues rendered from the earshot sound bank (MIT, https://github.com/Leonxlnx/earshot):\n\n")
    for name, (sound, _extra) in DESIGNED.items():
        f.write(f"- `{name}.mp3`: `{sound}`\n")
