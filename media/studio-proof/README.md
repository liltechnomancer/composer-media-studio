# Media Studio proof film

A 31.33-second, silent Remotion 4.0.543 and React/React DOM 19.3.1 composition at 1280 × 720, 30 fps. It combines public Share browser footage, a separately recorded LDraw local preview, and an existing Studio-generated Hailuo 2.3 motion clip. It does not depict an authenticated Studio creation session. NEW-073 is the Share artwork shown in LDraw; NEW-074 is the separate source for the motion clip. No new model request was made in producing this edit.

From this directory with Node 26 and pnpm installed:

```sh
pnpm install --frozen-lockfile
pnpm exec remotion render src/index.tsx StudioProof ../../public/films/artwork-to-motion.mp4 --codec h264 --crf 20 --pixel-format yuv420p --concurrency 4
```

`public/studio-public-journey.webm` is the previously captured public gallery journey; `public/ldraw-insert-20261114.webm` is the local LDraw interaction recording; `public/ldraw-mountain-hailuo-original.mp4` is the previously generated image-to-video result. The local Space Grotesk font comes from the Media Studio installation. The included footage is preserved as input, and the render does not alter it.

React 19.3.1 is within Remotion 4.0.543’s published peer range; this source and lockfile reproduce the silent film served at `/films/artwork-to-motion.mp4`.
