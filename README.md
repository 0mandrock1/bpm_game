# Beat Pulse Mic Game

This project is a collaborative effort between you and ChatGPT to provide a lightweight Node.js + Vite template for experimenting with microphone-powered button rhythm games. It ships with a minimal interface, live audio level feedback, and a simple beat-matching scoring system so you can expand the experience in any direction you like.

## Features

- 🎛️ Four core buttons: start listening, stop, tap beat, and reset score.
- 🎤 Microphone access handled via the Web Audio API with smooth level visualization.
- 🧠 Basic beat detection logic that rewards accurate rhythm taps and tracks streaks.
- 🛠️ Vite-powered developer experience with hot module replacement and modern tooling.

## Getting Started

1. Install dependencies:

   ```bash
   npm install
   ```

2. Start the development server:

   ```bash
   npm run dev
   ```

   Vite will print a local development URL. Open it in a browser that supports microphone access (Chrome, Edge, or Firefox).

3. Build for production:

   ```bash
   npm run build
   ```

4. Preview the production build locally:

   ```bash
   npm run preview
   ```

## Gameplay Overview

1. Press **Start Listening** and grant microphone access when prompted.
2. Watch the microphone level readout and wait for a beat detection message.
3. Press **Tap Beat** as close as possible to the detected beat to build streaks and earn points.
4. Use **Stop Listening** to release the microphone and **Reset Score** to start over.

## Next Steps

- Enhance the beat detection algorithm for greater accuracy.
- Add visualizations that respond to microphone input.
- Introduce multiplayer or leaderboard mechanics for friendly competition.

Happy building, and thanks for collaborating on this rhythm experiment!
