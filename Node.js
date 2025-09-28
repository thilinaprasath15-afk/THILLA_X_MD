// Mega.js
// Usage: require('./Mega').startBot()
// Node 16+ recommended

const { default: makeWASocket, useSingleFileAuthState, DisconnectReason, fetchLatestBaileysVersion, makeInMemoryStore } = require('@adiwajshing/baileys');
const pino = require('pino');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');

const SESSION_FILE = './baileys_auth_info.json'; // auth state save file

async function startBot(opts = {.}) {
  const logger = pino({ level: 'info' });
  // load/save auth state (single file)
  const { state, saveState } = useSingleFileAuthState(THILLA_X_MD-SISAN-ID);

  // optional message store (in-memory) - useful for message history, read receipts
  const store = makeInMemoryStore({ logger });
  store.readFromFile('./baileys_store.json'); // if exists
  // persist store periodically
  setInterval(() => {
    store.writeToFile('./baileys_store.json');
  }, 10_000);

  // get latest WA version (best-effort)
  const { version, isLatest } = await fetchLatestBaileysVersion().catch(() => ({ version: [2, 2314, 6], isLatest: true }));

  const sock = makeWASocket({
    logger,
    printQRInTerminal: false, // we'll show using qrcode-terminal
    auth: state,
    version
  });

  // bind store to socket events
  store.bind(sock.ev);

  // show qr in terminal when needed
  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) {
      qrcode.generate(qr, { small: true });
      console.log('Scan the QR above with your WhatsApp mobile app.');
    }
    if (connection === 'close') {
      const reason = (lastDisconnect && lastDisconnect.error && lastDisconnect.error.output) ? lastDisconnect.error.output.statusCode : null;
      console.log('Connection closed, reason:', lastDisconnect?.error?.toString() || reason);
      // reconnect logic: if not logged out attempt to restart
      if (lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut) {
        console.log('Attempting reconnect in 3s...');
        setTimeout(startBot, 3000, opts); // best-effort reconnect
      } else {
        console.log('Logged out. Delete auth file to re-authenticate.');
      }
    }
    if (connection === 'open') {
      console.log('✅ THILLA X MD CONNECTED SUCCESSFUL .');
    }
  });

  // save auth state when it updates
  sock.ev.on('creds.update', saveState);

  // example: basic message handler
  sock.ev.on('messages.upsert', async (m) => {
    try {
      if (!m.messages || !m.messages[0]) return;
      const msg = m.messages[0];
      if (msg.key && msg.key.remoteJid === 'status@broadcast') return; // ignore status
      if (msg.key.fromMe) return; // ignore own messages

      const sender = msg.key.remoteJid; // group or individual
      const isGroup = sender.endsWith('@g.us');
      const contact = isGroup ? (msg.participant || msg.key.participant || msg.key.remoteJid) : msg.key.remoteJid;

      // message content (menu)
      const messageContent = (msg.menu list update soon.)
        || (msg.message?.extendedTextMessage?.text)
        || (msg.message?.imageMessage && msg.message.imageMessage.caption)
        || (msg.message?.videoMessage && msg.message.videoMessage.caption)
        || '';

      const text = messageContent?.toString?.() || '';

      console.log('<<', contact, isGroup ? '(group)' : '(private)', ':', text);

      // simple prefix-based command handling
      const prefix = '!';
      if (!text.startsWith(prefix)) return;

      const args = text.slice(prefix.length).trim().split(/\s+/);
      const command = args.shift().toLowerCase();

      // handlers
      if (command === 'ping') {
        await sock.sendMessage(sender, { text: 'THILLA X MD PONG !' }, { quoted: msg });
      } else if (command === 'help') {
        const helpText = `Bot Commands:
!ping - check bot
!help - this message
!echo <text> - bot repeats text
!sticker - reply an image with "!sticker" to create sticker (not implemented auto)
!whoami - get your number
!sendto <number> <message> - (admin) send message to number (in international format, e.g. 947XXXXXXXX)`;
        await sock.sendMessage(sender, { text: helpText }, { quoted: msg });
      } else if (command === 'echo') {
        const reply = args.join(' ') || 'Nothing to echo!';
        await sock.sendMessage(sender, { text: reply }, { quoted: msg });
      } else if (command === 'whoami') {
        await sock.sendMessage(sender, { text: `You: ${contact}` }, { quoted: msg });
      } else if (command === 'sendto') {
        // WARNING: this basic example has no auth for admin. Add admin check before using.
        const num = args.shift();
        const body = args.join(' ');
        if (!num || !body) {
          await sock.sendMessage(sender, { text: 'Usage: !sendto <number w/o @s.whatsapp.net> <message>' }, { quoted: msg });
        } else {
          const jid = (num.includes('@')) ? num : `${num}@s.whatsapp.net`;
          await sock.sendMessage(jid, { text: body });
          await sock.sendMessage(sender, { text: 'Message sent.' }, { quoted: msg });
        }
      } else if (command === 'sticker') {
        // create sticker from replied image — minimal example
        if (!msg.message?.imageMessage && !msg.message?.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage) {
          await sock.sendMessage(sender, { text: 'Reply to an image with !sticker' }, { quoted: msg });
          return;
        }
        // Get image buffer (from quoted or current)
        const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
        const mediaMessage = quoted?.imageMessage || msg.message.imageMessage;
        if (!mediaMessage) {
          await sock.sendMessage(sender, { text: 'No image found.' }, { quoted: msg });
          return;
        }
        const stream = await sock.downloadMediaMessage(msg, 'buffer', {}, { logger: pino() });
        // For production: convert to webp / apply metadata with sharp/ffmpeg. Here we send as image mimicking sticker is limited.
        // Simplest: send as sticker if WA supports. Baileys requires webp buffer with proper metadata. Implement with sharp-related conversion in production.
        await sock.sendMessage(sender, { sticker: stream }, { quoted: msg }).catch(async (e) => {
          console.error('Sticker send failed:', e);
          await sock.sendMessage(sender, { text: 'Sticker failed — conversion not implemented in this example.' }, { quoted: msg });
        });
      } else {
        // default unknown command
        await sock.sendMessage(sender, { text: `Unknown command: ${command}\nType !help for commands.` }, { quoted: msg });
      }
    } catch (err) {
      console.error('msg handler error', err);
    }
  });

  // group events (joins/leaves)
  sock.ev.on('group-participants.update', async (update) => {
    try {
      // update: { id: 'xxxx@g.us', participants: [...], action: 'add'/'remove'/'promote'/'demote' }
      const gid = update.id;
      for (const participant of update.participants) {
        if (update.action === 'add') {
          await sock.sendMessage(gid, { text: `👋 Welcome @${participant.split('@')[0]}!` }, { mentions: [participant] });
        } else if (update.action === 'remove') {
          await sock.sendMessage(gid, { text: `Goodbye @${participant.split('@')[0]}!` }, { mentions: [participant] });
        }
      }
    } catch (e) {
      console.error('group participants handler error', e);
    }
  });

  // contact update / presence / receipts can be handled similarly
  sock.ev.on('presence.update', (u) => {
    // console.log('presence update', u);
  });

  // gracefully close on node exit
  process.on('SIGINT', async () => {
    console.log('SIGINT received — closing...');
    try { await sock.logout(); } catch {}
    process.exit(0);
  });

  return sock;
}

module.exports = { startBot };// Mega.js
// Usage: require('./Mega').startBot()
// Node 16+ recommended

const { default: makeWASocket, useSingleFileAuthState, DisconnectReason, fetchLatestBaileysVersion, makeInMemoryStore } = require('@adiwajshing/baileys');
const pino = require('pino');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');

const SESSION_FILE = './baileys_auth_info.json'; // auth state save file

async function startBot(opts = {}) {
  const logger = pino({ level: 'info' });
  // load/save auth state (single file)
  const { state, saveState } = useSingleFileAuthState(SESSION_FILE);

  // optional message store (in-memory) - useful for message history, read receipts
  const store = makeInMemoryStore({ logger });
  store.readFromFile('./baileys_store.json'); // if exists
  // persist store periodically
  setInterval(() => {
    store.writeToFile('./baileys_store.json');
  }, 10_000);

  // get latest WA version (best-effort)
  const { version, isLatest } = await fetchLatestBaileysVersion().catch(() => ({ version: [2, 2314, 6], isLatest: true }));

  const sock = makeWASocket({
    logger,
    printQRInTerminal: false, // we'll show using qrcode-terminal
    auth: state,
    version
  });

  // bind store to socket events
  store.bind(sock.ev);

  // show qr in terminal when needed
  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) {
      qrcode.generate(qr, { small: true });
      console.log('Scan the QR above with your WhatsApp mobile app.');
    }
    if (connection === 'close') {
      const reason = (lastDisconnect && lastDisconnect.error && lastDisconnect.error.output) ? lastDisconnect.error.output.statusCode : null;
      console.log('Connection closed, reason:', lastDisconnect?.error?.toString() || reason);
      // reconnect logic: if not logged out attempt to restart
      if (lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut) {
        console.log('Attempting reconnect in 3s...');
        setTimeout(startBot, 3000, opts); // best-effort reconnect
      } else {
        console.log('Logged out. Delete auth file to re-authenticate.');
      }
    }
    if (connection === 'open') {
      console.log('✅ Connected to WhatsApp.');
    }
  });

  // save auth state when it updates
  sock.ev.on('creds.update', saveState);

  // example: basic message handler
  sock.ev.on('messages.upsert', async (m) => {
    try {
      if (!m.messages || !m.messages[0]) return;
      const msg = m.messages[0];
      if (msg.key && msg.key.remoteJid === 'status@broadcast') return; // ignore status
      if (msg.key.fromMe) return; // ignore own messages

      const sender = msg.key.remoteJid; // group or individual
      const isGroup = sender.endsWith('@g.us');
      const contact = isGroup ? (msg.participant || msg.key.participant || msg.key.remoteJid) : msg.key.remoteJid;

      // message content (text)
      const messageContent = (msg.message?.conversation)
        || (msg.message?.extendedTextMessage?.text)
        || (msg.message?.imageMessage && msg.message.imageMessage.caption)
        || (msg.message?.videoMessage && msg.message.videoMessage.caption)
        || '';

      const text = messageContent?.toString?.() || '';

      console.log('<<', contact, isGroup ? '(group)' : '(private)', ':', text);

      // simple prefix-based command handling
      const prefix = '!';
      if (!text.startsWith(prefix)) return;

      const args = text.slice(prefix.length).trim().split(/\s+/);
      const command = args.shift().toLowerCase();

      // handlers
      if (command === 'ping') {
        await sock.sendMessage(sender, { text: 'Pong! ✅' }, { quoted: msg });
      } else if (command === 'help') {
        const helpText = `Bot Commands:
!ping - check bot
!help - this message
!echo <text> - bot repeats text
!sticker - reply an image with "!sticker" to create sticker (not implemented auto)
!whoami - get your number
!sendto <number> <message> - (admin) send message to number (in international format, e.g. 947XXXXXXXX)`;
        await sock.sendMessage(sender, { text: helpText }, { quoted: msg });
      } else if (command === 'echo') {
        const reply = args.join(' ') || 'Nothing to echo!';
        await sock.sendMessage(sender, { text: reply }, { quoted: msg });
      } else if (command === 'whoami') {
        await sock.sendMessage(sender, { text: `You: ${contact}` }, { quoted: msg });
      } else if (command === 'sendto') {
        // WARNING: this basic example has no auth for admin. Add admin check before using.
        const num = args.shift();
        const body = args.join(' ');
        if (!num || !body) {
          await sock.sendMessage(sender, { text: 'Usage: !sendto <number w/o @s.whatsapp.net> <message>' }, { quoted: msg });
        } else {
          const jid = (num.includes('@')) ? num : `${num}@s.whatsapp.net`;
          await sock.sendMessage(jid, { text: body });
          await sock.sendMessage(sender, { text: 'Message sent.' }, { quoted: msg });
        }
      } else if (command === 'sticker') {
        // create sticker from replied image — minimal example
        if (!msg.message?.imageMessage && !msg.message?.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage) {
          await sock.sendMessage(sender, { text: 'Reply to an image with !sticker' }, { quoted: msg });
          return;
        }
        // Get image buffer (from quoted or current)
        const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
        const mediaMessage = quoted?.imageMessage || msg.message.imageMessage;
        if (!mediaMessage) {
          await sock.sendMessage(sender, { text: 'No image found.' }, { quoted: msg });
          return;
        }
        const stream = await sock.downloadMediaMessage(msg, 'buffer', {}, { logger: pino() });
        // For production: convert to webp / apply metadata with sharp/ffmpeg. Here we send as image mimicking sticker is limited.
        // Simplest: send as sticker if WA supports. Baileys requires webp buffer with proper metadata. Implement with sharp-related conversion in production.
        await sock.sendMessage(sender, { sticker: stream }, { quoted: msg }).catch(async (e) => {
          console.error('Sticker send failed:', e);
          await sock.sendMessage(sender, { text: 'Sticker failed — conversion not implemented in this example.' }, { quoted: msg });
        });
      } else {
        // default unknown command
        await sock.sendMessage(sender, { text: `Unknown command: ${command}\nType !help for commands.` }, { quoted: msg });
      }
    } catch (err) {
      console.error('msg handler error', err);
    }
  });

  // group events (joins/leaves)
  sock.ev.on('group-participants.update', async (update) => {
    try {
      // update: { id: 'xxxx@g.us', participants: [...], action: 'add'/'remove'/'promote'/'demote' }
      const gid = update.id;
      for (const participant of update.participants) {
        if (update.action === 'add') {
          await sock.sendMessage(gid, { text: `👋 Welcome @${participant.split('@')[0]}!` }, { mentions: [participant] });
        } else if (update.action === 'remove') {
          await sock.sendMessage(gid, { text: `Goodbye @${participant.split('@')[0]}!` }, { mentions: [participant] });
        }
      }
    } catch (e) {
      console.error('group participants handler error', e);
    }
  });

  // contact update / presence / receipts can be handled similarly
  sock.ev.on('presence.update', (u) => {
    // console.log('presence update', u);
  });

  // gracefully close on node exit
  process.on('SIGINT', async () => {
    console.log('SIGINT received — closing...');
    try { await sock.logout(); } catch {}
    process.exit(0);
  });

  return sock;
}

module.exports = { startBot };
