# FlightWatch

A web app to track friends' flights in real time. Search any flight by number, add it to your watchlist, and get a browser notification when it lands.

## Features
- Live flight status via AviationStack API
- Watchlist to track multiple flights
- Browser arrival alerts
- Fully local — no server, no login

## Setup
1. Clone the repo
2. Create `config.js` in the root with your AviationStack key:
   ```js
   const CONFIG = { AVIATION_STACK_KEY: 'your_key_here' };
   ```
3. Open `index.html` in your browser

## Tech
HTML · CSS · Vanilla JavaScript
