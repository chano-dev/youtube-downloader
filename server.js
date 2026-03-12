// ============================================================
// server.js — Backend do YT Downloader
// Cross-platform: Windows, macOS, Linux
// ============================================================

const express = require('express');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 3000;

// --- DETECÇÃO DO SISTEMA OPERATIVO ---
// process.platform retorna: 'win32' (Windows), 'darwin' (macOS), 'linux' (Linux)
const isWindows = process.platform === 'win32';

// No Windows os executáveis têm .exe, nos outros sistemas não
const YT_DLP_PATH = path.join(__dirname, 'bin', isWindows ? 'yt-dlp.exe' : 'yt-dlp');
const FFMPEG_PATH = path.join(__dirname, 'bin');
const DOWNLOADS_PATH = path.join(__dirname, 'downloads');

// Verifica se o yt-dlp existe no caminho esperado
if (!fs.existsSync(YT_DLP_PATH)) {
    console.error(`\n❌ yt-dlp não encontrado em: ${YT_DLP_PATH}`);
    console.error(`   Baixa o executável correcto para o teu sistema:`);
    console.error(`   → Windows: yt-dlp.exe`);
    console.error(`   → macOS/Linux: yt-dlp`);
    console.error(`   Coloca na pasta bin/ do projecto.\n`);
    process.exit(1);
}

// Cria a pasta downloads se não existir
if (!fs.existsSync(DOWNLOADS_PATH)) {
    fs.mkdirSync(DOWNLOADS_PATH, { recursive: true });
}

// No Linux/macOS, garante que os executáveis têm permissão de execução
if (!isWindows) {
    const { execSync } = require('child_process');
    try {
        execSync(`chmod +x "${YT_DLP_PATH}"`);
        const ffmpegPath = path.join(FFMPEG_PATH, 'ffmpeg');
        const ffprobePath = path.join(FFMPEG_PATH, 'ffprobe');
        if (fs.existsSync(ffmpegPath)) execSync(`chmod +x "${ffmpegPath}"`);
        if (fs.existsSync(ffprobePath)) execSync(`chmod +x "${ffprobePath}"`);
    } catch (e) {
        // Se falhar, não é crítico
    }
}

// --- MIDDLEWARES ---
app.use(express.json());

// CORS — permite que a extensão do browser comunique com o servidor
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

app.use(express.static(path.join(__dirname, 'public')));


// ============================================================
// ROTA: Health Check
// ============================================================
app.get('/api/health', (req, res) => {
    res.json({ status: 'online', version: '1.1.0', platform: process.platform });
});


// ============================================================
// ROTA: Obter informações do vídeo
// ============================================================
app.get('/api/info', (req, res) => {
    const videoUrl = req.query.url;

    if (!videoUrl) {
        return res.status(400).json({ error: 'URL é obrigatório' });
    }

    const ytProcess = spawn(YT_DLP_PATH, [
        '--dump-json',
        '--no-download',
        '--ffmpeg-location', FFMPEG_PATH,
        '--js-runtimes', 'node',
        videoUrl
    ]);

    let jsonData = '';
    let errorData = '';

    ytProcess.stdout.on('data', (chunk) => {
        jsonData += chunk.toString();
    });

    ytProcess.stderr.on('data', (chunk) => {
        errorData += chunk.toString();
    });

    ytProcess.on('close', (code) => {
        if (code !== 0) {
            return res.status(500).json({
                error: 'Erro ao obter informações do vídeo',
                details: errorData
            });
        }

        try {
            const info = JSON.parse(jsonData);

            res.json({
                title: info.title,
                thumbnail: info.thumbnail,
                duration: info.duration_string,
                uploader: info.uploader,
                formats: info.formats
                    .filter(f => f.filesize || f.filesize_approx)
                    .map(f => ({
                        format_id: f.format_id,
                        ext: f.ext,
                        resolution: f.resolution || 'audio only',
                        filesize: f.filesize || f.filesize_approx,
                        vcodec: f.vcodec,
                        acodec: f.acodec,
                        note: f.format_note
                    }))
            });
        } catch (e) {
            res.status(500).json({ error: 'Erro ao processar dados do vídeo' });
        }
    });
});


// ============================================================
// ROTA: Download com progresso via SSE
// ============================================================
app.get('/api/download', (req, res) => {
    const videoUrl = req.query.url;
    const quality = req.query.quality || 'best-video';

    if (!videoUrl) {
        return res.status(400).json({ error: 'URL é obrigatório' });
    }

    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*'
    });

    function sendEvent(data) {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
    }

    let formatArgs = [];

    switch (quality) {
        case 'best-video':
            formatArgs = ['-f', 'bv*+ba/b', '--merge-output-format', 'mp4'];
            break;
        case '720p':
            formatArgs = ['-f', 'bv*[height<=720]+ba/b[height<=720]', '--merge-output-format', 'mp4'];
            break;
        case '480p':
            formatArgs = ['-f', 'bv*[height<=480]+ba/b[height<=480]', '--merge-output-format', 'mp4'];
            break;
        case '360p':
            formatArgs = ['-f', 'bv*[height<=360]+ba/b[height<=360]', '--merge-output-format', 'mp4'];
            break;
        case 'audio-only':
            formatArgs = ['-x', '--audio-format', 'mp3', '--audio-quality', '0'];
            break;
        default:
            formatArgs = ['-f', 'bv*+ba/b', '--merge-output-format', 'mp4'];
    }

    const args = [
        ...formatArgs,
        '--ffmpeg-location', FFMPEG_PATH,
        '-o', path.join(DOWNLOADS_PATH, '%(title)s.%(ext)s'),
        '--newline',
        '--progress',
        '--js-runtimes', 'node',
        videoUrl
    ];

    sendEvent({ type: 'start', message: 'A iniciar download...' });

    const ytProcess = spawn(YT_DLP_PATH, args);

    ytProcess.stderr.on('data', (chunk) => {
        const output = chunk.toString();
        const progressMatch = output.match(/(\d+\.?\d*)%/);
        if (progressMatch) {
            sendEvent({
                type: 'progress',
                percent: parseFloat(progressMatch[1]),
                raw: output.trim()
            });
        }
    });

    ytProcess.stdout.on('data', (chunk) => {
        const output = chunk.toString().trim();
        if (output) {
            sendEvent({ type: 'info', message: output });
        }
    });

    ytProcess.on('close', (code) => {
        if (code === 0) {
            sendEvent({ type: 'complete', message: 'Download concluído!' });
        } else {
            sendEvent({ type: 'error', message: `Erro no download (código: ${code})` });
        }
        res.end();
    });

    req.on('close', () => {
        ytProcess.kill();
    });
});


// ============================================================
// START SERVER
// ============================================================
app.listen(PORT, () => {
    const platformNames = { win32: 'Windows', darwin: 'macOS', linux: 'Linux' };
    const platform = platformNames[process.platform] || process.platform;

    console.log(`\n✅ Servidor a correr em http://localhost:${PORT}`);
    console.log(`💻 Sistema: ${platform}`);
    console.log(`📁 Downloads: ${DOWNLOADS_PATH}`);
    console.log(`🧩 Extensão: servidor pronto para receber pedidos`);
    console.log(`\nCtrl+C para parar.\n`);
});