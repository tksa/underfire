# UI structure

From `game/n2Menu_dll.dll` (screens/widgets) and the `mn_*` element ids in
`n2Game_Dll.dll`.

## Screens / flow
`intro` -> `logo1`/`logo2`/`logo3` -> main menu (`mainbk` background) ->
`loadsingle` (mission select) -> `briefing` (`brfbk` background) -> in-game.
Also: `demo`, `shortcuts` (controls help). Sound cues: `menuopen`/`menuclose`,
`mouse_click`; music `mainbk`/`winwav`/`loosewav`/`backwav`.

## Widget toolkit (`mn_*` element ids)
| Element | Widget |
|---|---|
| `mn_pbutton` / `mn_pbut_text` / `mn_cbutton` | push button (+ text) / custom button |
| `mn_checkbutton` (`checkbox_open`/`checkbox_close`) | checkbox |
| `mn_editbox` | text input |
| `mn_listbox` / `mn_listitem` / `mn_slist` | list / list item / scroll-list |
| `mn_scroller` / `mn_slider` | scrollbar / slider |
| `mn_image` | image |
| `mn_text` | static text |

Fonts: `font_comic30`, `font_phermes`, `font_plastilin1/2/3` (with `_m` mono and
`_s` small variants).

## Menu actions (mapped to keys in `orders_and_controls.md`)
`mn_save`, `mn_load`, `mn_sound`, `mn_graphics`, `mn_speed`, `mn_objectives`,
`mn_briefing`, `mn_restart`, `mn_quit`, `mn_delete`, `mn_exit_to_menu`,
`mn_exit_to_os`, `mn_ok`, `mn_cancel`.

## In-game HUD (from engine systems)
- **Command panel**: the 4x3 order-button grid (see `orders_and_controls.md`),
  context-sensitive to the selected unit.
- **Selection**: `selection/player_selection` module; `seltype`/`selunittypes`
  attributes control what can be selected/grouped.
- **Tactical map** (`key_TMap`/`key_TMapA`) and **info overlay** (`key_Info`).
- **Control-group bar** (0-9) and **location bar** (F1-F8).
- **Chat** line (begin/send/cancel + all-chat).
- Mission UI driven by triggers: `briefing`, `objectives`, modal dialogs and
  on-map "say phrase" callouts with optional marker pointers
  (see `ai_and_scripting.md`).
