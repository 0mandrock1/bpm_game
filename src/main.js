import './style.css';

const app = document.querySelector('#app');

const template = document.createElement('template');
template.innerHTML = `
  <main class="container">
    <header>
      <h1>Beat Pulse Mic Game</h1>
      <p>
        Tap the beat button in rhythm with what the microphone hears. Matching the detected beat
        boosts your streak and score!
      </p>
    </header>
    <section class="controls">
      <button id="start-btn" type="button">Start Listening</button>
      <button id="stop-btn" type="button" disabled>Stop Listening</button>
      <button id="tap-btn" type="button" disabled>Tap Beat</button>
      <button id="reset-btn" type="button">Reset Score</button>
    </section>
    <section class="status">
      <p><strong>Microphone Level:</strong> <span id="level">0</span></p>
      <p><strong>Beat Streak:</strong> <span id="streak">0</span></p>
      <p><strong>Score:</strong> <span id="score">0</span></p>
      <p id="message" role="status" aria-live="polite"></p>
    </section>
  </main>
`;

app.appendChild(template.content.cloneNode(true));

const startBtn = document.querySelector('#start-btn');
const stopBtn = document.querySelector('#stop-btn');
const tapBtn = document.querySelector('#tap-btn');
const resetBtn = document.querySelector('#reset-btn');
const levelSpan = document.querySelector('#level');
const streakSpan = document.querySelector('#streak');
const scoreSpan = document.querySelector('#score');
const message = document.querySelector('#message');

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
  streakSpan.textContent = streak.toString();
  scoreSpan.textContent = score.toString();
  message.textContent = 'Game reset. Ready when you are!';
}

function registerPeak() {
  const now = performance.now();
  if (now - lastPeakTime > minPeakInterval) {
    lastPeakTime = now;
    message.textContent = 'Beat detected! Try to match it!';
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
  const now = performance.now();
  if (now - lastPeakTime <= peakWindow) {
    streak += 1;
    score += 10 * streak;
    message.textContent = `Nice timing! Beat matched within ${Math.round(now - lastPeakTime)} ms.`;
  } else {
    streak = 0;
    score = Math.max(0, score - 5);
    message.textContent = 'Missed the beat. Keep listening and try again!';
  }

  streakSpan.textContent = streak.toString();
  scoreSpan.textContent = score.toString();
}

startBtn.addEventListener('click', startListening);
stopBtn.addEventListener('click', stopListening);
tapBtn.addEventListener('click', handleTap);
resetBtn.addEventListener('click', resetGame);

window.addEventListener('beforeunload', () => {
  if (audioContext?.state !== 'closed') {
    stopListening();
  }
});
