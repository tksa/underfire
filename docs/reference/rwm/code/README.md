# Game mechanics code - reverse-engineering package

The actual gameplay logic (movement, firing, bridge building, pathfinding, AI…) is
compiled C++ in the game DLLs. **Original source is not recoverable**, but the
binaries were built with assert macros that embed the original **source-file paths
and line numbers**, which lets us map machine code to the exact module/function that
implements each mechanic. This folder is the scaffolding to continue that RE.

## What's here

- **`disasm/`** - full x86 disassembly of each DLL (`objdump -d -M intel`):
  - `n2Game_Dll.asm` (~20 MB) - **all gameplay logic** (units, AI, movement, fire,
    bridges, pathfinding, aviation, land, map).
  - `n2Menu_dll.asm` - menu/UI logic.
  - `n2Cad1024.asm` - the CAD/render layer.
  - `excerpt_*.asm` - small pre-cut excerpts of specific mechanic functions.
- **`code_map.md`** - the codebase structure: every source file (by subsystem) and
  the resolved code address of key mechanic functions.
- **`mechanics_bridge_building.md`**, **`mechanics_movement.md`** - worked deep
  dives: data params + source file + code address + annotated disassembly.

## How to reverse-engineer further (recommended workflow)

1. Load `game/n2Game_Dll.dll` into Ghidra or IDA. **ImageBase = `0x10000000`.**
   Sections: `.text 0x10001000`, `.rdata 0x100eb000`, `.data 0x100f8000`.
2. The assert handler is `sub_1007ACC0` (called as
   `push <lineno>; push <file_str>; push <expr>; call 0x1007acc0`). Every call to it
   tells you the **source file + line** of the surrounding code - use it to name
   functions.
3. To locate a mechanic: find its source-file string VA (tool
   `tools/xref.py <keyword>`), then search the disassembly for `push <that VA>`;
   the enclosing function implements that file's logic.
4. Unit field names (e.g. `pontbuildtime`, `movespeed`) are parsed from the unit
   text defs in `n2Game_Dll`; the code reads them by name - searching the
   disassembly for the field-name string VA finds the parser/consumer.

## Confidence
Addresses, file names, and instruction bytes are exact (from the binary).
Interpretations of what the code computes are marked *(inferred)*.
