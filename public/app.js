// ============================================================
// app.js — Frontend Logic
// YT Downloader by Charles Nuno
// ============================================================

let selectedQuality = 'best-video';
let toastTimeout = null;

// --- THEME TOGGLE ---
const themeToggle = document.getElementById('themeToggle');
const html = document.documentElement;

// Load saved theme or default to dark
const savedTheme = localStorage.getItem('yt-dl-theme') || 'dark';
html.setAttribute('data-theme', savedTheme);

themeToggle.addEventListener('click', () => {
    const current = html.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    html.setAttribute('data-theme', next);
    localStorage.setItem('yt-dl-theme', next);
});


// --- QUALITY SELECTION ---
document.querySelectorAll('.quality-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.quality-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        selectedQuality = btn.dataset.quality;
    });
});


// --- ENTER KEY on input ---
document.getElementById('videoUrl').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') getVideoInfo();
});


// ============================================================
// URL VALIDATION
// ============================================================
function isValidYouTubeUrl(url) {
    // Accepts youtube.com/watch, youtu.be, youtube.com/shorts, etc.
    const patterns = [
        /^(https?:\/\/)?(www\.)?youtube\.com\/watch\?v=[\w-]+/,
        /^(https?:\/\/)?(www\.)?youtube\.com\/shorts\/[\w-]+/,
        /^(https?:\/\/)?(www\.)?youtube\.com\/embed\/[\w-]+/,
        /^(https?:\/\/)?youtu\.be\/[\w-]+/,
        /^(https?:\/\/)?(www\.)?youtube\.com\/live\/[\w-]+/,
        /^(https?:\/\/)?(m\.)?youtube\.com\/watch\?v=[\w-]+/,
    ];
    return patterns.some(pattern => pattern.test(url));
}


// ============================================================
// TOAST NOTIFICATIONS
// ============================================================
function showToast(type, title, message) {
    const toast = document.getElementById('toast');
    const toastTitle = document.getElementById('toastTitle');
    const toastMessage = document.getElementById('toastMessage');

    // Clear previous
    hideToast();

    // Remove old type classes
    toast.classList.remove('toast-error', 'toast-success', 'toast-warning');
    toast.classList.add(`toast-${type}`);

    toastTitle.textContent = title;
    toastMessage.textContent = message;

    toast.classList.remove('hidden');

    // Auto-hide after 6 seconds
    toastTimeout = setTimeout(() => hideToast(), 6000);
}

function hideToast() {
    const toast = document.getElementById('toast');
    toast.classList.add('hidden');
    if (toastTimeout) {
        clearTimeout(toastTimeout);
        toastTimeout = null;
    }
}


// ============================================================
// GET VIDEO INFO
// ============================================================
async function getVideoInfo() {
    const url = document.getElementById('videoUrl').value.trim();
    const btnInfo = document.getElementById('btnInfo');

    // --- Validations ---
    if (!url) {
        showToast('warning', 'Campo vazio', 'Cola um link do YouTube no campo acima para começar.');
        return;
    }

    if (!isValidYouTubeUrl(url)) {
        showToast('error', 'Link inválido',
            'Este link não parece ser do YouTube. Verifica se copiaste o link correcto (ex: youtube.com/watch?v=... ou youtu.be/...).');
        return;
    }

    // --- Loading state ---
    btnInfo.disabled = true;
    btnInfo.classList.add('btn-loading');
    hideToast();

    try {
        const response = await fetch(`/api/info?url=${encodeURIComponent(url)}`);
        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Não foi possível obter informações do vídeo.');
        }

        // Populate video card
        document.getElementById('thumbnail').src = data.thumbnail;
        document.getElementById('videoTitle').textContent = data.title;
        document.getElementById('videoUploader').textContent = data.uploader;
        document.getElementById('videoDuration').textContent = data.duration;

        // Show sections, hide empty state
        document.getElementById('emptyState').classList.add('hidden');
        document.getElementById('videoInfo').classList.remove('hidden');
        document.getElementById('qualitySection').classList.remove('hidden');

        // Hide progress from any previous download
        document.getElementById('progressSection').classList.add('hidden');

    } catch (error) {
        showToast('error', 'Erro ao buscar vídeo',
            error.message === 'Failed to fetch'
                ? 'Não foi possível conectar ao servidor. Verifica se o servidor está a correr (node server.js).'
                : error.message
        );
    } finally {
        btnInfo.disabled = false;
        btnInfo.classList.remove('btn-loading');
    }
}


// ============================================================
// CREDITS MODAL
// ============================================================
function showCreditsModal() {
    return new Promise((resolve) => {
        const modal = document.getElementById('creditsModal');
        const btnContinue = document.getElementById('modalContinue');

        modal.classList.remove('hidden');

        // Close on "Continue" button
        function onContinue() {
            modal.classList.add('hidden');
            btnContinue.removeEventListener('click', onContinue);
            modal.removeEventListener('click', onOverlayClick);
            resolve();
        }

        // Close on overlay click
        function onOverlayClick(e) {
            if (e.target === modal) {
                modal.classList.add('hidden');
                btnContinue.removeEventListener('click', onContinue);
                modal.removeEventListener('click', onOverlayClick);
                resolve();
            }
        }

        btnContinue.addEventListener('click', onContinue);
        modal.addEventListener('click', onOverlayClick);
    });
}


// ============================================================
// START DOWNLOAD
// ============================================================
async function startDownload() {
    const url = document.getElementById('videoUrl').value.trim();
    const btnDownload = document.getElementById('btnDownload');

    if (!url) return;

    // Show credits modal first
    await showCreditsModal();

    // Disable button
    btnDownload.disabled = true;
    btnDownload.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/>
            <line x1="12" y1="15" x2="12" y2="3"/>
        </svg>
        <span>A baixar...</span>
    `;

    // Show progress
    const progressSection = document.getElementById('progressSection');
    progressSection.classList.remove('hidden');
    document.getElementById('progressBar').style.width = '0%';
    document.getElementById('progressPercent').textContent = '0%';
    document.getElementById('progressDetail').textContent = 'A iniciar...';
    hideToast();

    // SSE connection
    const eventSource = new EventSource(
        `/api/download?url=${encodeURIComponent(url)}&quality=${selectedQuality}`
    );

    eventSource.onmessage = (event) => {
        const data = JSON.parse(event.data);

        switch (data.type) {
            case 'progress':
                const percent = Math.round(data.percent);
                document.getElementById('progressBar').style.width = `${percent}%`;
                document.getElementById('progressPercent').textContent = `${percent}%`;

                // Clean up the raw output for display
                const detail = data.raw
                    .replace(/\[download\]\s*/, '')
                    .replace(/\[.*?\]\s*/, '')
                    .trim();
                document.getElementById('progressDetail').textContent = detail || 'A processar...';
                break;

            case 'complete':
                document.getElementById('progressBar').style.width = '100%';
                document.getElementById('progressPercent').textContent = '100%';
                document.getElementById('progressDetail').textContent = 'Concluído';

                showToast('success', 'Download concluído',
                    'O ficheiro foi guardado na pasta "downloads" do projecto. Bom proveito!');

                eventSource.close();
                resetDownloadButton();
                break;

            case 'error':
                showToast('error', 'Erro no download',
                    data.message || 'Algo correu mal durante o download. Tenta novamente.');
                eventSource.close();
                resetDownloadButton();
                break;

            case 'info':
                document.getElementById('progressDetail').textContent = data.message
                    .replace(/\[.*?\]\s*/, '')
                    .trim();
                break;
        }
    };

    eventSource.onerror = () => {
        showToast('error', 'Conexão perdida',
            'A ligação com o servidor foi interrompida. Verifica se o servidor ainda está a correr.');
        eventSource.close();
        resetDownloadButton();
    };
}


// ============================================================
// HELPERS
// ============================================================
function resetDownloadButton() {
    const btn = document.getElementById('btnDownload');
    btn.disabled = false;
    btn.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/>
            <line x1="12" y1="15" x2="12" y2="3"/>
        </svg>
        <span>Baixar</span>
    `;
}