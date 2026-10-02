let config = {};
let historyEntries = [];

// Navegação de abas
document.querySelectorAll('#menu li').forEach(li => {
    li.addEventListener('click', () => {
        document.querySelectorAll('#menu li').forEach(el => el.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
        li.classList.add('active');
        document.getElementById(li.dataset.tab).classList.add('active');
    });
});

// SSE Events
const eventSource = new EventSource('/api/events');
eventSource.addEventListener('status', e => {
    const st = JSON.parse(e.data);
    const badge = document.getElementById('connectionStatus');
    badge.className = `badge ${st}`;
    badge.innerText = st === 'connected' ? 'Conectado' : 'Desconectado';
    document.getElementById('qrContainer').style.display = st === 'connected' ? 'none' : 'none';
});
eventSource.addEventListener('qr', e => {
    document.getElementById('qrContainer').style.display = 'block';
    document.getElementById('connectionStatus').innerText = 'Aguardando Leitura...';
    document.getElementById('connectionStatus').className = 'badge';
    QRCode.toCanvas(document.getElementById('qrCanvas'), JSON.parse(e.data), { width: 250 });
});
eventSource.addEventListener('stats', e => {
    const stats = JSON.parse(e.data);
    document.getElementById('statReceived').innerText = stats.received;
    document.getElementById('statSent').innerText = stats.sentToday;
    document.getElementById('statLastTime').innerText = stats.lastMessageTime;
});
eventSource.addEventListener('activity', e => {
    document.getElementById('botActivity').textContent = JSON.parse(e.data);
});
eventSource.addEventListener('history', () => loadHistory());

document.getElementById('historySearch').addEventListener('input', renderHistory);

// Load Data
async function loadData() {
    const res = await fetch('/api/config');
    config = await res.json();

    document.getElementById('botToggle').checked = config.botEnabled;
    document.getElementById('msgMain').value = config.messages.main;

    document.getElementById('cfgReplyMode').value = config.replyMode || (config.limitDaily === false ? 'always' : 'daily');
    document.getElementById('cfgCooldown').value = config.cooldownMinutes ?? 60;
    document.getElementById('cfgReplyDelay').value = config.replyDelaySeconds ?? 0;
    document.getElementById('cfgIgnoreGroups').checked = config.ignoreGroups;
    document.getElementById('cfgDetectChat').checked = config.detectOpenChat;
    document.getElementById('cfgManualPause').value = config.manualPauseMinutes ?? 15;

    renderTriggers();
    loadHistory();
}

document.getElementById('botToggle').addEventListener('change', async (e) => {
    config.botEnabled = e.target.checked;
    await updateConfig();
});

async function saveMessages() {
    config.messages.main = document.getElementById('msgMain').value;
    await updateConfig();
    alert('Mensagens salvas!');
}

async function saveSettings() {
    config.replyMode = document.getElementById('cfgReplyMode').value;
    config.cooldownMinutes = Math.max(0, parseInt(document.getElementById('cfgCooldown').value, 10) || 0);
    config.replyDelaySeconds = Math.max(0, parseInt(document.getElementById('cfgReplyDelay').value, 10) || 0);
    config.ignoreGroups = document.getElementById('cfgIgnoreGroups').checked;
    config.detectOpenChat = document.getElementById('cfgDetectChat').checked;
    config.manualPauseMinutes = Math.max(0, parseInt(document.getElementById('cfgManualPause').value, 10) || 0);
    await updateConfig();
    alert('Configurações salvas!');
}

function renderTriggers() {
    const tbody = document.getElementById('triggersList');
    tbody.innerHTML = config.triggers.map(t => `
        <tr>
            <td>${t.keyword}</td>
            <td>${t.matchType === 'word' ? 'Palavra Exata' : t.matchType === 'phrase' ? 'Frase Completa' : 'Trecho'}</td>
            <td><input type="checkbox" ${t.active ? 'checked' : ''} onchange="toggleTrigger('${t.id}', this.checked)"></td>
            <td><button class="danger" onclick="deleteTrigger('${t.id}')">Excluir</button></td>
        </tr>
    `).join('');
}

async function addTrigger() {
    const kw = document.getElementById('newTriggerWord').value;
    const type = document.getElementById('newTriggerType').value;
    if (!kw) return;
    config.triggers.push({ id: Date.now().toString(), keyword: kw, matchType: type, active: true });
    document.getElementById('newTriggerWord').value = '';
    await updateConfig();
    renderTriggers();
}

async function toggleTrigger(id, active) {
    const t = config.triggers.find(x => x.id === id);
    if (t) t.active = active;
    await updateConfig();
}

async function deleteTrigger(id) {
    config.triggers = config.triggers.filter(t => t.id !== id);
    await updateConfig();
    renderTriggers();
}

async function loadHistory() {
    const res = await fetch('/api/history');
    if (!res.ok) throw new Error('Não foi possível carregar o histórico.');
    historyEntries = await res.json();
    renderHistory();
}

function renderHistory() {
    const query = document.getElementById('historySearch').value.trim().toLocaleLowerCase('pt-BR');
    const filteredHistory = historyEntries.filter(entry => [
        entry.contact,
        entry.contactName,
        entry.contactNumber,
        entry.messageIn,
        entry.trigger,
        entry.messageOut,
        entry.type
    ].some(value => String(value ?? '').toLocaleLowerCase('pt-BR').includes(query)));
    const tbody = document.getElementById('historyList');
    tbody.replaceChildren();

    filteredHistory.forEach(entry => {
        const row = document.createElement('tr');
        const rawRecipient = String(entry.contactId || entry.contact || '').trim();
        const isLid = rawRecipient.endsWith('@lid');
        const recipient = String(entry.contactName || (isLid ? 'Contato WhatsApp' : entry.contact || entry.contactNumber || 'Contato'))
            .replace(/@(?:c\.us|lid)$/, '');
        const timestamp = new Date(entry.timestamp);
        const dateCell = document.createElement('td');
        dateCell.dataset.label = 'Data/Hora';
        dateCell.textContent = Number.isNaN(timestamp.getTime()) ? '—' : timestamp.toLocaleString('pt-BR');
        row.append(dateCell);

        const recipientCell = document.createElement('td');
        recipientCell.className = 'history-recipient';
        recipientCell.dataset.label = 'Destinatário';
        const recipientName = document.createElement('strong');
        recipientName.textContent = recipient;
        recipientCell.append(recipientName);
        const recipientDetail = entry.contactNumber || (isLid ? `ID WhatsApp: ${rawRecipient.replace(/@lid$/, '')}` : '');
        if (recipientDetail && recipientDetail !== recipient) {
            const recipientNumber = document.createElement('span');
            recipientNumber.textContent = recipientDetail;
            recipientCell.append(recipientNumber);
        }
        row.append(recipientCell);

        [[entry.messageIn, 'Mensagem recebida'], [entry.trigger, 'Gatilho']].forEach(([value, label]) => {
            const cell = document.createElement('td');
            cell.dataset.label = label;
            cell.textContent = value || '—';
            row.append(cell);
        });

        const responseCell = document.createElement('td');
        responseCell.className = 'history-response';
        responseCell.dataset.label = 'Resposta enviada';
        responseCell.textContent = entry.messageOut || '—';
        row.append(responseCell);

        const typeCell = document.createElement('td');
        typeCell.dataset.label = 'Tipo';
        const typeLabel = document.createElement('span');
        typeLabel.className = 'history-type';
        typeLabel.textContent = entry.type || 'Resposta';
        typeCell.append(typeLabel);
        row.append(typeCell);
        tbody.append(row);
    });

    document.getElementById('historyCount').textContent = query
        ? `${filteredHistory.length} de ${historyEntries.length} respostas`
        : `${historyEntries.length} ${historyEntries.length === 1 ? 'resposta registrada' : 'respostas registradas'}`;
    document.getElementById('historyTableWrap').hidden = filteredHistory.length === 0;
    const emptyState = document.getElementById('historyEmpty');
    emptyState.hidden = filteredHistory.length > 0;
    emptyState.textContent = historyEntries.length === 0
        ? 'Nenhuma resposta registrada ainda.'
        : 'Nenhum registro corresponde à busca.';
}

async function clearHistory() {
    if (confirm('Apagar todo o histórico?')) {
        const res = await fetch('/api/history', { method: 'DELETE' });
        if (!res.ok) throw new Error('Não foi possível limpar o histórico.');
        historyEntries = [];
        renderHistory();
    }
}

async function apiAction(type) { await fetch('/api/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type }) }); }
async function updateConfig() { await fetch('/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(config) }); }

loadData();