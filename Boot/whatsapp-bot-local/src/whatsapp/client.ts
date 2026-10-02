import { Client, LocalAuth, Message } from 'whatsapp-web.js';
import { readJson, writeJson } from '../services/storage';
import { toZonedTime, format } from 'date-fns-tz';

const TIMEZONE = 'America/Sao_Paulo';
let client: Client;
let broadcastEvent: (event: string, data: any) => void;
let stats = { received: 0, sentToday: 0, lastMessageTime: '-' };
const automatedReplies = new Map<string, number>();

function replyKey(chatId: string, body: string) {
    return `${chatId}\u0000${body}`;
}

function reportActivity(message: string) {
    broadcastEvent('activity', message);
}

function getLocalDay() {
    return format(toZonedTime(new Date(), TIMEZONE), 'yyyy-MM-dd');
}

function normalizeText(value: string) {
    return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

export const initWhatsApp = (broadcastFn: (event: string, data: any) => void) => {
    broadcastEvent = broadcastFn;
    client = new Client({
        authStrategy: new LocalAuth({ dataPath: './sessions' }),
        puppeteer: { headless: true, args: ['--no-sandbox'] }
    });

    client.on('qr', (qr) => broadcastEvent('qr', qr));
    client.on('ready', () => {
        broadcastEvent('status', 'connected');
        reportActivity('WhatsApp conectado. Aguardando mensagens.');
        console.log('WhatsApp Conectado!');
    });
    client.on('disconnected', () => broadcastEvent('status', 'disconnected'));

    client.on('message_create', async (msg: Message) => {
        try {
            if (msg.isStatus || !msg.fromMe) return;
            const config = await readJson('config');
            if (!config.detectOpenChat) return;

            const key = replyKey(msg.to, msg.body);
            const automatedCount = automatedReplies.get(key) || 0;
            if (automatedCount > 0) {
                if (automatedCount === 1) automatedReplies.delete(key);
                else automatedReplies.set(key, automatedCount - 1);
                return;
            }

            const contacts = await readJson('contacts');
            if (!contacts[msg.to]) contacts[msg.to] = {};
            contacts[msg.to].lastManualReply = Date.now();
            await writeJson('contacts', contacts);
        } catch (error) {
            console.error('Erro ao identificar atendimento manual:', error);
        }
    });

    client.on('message', async (msg: Message) => {
        try {
            if (msg.isStatus) return;
            const config = await readJson('config');
            stats.received++;
            stats.lastMessageTime = format(toZonedTime(new Date(), TIMEZONE), 'HH:mm:ss');
            broadcastEvent('stats', stats);

            if (!config.botEnabled) {
                reportActivity('Mensagem recebida, mas o bot está desligado.');
                return;
            }

            if (msg.from.endsWith('@g.us') && config.ignoreGroups) {
                reportActivity('Mensagem de grupo ignorada pelas configurações.');
                return;
            }

            await handleMessage(msg, config);
        } catch (error) {
            console.error('Erro ao processar mensagem do WhatsApp:', error);
            const details = error instanceof Error ? error.message : String(error);
            reportActivity(`Falha ao processar a mensagem: ${details.slice(0, 160)}`);
        }
    });

    client.initialize().catch(error => {
        console.error('Erro ao iniciar o cliente do WhatsApp:', error);
        reportActivity('Falha ao iniciar o WhatsApp. Confira o terminal do servidor.');
    });
};

async function handleMessage(msg: Message, config: any) {
    const contacts = await readJson('contacts');
    const history = await readJson('history');
    const sender = msg.from;
    const today = getLocalDay();
    const now = Date.now();
    const msgText = normalizeText(msg.body);

    // Identificar Gatilho
    let matchedTrigger = config.triggers.find((t: any) => {
        if (!t.active || typeof t.keyword !== 'string' || !t.keyword.trim()) return false;
        const kw = normalizeText(t.keyword);
        const escapedKeyword = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        if (t.matchType === 'word') return new RegExp(`\\b${escapedKeyword}\\b`, 'i').test(msgText);
        if (t.matchType === 'phrase') return msgText.replace(/\s+/g, '').includes(kw.replace(/\s+/g, ''));
        return msgText.includes(kw); // partial
    });

    if (!matchedTrigger) {
        reportActivity('Mensagem recebida, mas nenhum gatilho ativo correspondeu.');
        return;
    }

    const manualPauseMinutes = Math.max(0, Number(config.manualPauseMinutes ?? 15));
    const lastManualReply = Number(contacts[sender]?.lastManualReply || 0);
    if (config.detectOpenChat && manualPauseMinutes > 0 && lastManualReply &&
        now - lastManualReply < manualPauseMinutes * 60 * 1000) {
        reportActivity(`Resposta pausada por atendimento manual (${manualPauseMinutes} min). Desative essa opção ou aguarde a pausa.`);
        return;
    }

    if (!contacts[sender]) contacts[sender] = {};
    const contactData = contacts[sender];

    let responseText = "";

    const lastMainTime = Number(contactData.lastMainTime || 0);
    const hasPreviousMain = lastMainTime > 0;
    const minutesSinceMain = hasPreviousMain ? (now - lastMainTime) / 60000 : Infinity;
    const replyMode = config.replyMode ?? (config.limitDaily === false ? 'always' : 'daily');
    const sameDay = contactData.lastMainDate === today;
    const cooldownMinutes = Math.max(0, Number(config.cooldownMinutes) || 0);
    const cooldownElapsed = minutesSinceMain >= cooldownMinutes;

    if (replyMode === 'cooldown' && hasPreviousMain && !cooldownElapsed) {
        reportActivity('Gatilho reconhecido, mas o intervalo entre respostas ainda não terminou.');
        return;
    }

    if (replyMode === 'always' || (replyMode === 'daily' && !sameDay) ||
        (replyMode === 'cooldown' && (!hasPreviousMain || cooldownElapsed))) {
        responseText = config.messages.main;
        contactData.lastMainDate = today;
        contactData.lastMainTime = now;
    } else {
        const reason = replyMode === 'daily' ? 'limite diário já atingido' : 'intervalo entre respostas ainda não terminou';
        reportActivity(`Gatilho reconhecido, mas o ${reason}.`);
        return;
    }

    const delay = Math.max(0, Number(config.replyDelaySeconds) || 0);
    if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay * 1000));

    // Enviar mensagem
    const key = replyKey(sender, responseText);
    automatedReplies.set(key, (automatedReplies.get(key) || 0) + 1);
    try {
        await msg.reply(responseText);
    } catch (error) {
        const count = automatedReplies.get(key) || 0;
        if (count <= 1) automatedReplies.delete(key);
        else automatedReplies.set(key, count - 1);
        throw error;
    }
    await writeJson('contacts', contacts);
    stats.sentToday++;
    broadcastEvent('stats', stats);
    reportActivity(`Resposta principal enviada para o gatilho "${matchedTrigger.keyword}".`);

    // Salvar Histórico
    let recipientName = sender.replace(/@(?:c\.us|lid)$/, '');
    let recipientNumber = '';
    try {
        const contact = await msg.getContact();
        recipientName = contact.name || contact.pushname || contact.shortName || contact.number || recipientName;
        recipientNumber = contact.number || '';
    } catch (error) {
        console.warn('Não foi possível carregar o nome do destinatário:', error);
    }

    history.unshift({
        contact: recipientName,
        contactNumber: recipientNumber,
        contactId: sender,
        messageIn: msg.body,
        trigger: matchedTrigger.keyword,
        messageOut: responseText,
        type: 'Principal',
        timestamp: new Date().toISOString()
    });
    if (history.length > 500) history.pop();
    await writeJson('history', history);
    broadcastEvent('history', history[0]);
}

export const disconnectWhatsApp = async () => {
    if (client) await client.logout();
};
export const shutdownWhatsApp = async () => {
    if (client) await client.destroy();
};
export const restartWhatsApp = async () => {
    if (client) await client.destroy();
    initWhatsApp(broadcastEvent);
};