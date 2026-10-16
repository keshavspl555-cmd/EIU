# DEMO_SPL_EIU_APP — SPL EIU Companion (demo)

Demo app for the SPL EIU wand + implant system. **All device data is simulated**
inside `app.js`. The app does not talk to real hardware and is not for clinical use.

## How to open

- **Laptop:** double-click `index.html` (Edge / Chrome). No install, no internet needed.
- **Phone:** copy the folder to the phone and open `index.html` in Chrome, or host the
  folder on any web server and open the link.

## What it shows

| Mode | Screens |
|---|---|
| Connect | Scan for wand → pair → connection steps (Bluetooth, wand self-test, LF handshake, status read) |
| Patient | **Home** (implant battery ring, therapy time left, stimulation on/off, wand status, recent activity) · **Charge** (live wand-alignment bars + beeps, drag-the-wand simulator, charge current chart, time to full, temperatures, burst/telemetry cycle) · **Therapy** (programs, amplitude +/- inside clinician limits) · **Alerts** |
| Clinician (PIN **2468**) | **Program** (per-lead contact polarity, amplitude / pulse width / frequency, case anode, patient limits, charge-density safety check, send to implant with verify) · **Leads** (impedance test with normal / high / open / short) · **Charge** (engineering view: Rx/Tx voltage, power level, auto power tracking, manual level, charge-current limit, HV rail) · **Device** (implant + wand info, LF link stats) · **Log** (filter, CSV export) |

Settings (gear icon): patient / clinician mode, alignment beeps, auto power tracking,
demo speed 1× / 10× / 60×, disconnect, reset demo.

## Simulation model

- Coil drive 10.38 kHz, power level 15–33 (`pwm-rail` duty), burst ON then telemetry gap
  (compressed from 60 s / 2 s to 6 s / 1 s).
- Receiver voltage falls with wand misalignment; charge current is limited either by the
  link or by the implant charger (constant current, then taper above 80 %).
- Auto power tracking raises the level only when the link is the limit and lowers it
  when the charger is saturated with spare headroom.
- Implant temperature rise triggers an alert and an automatic power cut.

## Files

- `index.html` — page shell
- `styles.css` — UI (light + dark mode automatically)
- `app.js` — screens, simulator, actions

## Intro video

`intro/SPL_EIU_Companion_intro.mp4` (36 s) — motion-graphic walkthrough of the app.
Open `intro/intro.html` to watch it live or re-record it. See `intro/README.md`.

## Branding

- Opens with a 2 s Pacetronix splash (logo, ECG trace, "Shree Pacetronix Ltd. · implantable cardiac devices since 1988"), then fades into the app.
- Theme colours are taken from the Pacetronix logo: deep teal-blue `#1a6577` (light mode) / `#4aa3ba` (dark mode), steel-blue accent `#2b7ca3`.
- Logo files are in `assets/`: `pacetronix-logo.png` (dark ink, for light backgrounds), `pacetronix-logo-light.png` (white ink, for dark backgrounds), `pacetronix_logo_src.jpg` (original from pacetronix.com).
- The wordmark also appears on the connect screen, in Settings and on the Device screen (Manufacturer card).
