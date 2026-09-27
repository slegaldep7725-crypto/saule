// ИИ-помощник на странице оферты: отвечает на вопросы клиента строго по тексту oferta.txt.
// Переменные окружения: ANTHROPIC_API_KEY, ANTHROPIC_MODEL (необязательно, по умолчанию claude-sonnet-5).

import Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const clip = (v, n) => String(v ?? '').trim().slice(0, n);

const RULES = `Ты помощник на странице публичной оферты частного юриста Сауле Тураровой (Алматы, Казахстан). Клиент читает оферту перед тем, как её принять, и задаёт вопрос.
Правила:
- Отвечай только на основании текста оферты ниже. Если в оферте ответа нет, так и скажи и предложи уточнить у Сауле в WhatsApp.
- Не давай юридических консультаций по делу клиента и не оценивай его ситуацию: это предмет платной консультации.
- Не обещай того, чего нет в оферте, и не толкуй её в пользу одной из сторон.
- Места в квадратных скобках [ ] — ещё не заполненные условия; если вопрос о них, скажи, что это условие уточняется.
- Отвечай по-русски, коротко: 1–4 предложения, без Markdown. Ссылайся на пункт оферты, если он есть.`;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method' });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ error: 'off' });
  let b;
  try { b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {}; } catch { return res.status(400).json({ error: 'invalid' }); }
  const question = clip(b.question, 600);
  if (question.length < 3) return res.status(400).json({ error: 'invalid' });

  const offer = readFileSync(join(process.cwd(), 'oferta.txt'), 'utf8');
  const client = new Anthropic();
  try {
    const msg = await client.messages.create({
      model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5',
      max_tokens: 1024,
      output_config: { effort: 'low' },
      system: [
        { type: 'text', text: RULES },
        { type: 'text', text: 'Текст оферты:\n\n' + offer, cache_control: { type: 'ephemeral' } },
      ],
      messages: [{ role: 'user', content: question }],
    });
    if (msg.stop_reason === 'refusal') return res.status(200).json({ answer: 'На этот вопрос помощник не ответит. Напишите Сауле в WhatsApp.' });
    const answer = msg.content.filter((c) => c.type === 'text').map((c) => c.text).join('').trim();
    return res.status(200).json({ answer: answer || 'Не получилось ответить. Напишите Сауле в WhatsApp.' });
  } catch (e) {
    if (e instanceof Anthropic.APIError) console.error('anthropic', e.status, e.message);
    else console.error(e);
    return res.status(502).json({ error: 'ai' });
  }
}
