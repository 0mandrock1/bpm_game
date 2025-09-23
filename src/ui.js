import { createGameLogic } from './logic.js';

export function initializeUi() {
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
      <button id="start-btn" type="button">
        <svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="#e3e3e3"><path d="M480-400q-50 0-85-35t-35-85v-240q0-50 35-85t85-35q50 0 85 35t35 85v240q0 50-35 85t-85 35Zm0-240Zm-40 520v-123q-104-14-172-93t-68-184h80q0 83 58.5 141.5T480-320q83 0 141.5-58.5T680-520h80q0 105-68 184t-172 93v123h-80Zm40-360q17 0 28.5-11.5T520-520v-240q0-17-11.5-28.5T480-800q-17 0-28.5 11.5T440-760v240q0 17 11.5 28.5T480-480Z"/></svg>
      </button>
      <button
        id="stop-btn"
        type="button"
        disabled  
      >
        <svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="#e3e3e3"><path d="M320-640v320-320Zm-80 400v-480h480v480H240Zm80-80h320v-320H320v320Z"/></svg>
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

  const bpmControls = `
    <section class="bpm-controls">
      <label for="bpm-input">Your BPM Guess:</label>
      <input id="bpm-input" type="number" min="40" max="240" step="1" disabled />
      <button id="bpm-submit" type="button" disabled>Submit Guess</button>
    </section>
  `;

  template.innerHTML = `
    <main class="container">
      ${header}
      ${controls}
      ${bpmControls}
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

  let trackFlashTimeout;
  let tapFlashTimeout;

  const uiBindings = {
    setStartDisabled(disabled) {
      startBtn.disabled = disabled;
    },
    setStopDisabled(disabled) {
      stopBtn.disabled = disabled;
    },
    setTapDisabled(disabled) {
      tapBtn.disabled = disabled;
    },
    updateMessage(text) {
      message.textContent = text;
    },
    updateLevel(text) {
      levelSpan.textContent = text;
    },
    updateStreak(text) {
      streakSpan.textContent = text;
    },
    updateScore(text) {
      scoreSpan.textContent = text;
    },
    showResults() {
      bpmResults.hidden = false;
    },
    hideResults() {
      bpmResults.hidden = true;
      bpmResults.textContent = '';
    },
    setBpmResults(text) {
      bpmResults.textContent = text;
    },
    enableBpmControls() {
      bpmInput.disabled = false;
      bpmSubmit.disabled = false;
    },
    disableBpmControls() {
      bpmInput.disabled = true;
      bpmSubmit.disabled = true;
    },
    setBpmInputValue(value) {
      bpmInput.value = value;
    },
    triggerTrackFlash() {
      document.body.classList.add('assist-flash');
      if (trackFlashTimeout) {
        clearTimeout(trackFlashTimeout);
      }
      trackFlashTimeout = setTimeout(() => {
        document.body.classList.remove('assist-flash');
        trackFlashTimeout = undefined;
      }, 180);
    },
    triggerTapFlash() {
      document.body.classList.add('assist-flash');
      if (tapFlashTimeout) {
        clearTimeout(tapFlashTimeout);
      }
      tapFlashTimeout = setTimeout(() => {
        document.body.classList.remove('assist-flash');
        tapFlashTimeout = undefined;
      }, 150);
    },
    clearAssistFlash() {
      document.body.classList.remove('assist-flash');
      if (trackFlashTimeout) {
        clearTimeout(trackFlashTimeout);
        trackFlashTimeout = undefined;
      }
      if (tapFlashTimeout) {
        clearTimeout(tapFlashTimeout);
        tapFlashTimeout = undefined;
      }
    },
    setAssistMode(mode) {
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
    },
    triggerFireworks() {
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
  };

  const logic = createGameLogic(uiBindings);

  startBtn.addEventListener('click', () => {
    logic.startListening();
  });
  stopBtn.addEventListener('click', () => {
    logic.stopListening();
  });
  tapBtn.addEventListener('click', () => {
    logic.handleTap();
  });
  resetBtn.addEventListener('click', () => {
    logic.resetGame();
  });
  assistBtn.addEventListener('click', () => {
    logic.cycleAssistMode();
  });
  bpmSubmit.addEventListener('click', () => {
    logic.submitBpmGuess(bpmInput.value);
  });

  window.addEventListener('keydown', (event) => {
    if (event.code === 'Space' && !event.repeat) {
      event.preventDefault();
      logic.handleTap();
    }
  });

  document.addEventListener('pointerdown', (event) => {
    if (event.target.closest('button')) {
      return;
    }
    logic.handleTap();
  });

  window.addEventListener('beforeunload', () => {
    logic.stopListening();
  });

  uiBindings.setAssistMode(logic.getCurrentAssistMode());
}
