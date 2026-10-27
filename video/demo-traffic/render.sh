#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_dir="$(cd "$project_dir/../.." && pwd)"
assets="$project_dir/assets"
output="${1:-$repo_dir/example/demo-traffic-video/source.mp4}"

ffmpeg -y \
  -loop 1 -framerate 30 -i "$assets/intersection.png" \
  -loop 1 -framerate 30 -i "$assets/gold-sedan.png" \
  -loop 1 -framerate 30 -i "$assets/blue-sedan.png" \
  -loop 1 -framerate 30 -i "$assets/red-sedan.png" \
  -loop 1 -framerate 30 -i "$assets/signal-red.png" \
  -loop 1 -framerate 30 -i "$assets/signal-amber.png" \
  -loop 1 -framerate 30 -i "$assets/signal-green.png" \
  -filter_complex "\
    [0:v]scale=1920:1080,format=rgba[background];\
    [1:v]scale=360:240,format=rgba[gold];\
    [2:v]scale=360:240,format=rgba[blue];\
    [3:v]scale=360:240,format=rgba[red];\
    [background][gold]overlay=x='1120-136*t':y='790-208*t':eval=frame:enable='between(t,0,2.5)'[with_gold];\
    [with_gold][blue]overlay=x='if(lt(t,7.05),570,570-88*(t-7.05))':y='if(lt(t,2.7),850-77.27*(t-0.5),if(lt(t,7.05),680,680-144*(t-7.05)))':eval=frame:enable='between(t,0.5,10)'[with_blue];\
    [with_blue][red]overlay=x='1450-88*(t-3.55)':y='720-80*(t-3.55)':eval=frame:enable='between(t,3.55,7.3)'[with_cars];\
    [with_cars][4:v]overlay=0:0:eval=frame:enable='between(t,3,7)'[with_red_signal];\
    [with_red_signal][5:v]overlay=0:0:eval=frame:enable='between(t,2,3)'[with_amber_signal];\
    [with_amber_signal][6:v]overlay=0:0:eval=frame:enable='between(t,0,2)+between(t,7,10)'[composite]\
  " \
  -map '[composite]' -an -t 10 -r 30 -frames:v 300 \
  -c:v libx264 -preset medium -crf 17 -pix_fmt yuv420p \
  -color_primaries bt709 -color_trc bt709 -colorspace bt709 \
  -movflags +faststart "$output"
