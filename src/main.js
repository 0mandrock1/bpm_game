import './style.css';

const app = document.querySelector('#app');

const template = document.createElement('template');

const header = `
    <header>
      <h1>Beat Pulse</h1>
      <p>
        Guess the BPM. Assist modes: tap tempo, flash screen on song beat, flash screen on tap tempo.
      </p>
    </header>
    `;

const controls = `
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

const status = `
    <section class="status">
      <p><strong>Microphone Level:</strong> <span id="level">0</span></p>
      <p><strong>Beat Streak:</strong> <span id="streak">0</span></p>
      <p><strong>Score:</strong> <span id="score">0</span></p>
      <p id="assist-description" class="assist-description"></p>
      <p id="message" role="status" aria-live="polite"></p>
      <p id="bpm-results" hidden></p>
    </section>
    `;

template.innerHTML = `
  <main class="container">
    ${header}
     ${controls}
    <section style="text-align:center" class="status">
      <p><strong>BPM:</strong> <input type="number" id="bpm-input" min="40" max="240" step="1" aria-label="Enter your BPM guess" /></p>
      <p> <input type="button" id="bpm-submit" value="Submit" /></p>
    </section>
    ${status}
  </main>
`;

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
const assistDescription = document.querySelector('#assist-description');

const bpmInput = document.querySelector('#bpm-input');
const bpmSubmit = document.querySelector('#bpm-submit');

const fireworksContainer = document.createElement('div');
fireworksContainer.className = 'fireworks-container';
document.body.appendChild(fireworksContainer);

const assistModes = [
  {
    id: 'off',
    label: 'Assist Mode: Off',
    description: 'Assist features disabled. Listen and rely on your ear.'
  },
  {
    id: 'track-flash',
    label: 'Assist Mode: Track Flash',
    description: 'The classic helper: the screen flashes on every detected track beat.'
  },
  {
    id: 'tap-tempo',
    label: 'Assist Mode: Tap Tempo',
    description: 'Use Tap Beat to measure your own tempo and see the BPM instantly.'
  },
  {
    id: 'tap-flash',
    label: 'Assist Mode: Tap Flash',
    description: 'The screen flashes with every tap to help you lock your rhythm.'
  }
];

let assistModeIndex = 0;

let audioContext;
let analyser;
let dataArray;
let animationId;
let micStream;

let lastPeakTime = 0;
let streak = 0;
let score = 0;

const peakWindow = 1000; // ms window to match beat taps
const minPeakInterval = 320; // ms between peaks to avoid noise
const levelSmoothing = 0.18;

let displayLevel = 0;

const trackPeakTimes = [];
const consecutiveTapTimes = [];
const tapTempoTimes = [];

let lastTapBpm = null;
let tapTempoBpm = null;
let lastTrackBpm = null;

let hasShownResults = false;
let trackBpmLocked = false;
let guessLocked = false;

let userBpmGuess = null;
let userGuessDiff = null;

let trackFlashTimeout;
let tapFlashTimeout;

const energyHistory = [];
let energySum = 0;
let energySqSum = 0;
const energyHistorySize = 128;

function resetEnergyHistory() {
  energyHistory.length = 0;
  energySum = 0;
  energySqSum = 0;
}

function pushEnergy(value) {
  energyHistory.push(value);
  energySum += value;
  energySqSum += value * value;
  if (energyHistory.length > energyHistorySize) {
    const removed = energyHistory.shift();
    energySum -= removed;
    energySqSum -= removed * removed;
  }
}

function getEnergyStats() {
  const length = energyHistory.length;
  if (length === 0) {
    return { mean: 0, std: 0 };
  }
  const mean = energySum / length;
  const variance = Math.max(0, energySqSum / length - mean * mean);
  return { mean, std: Math.sqrt(variance) };
}

function ensureResultsVisible() {
  if (!hasShownResults) {
    hasShownResults = true;
    bpmResults.hidden = false;
  }
}

function renderBpmResults() {
  if (!hasShownResults) {
    return;
  }
  const parts = [];
  if (lastTrackBpm) {
    parts.push(`BPM трека: ${lastTrackBpm.toFixed(1)}`);
  }
  if (lastTapBpm) {
    parts.push(`BPM попаданий: ${lastTapBpm.toFixed(1)}`);
  }
  if (tapTempoBpm && assistModes[assistModeIndex].id === 'tap-tempo') {
    parts.push(`Tap tempo: ${tapTempoBpm.toFixed(1)}`);
  }
  if (userBpmGuess !== null && lastTrackBpm) {
    const delta = userGuessDiff !== null ? userGuessDiff.toFixed(1) : '—';
    parts.push(`Твой ответ: ${userBpmGuess.toFixed(1)} (Δ ${delta})`);
  }
  bpmResults.textContent = parts.join(' · ');
}

function updateAssistUi() {
  const mode = assistModes[assistModeIndex];
  assistBtn.textContent = mode.label;
  assistDescription.textContent = mode.description;

  document.body.classList.remove('assist-mode', 'assist-track', 'assist-tempo', 'assist-tap-flash', 'assist-flash');

  if (mode.id === 'off') {
    return;
  }

  document.body.classList.add('assist-mode');
  if (mode.id === 'track-flash') {
    document.body.classList.add('assist-track');
  } else if (mode.id === 'tap-tempo') {
    document.body.classList.add('assist-tempo');
  } else if (mode.id === 'tap-flash') {
    document.body.classList.add('assist-tap-flash');
  }
}

function cycleAssistMode() {
  assistModeIndex = (assistModeIndex + 1) % assistModes.length;
  clearAssistVisuals();
  updateAssistUi();
}

function clearAssistVisuals() {
  document.body.classList.remove('assist-flash');
  if (trackFlashTimeout) {
    clearTimeout(trackFlashTimeout);
    trackFlashTimeout = undefined;
  }
  if (tapFlashTimeout) {
    clearTimeout(tapFlashTimeout);
    tapFlashTimeout = undefined;
  }
}

function triggerTrackFlash() {
  const mode = assistModes[assistModeIndex];
  if (mode.id !== 'track-flash') {
    return;
  }
  document.body.classList.add('assist-flash');
  if (trackFlashTimeout) {
    clearTimeout(trackFlashTimeout);
  }
  trackFlashTimeout = setTimeout(() => {
    document.body.classList.remove('assist-flash');
    trackFlashTimeout = undefined;
  }, 180);
}

function triggerTapFlash() {
  const mode = assistModes[assistModeIndex];
  if (mode.id !== 'tap-flash') {
    return;
  }
  document.body.classList.add('assist-flash');
  if (tapFlashTimeout) {
    clearTimeout(tapFlashTimeout);
  }
  tapFlashTimeout = setTimeout(() => {
    document.body.classList.remove('assist-flash');
    tapFlashTimeout = undefined;
  }, 150);
}

function normalizeBpm(bpm) {
  if (!bpm) {
    return null;
  }
  let normalized = bpm;
  while (normalized < 70) {
    normalized *= 2;
  }
  while (normalized > 200) {
    normalized /= 2;
  }
  return normalized;
}

function calculateRefinedBpm(times) {
  if (times.length < 3) {
    return null;
  }

  const intervals = [];
  for (let i = 1; i < times.length; i += 1) {
    intervals.push(times[i] - times[i - 1]);
  }

  intervals.sort((a, b) => a - b);
  const medianInterval = intervals[Math.floor(intervals.length / 2)];

  const filtered = intervals.filter((interval) => Math.abs(interval - medianInterval) <= medianInterval * 0.25);
  const required = Math.max(2, Math.ceil(intervals.length * 0.6));
  if (filtered.length < required) {
    return null;
  }

  const sum = filtered.reduce((acc, value) => acc + value, 0);
  const averageInterval = sum / filtered.length;

  const variance = filtered.reduce((acc, value) => acc + (value - averageInterval) ** 2, 0) / filtered.length;
  const deviation = Math.sqrt(variance);

  if (deviation > 45) {
    return null;
  }

  return normalizeBpm(60000 / averageInterval);
}

function startListening() {
  if (!navigator.mediaDevices?.getUserMedia) {
    message.textContent = 'Microphone access is not supported in this browser.';
    return;
  }

  navigator.mediaDevices
    .getUserMedia({ audio: true })
    .then((stream) => {
      micStream = stream;
      audioContext = new AudioContext();
      const source = audioContext.createMediaStreamSource(micStream);

      analyser = audioContext.createAnalyser();
      analyser.fftSize = 512;
      dataArray = new Uint8Array(analyser.frequencyBinCount);

      source.connect(analyser);

      tapBtn.disabled = false;
      stopBtn.disabled = false;
      startBtn.disabled = true;

      trackPeakTimes.length = 0;
      consecutiveTapTimes.length = 0;
      tapTempoTimes.length = 0;
      resetEnergyHistory();

      lastTapBpm = null;
      tapTempoBpm = null;
      lastTrackBpm = null;
      trackBpmLocked = false;
      lastPeakTime = 0;

      userBpmGuess = null;
      userGuessDiff = null;
      guessLocked = false;
      bpmInput.disabled = false;
      bpmSubmit.disabled = false;

      hasShownResults = false;
      bpmResults.hidden = true;
      bpmResults.textContent = '';

      message.textContent = 'Listening for beats…';
      detectLoop();
    })
    .catch(() => {
      message.textContent = 'Microphone access denied. Please allow access to play.';
    });
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
  clearAssistVisuals();
}

function resetGame() {
  streak = 0;
  score = 0;
  consecutiveTapTimes.length = 0;
  tapTempoTimes.length = 0;
  trackPeakTimes.length = 0;
  lastTapBpm = null;
  tapTempoBpm = null;
  lastTrackBpm = null;
  trackBpmLocked = false;
  userBpmGuess = null;
  userGuessDiff = null;
  guessLocked = false;
  bpmInput.disabled = false;
  bpmSubmit.disabled = false;
  bpmInput.value = '';
  hasShownResults = false;
  bpmResults.hidden = true;
  bpmResults.textContent = '';
  streakSpan.textContent = streak.toString();
  scoreSpan.textContent = score.toString();
  message.textContent = 'Game reset. Ready when you are!';
  clearAssistVisuals();
}

function handleTrackPeak(now) {
  lastPeakTime = now;
  triggerTrackFlash();

  if (!trackBpmLocked) {
    trackPeakTimes.push(now);
    if (trackPeakTimes.length > 32) {
      trackPeakTimes.shift();
    }
    const refined = calculateRefinedBpm(trackPeakTimes);
    if (refined) {
      lastTrackBpm = refined;
      trackBpmLocked = true;
      ensureResultsVisible();
      renderBpmResults();
      message.textContent = `BPM трека зафиксирован: ${refined.toFixed(1)}.`;
    }
  }
}

function detectLoop() {
  animationId = requestAnimationFrame(detectLoop);
  analyser.getByteTimeDomainData(dataArray);

  let sumSquares = 0;
  for (let i = 0; i < dataArray.length; i += 1) {
    const value = (dataArray[i] - 128) / 128;
    sumSquares += value * value;
  }

  const energy = sumSquares / dataArray.length;
  pushEnergy(energy);

  const rms = Math.sqrt(energy);
  const level = Math.min(1, rms * 8);
  displayLevel = displayLevel * (1 - levelSmoothing) + level * levelSmoothing;
  levelSpan.textContent = displayLevel.toFixed(2);

  const now = performance.now();
  const { mean, std } = getEnergyStats();
  const threshold = mean + std * 1.6;

  if (energyHistory.length > 32 && energy > threshold && now - lastPeakTime > minPeakInterval) {
    handleTrackPeak(now);
  }
}

function handleTap() {
  if (tapBtn.disabled) {
    return;
  }

  const now = performance.now();

  tapTempoTimes.push(now);
  if (tapTempoTimes.length > 32) {
    tapTempoTimes.shift();
  }

  triggerTapFlash();

  if (tapTempoTimes.length >= 2) {
    const tempo = calculateRefinedBpm(tapTempoTimes);
    if (tempo) {
      tapTempoBpm = tempo;
      ensureResultsVisible();
      renderBpmResults();
      if (assistModes[assistModeIndex].id === 'tap-tempo') {
        message.textContent = `Tap tempo BPM: ${tempo.toFixed(1)}.`;
      }
    }
  }

  if (now - lastPeakTime <= peakWindow) {
    streak += 1;
    score += 10 * streak;
    message.textContent = `Nice timing! Beat matched within ${Math.round(now - lastPeakTime)} ms.`;
    consecutiveTapTimes.push(now);
    if (consecutiveTapTimes.length > 16) {
      consecutiveTapTimes.shift();
    }
    const tapBpm = calculateRefinedBpm(consecutiveTapTimes);
    if (tapBpm) {
      lastTapBpm = tapBpm;
      ensureResultsVisible();
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

function submitBpmGuess() {
  if (guessLocked) {
    message.textContent = 'Вы уже сделали ставку BPM. Сбросьте игру, чтобы попробовать снова.';
    return;
  }

  const guess = parseFloat(bpmInput.value);
  if (!Number.isFinite(guess) || guess < 40 || guess > 240) {
    message.textContent = 'Please enter a valid BPM between 40 and 240.';
    return;
  }

  if (!lastTrackBpm) {
    message.textContent = 'Подождите, пока игра зафиксирует BPM трека.';
    return;
  }

  userBpmGuess = guess;
  userGuessDiff = Math.abs(guess - lastTrackBpm);
  ensureResultsVisible();
  renderBpmResults();

  let points = 0;
  if (userGuessDiff <= 1) {
    points = 120;
  } else if (userGuessDiff <= 3) {
    points = 70;
  } else if (userGuessDiff <= 6) {
    points = 35;
  } else if (userGuessDiff <= 10) {
    points = 15;
  }

  if (points > 0) {
    score += points;
    message.textContent = `Круто! Разница всего ${userGuessDiff.toFixed(1)} BPM. +${points} очков.`;
    if (userGuessDiff <= 2) {
      triggerFireworks();
    }
  } else {
    score = Math.max(0, score - 20);
    message.textContent = `Не угадали. Вы промахнулись на ${userGuessDiff.toFixed(1)} BPM. -20 очков.`;
  }

  scoreSpan.textContent = score.toString();
  guessLocked = true;
  bpmInput.disabled = true;
  bpmSubmit.disabled = true;
}

function triggerFireworks() {
  const burstCount = 3;
  for (let i = 0; i < burstCount; i += 1) {
    const centerX = 20 + Math.random() * 60;
    const centerY = 20 + Math.random() * 40;
    const hue = Math.floor(120 + Math.random() * 60);
    const sparks = 16;

    for (let j = 0; j < sparks; j += 1) {
      const spark = document.createElement('span');
      spark.className = 'firework-spark';
      const angle = (Math.PI * 2 * j) / sparks;
      const distance = 40 + Math.random() * 35;
      const tx = Math.cos(angle) * distance;
      const ty = Math.sin(angle) * distance;
      spark.style.setProperty('--cx', `${centerX}`);
      spark.style.setProperty('--cy', `${centerY}`);
      spark.style.setProperty('--tx', `${tx.toFixed(2)}px`);
      spark.style.setProperty('--ty', `${ty.toFixed(2)}px`);
      spark.style.setProperty('--hue', `${hue}`);
      spark.style.setProperty('--delay', `${Math.random() * 0.25}s`);

      spark.addEventListener(
        'animationend',
        () => {
          spark.remove();
        },
        { once: true }
      );

      fireworksContainer.appendChild(spark);
    }
  }
}

startBtn.addEventListener('click', startListening);
stopBtn.addEventListener('click', stopListening);
tapBtn.addEventListener('click', handleTap);
resetBtn.addEventListener('click', resetGame);
assistBtn.addEventListener('click', cycleAssistMode);
bpmSubmit.addEventListener('click', submitBpmGuess);

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

updateAssistUi();
