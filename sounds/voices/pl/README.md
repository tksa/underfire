# Polish voice recordings

These are compressed runtime copies of 77 Polish voice clips supplied by the
project owner. The WAV masters remain outside the repository and are not changed
by the conversion process.

## Runtime coverage

- 16 `infantry-selection` takes are active for soldier selection.
- 20 `movement` and 10 `movement-soldier` takes are active for movement orders.
- Infantry attack pools use 6 `core-attack` and 18 morale/patriotic takes.
- Polish tank pools reuse vehicle-neutral supplied recordings: 15 selection,
  17 movement, 5 `core-attack`, 18 shared vehicle-safe morale/patriotic, and 8
  stop takes.
- The overlapping infantry and tank pools activate 75 unique assets overall.
- Only `formal-variants/oddzial-gotow-panie-kapitanie` and
  `patriotic/za-warszawe` remain reserved for suitable later use.
- Dedicated vehicle-crew recordings remain desirable, but Polish tanks are no
  longer silent.

## Acknowledgement behavior

- The first accepted Polish infantry or tank attack order uses the morale pool;
  every third accepted attack order thereafter does the same. Throttled calls do
  not advance that cadence.
- Direct attacks, attack-move, and attack-ground use attack semantics.
- Drag-box selection emits one aggregate infantry or tank acknowledgement for
  the entire selection, not one voice per unit.
- The final German Mokra echelon forces one `nie-zlamia-nas` cue through the
  mission-event path.

The active pools are declared in `js/audio.js`. A missing Polish semantic slot is
always silent and never falls through to French or German speech.

## Runtime format

- Ogg container with FLAC audio
- 22,050 Hz, mono, signed 16-bit
- 80 Hz high-pass filter
- fixed 8 dB attenuation to match the measured French/German command-voice bank

The 77 runtime files total about 1.8 MiB, down from about 3.6 MiB of WAV masters.

To rebuild these copies or process later additions:

```bash
scripts/process-polish-voices.sh /path/to/polish-wav-folder sounds/voices/pl
```

Folder names are preserved so repeated basenames remain distinct. Do not place
these recordings in `sounds/rwm/` or the RWM manifest: their provenance and
licensing are separate from the RWM-Zero public-domain sound bank.
