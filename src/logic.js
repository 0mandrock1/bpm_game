import { calculateRefinedBpm, createEnergyHistory, normalizeBpm } from './helpers.js';

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
  let frequencyData;
  let animationId;
  let micStream;
  let binWidth;

  let lastPeakTime = 0;
  let streak = 0;
  let score = 0;

  const peakWindow = 1000;
  const minPeakInterval = 320;
  const levelSmoothing = 0.18;

  let displayLevel = 0;

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

  const fluxHistory = createEnergyHistory(128);
  const onsetTimes = [];

  let lowBandLevel = 0;
  let highBandLevel = 0;
  let smoothedFlux = 0;

  const spectralFluxEnabled = new URLSearchParams(window.location.search).get('bpm') !== 'legacy';

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

    onsetTimes.push(now);
    if (onsetTimes.length > 64) {
      onsetTimes.shift();
    }

    if (!trackBpmLocked) {
      const refined = spectralFluxEnabled
        ? estimateBpmFromOnsets(onsetTimes) ?? calculateRefinedBpm(onsetTimes)
        : calculateRefinedBpm(onsetTimes);
      if (refined) {
        lastTrackBpm = refined;
        trackBpmLocked = true;
        ensureResultsVisible();
        renderBpmResults();
        ui.updateMessage(`BPM трека зафиксирован: ${refined.toFixed(1)}.`);
      }
    }
  }

  function computeBandAmplitude(minFrequency, maxFrequency) {
    if (!frequencyData || !binWidth) {
      return 0;
    }

    const startIndex = Math.max(0, Math.floor(minFrequency / binWidth));
    const endIndex = Math.min(
      frequencyData.length - 1,
      Math.ceil(maxFrequency / binWidth)
    );

    if (endIndex < startIndex) {
      return 0;
    }

    let sum = 0;
    let count = 0;
    for (let index = startIndex; index <= endIndex; index += 1) {
      const value = frequencyData[index];
      if (Number.isFinite(value)) {
        sum += 10 ** (value / 20);
        count += 1;
      }
    }

    if (count === 0) {
      return 0;
    }

    return sum / count;
  }

  function detectLoop() {
    if (!analyser || !frequencyData) {
      return;
    }

    animationId = requestAnimationFrame(detectLoop);
    analyser.getFloatFrequencyData(frequencyData);

    const lowBand = computeBandAmplitude(40, 200);
    const highBand = computeBandAmplitude(2000, 5000);

    const previousLow = lowBandLevel;
    const previousHigh = highBandLevel;
    const bandSmoothing = 0.3;
    lowBandLevel = previousLow + bandSmoothing * (lowBand - previousLow);
    highBandLevel = previousHigh + bandSmoothing * (highBand - previousHigh);

    const lowFlux = Math.max(0, lowBandLevel - previousLow);
    const highFlux = Math.max(0, highBandLevel - previousHigh);
    const instantFlux = lowFlux * 0.65 + highFlux * 0.35;
    const fluxSmoothing = 0.5;
    smoothedFlux = smoothedFlux + fluxSmoothing * (instantFlux - smoothedFlux);

    fluxHistory.push(smoothedFlux);

    const level = Math.min(1, (lowBandLevel * 3 + highBandLevel * 2) * 2.5);
    displayLevel = displayLevel * (1 - levelSmoothing) + level * levelSmoothing;
    ui.updateLevel(displayLevel.toFixed(2));

    const now = performance.now();
    const { mean, std } = fluxHistory.stats();
    const threshold = mean + std * 1.7;

    if (fluxHistory.length > 32 && smoothedFlux > threshold && now - lastPeakTime > minPeakInterval) {
      handleTrackPeak(now);
    }
  }

  function estimateBpmFromOnsets(times) {
    if (times.length < 4) {
      return null;
    }

    const minLag = 60000 / 240;
    const maxLag = 60000 / 40;
    const binSize = 10;
    const histogram = new Map();

    for (let i = times.length - 1; i > 0; i -= 1) {
      const current = times[i];
      for (let j = i - 1; j >= 0; j -= 1) {
        const lag = current - times[j];
        if (lag < minLag) {
          continue;
        }
        if (lag > maxLag) {
          break;
        }

        const bin = Math.round(lag / binSize) * binSize;
        const existing = histogram.get(bin) ?? 0;
        const weight = 1 - (times.length - 1 - i) / times.length;
        histogram.set(bin, existing + weight);
      }
    }

    if (histogram.size === 0) {
      return null;
    }

    let bestLag = 0;
    let bestScore = 0;
    histogram.forEach((score, lag) => {
      if (score > bestScore) {
        bestScore = score;
        bestLag = lag;
      }
    });

    if (bestLag <= 0 || bestScore < 2) {
      return null;
    }

    return normalizeBpm(60000 / bestLag);
  }

  function resetAnalysisState() {
    onsetTimes.length = 0;
    consecutiveTapTimes.length = 0;
    tapTempoTimes.length = 0;
    fluxHistory.reset();
    lowBandLevel = 0;
    highBandLevel = 0;
    smoothedFlux = 0;

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
        analyser.fftSize = 2048;
        analyser.minDecibels = -110;
        analyser.maxDecibels = -10;
        analyser.smoothingTimeConstant = 0.4;
        frequencyData = new Float32Array(analyser.frequencyBinCount);
        binWidth = audioContext.sampleRate / analyser.fftSize;

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
    frequencyData = undefined;
    binWidth = undefined;

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
