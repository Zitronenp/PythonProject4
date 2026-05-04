// ============================================
// ИСПОРЧЕННЫЙ ТЕЛЕФОН - КЛИЕНТСКАЯ ЛОГИКА
// Фиолетово-сиренево-розовая версия с анимациями
// ============================================

// ────────────────────────────────────────────
// CONSTANTS
// ────────────────────────────────────────────
const CONFIG = {
    CANVAS_WIDTH: 1200,
    CANVAS_HEIGHT: 720,
    MAX_UNDO_STEPS: 30,
    TOAST_ERROR_DURATION: 3000,
    TOAST_SUCCESS_DURATION: 2000,
    STATUS_CHECK_INTERVAL: 30000,
    CANVAS_COLORS: [
        '#FFFFFF', '#000000', '#808080',  // White, Black, Gray
        '#0000FF', '#00BFFF',             // Blue, Light Blue
        '#008000',                         // Green
        '#FF0000',                         // Red
        '#FFFF00', '#FFA500',             // Yellow, Orange
        '#8B4513', '#F5B5B5',             // Brown, Pinkish Beige
        '#FFC0CB', '#800080'              // Pink, Purple
    ],
    DEFAULT_BRUSH_SIZE: 4,
    DEFAULT_OPACITY: 100,
    MIN_BRUSH_SIZE: 1,
    MAX_BRUSH_SIZE: 40
};

// ────────────────────────────────────────────
// GLOBAL VARIABLES
// ────────────────────────────────────────────
const socket = io();
let mySid = null;
let isHost = false;
let hasJoinedGame = false;
let currentPhase = null;
let revealedBranchIndex = 0;
let revealedBranches = [];
let totalBranches = 0;
let lobbyTimerSeconds = 180;
let phraseSubmitted = false;
let drawingSubmitted = false;
let guessSubmitted = false;
let queuedPhaseChange = null;
let phaseTimerId = null;
let phaseEndsAt = 0;
let revealProgressTimerId = null;
let revealVisibleCount = 0;

// Canvas variables
let canvas, ctx;
let strokeCanvas, strokeCtx, strokeBaseImageData;
let drawing = false;
let lastX = 0, lastY = 0;
let currentColor = "#000000";
let currentSize = CONFIG.DEFAULT_BRUSH_SIZE;
let currentOpacity = CONFIG.DEFAULT_OPACITY / 100;
let isErasing = false;
let isFilling = false;
let undoStack = [];
let redoStack = [];

// Current assignment
let currentAssignment = null;

// Prevent duplicate reconnection
let isReconnecting = false;

// ────────────────────────────────────────────
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// ────────────────────────────────────────────
function showError(message) {
    showToast('error-toast', message, CONFIG.TOAST_ERROR_DURATION);
}

function showSuccess(message) {
    showToast('success-toast', message, CONFIG.TOAST_SUCCESS_DURATION);
}

function showToast(toastId, message, duration) {
    const toast = document.getElementById(toastId);
    if (!toast) return;
    
    const msgSpan = toast.querySelector('.toast-message');
    if (msgSpan) {
        msgSpan.textContent = message;
        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), duration);
    }
}

function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(screen => {
        screen.classList.remove('active');
    });
    const targetScreen = document.getElementById(screenId);
    if (targetScreen) {
        targetScreen.classList.add('active');

        const card = targetScreen.querySelector('.card');
        if (card) {
            card.style.animation = 'none';
            setTimeout(() => {
                card.style.animation = 'slideInUp 0.5s ease forwards';
            }, 10);
        }
    }
}

function triggerConfetti() {
    if (typeof canvasConfetti === 'function') {
        canvasConfetti({
            particleCount: 100,
            spread: 70,
            origin: { y: 0.6 },
            colors: ['#a855f7', '#c084fc', '#f472b6', '#ec4899', '#d8b4fe']
        });
    }
}

function triggerSuccessAnimation() {
    if (typeof canvasConfetti === 'function') {
        canvasConfetti({
            particleCount: 30,
            spread: 45,
            origin: { y: 0.8 },
            colors: ['#a855f7', '#c084fc', '#f472b6']
        });
    }
}

function playButtonSound() {
    if (navigator.vibrate) {
        navigator.vibrate(50);
    }
}

function formatTimer(seconds) {
    const safeSeconds = Math.max(0, Number(seconds) || 0);
    const minutes = Math.floor(safeSeconds / 60);
    const remainder = safeSeconds % 60;
    return `${minutes}:${String(remainder).padStart(2, '0')}`;
}

function ensureLobbyTimerControls() {
    const lobbyBody = document.querySelector('#lobby-screen .card-body');
    const startBtn = document.getElementById('start-btn');
    if (!lobbyBody || !startBtn || document.getElementById('timer-settings')) return;

    const timerSettings = document.createElement('div');
    timerSettings.id = 'timer-settings';
    timerSettings.className = 'timer-settings';
    timerSettings.innerHTML = `
        <label class="timer-label" for="timer-minutes-input">Таймер раунда</label>
        <div class="timer-control-row">
            <input id="timer-minutes-input" class="input-styled timer-input" type="number" min="0" max="30" step="1" value="3">
            <span class="timer-unit">мин</span>
        </div>
    `;

    lobbyBody.insertBefore(timerSettings, startBtn);

    const timerInput = document.getElementById('timer-minutes-input');
    if (timerInput) {
        timerInput.addEventListener('change', () => {
            const minutes = Math.max(0, Math.min(Number(timerInput.value) || 0, 30));
            timerInput.value = String(minutes);
            socket.emit('host_set_timer', { timer_seconds: minutes * 60 });
        });
    }
}

function updateLobbyTimerControls(data) {
    lobbyTimerSeconds = Number(data.timer_seconds ?? lobbyTimerSeconds) || 0;
    ensureLobbyTimerControls();

    const timerSettings = document.getElementById('timer-settings');
    const timerInput = document.getElementById('timer-minutes-input');
    if (timerSettings) timerSettings.style.display = isHost ? 'flex' : 'none';
    if (timerInput && document.activeElement !== timerInput) {
        timerInput.value = String(Math.round(lobbyTimerSeconds / 60));
    }
}

function stopPhaseTimer() {
    if (phaseTimerId) {
        clearInterval(phaseTimerId);
        phaseTimerId = null;
    }
    const timerElement = document.getElementById('phase-timer');
    if (timerElement) {
        timerElement.style.display = 'none';
        timerElement.classList.remove('timer-warning');
    }
    phaseEndsAt = 0;
}

function startPhaseTimer(seconds, onExpire) {
    stopPhaseTimer();
    const timerSeconds = Number(seconds) || 0;
    let timerElement = document.getElementById('phase-timer');
    const activeBody = document.querySelector('.screen.active .card-body');
    if (timerElement && activeBody && !activeBody.contains(timerElement)) {
        activeBody.insertBefore(timerElement, activeBody.firstChild?.nextSibling || activeBody.firstChild);
    }
    if (!timerElement) {
        if (activeBody) {
            timerElement = document.createElement('div');
            timerElement.id = 'phase-timer';
            timerElement.className = 'phase-timer';
            activeBody.insertBefore(timerElement, activeBody.firstChild?.nextSibling || activeBody.firstChild);
        }
    }
    if (!timerElement || timerSeconds <= 0) {
        if (timerElement) timerElement.style.display = 'none';
        return;
    }

    phaseEndsAt = Date.now() + timerSeconds * 1000;
    timerElement.style.display = 'inline-flex';

    const update = () => {
        const remaining = Math.max(0, Math.ceil((phaseEndsAt - Date.now()) / 1000));
        timerElement.textContent = `⏱ ${formatTimer(remaining)}`;
        timerElement.classList.toggle('timer-warning', remaining <= 10);
        if (remaining <= 0) {
            stopPhaseTimer();
            onExpire();
        }
    };

    update();
    phaseTimerId = setInterval(update, 250);
}

function stopRevealProgression() {
    if (revealProgressTimerId) {
        clearInterval(revealProgressTimerId);
        revealProgressTimerId = null;
    }
}

// ────────────────────────────────────────────
// ОБНОВЛЕНИЕ ЛОББИ
// ────────────────────────────────────────────
function updateLobbyList(data) {
    isHost = (data.host_sid === mySid);
    const list = document.getElementById('player-list');

    if (list) {
        if (data.players && data.players.length > 0) {
            list.innerHTML = data.players.map((p, index) =>
                `<li style="animation-delay: ${index * 0.05}s" class="animate-slide-up">
                    ${p.is_host ? '👑' : '🎨'} ${escapeHtml(p.nick)}
                </li>`
            ).join('');
        } else {
            list.innerHTML = '<li>👥 Ожидание игроков...</li>';
        }
    }

    const canStart = data.players && data.players.length >= 2;
    const startBtn = document.getElementById('start-btn');

    if (startBtn) {
        if (isHost && canStart && (!currentPhase || currentPhase === 'lobby')) {
            startBtn.style.display = 'block';
            startBtn.classList.add('animate-pulse');
        } else {
            startBtn.style.display = 'none';
            startBtn.classList.remove('animate-pulse');
        }
    }

    const lobbyTitle = document.getElementById('lobby-title');
    const lobbyText = document.getElementById('lobby-text');
    if (lobbyTitle && lobbyText && (!currentPhase || currentPhase === 'lobby')) {
        lobbyTitle.innerHTML = isHost ? '👋 Лобби (Вы хост)' : '👋 Лобби';
        lobbyText.innerHTML = isHost
            ? 'Нажмите кнопку ниже, чтобы начать игру!'
            : 'Ожидание начала игры...';
    }
}

// ────────────────────────────────────────────
// ОБНОВЛЕНИЕ ЭКРАНА РЕЗУЛЬТАТОВ
// ────────────────────────────────────────────
function updateRevealUI() {
    const branchCounter = document.getElementById('branch-counter');
    const revealSteps = document.getElementById('reveal-steps');
    const nextBtn = document.getElementById('next-branch-btn');
    const newGameBtn = document.getElementById('new-game-btn');
    const spectatorWait = document.getElementById('spectator-wait');

    if (!branchCounter || !revealSteps) return;
    stopRevealProgression();

    if (revealedBranchIndex >= totalBranches) {
        branchCounter.textContent = '🎉 Игра завершена! 🎉';
        if (nextBtn) nextBtn.style.display = 'none';
        if (newGameBtn) newGameBtn.style.display = isHost ? 'block' : 'none';
        if (spectatorWait) spectatorWait.style.display = 'none';
        revealSteps.innerHTML = '<div class="celebrate-pop" style="text-align:center; padding: 40px;"><div style="font-size: 3em;">🎨✨🎭</div><p style="margin-top: 20px; color: #a855f7; font-weight: 600;">Все цепочки показаны!</p></div>';

        triggerConfetti();
        return;
    }

    branchCounter.textContent = `📖 Ветка ${revealedBranchIndex + 1} из ${totalBranches}`;
    if (nextBtn) nextBtn.style.display = isHost ? 'block' : 'none';
    if (newGameBtn) newGameBtn.style.display = 'none';
    if (spectatorWait) spectatorWait.style.display = isHost ? 'none' : 'block';

    const branch = revealedBranches[revealedBranchIndex];
    if (!branch) return;

    revealVisibleCount = 1;

    const renderVisibleSteps = () => {
        const shownSteps = branch.chain.slice(0, revealVisibleCount);
        let html = '';

        shownSteps.forEach((step, i) => {
            const content = step.type === 'text'
                ? `<div class="content-text">📝 ${escapeHtml(step.content)}</div>`
                : `<img src="${step.content}" alt="Рисунок" loading="lazy">`;

            html += `
                <div class="reveal-step animate-slide-up">
                    <div class="nick">🎨 ${escapeHtml(step.author_nick)}</div>
                    <div class="content">${content}</div>
                </div>
            `;
            if (i < shownSteps.length - 1) {
                html += `<div class="reveal-arrow">👇</div>`;
            }
        });

        revealSteps.innerHTML = html;
        const lastStep = revealSteps.lastElementChild;
        if (lastStep?.scrollIntoView) {
            lastStep.scrollIntoView({ behavior: 'smooth', block: 'end' });
        }
    };

    renderVisibleSteps();

    if (branch.chain.length > 1) {
        revealProgressTimerId = setInterval(() => {
            revealVisibleCount += 1;
            renderVisibleSteps();
            if (revealVisibleCount >= branch.chain.length) {
                stopRevealProgression();
            }
        }, 3000);
    }
}

// ────────────────────────────────────────────
// ОБРАБОТКА ИГРОВЫХ ФАЗ
// ────────────────────────────────────────────
function handleGamePhase(data) {
    currentPhase = data.phase;

    switch (data.phase) {
        case 'writing':
            stopPhaseTimer();
            phraseSubmitted = false;
            showScreen('writing-screen');
            const phraseInput = document.getElementById('phrase-input');
            if (phraseInput) {
                phraseInput.value = '';
                phraseInput.disabled = false;
                phraseInput.focus();
            }
            const submitPhraseBtn = document.getElementById('submit-phrase-btn');
            if (submitPhraseBtn) submitPhraseBtn.disabled = false;
            const writingStatus = document.getElementById('writing-status');
            if (writingStatus) writingStatus.innerHTML = '✍️ Придумайте интересную фразу...';
            startPhaseTimer(data.timer_seconds, () => {
                if (!phraseSubmitted) submitPhrase(true);
            });
            break;

        case 'drawing':
            drawingSubmitted = false;
            queuedPhaseChange = null;
            showScreen('drawing-screen');
            const assignment = data.assignments?.[mySid];
            if (assignment) {
                currentAssignment = assignment;
                const drawingPrompt = document.getElementById('drawing-prompt');
                if (drawingPrompt) {
                    drawingPrompt.innerHTML = `🎯 Нарисуйте: <strong style="color: #ec4899;">"${escapeHtml(assignment.content)}"</strong>`;
                }
            }
            initCanvas();
            const submitDrawingBtn = document.getElementById('submit-drawing-btn');
            if (submitDrawingBtn) submitDrawingBtn.disabled = false;
            const drawingStatus = document.getElementById('drawing-status');
            if (drawingStatus) drawingStatus.innerHTML = '🖌️ Рисуйте!';
            startPhaseTimer(data.timer_seconds, () => {
                if (!drawingSubmitted) {
                    showSuccess('Время вышло, отправляю текущий рисунок.');
                    submitDrawing(true);
                }
            });
            break;

        case 'guessing':
            stopPhaseTimer();
            guessSubmitted = false;
            showScreen('guessing-screen');
            const guessAssignment = data.assignments?.[mySid];
            if (guessAssignment) {
                currentAssignment = guessAssignment;
                const imgElement = document.getElementById('guess-image');
                if (imgElement) {
                    imgElement.src = guessAssignment.content;
                    imgElement.alt = 'Рисунок для угадывания';
                    imgElement.classList.add('animate-scale-in');
                    setTimeout(() => imgElement.classList.remove('animate-scale-in'), 500);
                }
            }
            const guessInput = document.getElementById('guess-input');
            if (guessInput) {
                guessInput.value = '';
                guessInput.disabled = false;
                guessInput.focus();
            }
            const submitGuessBtn = document.getElementById('submit-guess-btn');
            if (submitGuessBtn) submitGuessBtn.disabled = false;
            const guessingStatus = document.getElementById('guessing-status');
            if (guessingStatus) guessingStatus.innerHTML = '👁️ Что здесь нарисовано?';
            startPhaseTimer(data.timer_seconds, () => {
                if (!guessSubmitted) submitGuess(true);
            });
            break;

        case 'lobby':
            stopPhaseTimer();
            showScreen('lobby-screen');
            const lobbyTitle = document.getElementById('lobby-title');
            const lobbyText = document.getElementById('lobby-text');
            if (lobbyTitle) lobbyTitle.innerHTML = data.message ? '👋 Игра завершена' : '👋 Лобби';
            if (lobbyText) lobbyText.innerHTML = data.message || 'Хост может запустить новую игру';
            currentPhase = 'lobby';
            break;

        case 'reveal':
            break;
    }
}

// ────────────────────────────────────────────
// CANVAS ФУНКЦИИ (УЛУЧШЕННАЯ ВЕРСИЯ)
// ────────────────────────────────────────────

// Save canvas state for undo
function saveToUndo() {
    if (!canvas || !ctx) return;
    
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    undoStack.push(imageData);
    redoStack = [];

    // Limit undo stack size
    while (undoStack.length > CONFIG.MAX_UNDO_STEPS) {
        undoStack.shift();
    }
}

// Undo last action
function undo() {
    if (undoStack.length === 0) {
        showError('Нечего отменять!');
        return;
    }

    const currentState = ctx.getImageData(0, 0, canvas.width, canvas.height);
    redoStack.push(currentState);

    const previousState = undoStack.pop();
    ctx.putImageData(previousState, 0, 0);

    animateCanvasContainer('animate-wobble');
}

// Redo action
function redo() {
    if (redoStack.length === 0) {
        showError('Нечего повторять!');
        return;
    }

    const currentState = ctx.getImageData(0, 0, canvas.width, canvas.height);
    undoStack.push(currentState);

    const nextState = redoStack.pop();
    ctx.putImageData(nextState, 0, 0);

    animateCanvasContainer('animate-wobble');
}

function animateCanvasContainer(animationClass) {
    const container = document.querySelector('.canvas-container');
    if (container) {
        container.classList.add(animationClass);
        setTimeout(() => container.classList.remove(animationClass), 500);
    }
}

function setupStrokeLayer() {
    if (!canvas) return;

    strokeCanvas = document.createElement('canvas');
    strokeCanvas.width = canvas.width;
    strokeCanvas.height = canvas.height;
    strokeCtx = strokeCanvas.getContext('2d');
    strokeCtx.lineCap = 'round';
    strokeCtx.lineJoin = 'round';
}

function renderStrokePreview() {
    if (!ctx || !strokeCanvas || !strokeBaseImageData) return;

    ctx.putImageData(strokeBaseImageData, 0, 0);
    ctx.save();
    ctx.globalAlpha = isErasing ? 1 : currentOpacity;
    ctx.drawImage(strokeCanvas, 0, 0);
    ctx.restore();
}

// Draw a continuous stroke with opacity
function startStroke(x, y) {
    if (!ctx || !strokeCtx) return;

    drawing = true;
    [lastX, lastY] = [x, y];
    strokeBaseImageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

    strokeCtx.clearRect(0, 0, strokeCanvas.width, strokeCanvas.height);
    strokeCtx.globalAlpha = 1;
    strokeCtx.strokeStyle = isErasing ? '#FFFFFF' : currentColor;
    strokeCtx.fillStyle = isErasing ? '#FFFFFF' : currentColor;
    strokeCtx.lineWidth = currentSize;
    strokeCtx.beginPath();
    strokeCtx.arc(lastX, lastY, currentSize / 2, 0, Math.PI * 2);
    strokeCtx.fill();
    strokeCtx.beginPath();
    strokeCtx.moveTo(lastX, lastY);

    renderStrokePreview();
}

function drawStroke(x, y) {
    if (!drawing || !strokeCtx) return;

    strokeCtx.lineTo(x, y);
    strokeCtx.stroke();
    [lastX, lastY] = [x, y];
    renderStrokePreview();
}

function endStroke() {
    if (!ctx || !drawing) return;
    renderStrokePreview();
    drawing = false;
    if (strokeCtx) {
        strokeCtx.closePath();
        strokeCtx.clearRect(0, 0, strokeCanvas.width, strokeCanvas.height);
    }
    strokeBaseImageData = null;
    ctx.globalAlpha = 1;
}

function updateToolButtons() {
    const eraserBtn = document.getElementById('eraser-btn');
    const fillBtn = document.getElementById('fill-canvas-btn');

    if (eraserBtn) eraserBtn.classList.toggle('active', isErasing);
    if (fillBtn) fillBtn.classList.toggle('active', isFilling);
    if (eraserBtn) eraserBtn.setAttribute('aria-pressed', String(isErasing));
    if (fillBtn) fillBtn.setAttribute('aria-pressed', String(isFilling));
    if (canvas) canvas.style.cursor = isFilling ? 'cell' : 'crosshair';
}

function getCurrentColorRgb() {
    const hex = normalizeColorToHex(currentColor);
    return [
        parseInt(hex.slice(1, 3), 16),
        parseInt(hex.slice(3, 5), 16),
        parseInt(hex.slice(5, 7), 16),
    ];
}

function blendFillColor(targetColor) {
    const source = getCurrentColorRgb();
    const alpha = isErasing ? 1 : currentOpacity;
    const inverseAlpha = 1 - alpha;
    const targetAlpha = targetColor[3] / 255;
    const outputAlpha = alpha + targetAlpha * inverseAlpha;

    if (outputAlpha === 0) return [source[0], source[1], source[2], 0];

    return [
        Math.round((source[0] * alpha + targetColor[0] * targetAlpha * inverseAlpha) / outputAlpha),
        Math.round((source[1] * alpha + targetColor[1] * targetAlpha * inverseAlpha) / outputAlpha),
        Math.round((source[2] * alpha + targetColor[2] * targetAlpha * inverseAlpha) / outputAlpha),
        Math.round(outputAlpha * 255),
    ];
}

function colorsMatch(data, index, color) {
    return (
        data[index] === color[0] &&
        data[index + 1] === color[1] &&
        data[index + 2] === color[2] &&
        data[index + 3] === color[3]
    );
}

function colorsClose(data, index, color, tolerance = 48) {
    return (
        Math.abs(data[index] - color[0]) <= tolerance &&
        Math.abs(data[index + 1] - color[1]) <= tolerance &&
        Math.abs(data[index + 2] - color[2]) <= tolerance &&
        Math.abs(data[index + 3] - color[3]) <= tolerance
    );
}

function paintBucketFill(x, y) {
    if (!ctx || !canvas) return;

    const startX = Math.floor(x);
    const startY = Math.floor(y);
    if (startX < 0 || startY < 0 || startX >= canvas.width || startY >= canvas.height) return;

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    const startIndex = (startY * canvas.width + startX) * 4;
    const targetColor = [
        data[startIndex],
        data[startIndex + 1],
        data[startIndex + 2],
        data[startIndex + 3],
    ];
    const fillColor = blendFillColor(targetColor);

    if (colorsClose(data, startIndex, fillColor, 3)) return;

    saveToUndo();

    const visited = new Uint8Array(canvas.width * canvas.height);
    const stack = [startY * canvas.width + startX];
    while (stack.length > 0) {
        const pixelIndex = stack.pop();
        if (visited[pixelIndex]) continue;
        visited[pixelIndex] = 1;

        const index = pixelIndex * 4;
        if (!colorsClose(data, index, targetColor)) continue;

        data[index] = fillColor[0];
        data[index + 1] = fillColor[1];
        data[index + 2] = fillColor[2];
        data[index + 3] = fillColor[3];

        const px = pixelIndex % canvas.width;
        const py = Math.floor(pixelIndex / canvas.width);
        if (px + 1 < canvas.width) stack.push(pixelIndex + 1);
        if (px > 0) stack.push(pixelIndex - 1);
        if (py + 1 < canvas.height) stack.push(pixelIndex + canvas.width);
        if (py > 0) stack.push(pixelIndex - canvas.width);
    }

    ctx.putImageData(imageData, 0, 0);
}

function toggleFill() {
    isFilling = !isFilling;
    if (isFilling) {
        isErasing = false;
    }
    updateToolButtons();
}

// Toggle eraser
function toggleEraser() {
    isErasing = !isErasing;
    isFilling = false;
    updateToolButtons();
    
    if (isErasing) {
        showSuccess('Ластик активирован! 🧽');
    }
}

// Очистить весь холст с подтверждением
function clearCanvasWithConfirm() {
    if (confirm('🗑️ Очистить весь рисунок? Отменить будет нельзя!')) {
        clearCanvas();
        triggerSuccessAnimation();
    }
}

function clearCanvas() {
    if (!ctx) return;

    if (undoStack.length === 0 || !isSameAsLastState()) {
        saveToUndo();
    }
    
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = currentColor;
    ctx.lineWidth = currentSize;

    animateCanvasContainer('animate-shake');
}

function isSameAsLastState() {
    if (undoStack.length === 0) return false;
    const lastState = undoStack[undoStack.length - 1];
    const currentState = ctx.getImageData(0, 0, canvas.width, canvas.height);

    if (lastState.data.length !== currentState.data.length) return false;
    for (let i = 0; i < lastState.data.length; i++) {
        if (lastState.data[i] !== currentState.data[i]) return false;
    }
    return true;
}

// Add eraser button once
let eraserButtonAdded = false;
function addEraserButton() {
    if (eraserButtonAdded) return;
    
    const toolPanel = document.getElementById('tool-panel');
    if (toolPanel && !document.getElementById('eraser-btn')) {
        const eraserBtn = document.createElement('button');
        eraserBtn.id = 'eraser-btn';
        eraserBtn.className = 'btn btn-secondary tool-action-btn';
        eraserBtn.innerHTML = '🧽 Ластик';
        eraserBtn.onclick = toggleEraser;
        toolPanel.appendChild(eraserBtn);
        eraserButtonAdded = true;
    }
}

// Add undo/redo buttons once
let undoRedoButtonsAdded = false;
function addUndoRedoButtons() {
    if (undoRedoButtonsAdded) return;
    
    const toolPanel = document.getElementById('tool-panel');
    const buttonGroup = document.querySelector('#drawing-screen .button-group');
    if (toolPanel) {
        if (!document.getElementById('undo-btn')) {
            const undoBtn = document.createElement('button');
            undoBtn.id = 'undo-btn';
            undoBtn.className = 'btn btn-secondary tool-action-btn';
            undoBtn.innerHTML = '↩️ Отменить';
            undoBtn.onclick = undo;
            toolPanel.appendChild(undoBtn);
        }

        if (!document.getElementById('redo-btn')) {
            const redoBtn = document.createElement('button');
            redoBtn.id = 'redo-btn';
            redoBtn.className = 'btn btn-secondary tool-action-btn';
            redoBtn.innerHTML = '↪️ Повторить';
            redoBtn.onclick = redo;
            toolPanel.appendChild(redoBtn);
        }

        if (!document.getElementById('fill-canvas-btn')) {
            const fillBtn = document.createElement('button');
            fillBtn.id = 'fill-canvas-btn';
            fillBtn.className = 'btn btn-secondary tool-action-btn';
            fillBtn.innerHTML = '🪣 Заливка';
            fillBtn.onclick = toggleFill;
            toolPanel.appendChild(fillBtn);
        }

        if (!document.getElementById('clear-canvas-btn')) {
            const newClearBtn = document.createElement('button');
            newClearBtn.id = 'clear-canvas-btn';
            newClearBtn.className = 'btn btn-secondary tool-action-btn';
            newClearBtn.innerHTML = '🗑️ Очистить всё';
            newClearBtn.onclick = clearCanvasWithConfirm;
            toolPanel.appendChild(newClearBtn);
        }

        // Hide old clear button
        const oldClearBtn = buttonGroup?.querySelector('button[onclick="window.clearCanvas?.()"]');
        if (oldClearBtn) {
            oldClearBtn.style.display = 'none';
        }
        
        undoRedoButtonsAdded = true;
    }
}

function renderColorPalette() {
    const palette = document.getElementById('palette');
    if (!palette) return;

    palette.innerHTML = '';

    CONFIG.CANVAS_COLORS.forEach(color => {
        const btn = document.createElement('div');
        btn.className = 'color-btn';
        if (color.toUpperCase() === currentColor.toUpperCase() && !isErasing) {
            btn.classList.add('active');
        }
        btn.style.backgroundColor = color;
        btn.setAttribute('data-color', color);
        btn.onclick = () => setDrawingColor(color, btn);
        palette.appendChild(btn);
    });

    // Add color picker
    const pickerWrapper = document.createElement('label');
    pickerWrapper.className = 'color-picker-wrapper';
    pickerWrapper.title = 'Цветовой круг';

    const pickerText = document.createElement('span');
    pickerText.className = 'color-picker-label';
    pickerText.textContent = 'Цветовой круг';

    const colorPicker = document.createElement('input');
    colorPicker.type = 'color';
    colorPicker.id = 'color-wheel';
    colorPicker.className = 'color-wheel';
    colorPicker.value = normalizeColorToHex(currentColor);
    colorPicker.oninput = (event) => {
        setDrawingColor(event.target.value);
    };

    pickerWrapper.appendChild(pickerText);
    pickerWrapper.appendChild(colorPicker);
    palette.appendChild(pickerWrapper);
}

function normalizeColorToHex(color) {
    if (!color) return '#000000';
    if (color.startsWith('#')) {
        if (color.length === 4) {
            return `#${color[1]}${color[1]}${color[2]}${color[2]}${color[3]}${color[3]}`;
        }
        return color;
    }

    const temp = document.createElement('canvas').getContext('2d');
    temp.fillStyle = color;
    const normalized = temp.fillStyle;
    return normalized.startsWith('#') ? normalized : '#000000';
}

// Set drawing color
function setDrawingColor(color, sourceBtn = null) {
    if (isErasing) toggleEraser();
    updateToolButtons();
    
    currentColor = color;

    document.querySelectorAll('.color-btn').forEach(b => {
        b.classList.toggle('active', b === sourceBtn);
    });

    const colorPicker = document.getElementById('color-wheel');
    if (colorPicker) {
        colorPicker.value = normalizeColorToHex(color);
    }

}

function ensureDrawingLayout() {
    const drawingBody = document.querySelector('#drawing-screen .card-body');
    const promptBox = document.getElementById('drawing-prompt');
    const palette = document.getElementById('palette');
    const brushControls = document.getElementById('brush-controls');
    const canvasContainer = document.querySelector('#drawing-screen .canvas-container');
    const buttonGroup = document.querySelector('#drawing-screen .button-group');
    const drawingStatus = document.getElementById('drawing-status');

    if (!drawingBody || !promptBox || !palette || !brushControls || !canvasContainer || !buttonGroup) return;
    if (document.querySelector('#drawing-screen .drawing-layout')) return;

    const phaseTimer = document.getElementById('phase-timer') || document.createElement('div');
    phaseTimer.id = 'phase-timer';
    phaseTimer.className = 'phase-timer';
    phaseTimer.style.display = 'none';

    const layout = document.createElement('div');
    layout.className = 'drawing-layout';

    const toolsPanel = document.createElement('aside');
    toolsPanel.className = 'drawing-side drawing-tools';
    toolsPanel.innerHTML = '<div class="side-title">Инструменты</div><div id="tool-panel" class="tool-panel"></div>';

    const mainPanel = document.createElement('main');
    mainPanel.className = 'drawing-main';

    const colorsPanel = document.createElement('aside');
    colorsPanel.className = 'drawing-side drawing-colors';
    colorsPanel.innerHTML = '<div class="side-title">Цвет</div>';

    const bottomBar = document.createElement('div');
    bottomBar.className = 'drawing-bottom-bar';

    buttonGroup.classList.add('drawing-submit-group');
    mainPanel.appendChild(canvasContainer);
    colorsPanel.appendChild(palette);
    bottomBar.appendChild(brushControls);
    bottomBar.appendChild(buttonGroup);

    layout.appendChild(toolsPanel);
    layout.appendChild(mainPanel);
    layout.appendChild(colorsPanel);

    promptBox.after(phaseTimer);
    phaseTimer.after(layout);
    layout.after(bottomBar);
    if (drawingStatus) bottomBar.after(drawingStatus);
}

function initCanvas() {
    ensureDrawingLayout();
    canvas = document.getElementById('draw-canvas');
    if (!canvas) return;

    ctx = canvas.getContext('2d');
    isErasing = false;
    isFilling = false;

    // Set canvas dimensions
    canvas.width = CONFIG.CANVAS_WIDTH;
    canvas.height = CONFIG.CANVAS_HEIGHT;

    // Style canvas
    canvas.style.width = '100%';
    canvas.style.height = 'auto';
    canvas.style.maxWidth = `${CONFIG.CANVAS_WIDTH}px`;
    canvas.style.borderRadius = '16px';
    canvas.style.boxShadow = '0 10px 30px rgba(139, 92, 246, 0.2)';

    // Initialize canvas context
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = currentColor;
    ctx.lineWidth = currentSize;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    setupStrokeLayer();

    // Reset undo/redo stacks
    undoStack = [];
    redoStack = [];
    saveToUndo();

    renderColorPalette();
    setupBrushSliders();
    addEraserButton();
    addUndoRedoButtons();
    updateToolButtons();

    setupCanvasEvents();
}

function setupBrushSliders() {
    const sizeSlider = document.getElementById('brush-size-slider');
    const sizeValue = document.getElementById('brush-size-value');
    const opacitySlider = document.getElementById('brush-opacity-slider');
    const opacityValue = document.getElementById('brush-opacity-value');

    if (sizeSlider && sizeValue) {
        sizeSlider.min = String(CONFIG.MIN_BRUSH_SIZE);
        sizeSlider.max = String(CONFIG.MAX_BRUSH_SIZE);
        sizeSlider.value = String(currentSize);
        sizeValue.textContent = String(currentSize);

        sizeSlider.oninput = (event) => {
            currentSize = Number(event.target.value);
            sizeValue.textContent = String(currentSize);
            if (ctx) ctx.lineWidth = currentSize;
        };
    }

    if (opacitySlider && opacityValue) {
        const opacityPercent = Math.round(currentOpacity * 100);
        opacitySlider.value = String(opacityPercent);
        opacityValue.textContent = String(opacityPercent);

        opacitySlider.oninput = (event) => {
            const value = Number(event.target.value);
            currentOpacity = value / 100;
            opacityValue.textContent = String(value);
        };
    }
}

function setupCanvasEvents() {
    const getCoords = (clientX, clientY) => {
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        return [(clientX - rect.left) * scaleX, (clientY - rect.top) * scaleY];
    };

    // Clear previous event listeners
    canvas.onmousedown = null;
    canvas.onmouseup = null;
    canvas.onmouseout = null;
    canvas.onmousemove = null;
    canvas.ontouchstart = null;
    canvas.ontouchend = null;
    canvas.ontouchmove = null;

    // Mouse events
    canvas.onmousedown = (e) => {
        const [x, y] = getCoords(e.clientX, e.clientY);
        if (isFilling) {
            paintBucketFill(x, y);
            return;
        }

        if (undoStack.length === 0 || !isSameAsLastState()) {
            saveToUndo();
        }

        startStroke(x, y);
    };

    canvas.onmouseup = () => { endStroke(); };
    canvas.onmouseout = () => { endStroke(); };
    canvas.onmousemove = (e) => {
        if (drawing) {
            const [x, y] = getCoords(e.clientX, e.clientY);
            drawStroke(x, y);
        }
    };

    // Touch events
    canvas.ontouchstart = (e) => {
        e.preventDefault();
        const touch = e.touches[0];
        const [x, y] = getCoords(touch.clientX, touch.clientY);
        if (isFilling) {
            paintBucketFill(x, y);
            return;
        }

        if (undoStack.length === 0 || !isSameAsLastState()) {
            saveToUndo();
        }

        startStroke(x, y);
    };
    canvas.ontouchend = () => { endStroke(); };
    canvas.ontouchmove = (e) => {
        e.preventDefault();
        if (drawing) {
            const touch = e.touches[0];
            const [x, y] = getCoords(touch.clientX, touch.clientY);
            drawStroke(x, y);
        }
    };
}

// ────────────────────────────────────────────
// ОТПРАВКА ДЕЙСТВИЙ
// ────────────────────────────────────────────
function submitPhrase(isAuto = false) {
    const input = document.getElementById('phrase-input');
    if (!input) return;
    if (phraseSubmitted) return;
    const text = input.value.trim() || (isAuto ? 'Не успел' : '');
    if (!text) {
        showError('Введите фразу! ✍️');
        input.classList.add('animate-shake');
        setTimeout(() => input.classList.remove('animate-shake'), 500);
        return;
    }

    phraseSubmitted = true;
    stopPhaseTimer();
    socket.emit('submit_text', { text: text });
    input.disabled = true;
    const submitBtn = document.getElementById('submit-phrase-btn');
    if (submitBtn) submitBtn.disabled = true;
    const statusSpan = document.getElementById('writing-status');
    if (statusSpan) statusSpan.innerHTML = '✅ Отправлено! Ожидание остальных...';
    triggerSuccessAnimation();
    playButtonSound();

}

function submitDrawing(isAuto = false) {
    if (!canvas) return;
    if (drawingSubmitted) return;

    drawingSubmitted = true;
    stopPhaseTimer();
    const imageData = canvas.toDataURL('image/png');
    socket.emit('submit_drawing', { image: imageData, auto: Boolean(isAuto) });
    const submitBtn = document.getElementById('submit-drawing-btn');
    if (submitBtn) submitBtn.disabled = true;
    const statusSpan = document.getElementById('drawing-status');
    if (statusSpan) statusSpan.innerHTML = '✅ Рисунок отправлен! Ожидание...';
    triggerSuccessAnimation();
    playButtonSound();

    if (queuedPhaseChange) {
        const nextPhase = queuedPhaseChange;
        queuedPhaseChange = null;
        applyPhaseChange(nextPhase);
    }
}

function submitGuess(isAuto = false) {
    const input = document.getElementById('guess-input');
    if (!input) return;
    if (guessSubmitted) return;
    const text = input.value.trim() || (isAuto ? 'Не успел' : '');
    if (!text) {
        showError('Введите описание рисунка! 👁️');
        input.classList.add('animate-shake');
        setTimeout(() => input.classList.remove('animate-shake'), 500);
        return;
    }

    guessSubmitted = true;
    stopPhaseTimer();
    socket.emit('submit_guess', { text: text });
    input.disabled = true;
    const submitBtn = document.getElementById('submit-guess-btn');
    if (submitBtn) submitBtn.disabled = true;
    const statusSpan = document.getElementById('guessing-status');
    if (statusSpan) statusSpan.innerHTML = '✅ Отправлено! Ожидание...';
    triggerSuccessAnimation();
    playButtonSound();
}

function startGame() {
    if (isHost) {
        const timerInput = document.getElementById('timer-minutes-input');
        const timerSeconds = timerInput ? Math.max(0, Math.min(Number(timerInput.value) || 0, 30)) * 60 : lobbyTimerSeconds;
        socket.emit('host_start_game', { timer_seconds: timerSeconds });
        showSuccess('Игра начинается! 🚀');
        playButtonSound();
    }
}

function nextBranch() {
    if (isHost) {
        socket.emit('next_reveal_branch');
        playButtonSound();
    }
}

function newGame() {
    if (isHost) {
        socket.emit('host_new_game');
        showSuccess('Новая игра! 🎨');
        playButtonSound();
    }
}

function joinGame() {
    const input = document.getElementById('nickname-input');
    if (!input) return;
    const nickname = input.value.trim();
    if (!nickname) {
        showError('Введите никнейм! ✨');
        input.classList.add('animate-shake');
        setTimeout(() => input.classList.remove('animate-shake'), 500);
        return;
    }
    socket.emit('join_game', { nickname: nickname });
    playButtonSound();
}

// ────────────────────────────────────────────
// SOCKET ОБРАБОТЧИКИ
// ────────────────────────────────────────────
socket.on('connect', () => {
    mySid = socket.id;
    console.log('✅ Подключено к серверу');

    if (currentPhase && currentPhase !== 'lobby') {
        socket.emit('check_game_status');
    }
});

socket.on('connect_error', () => {
    showError('Ошибка подключения к серверу!');
});

socket.on('disconnect', () => {
    showError('Соединение потеряно. Перезагрузите страницу.');
});

socket.on('error', (data) => {
    if (data && data.message) showError(data.message);
});

socket.on('lobby_update', (data) => {
    updateLobbyList(data);
    updateLobbyTimerControls(data);
    if (!hasJoinedGame) return;

    if (!currentPhase || currentPhase === 'lobby' || currentPhase === 'reveal') {
        if (currentPhase !== 'reveal') {
            showScreen('lobby-screen');
        }
    }
});

socket.on('joined_mid_round', (data) => {
    showScreen('lobby-screen');
    const lobbyTitle = document.getElementById('lobby-title');
    const lobbyText = document.getElementById('lobby-text');
    if (lobbyTitle) lobbyTitle.innerHTML = '⏳ Ожидание следующего раунда';
    if (lobbyText) lobbyText.innerHTML = data.message;
    const startBtn = document.getElementById('start-btn');
    if (startBtn) startBtn.style.display = 'none';
});

socket.on('join_success', (data) => {
    hasJoinedGame = true;
    showScreen('lobby-screen');
    isHost = data.is_host;
    showSuccess(`Добро пожаловать! ${isHost ? 'Вы хост' : 'Вы игрок'}`);
});

function applyPhaseChange(data) {
    currentPhase = data.phase;

    if (data.phase === 'reveal') {
        stopPhaseTimer();
        revealedBranches = data.branches || [];
        totalBranches = data.branches?.length || 0;
        revealedBranchIndex = data.current_branch || 0;
        isHost = (data.host_sid === mySid);
        showScreen('reveal-screen');
        updateRevealUI();
        triggerConfetti();
    } else if (data.phase === 'lobby') {
        stopRevealProgression();
        stopPhaseTimer();
        showScreen('lobby-screen');
        const lobbyTitle = document.getElementById('lobby-title');
        const lobbyText = document.getElementById('lobby-text');
        if (lobbyTitle) lobbyTitle.innerHTML = 'Лобби';
        if (lobbyText) lobbyText.innerHTML = data.message || 'Хост может запустить новую игру';
    } else {
        stopRevealProgression();
        handleGamePhase(data);
    }
}

socket.on('phase_change', (data) => {
    if (currentPhase === 'drawing' && !drawingSubmitted && data.phase !== 'drawing') {
        queuedPhaseChange = data;
        const drawingStatus = document.getElementById('drawing-status');
        if (drawingStatus) {
            drawingStatus.innerHTML = 'Игра обновилась. Закончите рисунок и нажмите отправку.';
        }
        return;
    }

    applyPhaseChange(data);
});

socket.on('reveal_update', (data) => {
    revealedBranchIndex = data.current_branch;
    totalBranches = data.total_branches;
    updateRevealUI();
});

socket.on('player_left', (data) => {
    showError(`Игрок "${data.nickname}" покинул игру`);
    if (currentPhase === 'lobby') {
        socket.emit('request_lobby_update');
    }
});

// ────────────────────────────────────────────
// LOAD AND EVENT BINDING
// ────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    // Expose functions to window for inline handlers
    window.joinGame = joinGame;
    window.startGame = startGame;
    window.submitPhrase = submitPhrase;
    window.submitDrawing = submitDrawing;
    window.submitGuess = submitGuess;
    window.clearCanvas = clearCanvas;
    window.nextBranch = nextBranch;
    window.newGame = newGame;
    window.undo = undo;
    window.redo = redo;
    window.toggleEraser = toggleEraser;

    // Setup enter key handlers
    setupInputHandlers();

    // Animate background shapes
    animateBackgroundShapes();

    console.log('🎨 Игра загружена! Приятной игры!');
});

function setupInputHandlers() {
    const nicknameInput = document.getElementById('nickname-input');
    if (nicknameInput) {
        nicknameInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') joinGame();
        });
    }

    // Add click handler for join button
    const joinBtn = document.getElementById('join-btn');
    if (joinBtn) {
        joinBtn.addEventListener('click', joinGame);
    }

    const phraseInput = document.getElementById('phrase-input');
    if (phraseInput) {
        phraseInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') submitPhrase();
        });
    }

    const guessInput = document.getElementById('guess-input');
    if (guessInput) {
        guessInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') submitGuess();
        });
    }
}

function animateBackgroundShapes() {
    const shapes = document.querySelectorAll('.floating-shape');
    shapes.forEach((shape, i) => {
        shape.style.animation = `floatSlow ${15 + i * 2}s ease-in-out infinite`;
        shape.style.animationDelay = `${i * 2}s`;
    });
}

// ────────────────────────────────────────────
// PERIODIC GAME STATUS CHECK
// ────────────────────────────────────────────
setInterval(() => {
    if (currentPhase && currentPhase !== 'lobby' && currentPhase !== 'reveal') {
        socket.emit('check_game_status');
    }
}, CONFIG.STATUS_CHECK_INTERVAL);
