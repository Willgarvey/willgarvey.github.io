/* ---------------------------------------------------------
   Adaptive Metronome — Corrected Phase Logic
   - Exact min/max BPM repeat behavior
   - No extra bars at max BPM
   - No missing bars at min BPM
   - Beat 1 accent
   - Subdivisions on all beats
   - Circle animation fixed
   - Proper end-of-cycle behavior
--------------------------------------------------------- */

// -------------------------------
// DOM ELEMENTS
// -------------------------------
const startBpmInput    = document.getElementById("startBpm");
const targetBpmInput   = document.getElementById("targetBpm");
const beatsPerBarInput = document.getElementById("beatsPerBar");
const bpmStepInput     = document.getElementById("bpmStep");

const maxRepeatsInput  = document.getElementById("maxRepeats");
const minRepeatsInput  = document.getElementById("minRepeats");

const startBtn         = document.getElementById("startBtn");
const stopBtn          = document.getElementById("stopBtn");
const statusText       = document.getElementById("statusText");

const bpmDisplay       = document.getElementById("bpmDisplay");
const barBeatDisplay   = document.getElementById("barBeatDisplay");
const cycleCountText   = document.getElementById("cycleCount");

const clickSoundSelect = document.getElementById("clickSound");
const previewSoundBtn  = document.getElementById("previewSoundBtn");
const volumeSlider     = document.getElementById("volumeSlider");
const volumeText       = document.getElementById("volumeText");

const accentBeat1Checkbox   = document.getElementById("accentBeat1");
const enableSubdivCheckbox  = document.getElementById("enableSubdivisions");
const subdivisionControls   = document.getElementById("subdivisionControls");
const subdivisionButtons    = document.querySelectorAll(".subdiv-btn");

const ring             = document.getElementById("beatRing");
const radius           = ring.r.baseVal.value;
const circumference    = 2 * Math.PI * radius;

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

let maxRepeats = 1;
let minRepeats = 1;

let runMode = "once";

let beatTimerId = null;
let beatIntervalMs = 0;

let beatInBar = 1;
let barCount = 1;

let cycleCount = 1;

// PHASE MACHINE
// "toTarget", "holdTarget", "toStart", "holdStart"
let phase = "toTarget";

// repeat counters
let barsAtTarget = 0;
let barsAtStart  = 0;

// NEW — initial min BPM holds
let initialMinBarsRemaining = 0;
let initialMinPhaseDone = false;

// stop after final bar
let pendingStop = false;


// -------------------------------
// COUNTDOWN
// -------------------------------
function startCountdownThenMetronome() {
    countdownActive = true;
    statusText.textContent = "Countdown...";

    bpmDisplay.textContent = "LOADING";
    barBeatDisplay.textContent = "...";

    if (audioCtx.state === "suspended") audioCtx.resume();

    const interval = 60000 / startBpm;

    setTimeout(() => {
        let count = 8;

        function tick() {
            if (!countdownActive) return;

            playMainClick(false);

            bpmDisplay.textContent = count;
            barBeatDisplay.textContent = "Starting...";

            if (count === 1) {
                setTimeout(() => {
                    countdownActive = false;
                    bpmDisplay.textContent = "--";
                    barBeatDisplay.textContent = "Bar -, Beat -";
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
// PHASE LOGIC — CORRECTED + INITIAL MIN BPM HOLDS
// -------------------------------
function handleEndOfBar() {

    if (phase === "toTarget") {

        // NEW — initial min BPM bars before climbing
        if (!initialMinPhaseDone) {
            if (initialMinBarsRemaining > 0) {
                initialMinBarsRemaining--;
                return; // stay at start BPM for another bar
            }
            initialMinPhaseDone = true;
        }

        // existing logic
        stepTowardTarget();

        if (currentBpm === targetBpm) {
            phase = "holdTarget";
            barsAtTarget = 0;

            if (maxRepeats === 0 || maxRepeats === 1) {
                phase = "toStart";
            }
        }
        return;
    }

    if (phase === "holdTarget") {
        barsAtTarget++;

        if (barsAtTarget >= maxRepeats) {
            phase = "toStart";
        }
        return;
    }

    if (phase === "toStart") {
        stepTowardStart();

        if (currentBpm === startBpm) {
            phase = "holdStart";
            barsAtStart = 0;
        }
        return;
    }

    if (phase === "holdStart") {
        barsAtStart++;

        if (barsAtStart > minRepeats) {
            if (runMode === "once") {
                pendingStop = true;
            } else {
                phase = "toTarget";
                barsAtTarget = 0;
                barsAtStart  = 0;
            }
        }
        return;
    }
}


// -------------------------------
// BEAT LOOP
// -------------------------------
function scheduleNextBeat() {
    if (!running) return;

    beatIntervalMs = 60000 / currentBpm;

    ring.style.transition = "none";
    ring.style.strokeDashoffset = 0;

    ring.getBoundingClientRect();

    requestAnimationFrame(() => {
        ring.style.transition = `stroke-dashoffset ${beatIntervalMs}ms linear`;
        ring.style.strokeDashoffset = circumference;
    });

    const isAccentBeat = (beatInBar === 1);
    playMainClick(isAccentBeat);

    bpmDisplay.textContent = Math.round(currentBpm);
    barBeatDisplay.textContent = `Bar ${barCount}, Beat ${beatInBar}`;

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

    phase = "toTarget";
    barsAtTarget = 0;
    barsAtStart  = 0;

    initialMinBarsRemaining = Math.max(0, minRepeats);
    initialMinPhaseDone = false;

    cycleCount = 1;
    cycleCountText.textContent = cycleCount;

    pendingStop = false;
    running = true;

    statusText.textContent = (runMode === "once")
        ? "Running (one full cycle)."
        : "Running (continuous cycles).";

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

    runMode     = document.querySelector('input[name="runMode"]:checked').value;

    accentEnabled       = accentBeat1Checkbox.checked;
    subdivisionsEnabled = enableSubdivCheckbox.checked;

    startBtn.disabled = true;
    stopBtn.disabled = false;

    startCountdownThenMetronome();
}

function stopMetronome() {
    running = false;
    countdownActive = false;
    pendingStop = false;

    if (beatTimerId !== null) {
        clearTimeout(beatTimerId);
        beatTimerId = null;
    }

    ring.style.transition = "none";
    ring.style.strokeDashoffset = 0;

    bpmDisplay.textContent = "--";
    barBeatDisplay.textContent = "Bar -, Beat -";

    startBtn.disabled = false;
    stopBtn.disabled = true;
    statusText.textContent = "Stopped.";
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
