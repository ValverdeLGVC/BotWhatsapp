import fs from 'fs/promises';
import path from 'path';

const DATA_DIR = path.join(__dirname, '../../data');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const CONTACTS_FILE = path.join(DATA_DIR, 'contacts.json');
const HISTORY_FILE = path.join(DATA_DIR, 'history.json');

export const defaultSettings = {
    botEnabled: true,
    replyMode: 'daily',
    replyDelaySeconds: 0,
    cooldownMinutes: 60,
    ignoreGroups: true,
    detectOpenChat: true,
    manualPauseMinutes: 15,
    messages: {
        main: "Olá! Tudo bem? Recebi sua mensagem. No momento não estou disponível, mas retornarei em breve."
    },
    triggers: [
        { id: '1', keyword: 'bom dia', active: true, matchType: 'phrase' },
        { id: '2', keyword: 'ajuda', active: true, matchType: 'word' },
        { id: '3', keyword: 'impressora', active: true, matchType: 'word' },
        { id: '4', keyword: 'oi', active: true, matchType: 'word' }
    ]
};

async function ensureFile(filePath: string, defaultData: any) {
    try {
        await fs.access(filePath);
    } catch {
        await fs.mkdir(DATA_DIR, { recursive: true });
        await fs.writeFile(filePath, JSON.stringify(defaultData, null, 2));
    }
}

export async function readJson(file: 'config' | 'contacts' | 'history') {
    const filePath = file === 'config' ? CONFIG_FILE : file === 'contacts' ? CONTACTS_FILE : HISTORY_FILE;
    await ensureFile(filePath, file === 'config' ? defaultSettings : (file === 'history' ? [] : {}));
    const data = await fs.readFile(filePath, 'utf-8');
    const parsed = JSON.parse(data);
    if (file !== 'config') return parsed;

    return {
        ...defaultSettings,
        ...parsed,
        replyMode: parsed.replyMode ?? (parsed.limitDaily === false ? 'always' : defaultSettings.replyMode),
        messages: { ...defaultSettings.messages, ...parsed.messages },
        triggers: Array.isArray(parsed.triggers) ? parsed.triggers : defaultSettings.triggers
    };
}

export async function writeJson(file: 'config' | 'contacts' | 'history', data: any) {
    const filePath = file === 'config' ? CONFIG_FILE : file === 'contacts' ? CONTACTS_FILE : HISTORY_FILE;
    await fs.writeFile(filePath, JSON.stringify(data, null, 2));
}