/*
Cloudflare Workers adapter for the OFFICIAL Ganjoor MCP server.
This file does not reimplement, filter, or remove the official tools.
It needs the official repository and its compiled dist/server.js.
This adapter has NOT been deployed or tested against Gemini or Cloudflare.

راهنما:
۱) کد رسمی را از https://github.com/ganjoor/ganjoor-mcp-server دانلود و باز کنید.
   در GitHub: Code > Download ZIP. پوشهٔ پروژه همان پوشه‌ای است که package.json دارد.
۲) این فایل را کنار package.json در همان پوشه بگذارید.
۳) Node.js LTS را از https://nodejs.org نصب کنید و Terminal را در پوشهٔ پروژه باز کنید.
۴) این فرمان‌ها را جداگانه اجرا کنید:
   npm ci --include=dev
   npm run build
۵) برای حساب رایگان Cloudflare از https://dash.cloudflare.com/sign-up استفاده کنید.
   فقط Workers Free؛ برای این فایل خرید دامنه و سرویس‌های پولی لازم نیست.
۶) ورود و انتشار را جداگانه اجرا کنید:
   npx wrangler login
   npx wrangler deploy ganjoor-official-worker.mjs --name ganjoor-poetry-full --compatibility-date 2026-10-09 --compatibility-flags nodejs_compat
۷) نشانی واقعی workers.dev که در خروجی چاپ شده را باز کنید.
   روی «نمایش ابزارهای ثبت‌شده» بزنید. نسخه فعلی رسمی باید ۴۴ ابزار نشان دهد.
   ثبت ابزار به معنی موفقیت اجرای تک‌تک ابزارها نیست؛ باید پاسخ‌های واقعی هم آزموده شوند.
۸) نشانی همان Worker با /mcp در پایان، نشانی اتصال در Custom apps جمینای است.

نکته: دسترسی سرور رسمی عمومی و فقط خواندنی است. جستجوی معنایی ممکن است در
API گنجور غیرفعال باشد. ثبت حاشیه، نشان‌گذاری حساب شخصی و ارسال اصلاحیه در سرور
رسمی ارائه نشده‌اند. سازگاری اتصال بدون OAuth در حساب جمینای باید بررسی شود.
این فایل OAuth پیاده‌سازی نمی‌کند و تضمین اتصال به جمینای نیست.

Prerequisites / verification sources:
https://github.com/ganjoor/ganjoor-mcp-server
https://developers.cloudflare.com/workers/runtime-apis/nodejs/http/
https://developers.cloudflare.com/workers/wrangler/commands/workers/
*/

import express from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { httpServerHandler } from 'cloudflare:node';
import { createServer } from './dist/server.js';

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));

app.get('/', (_req, res) => {
  res.type('html').send(`<!doctype html>
<html lang="fa" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>سرور رسمی گنجور</title><style>body{max-width:750px;margin:48px auto;padding:24px;font:18px/1.8 system-ui;background:#faf8f3;color:#242424}code{direction:ltr;display:block;overflow-wrap:anywhere;padding:16px;background:#fff;border:1px solid #ddd}button{font:inherit;padding:8px 14px;margin:10px;cursor:pointer}li{overflow-wrap:anywhere}</style>
<h1>واسط سرور رسمی گنجور</h1><p>ابزارها مستقیماً از کد رسمی گنجور ثبت می‌شوند. این واسط فهرست ابزارها را محدود نمی‌کند.</p>
<p>نشانی اتصال MCP:</p><code id="endpoint"></code><button id="copy">کپی نشانی اتصال</button>
<button id="test">نمایش ابزارهای ثبت‌شده</button><p id="status"></p><ol id="tools"></ol>
<p>نمایش ابزارها فقط ثبت‌شدن آن‌ها را بررسی می‌کند. برای بررسی عملکرد، جستجو و خواندن شعر را با پاسخ واقعی امتحان کنید.</p>
<p>جستجوی معنایی به فعال‌بودن سرویس آن در گنجور وابسته است. امکانات حساب شخصی و نوشتن در گنجور جزو ابزارهای رسمی این سرور نیستند.</p>
<p>اگر جمینای برای اتصال OAuth یا Client ID می‌خواهد، این واسط به‌تنهایی آن مرحله را فراهم نمی‌کند.</p>
<script>
const endpoint=location.origin+'/mcp';
document.getElementById('endpoint').textContent=endpoint;
document.getElementById('copy').onclick=async()=>{try{await navigator.clipboard.writeText(endpoint);document.getElementById('status').textContent='نشانی کپی شد.'}catch{document.getElementById('status').textContent='نشانی بالا را انتخاب و کپی کنید.'}};
async function rpc(body,version){const headers={'Content-Type':'application/json','Accept':'application/json, text/event-stream'};if(version)headers['MCP-Protocol-Version']=version;const r=await fetch(endpoint,{method:'POST',headers,body:JSON.stringify(body)});if(!r.ok)throw new Error('HTTP '+r.status);const data=await r.json();if(data.error)throw new Error(data.error.message);return data.result;}
document.getElementById('test').onclick=async()=>{
 const status=document.getElementById('status');const list=document.getElementById('tools');list.replaceChildren();status.textContent='در حال بررسی…';
 try{
  const init=await rpc({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'ganjoor-worker-check',version:'1.0.0'}}});
  const headers={'Content-Type':'application/json','Accept':'application/json, text/event-stream','MCP-Protocol-Version':init.protocolVersion};
  const notification=await fetch(endpoint,{method:'POST',headers,body:JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})});
  if(!notification.ok)throw new Error('Notification HTTP '+notification.status);
  let cursor;const tools=[];
  do{const result=await rpc({jsonrpc:'2.0',id:2,method:'tools/list',params:cursor?{cursor}:{}},init.protocolVersion);tools.push(...result.tools);cursor=result.nextCursor;}while(cursor);
  const essential=['ganjoor_search_poems','ganjoor_semantic_search_poems','ganjoor_get_poem','ganjoor_get_poem_recitations','ganjoor_analyze_poem_rhyme'];
  const missing=essential.filter(name=>!tools.some(tool=>tool.name===name));
  status.textContent=tools.length+' ابزار ثبت شده است.'+(missing.length?' ابزارهای مورد انتظار پیدا نشدند: '+missing.join(', '):' ابزارهای جستجو، شعر، خوانش و قافیه در فهرست هستند.');
  for(const tool of tools){const li=document.createElement('li');li.textContent=tool.name;li.dir='ltr';list.appendChild(li)}
 }catch(error){status.textContent='بررسی موفق نشد: '+error.message;}
};
</script></html>`);
});

app.post('/mcp', async (req, res) => {
  // The official factory registers every official tool. Nothing is rewritten.
  const server = createServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
    // Origin is validated by the Worker fetch handler below.
    enableDnsRebindingProtection: false,
  });
  res.on('close', () => {
    Promise.allSettled([transport.close(), server.close()]);
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch {
    if (!res.headersSent) res.status(500).json({ jsonrpc: '2.0', id: req.body?.id ?? null, error: { code: -32603, message: 'MCP handler failed. Inspect the Worker logs.' } });
  }
});

app.all('/mcp', (_req, res) => {
  res.set('Allow', 'POST, OPTIONS').status(405).json({ note: 'This stateless MCP endpoint accepts POST JSON messages.' });
});
app.use((error, _req, res, _next) => {
  res.status(error.status ?? 500).json({ error: 'Invalid request or server error.' });
});

// Workers supports Node HTTP using a virtual port; no separate server is rented.
const nodeHandler = httpServerHandler(app.listen(3000));

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin');
    if (origin && ![url.origin, 'https://gemini.google.com'].includes(origin)) {
      return new Response('Origin not allowed.', { status: 403 });
    }
    let response;
    if (request.method === 'OPTIONS') response = new Response(null, { status: 204 });
    else response = await nodeHandler.fetch(request, env, ctx);
    const headers = new Headers(response.headers);
    headers.set('Cache-Control', 'no-store');
    headers.set('X-Content-Type-Options', 'nosniff');
    headers.set('Vary', 'Origin');
    if (origin) headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    headers.set('Access-Control-Allow-Headers', 'Content-Type, Accept, MCP-Protocol-Version');
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  },
};
