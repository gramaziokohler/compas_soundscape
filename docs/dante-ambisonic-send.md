# Ambisonic send → Dante → Holophonix (and Reaper)

The app can stream its spatial scene live as **ambisonics (ACN/SN3D, "AmbiX")** to a multichannel
audio device: **3rd order / 16 channels** (default, for the dome) or **1st order / 4 channels**
(Settings → Rendering → *Send order*) for devices with fewer channels. With Dante Virtual Soundcard (DVS) this
feeds a Holophonix processor (which decodes to the loudspeaker dome) and, optionally, Reaper for
recording. It works from soundisblue.com — no local backend.

Two outputs (Settings → Rendering → *Output*):

| Output | Use it for | Path |
|---|---|---|
| **Audio device** | macOS (DVS is one Core Audio device), BlackHole, any device with enough channels | browser → device |
| **Local ASIO bridge** | **Windows + DVS** (WDM only gives browsers stereo pairs) | browser → `ws://127.0.0.1:8765` → `scripts/ambisonic_bridge` → ASIO |

## 1. The one hard requirement: a single device with enough channels

A browser plays to **one** output device, so that device must expose at least (order+1)²
channels: 16 for 3rd order, 9 for 2nd, 4 for 1st.
The send-device picker (Settings → Rendering) shows each device's channel count
(e.g. `BlackHole 16ch · 16 ch`) and greys out devices that are too small.

| | macOS | Windows |
|---|---|---|
| Dante Virtual Soundcard | ✅ one Core Audio device with all channels (*Audio device*) | ❌ direct: WDM mode exposes **8 separate stereo devices** ("DVS Transmit 1-2", …) · ✅ via the **Local ASIO bridge** (DVS in ASIO mode) |
| Home test without Dante | ✅ BlackHole 16ch (free), 3rd order | ⚠️ Virtual Audio Cable (VAC) tops out at **4 ch** here → **1st order** only |
| Browser | Chrome / Edge ≥ 110 | Chrome / Edge ≥ 110 |

On Windows, DVS cannot carry the 16-ch stream **directly** from a browser (Audinate documents no
way to merge its WDM stereo pairs, and browsers can't open ASIO). Use the **Local ASIO bridge**
(section 3) — or run the show from a Mac with *Audio device*.

Firefox and Safari can't route the app to a chosen device. In Safari you can make the device the
**system default output** and pick "System default" as the send device — card previews will then
also play there.

## 2. Home test (no dome): app → 16-ch virtual device → Reaper → headphones

### 2.1 Install (once)

1. **Reaper** — reaper.fm.
2. **IEM Plug-in Suite** (free, VST3) — plugins.iem.at. Gives BinauralDecoder and EnergyVisualizer.
3. A **16-channel virtual device**:
   - macOS: **BlackHole 16ch** (existential.audio/blackhole) — or DVS (see 2.4).
   - Windows: **Virtual Audio Cable** (vac.muzychenko.net). In *VAC Control Panel*: click the
     *Cable 1* row → *Format range* **NC 1 .. 4**, *SR* 48000 .. 48000 → **Set**. Then *Audio
     properties* → Playback **and** Recording → *Line 1* → Properties → Advanced → default format
     **4 channel, 48000 Hz** (don't open the *Levels* tab). Restart Chrome. Use **Send order =
     1st order · 4 ch** in the app.
4. macOS only — **Audio MIDI Setup → ＋ → Create Aggregate Device**: tick *BlackHole 16ch* and
   *Scarlett 2i2*, set the 2i2 as *Clock Source*, 48 kHz. Name it "Ambi Monitor".

### 2.2 The app (soundisblue.com in Chrome)

1. Settings → **Rendering** → *Send device* → click **Show device names** if names are generic
   (macOS: also allow Chrome under System Settings → Privacy & Security → Microphone).
2. *Send order*: **3rd order** with BlackHole 16ch, **1st order** with VAC.
3. Pick **BlackHole 16ch** (or *Line 1 (Virtual Audio Cable)*). It must show at least the order's
   channel count (`· 16 ch` / `· 4 ch`); devices that are too small are greyed out.
4. Leave *Rotate with listener* on. Don't enable the stream yet.

### 2.3 Reaper

1. **Preferences → Audio → Device**
   - macOS: *Audio system* = **CoreAudio**, *Device* = **Ambi Monitor** (the aggregate).
   - Windows: *Audio system* = **WASAPI**, *Input device* = VAC line, *Output device* =
     Focusrite 2i2. If 16 inputs don't appear, try *WDM Kernel Streaming*.
   - *Request sample rate* **48000**, *block size* 256–512. Enable all inputs in the input range.
2. **Insert → New track**. Click its **Route** button → *Track channels* = **16** (or **4** for
   1st order).
3. Track **record-input** menu → *Input: Multichannel* → **Source 16 channels: 1–16** (1st order:
   *Source 4 channels: 1–4*). On the aggregate these are the BlackHole channels, typically first.
4. **Arm** the track and set **Record monitoring: On** (speaker icon) — you hear it live.
5. Track **FX** (in this order):
   1. *IEM EnergyVisualizer* — Input order **3** (or **1**), normalization **SN3D**.
   2. *IEM BinauralDecoder* — Input order **3** (or **1**), normalization **SN3D**. Outputs on
      channels 1–2.
6. **Master** track stays 2 channels → hardware outputs 1–2 of the 2i2 (on the aggregate: the
   2i2's outputs, after BlackHole's 16).

### 2.4 Go

1. In the app, turn on **Stream ambisonics (Dante / DAW)**. The status line reads
   `Order 3 · 16 ch · ACN/SN3D · listener-rotated · device … ch` (or `Order 1 · 4 ch …`).
2. Press play in the app. You hear the scene binaurally from Reaper on the 2i2; the browser itself
   is silent. Hit Reaper's record to capture the 16-ch AmbiX file.

**Checks:**
- A source straight ahead → equal peaks on track channels 1 (W) and 4 (X).
- A source on your left → EnergyVisualizer hotspot at +90°; turn the camera 90° → it moves to the
  front. Same in Anechoic, IR and Resonance modes.
- *Rotate with listener* off → turning the camera no longer moves the hotspot.
- BottomBar mute → Reaper meters drop to silence.

**Rehearsing the Dante chain on a Mac:** use DVS instead of BlackHole. In Dante Controller route
DVS TX 1–16 → DVS RX 1–16, pick the DVS device in the app, and in Reaper record DVS inputs 1–16
(aggregate DVS + 2i2 as above). DVS needs an active network adapter but no other Dante gear.

## 3. Windows dome show: Local ASIO bridge

The bridge is a small Python helper on the show PC. The browser streams the 16 channels to it over
localhost; it plays them sample-aligned through an ASIO driver and compensates the clock drift
between the browser's audio device and Dante (adaptive resampling, ~40 ms buffer).

### 3.1 Once

1. Python ≥ 3.9 from python.org (not conda — the conda PortAudio has no ASIO).
2. `pip install -r scripts/ambisonic_bridge/requirements.txt` (sounddevice ≥ 0.5.1, numpy, websockets).
3. **Dante Virtual Soundcard → Settings → Audio Interface = ASIO**, 16×16 channels, 48 kHz, then
   start DVS. (In ASIO mode the "DVS Transmit 1-2…" Windows devices disappear — expected.)
4. Dante Controller: DVS **TX 1–16** → Holophonix inputs (HOA input, order 3, ACN/SN3D).

### 3.2 Option A — straight to DVS (lowest latency, no Reaper)

```bash
python scripts/ambisonic_bridge/ambisonic_bridge.py --list
python scripts/ambisonic_bridge/ambisonic_bridge.py --device Dante --record show.wav
```

`--list` must show an `ASIO … 16+ ch … Dante Virtual Soundcard` line. `--record` (optional)
writes a 24-bit 16-ch AmbiX WAV of exactly what was sent. Only one program can own the DVS ASIO
driver, so close Reaper (or set it to another device) in this option.

### 3.3 Option B — through Reaper via ReaRoute (record / monitor / process in Reaper)

1. Reaper → Preferences → Audio → Device: **ASIO**, driver **Dante Virtual Soundcard**, 48 kHz,
   block 256. Preferences → Audio → **ReaRoute**: enable, ≥ 16 channels.
2. Start the bridge into ReaRoute:
   ```bash
   python scripts/ambisonic_bridge/ambisonic_bridge.py --device ReaRoute
   ```
3. New track → *Route* → *Track channels* **16**; uncheck *Master send*; add *Hardware output*
   **Output 1–16** (multichannel, DVS 1–16).
4. Record input → *Input: Multichannel* → **ReaRoute 1–16**; **arm** + **Record monitoring On**.
   Record whenever you like; insert IEM plugins (e.g. EnergyVisualizer) for checks.

Option B adds one Reaper buffer of latency; Reaper must stay open for the dome to play.

### 3.4 In the app

1. Settings → Rendering → *Output* = **Local ASIO bridge**, *Send order* = **3rd order · 16 ch**.
2. Turn on **Stream ambisonics**. Chrome may ask to let soundisblue.com access apps on this
   device (local network access) — **Allow**.
3. The status line shows `… · bridge → Dante Virtual Soundcard … · device 16 ch`. If it shows
   *Bridge not reachable*, the helper isn't running (it retries every 2 s).

The bridge console prints buffer level, drift (ppm) and underruns every 2 s. If you hear dropouts,
restart it with `--target-ms 80`.

## 4. Dome show on macOS (Audio device)

1. DVS: ≥ 16 channels, 48 kHz (also check Audio MIDI Setup).
2. Dante Controller: DVS **TX 1–16** → the Holophonix Dante inputs; optionally also → DVS
   **RX 1–16** for Reaper (a TX channel can feed several receivers).
3. Holophonix: an **external Ambisonics (HOA) input** — order 3, ACN, SN3D (AmbiX) — on those 16
   inputs. Check your version/licence supports decoding an external HOA stream. With
   *Rotate with listener* on, the dome's front is what the 3D camera looks at.
4. App: send device = DVS, stream on. Reaper (optional) records exactly as in 2.3, from DVS.

## 5. Behaviour reference

- While the send is on the browser plays **no binaural** (one output per audio engine). The
  BottomBar **master volume / mute** controls the send level. Card previews keep the regular
  output device.
- All three render modes are sent. While the send is on, **Anechoic** is encoded at the send order
  (raised from its usual first order) so all 16 channels carry signal; **Resonance** is always
  third order. **Ambisonic IR** keeps the IR's order — a first-order IR fills channels 1–4 only (the
  panel says so), and the rest stay silent so the 16-ch patch never changes.
- If the device drops below 16 channels or disappears, the send turns itself off and binaural
  playback resumes.
