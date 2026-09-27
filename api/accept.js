// Онлайн-акцепт публичной оферты (замена eSign / Documentolog для договоров-оферт).
// Текст оферты — файл oferta.txt в корне. Клиент видит его на /oferta.html, нажимает
// «Принимаю», а сюда приходят его данные и отпечаток (SHA-256) текста, который он видел.
// Мы сверяем отпечаток с текущим oferta.txt и отправляем вам в Telegram запись об акцепте
// и файл с принятым текстом — это ваш архив.
// Переменные окружения: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID (те же, что для заявок).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';

const clip = (v, n) => String(v ?? '').trim().slice(0, n);
const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

function loadOffer() {
  const text = readFileSync(join(process.cwd(), 'oferta.txt'), 'utf8').replace(/^\uFEFF/, ''); // браузер тоже отбрасывает BOM
  return { text, hash: createHash('sha256').update(text, 'utf8').digest('hex') };
}

function almatyTime(d) {
  return new Intl.DateTimeFormat('ru-RU', { timeZone: 'Asia/Almaty', dateStyle: 'long', timeStyle: 'medium' }).format(d);
}

function recordText(r, offer) {
  return [
    `ПОДТВЕРЖДЕНИЕ АКЦЕПТА ПУБЛИЧНОЙ ОФЕРТЫ № ${r.id}`,
    '',
    `Дата и время акцепта: ${r.time} (Алматы), ${r.iso} UTC`,
    `ФИО: ${r.name}`,
    `Телефон: ${r.phone}`,
    `Email: ${r.email || '—'}`,
    `ИИН: ${r.iin || '—'}`,
    'Согласие с условиями оферты: да',
    'Согласие на обработку персональных данных: да',
    `IP-адрес: ${r.ip}`,
    `Браузер: ${r.ua}`,
    `SHA-256 текста оферты: ${r.hash}`,
    '',
    '──────── ПРИНЯТЫЙ ТЕКСТ ОФЕРТЫ ────────',
    '',
    offer.text,
  ].join('\n');
}

async function archive(r, offer) {
  const token = process.env.TELEGRAM_BOT_TOKEN, chat = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat) return false;
  const msg = `<b>✍️ Акцепт оферты № ${esc(r.id)}</b>\n${esc(r.name)} · ${esc(r.phone)}` +
    (r.email ? ` · ${esc(r.email)}` : '') + (r.iin ? `\nИИН: ${esc(r.iin)}` : '') +
    `\n${esc(r.time)} (Алматы)\nSHA-256: <code>${esc(r.hash.slice(0, 16))}…</code>\n\nПолная запись и текст оферты — в файле ниже.`;
  const phone = r.phone.replace(/\D/g, '');
  const body = { chat_id: chat, text: msg, parse_mode: 'HTML', disable_web_page_preview: true };
  if (phone.length >= 10) body.reply_markup = { inline_keyboard: [[{ text: 'Написать в WhatsApp', url: 'https://wa.me/' + phone }]] };
  const m = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!m.ok) console.error('telegram message', m.status, await m.text());

  const form = new FormData();
  form.append('chat_id', chat);
  form.append('caption', `Акцепт № ${r.id} — ${r.name}`);
  form.append('document', new Blob([recordText(r, offer)], { type: 'text/plain;charset=utf-8' }), `akcept-${r.id}.txt`);
  const d = await fetch(`https://api.telegram.org/bot${token}/sendDocument`, { method: 'POST', body: form });
  if (!d.ok) console.error('telegram document', d.status, await d.text());
  return m.ok && d.ok;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method' });
  let b;
  try { b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {}; } catch { return res.status(400).json({ error: 'invalid' }); }
  if (b.website) return res.status(200).json({ ok: true }); // бот-ловушка

  const offer = loadOffer();
  if (offer.text.trimStart().startsWith('ЧЕРНОВИК')) return res.status(409).json({ error: 'draft' });
  if (b.hash !== offer.hash) return res.status(409).json({ error: 'changed' });

  const name = clip(b.name, 160), phone = clip(b.phone, 40), email = clip(b.email, 120), iin = clip(b.iin, 12).replace(/\D/g, '');
  if (name.length < 5 || phone.replace(/\D/g, '').length < 10 || b.agree !== true || b.consent !== true) return res.status(400).json({ error: 'invalid' });
  if (iin && iin.length !== 12) return res.status(400).json({ error: 'iin' });
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'email' });

  const now = new Date();
  const r = {
    id: now.toISOString().slice(0, 10).replace(/-/g, '') + '-' + randomBytes(3).toString('hex').toUpperCase(),
    iso: now.toISOString().replace('T', ' ').slice(0, 19), time: almatyTime(now),
    name, phone, email, iin,
    ip: clip(String(req.headers['x-forwarded-for'] || '').split(',')[0], 60) || '—',
    ua: clip(req.headers['user-agent'], 300) || '—',
    hash: offer.hash,
  };

  let archived = false;
  try { archived = await archive(r, offer); } catch (e) { console.error(e); }
  // Без Telegram запись некуда сохранить — не подтверждаем клиенту акцепт, который вы не увидите
  if (!archived) return res.status(503).json({ error: 'archive' });
  return res.status(200).json({ ok: true, record: { id: r.id, time: r.time, iso: r.iso, name, phone, email, iin, hash: r.hash } });
}
