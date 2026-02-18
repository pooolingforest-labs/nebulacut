# NebulaCut

## Mission
NebulaCut exists to build a professional-grade video editor as open-source software.

We aim to give creators a serious editing tool they can trust, inspect, and improve together with the community.

## Current Scope
- Import video, image, and audio files
- Edit with separate video and audio tracks
- Place image clips on the video track
- Timeline controls: play, seek, trim (head/tail), split, and delete
- Clip inspector: start, duration, offset, and volume

## Development
```bash
npm install
npm run dev
```

`npm run dev` starts Vite and Electron together.

## Build and Run
```bash
npm run build
npm run start
```

`npm run build` creates the renderer bundle, and `npm run start` launches the app with Electron.
