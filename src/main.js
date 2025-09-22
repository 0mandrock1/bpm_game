import './style.css';

const app = document.querySelector('#app');

const template = document.createElement('template');
let header = `
    <header>
      <h1>Beat Pulse</h1>
      <p>
        Guess the BPM. Assist modes: tap tempo, flash screen on songs beat, flash screen on tap tempo.
      </p>
    </header>
    `;
let controls = `
    <section class="controls">
      <button id="start-btn" type="button" aria-label="Start listening">🎤</button>
      <button
        id="stop-btn"
        type="button"
        aria-label="Stop listening"
        disabled
      >
        ■
      </button>
      <button id="tap-btn" type="button" disabled>Tap Beat</button>
      <button id="assist-btn" type="button">Assist Mode: Off</button>
      <button id="reset-btn" type="button">Reset Score</button>
    </section>
    `;
let status = `
    <section class="status">
      <p><strong>Microphone Level:</strong> <span id="level">0</span></p>
      <p><strong>Beat Streak:</strong> <span id="streak">0</span></p>
      <p><strong>Score:</strong> <span id="score">0</span></p>
      <p id="message" role="status" aria-live="polite"></p>
      <p id="bpm-results" hidden></p>
    </section>
    `;
template.innerHTML =  `
  <main class="container">
    ${header}
     ${controls}
    <section style="text-align:center" class="status">
      <p><strong>BPM:</strong> <input type="number" id="bpm-input" min="40" max="240" step="1" aria-label="Enter your BPM guess" /></p>
      <p> <input type="button" id="bpm-submit" value="Submit" /></p>
    </section>
    ${status}
  </main>
`

app.appendChild(template.content.cloneNode(true));

const startBtn = document.querySelector('#start-btn');
const stopBtn = document.querySelector('#stop-btn');
const tapBtn = document.querySelector('#tap-btn');
const assistBtn = document.querySelector('#assist-btn');
const resetBtn = document.querySelector('#reset-btn');
const levelSpan = document.querySelector('#level');
const streakSpan = document.querySelector('#streak');
const scoreSpan = document.querySelector('#score');
const message = document.querySelector('#message');
const bpmResults = document.querySelector('#bpm-results');

const bpmInput = document.querySelector('#bpm-input');
const bpmSubmit = document.querySelector('#bpm-submit');


let audioContext;
let analyser;
let dataArray;
let animationId;
let micStream;
let lastPeakTime = 0;
let streak = 0;
let score = 0;
const peakWindow = 1000; // ms window to match beat taps
const minPeakInterval = 350; // ms between peaks to avoid noise
const levelSmoothing = 0.2;
let displayLevel = 0;
const peakTimes = [];
const consecutiveTapTimes = [];
let lastTapBpm = null;
let lastTrackBpm = null;
let hasShownResults = false;
let assistModeEnabled = false;
let assistFlashTimeout;

// game logic
async function startListening() {
  if (!navigator.mediaDevices?.getUserMedia) {
    message.textContent = 'Microphone access is not supported in this browser.';
    return;
  }

  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioContext = new AudioContext();
    const source = audioContext.createMediaStreamSource(micStream);

    analyser = audioContext.createAnalyser();
    analyser.fftSize = 512;
    dataArray = new Uint8Array(analyser.frequencyBinCount);

    source.connect(analyser);
    tapBtn.disabled = false;
    stopBtn.disabled = false;
    startBtn.disabled = true;
    peakTimes.length = 0;
    lastTrackBpm = null;
    message.textContent = 'Listening for beats…';
    detectLoop();
  } catch (error) {
    message.textContent = 'Microphone access denied. Please allow access to play.';
  }
}

function stopListening() {
  cancelAnimationFrame(animationId);
  if (micStream) {
    micStream.getTracks().forEach((track) => track.stop());
  }
  if (audioContext) {
    audioContext.close();
  }
  tapBtn.disabled = true;
  stopBtn.disabled = true;
  startBtn.disabled = false;
  message.textContent = 'Microphone stopped.';
}

function resetGame() {
  streak = 0;
  score = 0;
  consecutiveTapTimes.length = 0;
  peakTimes.length = 0;
  lastTapBpm = null;
  lastTrackBpm = null;
  hasShownResults = false;
  streakSpan.textContent = streak.toString();
  scoreSpan.textContent = score.toString();
  message.textContent = 'Game reset. Ready when you are!';
  bpmResults.hidden = true;
  bpmResults.textContent = '';
}
function renderBpmResults() {
  if (!hasShownResults) {
    return;
  }
  const tapText = lastTapBpm
    ? `Итоговый BPM нажатий: ${lastTapBpm.toFixed(1)}`
    : 'Итоговый BPM нажатий: недостаточно данных';
  const trackText = lastTrackBpm
    ? `BPM трека: ${lastTrackBpm.toFixed(1)}`
    : 'BPM трека: недостаточно данных';
  bpmResults.textContent = `${tapText} · ${trackText}`;
}

function toggleAssistMode() {
  assistModeEnabled = !assistModeEnabled;
  assistBtn.textContent = assistModeEnabled ? 'Assist Mode: On' : 'Assist Mode: Off';
  if (!assistModeEnabled) {
    document.body.classList.remove('assist-flash');
    document.body.classList.remove('assist-mode');
    if (assistFlashTimeout) {
      clearTimeout(assistFlashTimeout);
    }
    assistFlashTimeout = undefined;
    return;
  }
  document.body.classList.add('assist-mode');
}


// music beat detection based on simple amplitude thresholding
function registerPeak() {
  const now = performance.now();
  if (now - lastPeakTime > minPeakInterval) {
    lastPeakTime = now;
    message.textContent = 'Beat detected! Try to match it!';
    peakTimes.push(now);
    if (peakTimes.length > 16) {
      peakTimes.shift();
    }
    const trackBpm = calculateBpm(peakTimes);
    if (trackBpm) {
      lastTrackBpm = trackBpm;
    }
    if (assistModeEnabled) {
      triggerAssistFlash();
    }
    renderBpmResults();
  }
}

function detectLoop() {
  animationId = requestAnimationFrame(detectLoop);
  analyser.getByteTimeDomainData(dataArray);

  let sum = 0;
  for (let i = 0; i < dataArray.length; i += 1) {
    const value = (dataArray[i] - 128) / 128;
    sum += value * value;
  }

  const rms = Math.sqrt(sum / dataArray.length);
  const level = Math.min(1, rms * 8);
  displayLevel = displayLevel * (1 - levelSmoothing) + level * levelSmoothing;
  levelSpan.textContent = displayLevel.toFixed(2);

  if (level > 0.4 && performance.now() - lastPeakTime > minPeakInterval) {
    registerPeak();
  }
}

function handleTap() {
  if (tapBtn.disabled) {
    return;
  }
  const now = performance.now();
  if (now - lastPeakTime <= peakWindow) {
    streak += 1;
    score += 10 * streak;
    message.textContent = `Nice timing! Beat matched within ${Math.round(now - lastPeakTime)} ms.`;
    consecutiveTapTimes.push(now);
    if (consecutiveTapTimes.length > 16) {
      consecutiveTapTimes.shift();
    }
    if (streak >= 4) {
      const tapBpm = calculateBpm(consecutiveTapTimes);
      if (tapBpm) {
        lastTapBpm = tapBpm;
      }
      if (!hasShownResults) {
        hasShownResults = true;
        bpmResults.hidden = false;
      }
      renderBpmResults();
    }
  } else {
    streak = 0;
    score = Math.max(0, score - 5);
    message.textContent = 'Missed the beat. Keep listening and try again!';
    consecutiveTapTimes.length = 0;
  }

  streakSpan.textContent = streak.toString();
  scoreSpan.textContent = score.toString();
}

function calculateBpm(times) {
  if (times.length < 2) {
    return null;
  }
  let sumIntervals = 0;
  for (let i = 1; i < times.length; i += 1) {
    sumIntervals += times[i] - times[i - 1];
  }
  const averageInterval = sumIntervals / (times.length - 1);
  if (averageInterval <= 0) {
    return null;
  }
  return 60000 / averageInterval;
}

// misc helpers
function triggerAssistFlash() {
  document.body.classList.add('assist-mode');
  document.body.classList.add('assist-flash');
  if (assistFlashTimeout) {
    clearTimeout(assistFlashTimeout);
  }
  assistFlashTimeout = setTimeout(() => {
    document.body.classList.remove('assist-flash');
    assistFlashTimeout = undefined;
  }, 180);
}

function submitBpmGuess() {
  const guess = parseFloat(bpmInput.value);
  if (isNaN(guess) || guess < 40 || guess > 240) {
    message.textContent = 'Please enter a valid BPM between 40 and 240.';
    return;
  }
  if (lastTrackBpm) {
    const diff = Math.abs(guess - lastTrackBpm);
    if (diff < 3) {
      score += 50;
      message.textContent = `Amazing! Your guess of ${guess} BPM is very close to the track BPM of ${lastTrackBpm.toFixed(1)}! +50 points.`;
    }}}


startBtn.addEventListener('click', startListening);
stopBtn.addEventListener('click', stopListening);
tapBtn.addEventListener('click', handleTap);
resetBtn.addEventListener('click', resetGame);
assistBtn.addEventListener('click', toggleAssistMode);

window.addEventListener('keydown', (event) => {
  if (event.code === 'Space' && !event.repeat) {
    event.preventDefault();
    handleTap();
  }
});

document.addEventListener('pointerdown', (event) => {
  if (event.target.closest('button')) {
    return;
  }
  handleTap();
});

window.addEventListener('beforeunload', () => {
  if (audioContext?.state !== 'closed') {
    stopListening();
  }
});

