import express from 'express';
import cors from 'cors';
import { initWhatsApp, disconnectWhatsApp, restartWhatsApp, shutdownWhatsApp } from './whatsapp/client';
import { readJson, writeJson, defaultSettings } from './services/storage';

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

let clients: any[] = [];
let server: ReturnType<typeof app.listen>;
let whatsappStatus = 'starting';
let latestQr: string | null = null;
let latestActivity = 'Aguardando conexão...';
function broadcast(event: string, data: any) {
    if (event === 'status') {
        whatsappStatus = data;
        if (data !== 'qr') latestQr = null;
    }
    if (event === 'qr') {
        whatsappStatus = 'qr';
        latestQr = data;
    }
    if (event === 'activity') latestActivity = data;
    clients.forEach(c => c.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
}

app.get('/api/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    clients.push(res);
    res.write(`event: status\ndata: ${JSON.stringify(whatsappStatus)}\n\n`);
    if (latestQr) res.write(`event: qr\ndata: ${JSON.stringify(latestQr)}\n\n`);
    res.write(`event: activity\ndata: ${JSON.stringify(latestActivity)}\n\n`);
    req.on('close', () => { clients = clients.filter(c => c !== res); });
});

app.get('/api/config', async (req, res) => res.json(await readJson('config')));
app.post('/api/config', async (req, res) => {
    await writeJson('config', req.body);
    broadcast('config_updated', req.body);
    res.json({ success: true });
});
app.get('/api/history', async (req, res) => res.json(await readJson('history')));
app.delete('/api/history', async (req, res) => {
    await writeJson('history', []);
    res.json({ success: true });
});

app.post('/api/action', async (req, res) => {
    const { type } = req.body;
    if (type === 'disconnect') await disconnectWhatsApp();
    if (type === 'restart') await restartWhatsApp();
    res.json({ success: true });
});

// Endpoint para desligar o processo de forma controlada
app.post('/api/shutdown', async (req, res) => {
    try {
        await shutdownWhatsApp();
        res.json({ success: true });
        clients.forEach(client => client.end());
        clients = [];
        server.close(() => process.exit(0));
    } catch (error) {
        console.error('Erro ao encerrar o bot:', error);
        res.status(500).json({ success: false, error: 'Não foi possível encerrar o bot com segurança.' });
    }
});

server = app.listen(3000, '127.0.0.1', () => {
    console.log('Servidor rodando em http://localhost:3000');
    initWhatsApp(broadcast);
});