// ============================================================
// popup.js — YT Downloader Extension Logic
// ============================================================

const SERVER_URL = 'http://localhost:3000';
let selectedQuality = 'best-video';
let toastTimeout = null;
let serverOnline = false;

// ============================================================
// INIT
// ============================================================
document.addEventListener('DOMContentLoaded', async () => {
    loadTheme();
    await checkServer();
    if (serverOnline) {
        autoFillUrl();
    }
});

// --- Theme ---
function loadTheme() {
    // Extensions use chrome.storage instead of localStorage
    chrome.storage.local.get('theme', (result) => {
        const theme = result.theme || 'dark';
        document.documentElement.setAttribute('data-theme', theme);
    });
}

document.getElementById('themeToggle').addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    chrome.storage.local.set({ theme: next });
});

// --- Quality Selection ---
document.querySelectorAll('.quality-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.quality-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        selectedQuality = btn.dataset.quality;
    });
});

// --- Enter key ---
document.getElementById('videoUrl').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') getVideoInfo();
});

// --- Button listeners ---
document.getElementById('btnInfo').addEventListener('click', getVideoInfo);
document.getElementById('btnDownload').addEventListener('click', startDownload);


// ============================================================
// AUTO-FILL URL FROM ACTIVE TAB
// ============================================================
function autoFillUrl() {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0] && tabs[0].url) {
            const url = tabs[0].url;
            if (isValidYouTubeUrl(url)) {
                document.getElementById('videoUrl').value = url;
                // Auto-fetch info
                getVideoInfo();
            }
        }
    });
}


// ============================================================
// SERVER CHECK
// ============================================================
async function checkServer() {
    const statusEl = document.getElementById('serverStatus');

    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 3000);

        const response = await fetch(`${SERVER_URL}/api/health`, {
            method: 'GET',
            mode: 'cors',
            signal: controller.signal
        });

        clearTimeout(timeout);

        if (response.ok) {
            serverOnline = true;
            statusEl.className = 'server-status online';
            statusEl.querySelector('span').textContent = 'Servidor local activo';
        } else {
            throw new Error();
        }
    } catch {
        serverOnline = false;
        statusEl.className = 'server-status offline';
        statusEl.querySelector('span').textContent = 'Servidor offline — executa node server.js';
    }
}


// ============================================================
// URL VALIDATION
// ============================================================
function isValidYouTubeUrl(url) {
    const patterns = [
        /^(https?:\/\/)?(www\.)?youtube\.com\/watch\?v=[\w-]+/,
        /^(https?:\/\/)?(www\.)?youtube\.com\/shorts\/[\w-]+/,
        /^(https?:\/\/)?(www\.)?youtube\.com\/embed\/[\w-]+/,
        /^(https?:\/\/)?youtu\.be\/[\w-]+/,
        /^(https?:\/\/)?(www\.)?youtube\.com\/live\/[\w-]+/,
        /^(https?:\/\/)?(m\.)?youtube\.com\/watch\?v=[\w-]+/,
    ];
    return patterns.some(p => p.test(url));
}


// ============================================================
// TOAST
// ============================================================
function showToast(type, message) {
    const toast = document.getElementById('toast');
    const text = document.getElementById('toastText');

    hideToast();
    toast.classList.remove('toast-error', 'toast-success', 'toast-warning');
    toast.classList.add(`toast-${type}`);
    text.textContent = message;
    toast.classList.remove('hidden');

    toastTimeout = setTimeout(() => hideToast(), 5000);
}

function hideToast() {
    document.getElementById('toast').classList.add('hidden');
    if (toastTimeout) { clearTimeout(toastTimeout); toastTimeout = null; }
}


// ============================================================
// GET VIDEO INFO
// ============================================================
async function getVideoInfo() {
    const url = document.getElementById('videoUrl').value.trim();
    const btn = document.getElementById('btnInfo');

    if (!url) {
        showToast('warning', 'Cola um link do YouTube primeiro.');
        return;
    }

    if (!isValidYouTubeUrl(url)) {
        showToast('error', 'Link inválido. Usa um link do YouTube (youtube.com/watch?v=... ou youtu.be/...).');
        return;
    }

    if (!serverOnline) {
        showToast('error', 'Servidor offline. Executa "node server.js" no terminal.');
        return;
    }

    btn.disabled = true;
    btn.classList.add('btn-loading');
    hideToast();

    try {
        const response = await fetch(`${SERVER_URL}/api/info?url=${encodeURIComponent(url)}`);
        const data = await response.json();

        if (!response.ok) throw new Error(data.error || 'Erro ao obter informações.');

        document.getElementById('thumbnail').src = data.thumbnail;
        document.getElementById('videoTitle').textContent = data.title;
        document.getElementById('videoMeta').textContent = `${data.uploader} · ${data.duration}`;

        document.getElementById('videoInfo').classList.remove('hidden');
        document.getElementById('qualitySection').classList.remove('hidden');
        document.getElementById('progressSection').classList.add('hidden');

    } catch (error) {
        if (error.message === 'Failed to fetch') {
            showToast('error', 'Não foi possível conectar ao servidor. Verifica se está a correr.');
            serverOnline = false;
            checkServer();
        } else {
            showToast('error', error.message);
        }
    } finally {
        btn.disabled = false;
        btn.classList.remove('btn-loading');
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

        function onContinue() {
            modal.classList.add('hidden');
            btnContinue.removeEventListener('click', onContinue);
            modal.removeEventListener('click', onOverlay);
            resolve();
        }

        function onOverlay(e) {
            if (e.target === modal) {
                modal.classList.add('hidden');
                btnContinue.removeEventListener('click', onContinue);
                modal.removeEventListener('click', onOverlay);
                resolve();
            }
        }

        btnContinue.addEventListener('click', onContinue);
        modal.addEventListener('click', onOverlay);
    });
}


// ============================================================
// START DOWNLOAD
// ============================================================
async function startDownload() {
    const url = document.getElementById('videoUrl').value.trim();
    const btn = document.getElementById('btnDownload');

    if (!url || !serverOnline) return;

    // Show credits first
    await showCreditsModal();

    btn.disabled = true;
    btn.querySelector('span').textContent = 'A baixar...';

    const progressSection = document.getElementById('progressSection');
    progressSection.classList.remove('hidden');
    document.getElementById('progressBar').style.width = '0%';
    document.getElementById('progressPercent').textContent = '0%';
    document.getElementById('progressDetail').textContent = 'A iniciar...';
    hideToast();

    const eventSource = new EventSource(
        `${SERVER_URL}/api/download?url=${encodeURIComponent(url)}&quality=${selectedQuality}`
    );

    eventSource.onmessage = (event) => {
        const data = JSON.parse(event.data);

        switch (data.type) {
            case 'progress':
                const percent = Math.round(data.percent);
                document.getElementById('progressBar').style.width = `${percent}%`;
                document.getElementById('progressPercent').textContent = `${percent}%`;
                const detail = data.raw.replace(/\[.*?\]\s*/g, '').trim();
                document.getElementById('progressDetail').textContent = detail || 'A processar...';
                break;

            case 'complete':
                document.getElementById('progressBar').style.width = '100%';
                document.getElementById('progressPercent').textContent = '100%';
                document.getElementById('progressDetail').textContent = 'Concluído';
                showToast('success', 'Download concluído! Ficheiro na pasta "downloads".');
                eventSource.close();
                resetBtn();
                break;

            case 'error':
                showToast('error', data.message || 'Erro durante o download.');
                eventSource.close();
                resetBtn();
                break;

            case 'info':
                document.getElementById('progressDetail').textContent =
                    data.message.replace(/\[.*?\]\s*/g, '').trim();
                break;
        }
    };

    eventSource.onerror = () => {
        showToast('error', 'Conexão com o servidor perdida.');
        eventSource.close();
        resetBtn();
    };

    function resetBtn() {
        btn.disabled = false;
        btn.querySelector('span').textContent = 'Baixar';
    }
}