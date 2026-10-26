#!/usr/bin/env bash
# Assemble the submission video from the real screen recording:
#   title card -> recording with burned-in captions -> limitations / end card.
# Usage (repo root): bash scripts/build-video.sh   (needs ffmpeg with libass + libfreetype)
set -euo pipefail
cd "$(dirname "$0")/../docs/submission/video"

FONT="${FONT:-C\\:/Windows/Fonts/segoeui.ttf}"
MONO="${MONO:-C\\:/Windows/Fonts/consola.ttf}"
BG=0x111719

ffmpeg -v error -y -f lavfi -i "color=c=${BG}:s=1920x1080:d=6:r=30" -vf "\
drawtext=fontfile='${MONO}':text='BOARDGUARD':fontcolor=0x79ADA0:fontsize=34:x=(w-tw)/2:y=h/2-120,\
drawtext=fontfile='${FONT}':text='AI-powered microscope assistant for electronics repair':fontcolor=0xF0F0EB:fontsize=58:x=(w-tw)/2:y=h/2-40,\
drawtext=fontfile='${FONT}':text='See the damage. Guide the repair. Verify the result.':fontcolor=0x9BA7A7:fontsize=36:x=(w-tw)/2:y=h/2+50,\
drawtext=fontfile='${MONO}':text='Real application footage - OpenCV 5.0.0 processing runs live during the recording':fontcolor=0x6C7878:fontsize=24:x=(w-tw)/2:y=h-120,\
fade=t=in:st=0:d=0.6,fade=t=out:st=5.4:d=0.6" -c:v libx264 -pix_fmt yuv420p -crf 18 title.mp4

STYLE="FontName=Segoe UI,FontSize=15,PrimaryColour=&H00EBF0F0,BackColour=&HD0191711,BorderStyle=3,OutlineColour=&H30191711,Outline=9,Shadow=0,MarginV=34,Alignment=2"
ffmpeg -v error -y -i raw.webm -vf "subtitles=captions.srt:force_style='${STYLE}',fps=30" \
  -c:v libx264 -pix_fmt yuv420p -crf 20 -preset medium main.mp4

ffmpeg -v error -y -f lavfi -i "color=c=${BG}:s=1920x1080:d=8:r=30" -vf "\
drawtext=fontfile='${FONT}':text='What BoardGuard is not':fontcolor=0xD8AA68:fontsize=40:x=240:y=250,\
drawtext=fontfile='${FONT}':text='- an electrical tester\: a photograph cannot prove or exclude a short':fontcolor=0xF0F0EB:fontsize=32:x=240:y=330,\
drawtext=fontfile='${FONT}':text='- a validated diagnostic\: findings are suspected visual anomalies with heuristic scores':fontcolor=0xF0F0EB:fontsize=32:x=240:y=385,\
drawtext=fontfile='${FONT}':text='- trained on real repair cases\: thresholds come from 27 public photos and synthetic data':fontcolor=0xF0F0EB:fontsize=32:x=240:y=440,\
drawtext=fontfile='${FONT}':text='What it is\: a visual inspection aid that knows when to look again.':fontcolor=0x79ADA0:fontsize=38:x=240:y=560,\
drawtext=fontfile='${MONO}':text='github.com/bilal-feroz/BoardGuard':fontcolor=0x9BA7A7:fontsize=28:x=240:y=680,\
fade=t=in:st=0:d=0.6,fade=t=out:st=7.4:d=0.6" -c:v libx264 -pix_fmt yuv420p -crf 18 end.mp4

printf "file 'title.mp4'\nfile 'main.mp4'\nfile 'end.mp4'\n" > concat.txt
ffmpeg -v error -y -f concat -safe 0 -i concat.txt -c copy boardguard-demo.mp4
rm -f title.mp4 main.mp4 end.mp4 concat.txt
ffprobe -v error -show_entries format=duration,size -of default=nw=1 boardguard-demo.mp4
