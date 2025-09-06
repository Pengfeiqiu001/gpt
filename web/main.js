const apiInput = document.getElementById('api');
const tokenInput = document.getElementById('token');
const saveBtn = document.getElementById('save');
const clearBtn = document.getElementById('clearHist');
const q = document.getElementById('q');
const sendBtn = document.getElementById('send');
const sendSSEBtn = document.getElementById('sendSSE');
const chat = document.getElementById('chat');
const statusEl = document.getElementById('status');

let API_BASE = localStorage.getItem('api_base') || '';
let APP_TOKEN = localStorage.getItem('app_token') || '';
apiInput.value = API_BASE;
tokenInput.value = APP_TOKEN;

let history = [];

function logSys(text, ok=false, err=false){
  statusEl.textContent = '状态：' + text;
  statusEl.className = 'sys ' + (ok?'ok':'') + (err?' err':'');
}
function append(role, text){
  const div = document.createElement('div');
  div.className = 'msg ' + (role==='user'?'user': role==='ai'?'ai':'sys');
  div.textContent = (role==='user'?'你: ':role==='ai'?'AI: ':'系统: ') + text;
  chat.appendChild(div);
  chat.scrollTop = chat.scrollHeight;
}
function headersJSON(){
  const h = {};
  h['Content-Type'] = 'text/plain'; // 避免预检
  if (APP_TOKEN) h['x-app-token'] = APP_TOKEN;
  return h;
}
function headersSSE(){
  const h = {};
  if (APP_TOKEN) h['x-app-token'] = APP_TOKEN;
  return h;
}

saveBtn.onclick = ()=>{
  API_BASE = apiInput.value.trim();
  APP_TOKEN = tokenInput.value.trim();
  localStorage.setItem('api_base', API_BASE);
  localStorage.setItem('app_token', APP_TOKEN);
  logSys('已保存 API_BASE 与 App Token', true);
};
clearBtn.onclick = ()=>{
  history = [];
  chat.textContent = '';
  logSys('已清空对话', true);
};

async function sendNonStream(text){
  history.push({ role: 'user', content: text });
  const payload = { messages: history, stream: false };
  const resp = await fetch(API_BASE + '/chat', {
    method: 'POST',
    headers: headersJSON(),
    body: JSON.stringify(payload)
  });
  const data = await resp.json();
  if (!resp.ok){ append('sys', '错误：' + JSON.stringify(data)); return; }
  const out = data.choices?.[0]?.message?.content || JSON.stringify(data);
  append('ai', out);
  history.push({ role: 'assistant', content: out });
}

async function sendStream(text){
  history.push({ role: 'user', content: text });
  const payload = { messages: history, stream: true };
  try{
    const resp = await fetch(API_BASE + '/chat', {
      method: 'POST',
      headers: headersSSE(),
      body: JSON.stringify(payload)
    });
    if (!resp.ok || !(resp.headers.get('content-type')||'').includes('text/event-stream')){
      await sendNonStream(text);
      return;
    }
    logSys('SSE 连接成功，开始流式', true);
    const reader = resp.body.getReader();
    let buffer = '', acc='';
    const aiDiv = document.createElement('div'); aiDiv.className='msg ai'; aiDiv.textContent='AI: ';
    chat.appendChild(aiDiv);
    while(true){
      const { value, done } = await reader.read();
      if (done) break;
      buffer += new TextDecoder().decode(value, { stream: true });
      const parts = buffer.split('\n\n');
      for (let i=0; i<parts.length-1; i++){
        const line = parts[i].trim();
        if (line.startsWith('data: ')){
          const payload = line.slice(6);
          if (payload === '[DONE]') continue;
          try{
            const obj = JSON.parse(payload);
            const delta = obj.choices?.[0]?.delta?.content || '';
            acc += delta; aiDiv.textContent = 'AI: ' + acc;
          }catch{}
        }
      }
      buffer = parts[parts.length-1];
      chat.scrollTop = chat.scrollHeight;
    }
    history.push({ role:'assistant', content: aiDiv.textContent.replace(/^AI: /,'') });
  }catch(e){
    await sendNonStream(text);
  }
}

sendBtn.onclick = async ()=>{
  const text = q.value.trim(); if(!text){ return; }
  append('user', text); q.value='';
  try{ await sendNonStream(text); logSys('非流式完成', true); }
  catch(e){ append('sys', '请求失败：' + e.message); logSys('请求失败', false, true); }
};
sendSSEBtn.onclick = async ()=>{
  const text = q.value.trim(); if(!text){ return; }
  append('user', text); q.value='';
  try{ await sendStream(text); }
  catch(e){ append('sys', '流式失败：' + e.message); await sendNonStream(text); }
};
