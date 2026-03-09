// ============================================================
// server.js — O servidor backend da aplicação
// ============================================================

// --- IMPORTAÇÕES ---
// 'express' é o framework web (instalaste com npm install express)
const express = require('express');

// 'child_process' é um módulo NATIVO do Node.js (não precisa instalar)
// 'spawn' permite executar programas externos (como o yt-dlp.exe)
// e capturar a saída em tempo real (diferente de exec que espera acabar)
const { spawn } = require('child_process');

// 'path' é um módulo nativo para trabalhar com caminhos de ficheiros
// Evita problemas entre Windows (\) e Linux (/)
const path = require('path');

// 'fs' (File System) é um módulo nativo para trabalhar com ficheiros
// Vamos usar para verificar se pastas existem
const fs = require('fs');

// --- CONFIGURAÇÃO ---
// Cria a aplicação Express (equivalente a criar a app no Laravel)
const app = express();

// Define a porta onde o servidor vai correr
const PORT = 3000;

// Caminhos importantes
// path.join() junta pedaços de caminho de forma segura
// __dirname é uma variável especial do Node que dá o caminho da pasta actual
const YT_DLP_PATH = path.join(__dirname, 'bin', 'yt-dlp.exe');
const FFMPEG_PATH = path.join(__dirname, 'bin');
const DOWNLOADS_PATH = path.join(__dirname, 'downloads');

// Cria a pasta downloads se não existir
// { recursive: true } é como mkdir -p no Linux
if (!fs.existsSync(DOWNLOADS_PATH)) {
    fs.mkdirSync(DOWNLOADS_PATH, { recursive: true });
}

// --- MIDDLEWARES ---
// Middleware = código que corre ANTES das rotas (como middleware no Laravel)

// express.json() permite receber dados JSON no body dos pedidos POST
// (equivalente a ter Content-Type: application/json)
app.use(express.json());

// express.static() serve ficheiros estáticos (HTML, CSS, JS) da pasta 'public'
// Quando acedes a http://localhost:3000, ele serve public/index.html
app.use(express.static(path.join(__dirname, 'public')));


// ============================================================
// ROTA 1: Obter informações do vídeo (título, formatos disponíveis)
// ============================================================
// GET /api/info?url=LINK_DO_VIDEO
// Equivalente Laravel: Route::get('/api/info', function(Request $request) {...})
app.get('/api/info', (req, res) => {

    // req.query.url é como $request->query('url') no Laravel
    const videoUrl = req.query.url;

    // Validação básica
    if (!videoUrl) {
        // res.status(400).json() é como return response()->json(..., 400)
        return res.status(400).json({ error: 'URL é obrigatório' });
    }

    // Executa o yt-dlp para obter informações (sem baixar)
    // spawn(programa, [argumentos]) — como exec() no PHP mas em tempo real
    //
    // Argumentos:
    //   --dump-json     → Mostra informação do vídeo em formato JSON (não baixa)
    //   --no-download   → Garante que não baixa nada
    //   --ffmpeg-location → Diz onde está o ffmpeg
    const ytProcess = spawn(YT_DLP_PATH, [
        '--dump-json',
        '--no-download',
        '--ffmpeg-location', FFMPEG_PATH,
        '--js-runtimes', 'node',
        videoUrl
    ]);

    let jsonData = '';   // Vai acumular a saída do comando
    let errorData = '';  // Vai acumular erros, se houver

    // 'stdout' é a saída normal do programa (standard output)
    // .on('data', ...) escuta cada pedaço de dados que chega
    // É como ler linha a linha a saída do terminal
    ytProcess.stdout.on('data', (chunk) => {
        // chunk é um Buffer (dados em bruto), .toString() converte para texto
        jsonData += chunk.toString();
    });

    // 'stderr' é a saída de erros (standard error)
    ytProcess.stderr.on('data', (chunk) => {
        errorData += chunk.toString();
    });

    // 'close' dispara quando o processo termina
    // 'code' é o código de saída (0 = sucesso, outro = erro)
    ytProcess.on('close', (code) => {
        if (code !== 0) {
            return res.status(500).json({
                error: 'Erro ao obter informações',
                details: errorData
            });
        }

        try {
            // Converte o JSON recebido do yt-dlp para um objecto JavaScript
            const info = JSON.parse(jsonData);

            // Extrai só o que precisamos e envia ao frontend
            res.json({
                title: info.title,
                thumbnail: info.thumbnail,
                duration: info.duration_string,
                uploader: info.uploader,
                // Filtra os formatos para mostrar só os úteis ao utilizador
                formats: info.formats
                    .filter(f => f.filesize || f.filesize_approx) // Só formatos com tamanho
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
// ROTA 2: Baixar o vídeo (com progresso em tempo real via SSE)
// ============================================================
// GET /api/download?url=LINK&quality=OPCAO
app.get('/api/download', (req, res) => {

    const videoUrl = req.query.url;
    const quality = req.query.quality || 'best-video'; // Padrão: melhor vídeo

    if (!videoUrl) {
        return res.status(400).json({ error: 'URL é obrigatório' });
    }

    // --- CONFIGURAR SERVER-SENT EVENTS (SSE) ---
    // SSE permite enviar dados continuamente do servidor para o browser
    // É uma conexão HTTP que fica aberta e o servidor vai "empurrando" dados
    //
    // Headers necessários:
    //   Content-Type: text/event-stream  → Diz ao browser que é SSE
    //   Cache-Control: no-cache          → Não guardar em cache
    //   Connection: keep-alive           → Manter a conexão aberta
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
    });

    // Função auxiliar para enviar eventos SSE
    // O formato SSE é: "data: CONTEUDO\n\n" (duas quebras de linha no fim)
    function sendEvent(data) {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
    }

    // --- MONTAR OS ARGUMENTOS DO YT-DLP ---
    // Diferentes qualidades pedem diferentes argumentos
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
    }
    // Monta o array completo de argumentos
    const args = [
        ...formatArgs,                                    // Formato escolhido
        '--ffmpeg-location', FFMPEG_PATH,                 // Onde está o ffmpeg
       // '--merge-output-format', (quality !== 'audio-only' ? ['--merge-output-format', 'mp4'] : []), // Força MP4 para vídeo, não necessário para áudio
        '-o', path.join(DOWNLOADS_PATH, '%(title)s.%(ext)s'),  // Onde guardar
        '--newline',                                      // IMPORTANTE: cada update numa nova linha
        '--progress',                                     // Mostrar progresso
        '--js-runtimes', 'node',                          // Usar Node como JS runtime
        videoUrl                                          // O link do vídeo
    ];

    // Inicia o download
    sendEvent({ type: 'start', message: 'A iniciar download...' });

    const ytProcess = spawn(YT_DLP_PATH, args);

    // --- CAPTURAR PROGRESSO EM TEMPO REAL ---
    // O yt-dlp escreve o progresso no stderr (não no stdout)
    // Com --newline, cada actualização vem numa linha separada
    ytProcess.stderr.on('data', (chunk) => {
        const output = chunk.toString();
        // As linhas de output são como: [download]  45.3% of 50.21MiB at 2.30MiB/s ETA 00:12

        // Tenta extrair a percentagem com uma expressão regular (regex)
        // \d+ = um ou mais dígitos, \.? = ponto opcional, \d* = mais dígitos opcionais
        const progressMatch = output.match(/(\d+\.?\d*)%/);
        if (progressMatch) {
            sendEvent({
                type: 'progress',
                percent: parseFloat(progressMatch[1]),
                raw: output.trim()  // Envia também o texto original para debug
            });
        }
    });

    // stdout também pode ter informação útil
    ytProcess.stdout.on('data', (chunk) => {
        const output = chunk.toString().trim();
        if (output) {
            sendEvent({ type: 'info', message: output });
        }
    });

    // Quando o download terminar
    ytProcess.on('close', (code) => {
        if (code === 0) {
            sendEvent({ type: 'complete', message: 'Download concluído!' });
        } else {
            sendEvent({ type: 'error', message: `Erro no download (código: ${code})` });
        }
        // Fecha a conexão SSE
        res.end();
    });

    // Se o browser fechar/cancelar, mata o processo yt-dlp
    req.on('close', () => {
        ytProcess.kill();
    });
});


// ============================================================
// INICIAR O SERVIDOR
// ============================================================
// app.listen() inicia o servidor na porta definida
// Equivalente a php artisan serve
app.listen(PORT, () => {
    console.log(`\n✅ Servidor a correr em http://localhost:${PORT}`);
    console.log(`📁 Downloads serão guardados em: ${DOWNLOADS_PATH}`);
    console.log(`\nPressiona Ctrl+C para parar.\n`);
});