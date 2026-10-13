# Ambisonic send → Dante → Holophonix (and Reaper)

The app can stream its spatial scene live as **ambisonics (ACN/SN3D, "AmbiX")** to a multichannel
audio device: **3rd order / 16 channels** (default, for the dome) or **1st order / 4 channels**
(Settings → Rendering → *Send order*) for devices with fewer channels. With Dante Virtual Soundcard (DVS) this
feeds a Holophonix processor (which decodes to the loudspeaker dome) and, optionally, Reaper for
recording. Everything runs in the browser — it works from soundisblue.com, no local backend.

```
App (Chrome) ──16 ch──▶ DVS TX 1–16 ──Dante──▶ Holophonix (HOA input, order 3) ──▶ speakers
                                     └─Dante──▶ DVS RX 1–16 ──▶ Reaper (record / monitor)
```

Reaper is never in the playback path: it only listens, so it adds no latency and the dome keeps
playing if it closes.

## 1. The one hard requirement: a single device with enough channels

A browser plays to **one** output device, so that device must expose at least (order+1)²
channels: 16 for 3rd order, 9 for 2nd, 4 for 1st.
The send-device picker (Settings → Rendering) shows each device's channel count
(e.g. `BlackHole 16ch · 16 ch`) and greys out devices that are too small.

| | macOS | Windows |
|---|---|---|
| Dante Virtual Soundcard | ✅ one Core Audio device with all channels | ❌ WDM mode exposes **8 separate stereo devices** ("DVS Transmit 1-2", "3-4", …); ASIO mode is invisible to browsers |
| Home test without Dante | ✅ BlackHole 16ch (free), 3rd order | ⚠️ Virtual Audio Cable (VAC) tops out at **4 ch** here → **1st order** only |
| Browser | Chrome / Edge ≥ 110 | Chrome / Edge ≥ 110 |

**Run the dome show from a Mac** with DVS. On Windows, DVS cannot carry the 16-ch stream from a
browser (Audinate documents no way to merge its WDM stereo pairs).

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

## 3. Dome show (macOS + DVS)

1. DVS: ≥ 16 channels, 48 kHz (also check Audio MIDI Setup).
2. Dante Controller: DVS **TX 1–16** → the Holophonix Dante inputs; optionally also → DVS
   **RX 1–16** for Reaper (a TX channel can feed several receivers).
3. Holophonix: an **external Ambisonics (HOA) input** — order 3, ACN, SN3D (AmbiX) — on those 16
   inputs. Check your version/licence supports decoding an external HOA stream. With
   *Rotate with listener* on, the dome's front is what the 3D camera looks at.
4. App: send device = DVS, stream on. Reaper (optional) records exactly as in 2.3, from DVS.

## 4. Behaviour reference

- While the send is on the browser plays **no binaural** (one output per audio engine). The
  BottomBar **master volume / mute** controls the send level. Card previews keep the regular
  output device.
- All three render modes are sent. Lower orders occupy channels 1–4 / 1–9 and leave the rest
  silent, so the 16-ch patch never changes.
- If the device drops below 16 channels or disappears, the send turns itself off and binaural
  playback resumes.
