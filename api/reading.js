// Тренажёр чтения /chtenie: ИИ придумывает новые слова и фразы по слогам.
// Использует тот же ANTHROPIC_API_KEY, что и api/lead.js. Без ключа тренажёр работает на встроенных словах.

const LEVELS = {
  syl: 'слоги из двух букв (согласная + гласная), например МА, ЛУ, РЫ. Без эмодзи.',
  w2: 'простые слова из 1–2 слогов, знакомые шестилетнему ребёнку (животные, еда, игрушки, дом), например КО-ЗА, КОТ, ЛОД-КА. У каждого слова эмодзи, которое однозначно его изображает.',
  w3: 'слова из 3–4 слогов, знакомые шестилетнему ребёнку, например МА-ШИ-НА, СО-БА-КА. У каждого слова эмодзи, которое однозначно его изображает.',
  s: 'короткие предложения из 2–4 простых слов для ребёнка 6 лет, с точкой в конце, например КОТ СПИТ. или ЛИ-СА БЕ-ЖИТ В ЛЕС. У каждого предложения эмодзи по смыслу.',
};

function prompt(level, known) {
  return `Ты помогаешь шестилетней девочке учиться читать по-русски. Она знает буквы и читает слоги.
Придумай 10 новых заданий. Тип: ${LEVELS[level]}
Пиши заглавными буквами. Дели слова на слоги дефисом по школьным правилам (ЛОД-КА, КА-ПУС-ТА). Односложные слова без дефиса.
Не повторяй: ${known.join(', ') || 'нет'}.
Ответь только JSON: {"items":[{"t":"СО-БА-КА","e":"🐶"}]}`;
}

const VALID = /^[А-ЯЁ]+(-[А-ЯЁ]+)*([ ][А-ЯЁ]+(-[А-ЯЁ]+)*)*[.!?]?$/;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method' });
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return res.status(503).json({ error: 'no_key' });
  const b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
  const level = Object.hasOwn(LEVELS, b.level) ? b.level : 'w2';
  const known = (Array.isArray(b.known) ? b.known : []).slice(0, 80).map((x) => String(x).slice(0, 40).replace(/[^А-ЯЁа-яё ]/g, ''));

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5',
      max_tokens: 800,
      messages: [{ role: 'user', content: prompt(level, known) }],
    }),
  });
  if (!r.ok) { console.error('anthropic', r.status, await r.text()); return res.status(502).json({ error: 'ai' }); }
  const data = await r.json();
  const text = (data.content || []).filter((x) => x.type === 'text').map((x) => x.text).join('');
  const m = text.match(/\{[\s\S]*\}/);
  let items = [];
  try { items = m ? JSON.parse(m[0]).items || [] : []; } catch { items = []; }
  items = items
    .map((x) => ({ t: String(x.t || '').trim().toUpperCase(), e: level === 'syl' ? undefined : String(x.e || '').slice(0, 8) || undefined }))
    .filter((x) => VALID.test(x.t) && x.t.length <= 40)
    .slice(0, 12);
  return res.status(200).json({ items });
}
