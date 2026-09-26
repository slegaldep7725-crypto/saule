// Приём заявки: ИИ-разбор (Claude API) + уведомление в Telegram.
// Переменные окружения в Vercel → Settings → Environment Variables:
//   ANTHROPIC_API_KEY   ключ Claude API (console.anthropic.com) — для ИИ-разбора
//   TELEGRAM_BOT_TOKEN  токен бота от @BotFather — для уведомлений
//   TELEGRAM_CHAT_ID    ваш chat id (узнать у @userinfobot)
//   ANTHROPIC_MODEL     необязательно, по умолчанию claude-sonnet-5
// Без ключей сайт работает: клиент отправляет заявку вам в WhatsApp.

const AREAS=['Договоры','Недвижимость и земля','Земельные инвестиции','Семейное право / расторжение брака','Регистрация ТОО','Взыскание по займу','Строительство','Судебный спор','Вне специализации'];
function triagePrompt(l){
return `Ты помощник частного юриста Сауле Тураровой (Алматы, работает по всей Республике Казахстан; арбитр Арбитража Союза предпринимателей Казахстана с 2006 года, в прошлом адвокат Коллегии адвокатов г. Астаны). Она работает лично, разовыми консультациями с почасовой оплатой. Форматы: «Консультация» (от 1 часа), «Изучение документов» (почасово: анализ документов клиента, письменное резюме, консультация), «Проверка участка» (юридическая проверка земельного участка до покупки для инвестора). Направления: подготовка и проверка договоров; анализ документов на недвижимость и земельные инвестиции; консультации по расторжению брака (раздел имущества, алименты, дети); регистрация и перерегистрация ТОО; взыскание по договорам займа и распискам; строительство, долевое участие и ЖСК; судебные споры по этим темам.

Сделай первичный разбор обращения клиента для юриста. Это внутренний материал, не юридическое заключение. Правила:
- Право Республики Казахстан. Упоминай нормативные акты (ГК РК, Кодекс РК «О браке (супружестве) и семье», Закон РК «О товариществах с ограниченной и дополнительной ответственностью», Закон РК «О государственной регистрации юридических лиц…», Земельный кодекс РК, Закон РК «Об архитектурной, градостроительной и строительной деятельности в РК», Закон РК «О долевом участии в жилищном строительстве», ГПК РК и др.) только если уверен в применимости, без номеров статей, если не уверен. Всё, что касается норм, юрист проверит в актуальной редакции.
- Не выдумывай факты. Чего не хватает, выноси в вопросы клиенту.
- Сроки: отметь, какие сроки нужно проверить (исковая давность, процессуальные сроки, сроки по договору, сроки госорганов), и явно выдели, если по описанию срок может скоро истечь.
- Отбор клиентов: Сауле берёт только профильные дела и только клиентов, готовых к платной почасовой работе. decision = "accept", если дело профильное и клиент готов платить; "clarify", если дело частично профильное, клиент сначала хочет узнать стоимость или не хватает данных; "decline", если дело непрофильное или клиент ищет бесплатную помощь.
- Оцени объём работы в часах реалистично и консервативно: консультация обычно 1 час, изучение документов зависит от их количества и сложности.
- Пиши по-русски, кратко и конкретно.

Обращение:
Имя: ${l.name}
Формат, выбранный клиентом: ${l.format||"не указан"}
Тема, выбранная клиентом: ${l.topic}
Что произошло: ${l.story}
Цель клиента: ${l.goal||'не указана'}
Документы на руках: ${l.docs||'не указаны'}
Сроки / дата суда: ${l.deadline||'не указаны'}
Готовность к оплате: ${l.pay||'не указана'}
Откуда узнал: ${l.source||'не указано'}

Ответь только JSON такого вида:
{"decision":"accept | clarify | decline","decision_reason":"почему, одно предложение","summary":"суть в 2–3 предложениях","area":"одно из: ${AREAS.join(' | ')}","fit":"профильное | частично профильное | непрофильное","urgency":"high | mid | low","urgency_reason":"почему","key_facts":["..."],"legal_issues":["правовой вопрос и, если уверен, применимый акт"],"risks":["..."],"deadlines_to_check":["..."],"documents_needed":["документ, который клиенту стоит принести"],"questions_for_client":["..."],"format_suggested":"Консультация | Изучение документов | Проверка участка","estimated_hours":{"min":1,"max":2},"hours_reason":"из чего складывается оценка часов: объём документов, сложность","next_step":"что юристу сделать первым","client_reply":"короткий вежливый ответ клиенту от имени Сауле: заявку получила, что подготовить, когда свяжется; без юридических выводов"}`;
}

function decide(l, a) {
  if (/бесплатн/i.test(l.pay || '')) return 'decline';
  if (a && a.fit === 'непрофильное') return 'decline';
  return a && ['accept', 'clarify', 'decline'].includes(a.decision) ? a.decision : 'clarify';
}

const clip = (v, n) => String(v ?? '').trim().slice(0, n);
const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const list = (t, a) => (Array.isArray(a) && a.length ? `\n<b>${t}</b>\n` + a.map((x) => '• ' + esc(x)).join('\n') : '');

async function analyze(lead) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5',
      max_tokens: 2500,
      messages: [{ role: 'user', content: triagePrompt(lead) + '\n\nВерни только JSON, без пояснений и без Markdown.' }],
    }),
  });
  if (!r.ok) { console.error('anthropic', r.status, await r.text()); return null; }
  const data = await r.json();
  const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  const m = text.match(/\{[\s\S]*\}/);
  try { return m ? JSON.parse(m[0]) : null; } catch { return null; }
}

async function notify(lead, a) {
  const token = process.env.TELEGRAM_BOT_TOKEN, chat = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat) return false;
  const u = { high: '🔴 Срочно', mid: '🟡 Средне', low: '🟢 Не срочно' };
  const h = a && a.estimated_hours ? `${a.estimated_hours.min}–${a.estimated_hours.max} ч` : '';
  const D = { accept: '✅ Подходит', clarify: '❓ Уточнить', decline: '⛔ Отсеять' };
  const d = decide(lead, a);
  let msg = `${D[d]}${a && a.decision_reason ? ' — ' + esc(a.decision_reason) : ''}\n\n<b>Новая заявка</b>\n${esc(lead.name)} · ${esc(lead.contact)}\nФормат: ${esc(lead.format)} · Тема: ${esc(lead.topic)}\n\n<i>${esc(lead.story)}</i>`;
  if (lead.goal) msg += `\nЦель: ${esc(lead.goal)}`;
  if (lead.docs) msg += `\nДокументы: ${esc(lead.docs)}`;
  if (lead.deadline) msg += `\nСроки: ${esc(lead.deadline)}`;
  msg += `\nОплата: ${esc(lead.pay || 'не указано')}`;
  if (lead.source) msg += `\nИсточник: ${esc(lead.source)}`;
  if (a) {
    msg += `\n\n<b>ИИ-разбор</b> · ${u[a.urgency] || ''} · ${esc(a.area || '')} · ${esc(a.fit || '')}${h ? ' · ' + h : ''}\n${esc(a.summary || '')}`;
    if (a.urgency_reason) msg += `\nСрочность: ${esc(a.urgency_reason)}`;
    msg += list('Правовые вопросы', a.legal_issues) + list('Риски', a.risks) + list('Сроки проверить', a.deadlines_to_check) + list('Вопросы клиенту', a.questions_for_client);
    if (a.next_step) msg += `\n\n<b>Первый шаг:</b> ${esc(a.next_step)}`;
    if (a.client_reply) msg += `\n\n<b>Черновик ответа:</b>\n${esc(a.client_reply)}`;
    msg += '\n\n<i>Нормы и сроки проверить по актуальной редакции.</i>';
  }
  const phone = lead.contact.replace(/\D/g, '');
  const body = { chat_id: chat, text: msg.slice(0, 4000), parse_mode: 'HTML', disable_web_page_preview: true };
  if (phone.length >= 10) body.reply_markup = { inline_keyboard: [[{ text: 'Написать в WhatsApp', url: 'https://wa.me/' + phone + (a && a.client_reply ? '?text=' + encodeURIComponent(a.client_reply) : '') }]] };
  const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) console.error('telegram', r.status, await r.text());
  return r.ok;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method' });
  const b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
  if (b.website) return res.status(200).json({ delivered: true, analysis: null }); // бот-ловушка
  const lead = {
    name: clip(b.name, 120), contact: clip(b.contact, 60), format: clip(b.format, 60) || 'Пока не знаю',
    topic: clip(b.topic, 80) || 'Другое', story: clip(b.story, 6000), goal: clip(b.goal, 500),
    docs: clip(b.docs, 500), deadline: clip(b.deadline, 200),
    pay: clip(b.pay, 80), source: clip(b.source, 200),
  };
  if (!lead.pay) return res.status(400).json({ error: 'invalid' });
  if (!lead.name || !lead.contact || lead.story.length < 30) return res.status(400).json({ error: 'invalid' });
  let a = null;
  try { a = await analyze(lead); } catch (e) { console.error(e); }
  let delivered = false;
  try { delivered = await notify(lead, a); } catch (e) { console.error(e); }
  // Клиенту уходит только клиентская часть разбора
  const client = a && {
    summary: a.summary, documents_needed: a.documents_needed, questions_for_client: a.questions_for_client,
    urgency: a.urgency, urgency_reason: a.urgency_reason, format_suggested: a.format_suggested, estimated_hours: a.estimated_hours,
    off_profile: a.fit === 'непрофильное',
  };
  return res.status(200).json({ delivered, analysis: client });
}
