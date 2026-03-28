/* ---------------------------------------------------------
   Adaptive Metronome — Final Corrected Version
   - barsPerStep controls bars per BPM step
   - min/max segments = barsPerStep × (1 + repeats)
   - Intermediate steps = barsPerStep
   - Animation starts only on next Beat 1
   - Clean phase machine (no ghost segments)
--------------------------------------------------------- */

// -------------------------------
// DOM ELEMENTS
// -------------------------------
const ring             = document.getElementById("beatRing");
const radius           = ring.r.baseVal.value;
const circumference    = 2 * Math.PI * radius;
const directionSymbol = document.getElementById("directionSymbol");

const startBpmInput    = document.getElementById("startBpm");
const targetBpmInput   = document.getElementById("targetBpm");
const beatsPerBarInput = document.getElementById("beatsPerBar");
const bpmStepInput     = document.getElementById("bpmStep");

const maxRepeatsInput  = document.getElementById("maxRepeats");
const minRepeatsInput  = document.getElementById("minRepeats");
const barsPerStepInput = document.getElementById("barsPerStep");

const startBtn         = document.getElementById("startBtn");
const stopBtn          = document.getElementById("stopBtn");

const bpmDisplay       = document.getElementById("bpmDisplay");
const barBeatDisplay   = document.getElementById("barBeatDisplay");

const clickSoundSelect = document.getElementById("clickSound");
const previewSoundBtn  = document.getElementById("previewSoundBtn");
const volumeSlider     = document.getElementById("volumeSlider");
const volumeText       = document.getElementById("volumeText");

const accentBeat1Checkbox   = document.getElementById("accentBeat1");
const enableSubdivCheckbox  = document.getElementById("enableSubdivisions");
const subdivisionControls   = document.getElementById("subdivisionControls");
const subdivisionButtons    = document.querySelectorAll(".subdiv-btn");


ring.style.strokeDasharray = `${circumference}`;
ring.style.strokeDashoffset = 0;


// -------------------------------
// AUDIO
// -------------------------------
let audioCtx = null;
let soundBuffers = {};
let volume = 1.0;
let soundType = "beep";

let accentEnabled = true;
let subdivisionsEnabled = false;
let subdivisionValue = 2;

function createClickSound(type, options = {}) {
    const duration = options.duration || 0.04;
    const freq     = options.freq || 1000;
    const noise    = options.noise || false;
    const gainMul  = options.gainMul || 1.0;

    const sampleRate = audioCtx.sampleRate;
    const buffer = audioCtx.createBuffer(1, duration * sampleRate, sampleRate);
    const data = buffer.getChannelData(0);

    for (let i = 0; i < data.length; i++) {
        const t = i / sampleRate;
        let sample = noise ? (Math.random() * 2 - 1) : Math.sin(2 * Math.PI * freq * t);
        sample *= Math.exp(-t * 40);
        data[i] = sample * gainMul;
    }

    return buffer;
}

async function initAudio() {
    if (audioCtx) return;
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();

    soundBuffers.classic = createClickSound("classic", { noise: true, gainMul: 1.0 });
    soundBuffers.soft    = createClickSound("soft",    { noise: true, gainMul: 0.6 });
    soundBuffers.wood    = createClickSound("wood",    { freq: 800,  gainMul: 1.0 });
    soundBuffers.beep    = createClickSound("beep",    { freq: 1200, gainMul: 1.0 });
}

function playBuffer(buffer, gainScale = 1.0) {
    if (!audioCtx || !buffer) return;
    const src = audioCtx.createBufferSource();
    const gain = audioCtx.createGain();
    gain.gain.value = volume * gainScale;
    src.buffer = buffer;
    src.connect(gain).connect(audioCtx.destination);
    src.start();
}

function playMainClick(isAccent = false) {
    const baseBuffer = soundBuffers[soundType];
    if (!baseBuffer) return;

    if (!accentEnabled || !isAccent) {
        playBuffer(baseBuffer, 1.0);
        return;
    }

    const accentBuffer = createClickSound("accent", { freq: 1500, gainMul: 1.2 });
    playBuffer(accentBuffer, 1.0);
}

function playSubdivisionClick() {
    const subdivBuffer = createClickSound("subdiv", { freq: 700, gainMul: 0.6 });
    playBuffer(subdivBuffer, 0.6);
}


// -------------------------------
// METRONOME STATE
// -------------------------------
let running = false;
let countdownActive = false;

let currentBpm = 80;
let startBpm = 80;
let targetBpm = 140;
let beatsPerBar = 4;
let bpmStep = 10;

let maxRepeats = 0;
let minRepeats = 0;
let barsPerStep = 1;

let runMode = "once";

let beatTimerId = null;
let beatIntervalMs = 0;

let beatInBar = 1;
let barCount = 1;

// PHASE MACHINE
// "initialMin", "toTarget", "holdTarget", "toStart", "finalMin"
let phase = "initialMin";

// counters
let barsRemaining = 0;

// animation state
let segmentJustChanged = false;
let segmentBarsTotal   = 0;

// stop after final bar
let pendingStop = false;


// -------------------------------
// COUNTDOWN
// -------------------------------
function startCountdownThenMetronome() {
    countdownActive = true;

    bpmDisplay.textContent = "LOADING";
    barBeatDisplay.textContent = "...";

    if (audioCtx.state === "suspended") audioCtx.resume();

    const interval = 60000 / startBpm;

    setTimeout(() => {
        let count = 4;

        function tick() {
            if (!countdownActive) return;

            playMainClick(false);

            bpmDisplay.textContent = count;
            barBeatDisplay.textContent = "Starting...";

            if (count === 1) {
                setTimeout(() => {
                    countdownActive = false;
                    bpmDisplay.textContent = "--";
                    barBeatDisplay.textContent = "Beat -, Bar -";
                    startMainMetronome();
                }, interval);
                return;
            }

            count--;
            setTimeout(tick, interval);
        }

        tick();
    }, 400);
}


// -------------------------------
// TEMPO STEPPING
// -------------------------------
function stepTowardTarget() {
    if (startBpm < targetBpm) {
        currentBpm += bpmStep;
        if (currentBpm > targetBpm) currentBpm = targetBpm;
    } else {
        currentBpm -= bpmStep;
        if (currentBpm < targetBpm) currentBpm = targetBpm;
    }
}

function stepTowardStart() {
    if (startBpm < targetBpm) {
        currentBpm -= bpmStep;
        if (currentBpm < startBpm) currentBpm = startBpm;
    } else {
        currentBpm += bpmStep;
        if (currentBpm > startBpm) currentBpm = startBpm;
    }
}


// -------------------------------
// RING ANIMATION
// -------------------------------
function resetRing() {
    ring.style.transition = "none";
    ring.style.strokeDashoffset = 0;
}

function startSegmentAnimation(durationSeconds) {
    resetRing();
    ring.getBoundingClientRect();

    requestAnimationFrame(() => {
        ring.style.transition = `stroke-dashoffset ${durationSeconds}s linear`;
        ring.style.strokeDashoffset = circumference;
    });
}


// -------------------------------
// PHASE LOGIC
// -------------------------------
function updateDirectionSymbol(mode) {
    if (!directionSymbol) return;

    switch (mode) {
        case "up":
            directionSymbol.textContent = "⬆️";
            break;
        case "down":
            directionSymbol.textContent = "⬇️";
            break;
        case "stop":
            directionSymbol.textContent = "🟥";
            break;
        case "clear":
        default:
            directionSymbol.textContent = "";
            break;
    }
}

function getNextDirectionSymbol() {
    // If we're already in finalMin, next is stop
    if (phase === "finalMin") {
        return "stop";
    }

    // Going upward toward target
    if (phase === "initialMin" || phase === "toTarget") {
        return (startBpm < targetBpm) ? "up" : "down";
    }

    // Holding target → next is descending
    if (phase === "holdTarget") {
        return (startBpm < targetBpm) ? "down" : "up";
    }

    // Descending toward start
    if (phase === "toStart") {

        // IMPORTANT FIX:
        // Only show stop if the *current* BPM is already at startBpm,
        // meaning the NEXT segment is finalMin.
        if (currentBpm === startBpm) {
            return "stop";
        }

        // Otherwise still descending
        return (startBpm < targetBpm) ? "down" : "up";
    }

    return "clear";
}



function handleEndOfBar() {
    segmentJustChanged = false;

    const minTotalBars = barsPerStep * (1 + minRepeats);
    const maxTotalBars = barsPerStep * (1 + maxRepeats);

    // INITIAL MIN BPM
    if (phase === "initialMin") {
        barsRemaining--;
        if (barsRemaining > 0) return;

        // Move immediately to first intermediate BPM
        stepTowardTarget();
        phase = "toTarget";
        barsRemaining = barsPerStep;
        segmentJustChanged = true;
        segmentBarsTotal = barsRemaining;
        return;
    }

    // TO TARGET (intermediate steps)
    if (phase === "toTarget") {
        barsRemaining--;
        if (barsRemaining > 0) return;

        stepTowardTarget();
        segmentJustChanged = true;

        if (currentBpm === targetBpm) {
            phase = "holdTarget";
            barsRemaining = maxTotalBars;
            segmentBarsTotal = barsRemaining;
            return;
        }

        barsRemaining = barsPerStep;
        segmentBarsTotal = barsRemaining;
        return;
    }

    // HOLD TARGET
    if (phase === "holdTarget") {
        barsRemaining--;
        if (barsRemaining > 0) return;

        // Begin descending
        stepTowardStart();
        phase = "toStart";
        barsRemaining = barsPerStep;
        segmentJustChanged = true;
        segmentBarsTotal = barsRemaining;
        return;
    }

    // TO START (intermediate descending)
    if (phase === "toStart") {

        // Only finish THIS bar before stepping down
        barsRemaining--;
        if (barsRemaining > 0) return;

        // Now step down to the next BPM
        stepTowardStart();
        segmentJustChanged = true;

        // If we have arrived at the start BPM,
        // begin the final min segment on the NEXT bar
        if (currentBpm === startBpm) {
            phase = "finalMin";
            barsRemaining = minTotalBars;
            segmentBarsTotal = barsRemaining;
            return;
        }

        // Otherwise continue descending normally
        barsRemaining = barsPerStep;
        segmentBarsTotal = barsRemaining;
        return;
    }


    // FINAL MIN BPM
    if (phase === "finalMin") {
        barsRemaining--;
        if (barsRemaining > 0) return;

        pendingStop = true;
        return;
    }
}


// -------------------------------
// BEAT LOOP
// -------------------------------
function scheduleNextBeat() {
    if (!running) return;

    beatIntervalMs = 60000 / currentBpm;

    const isAccentBeat = (beatInBar === 1);
    playMainClick(isAccentBeat);

    bpmDisplay.textContent = Math.round(currentBpm);
    barBeatDisplay.textContent = `Beat ${beatInBar}, Bar ${barCount}`;

    // Animation starts ONLY when:
    // - segmentJustChanged is true
    // - AND beatInBar === 1
    if (segmentJustChanged && beatInBar === 1) {
        const secondsPerBeat = 60 / currentBpm;
        const durationSeconds = segmentBarsTotal * beatsPerBar * secondsPerBeat;

        // NEW: update direction symbol at the exact moment animation begins
        updateDirectionSymbol(getNextDirectionSymbol());

        startSegmentAnimation(durationSeconds);
        segmentJustChanged = false;
    }


    if (subdivisionsEnabled && subdivisionValue > 1) {
        const subdivInterval = beatIntervalMs / subdivisionValue;

        for (let i = 1; i < subdivisionValue; i++) {
            setTimeout(() => {
                if (!running) return;
                playSubdivisionClick();
            }, subdivInterval * i);
        }
    }

    beatInBar++;

    if (beatInBar > beatsPerBar) {
        beatInBar = 1;
        barCount++;

        handleEndOfBar();

        if (pendingStop) {
            const delay = beatIntervalMs;
            pendingStop = false;
            setTimeout(() => stopMetronome(), delay);
            return;
        }
    }

    beatTimerId = setTimeout(scheduleNextBeat, beatIntervalMs);
}


// -------------------------------
// START / STOP
// -------------------------------
function startMainMetronome() {
    currentBpm = startBpm;
    beatInBar = 1;
    barCount = 1;

    const minTotalBars = barsPerStep * (1 + minRepeats);

    phase = "initialMin";
    barsRemaining = minTotalBars;
    segmentJustChanged = true;
    segmentBarsTotal = barsRemaining;

    pendingStop = false;
    running = true;

    resetRing();
    scheduleNextBeat();
}

function startMetronome() {
    if (running || countdownActive) return;

    startBpm    = Number(startBpmInput.value);
    targetBpm   = Number(targetBpmInput.value);
    beatsPerBar = Number(beatsPerBarInput.value);
    bpmStep     = Number(bpmStepInput.value);

    maxRepeats  = Number(maxRepeatsInput.value);
    minRepeats  = Number(minRepeatsInput.value);
    barsPerStep = Number(barsPerStepInput.value) || 1;

    runMode     = document.querySelector('input[name="runMode"]:checked').value;

    accentEnabled       = accentBeat1Checkbox.checked;
    subdivisionsEnabled = enableSubdivCheckbox.checked;

    startBtn.disabled = true;
    stopBtn.disabled = false;

    startCountdownThenMetronome();
    updateDirectionSymbol("clear");
}

function stopMetronome() {
    running = false;
    countdownActive = false;
    pendingStop = false;

    if (beatTimerId !== null) {
        clearTimeout(beatTimerId);
        beatTimerId = null;
    }

    resetRing();

    bpmDisplay.textContent = "--";
    barBeatDisplay.textContent = "Beat -, Bar -";

    startBtn.disabled = false;
    stopBtn.disabled = true;
    updateDirectionSymbol("clear");
}


// -------------------------------
// UI EVENTS
// -------------------------------
startBtn.addEventListener("click", async () => {
    await initAudio();
    if (audioCtx.state === "suspended") await audioCtx.resume();
    startMetronome();
});

stopBtn.addEventListener("click", stopMetronome);

clickSoundSelect.addEventListener("change", (e) => {
    soundType = e.target.value;
});

previewSoundBtn.addEventListener("click", async () => {
    await initAudio();
    if (audioCtx.state === "suspended") await audioCtx.resume();
    playMainClick(false);
});

volumeSlider.addEventListener("input", (e) => {
    const val = Number(e.target.value);
    volume = val / 100;
    volumeText.textContent = `${val}%`;
});

accentBeat1Checkbox.addEventListener("change", (e) => {
    accentEnabled = e.target.checked;
});

enableSubdivCheckbox.addEventListener("change", (e) => {
    subdivisionsEnabled = e.target.checked;
    subdivisionControls.classList.toggle("hidden", !subdivisionsEnabled);
});

subdivisionButtons.forEach(btn => {
    btn.addEventListener("click", () => {
        subdivisionButtons.forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        subdivisionValue = Number(btn.dataset.subdiv);
    });
});

window.addEventListener("load", () => {
    stopMetronome();
    const defaultBtn = document.querySelector('.subdiv-btn[data-subdiv="2"]');
    if (defaultBtn) defaultBtn.classList.add("active");
});
