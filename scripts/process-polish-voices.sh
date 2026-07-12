#!/usr/bin/env bash
set -euo pipefail

source_root="${1:-}"
output_root="${2:-sounds/voices/pl}"

if [[ -z "$source_root" || ! -d "$source_root" ]]; then
  echo "usage: $0 /path/to/polish-wav-folder [output-folder]" >&2
  exit 2
fi

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "ffmpeg is required" >&2
  exit 2
fi

mkdir -p "$output_root"
count=0

while IFS= read -r -d '' source_file; do
  relative_path="${source_file#"$source_root"/}"
  output_file="$output_root/${relative_path%.*}.ogg"
  mkdir -p "$(dirname "$output_file")"

  # Existing command voices average about -26 dB mean / -11 dB peak. The
  # supplied Polish WAVs average roughly 8 dB louder, so a fixed reduction
  # preserves expressive differences while matching the current bank. Keep
  # the established runtime format: mono 22.05 kHz FLAC in an Ogg container.
  ffmpeg -v error -nostdin -y -i "$source_file" \
    -map_metadata -1 -vn -sn -dn \
    -af "aresample=22050:out_chlayout=mono,highpass=f=80,volume=-8dB" \
    -ar 22050 -ac 1 -sample_fmt s16 \
    -c:a flac -compression_level 8 -f ogg "$output_file"

  count=$((count + 1))
done < <(find "$source_root" -type f -iname '*.wav' -print0)

echo "processed $count Polish voice clips into $output_root"
