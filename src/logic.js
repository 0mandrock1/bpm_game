import { calculateRefinedBpm, createEnergyHistory } from './helpers.js';

export const assistModes = [
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
  },  
    {
    id: 'tap-tempo-flash',
    label: 'Assist Mode: Tap Tempo Flash',
    description: 'The screen flashes with tapped bpm.'
  }
];

export function createGameLogic(ui) {
  let assistModeIndex = 0;
  let audioContext;
  let analyser;
  let dataArray;
  let animationId;
  let micStream;

  let lastPeakTime = 0;
  let streak = 0;
  let score = 0;

  const peakWindow = 1000;
  const minPeakInterval = 320;
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
  let isTapEnabled = false;

  let userBpmGuess = null;
  let userGuessDiff = null;

  const energyHistory = createEnergyHistory(128);

  function ensureResultsVisible() {
    if (!hasShownResults) {
      hasShownResults = true;
      ui.showResults();
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
    ui.setBpmResults(parts.join(' · '));
  }

  function handleTrackPeak(now) {
    lastPeakTime = now;
    if (assistModes[assistModeIndex].id === 'track-flash') {
      ui.triggerTrackFlash();
    }

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
        ui.updateMessage(`BPM трека зафиксирован: ${refined.toFixed(1)}.`);
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
    energyHistory.push(energy);

    const rms = Math.sqrt(energy);
    const level = Math.min(1, rms * 8);
    displayLevel = displayLevel * (1 - levelSmoothing) + level * levelSmoothing;
    ui.updateLevel(displayLevel.toFixed(2));

    const now = performance.now();
    const { mean, std } = energyHistory.stats();
    const threshold = mean + std * 1.6;

    if (energyHistory.length > 32 && energy > threshold && now - lastPeakTime > minPeakInterval) {
      handleTrackPeak(now);
    }
  }

  function resetAnalysisState() {
    trackPeakTimes.length = 0;
    consecutiveTapTimes.length = 0;
    tapTempoTimes.length = 0;
    energyHistory.reset();

    lastTapBpm = null;
    tapTempoBpm = null;
    lastTrackBpm = null;
    trackBpmLocked = false;
    lastPeakTime = 0;
    userBpmGuess = null;
    userGuessDiff = null;
    guessLocked = false;
    hasShownResults = false;

    ui.hideResults();
    ui.setBpmResults('');
  }

  function startListening() {
    if (!navigator.mediaDevices?.getUserMedia) {
      ui.updateMessage('Microphone access is not supported in this browser.');
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

        ui.setTapDisabled(false);
        ui.setStopDisabled(false);
        ui.setStartDisabled(true);
        ui.enableBpmControls();

        isTapEnabled = true;

        resetAnalysisState();

        ui.updateMessage('Listening for beats…');
        detectLoop();
      })
      .catch(() => {
        ui.updateMessage('Microphone access denied. Please allow access to play.');
        ui.setStartDisabled(false);
        ui.setStopDisabled(true);
        ui.setTapDisabled(true);
      });
  }

  function stopListening() {
    cancelAnimationFrame(animationId);
    if (micStream) {
      micStream.getTracks().forEach((track) => track.stop());
      micStream = undefined;
    }
    if (audioContext) {
      audioContext.close();
      audioContext = undefined;
    }
    analyser = undefined;
    dataArray = undefined;

    ui.setTapDisabled(true);
    ui.setStopDisabled(true);
    ui.setStartDisabled(false);
    ui.updateMessage('Microphone stopped.');
    ui.clearAssistFlash();

    isTapEnabled = false;
  }

  function resetGame() {
    streak = 0;
    score = 0;
    resetAnalysisState();

    ui.updateStreak(streak.toString());
    ui.updateScore(score.toString());
    ui.updateMessage('Game reset. Ready when you are!');
    ui.clearAssistFlash();
    ui.enableBpmControls();
    ui.setBpmInputValue('');
  }

  function handleTap() {
    if (!isTapEnabled) {
      return;
    }

    const now = performance.now();

    tapTempoTimes.push(now);
    if (tapTempoTimes.length > 32) {
      tapTempoTimes.shift();
    }

    if (assistModes[assistModeIndex].id === 'tap-flash') {
      ui.triggerTapFlash();
    }

    if (tapTempoTimes.length >= 2) {
      const tempo = calculateRefinedBpm(tapTempoTimes);
      if (tempo) {
        tapTempoBpm = tempo;
        ensureResultsVisible();
        renderBpmResults();
        if (assistModes[assistModeIndex].id === 'tap-tempo') {
          ui.updateMessage(`Tap tempo BPM: ${tempo.toFixed(1)}.`);
        }
      }
    }

    if (now - lastPeakTime <= peakWindow) {
      streak += 1;
      score += 10 * streak;
      ui.updateMessage(`Nice timing! Beat matched within ${Math.round(now - lastPeakTime)} ms.`);
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
      ui.updateMessage('Missed the beat. Keep listening and try again!');
      consecutiveTapTimes.length = 0;
    }

    ui.updateStreak(streak.toString());
    ui.updateScore(score.toString());
  }

  function submitBpmGuess(rawGuess) {
    if (guessLocked) {
      ui.updateMessage('Вы уже сделали ставку BPM. Сбросьте игру, чтобы попробовать снова.');
      return;
    }

    const guess = Number.parseFloat(rawGuess);
    if (!Number.isFinite(guess) || guess < 40 || guess > 240) {
      ui.updateMessage('Please enter a valid BPM between 40 and 240.');
      return;
    }

    if (!lastTrackBpm) {
      ui.updateMessage('Подождите, пока игра зафиксирует BPM трека.');
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
      ui.updateMessage(`Круто! Разница всего ${userGuessDiff.toFixed(1)} BPM. +${points} очков.`);
      if (userGuessDiff <= 2) {
        ui.triggerFireworks();
      }
    } else {
      score = Math.max(0, score - 20);
      ui.updateMessage(`Не угадали. Вы промахнулись на ${userGuessDiff.toFixed(1)} BPM. -20 очков.`);
    }

    ui.updateScore(score.toString());
    guessLocked = true;
    ui.disableBpmControls();
  }

  function cycleAssistMode() {
    assistModeIndex = (assistModeIndex + 1) % assistModes.length;
    ui.clearAssistFlash();
    ui.setAssistMode(assistModes[assistModeIndex]);
    renderBpmResults();
  }

  function getCurrentAssistMode() {
    return assistModes[assistModeIndex];
  }

  return {
    startListening,
    stopListening,
    resetGame,
    handleTap,
    submitBpmGuess,
    cycleAssistMode,
    getCurrentAssistMode
  };
}
