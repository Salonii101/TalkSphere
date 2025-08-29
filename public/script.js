// script.js - client logic (typing, recording, audio send/playback, local history)

const modal = document.getElementById('modal');
const startBtn = document.getElementById('startBtn');
const yourNameInput = document.getElementById('yourName');
const theirNameInput = document.getElementById('theirName');

const chatContainer = document.getElementById('chat-container');
const chatArea = document.getElementById('chat-area');
const statusFooter = document.getElementById('status-footer');
const textInput = document.getElementById('text-input');
const sendBtn = document.getElementById('send-btn');
const recordBtn = document.getElementById('record-btn');

let ws = null;
let me = '';
let friend = '';
let room = '';
let typingTimer = null;
let mediaRecorder = null;
let audioChunks = [];

// helper: format seconds to m:ss
function fmtDuration(sec) {
  if (!isFinite(sec)) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2,'0')}`;
}
function timeLabel(ts = Date.now()){
  const d = new Date(ts);
  return d.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
}

// append text bubble
function appendTextBubble(userName, text, ts, mine=false){
  const div = document.createElement('div');
  div.className = 'msg ' + (mine ? 'me' : 'friend');
  div.innerHTML = `<div class="text">${escapeHtml(text)}</div><span class="time">${timeLabel(ts)}</span>`;
  chatArea.appendChild(div);
  chatArea.scrollTop = chatArea.scrollHeight;
}

// append audio bubble with custom play button + duration
function appendAudioBubble(userName, base64DataUrl, durationSec, ts, mine=false){
  const div = document.createElement('div');
  div.className = 'msg ' + (mine ? 'me' : 'friend');

  // build inner
  const safeDuration = fmtDuration(durationSec);
  div.innerHTML = `
    <div class="audio-bubble">
      <button class="play-btn">▶</button>
      <div class="wave"></div>
      <div class="voice-duration">${safeDuration}</div>
    </div>
    <span class="time">${timeLabel(ts)}</span>
  `;
  chatArea.appendChild(div);
  chatArea.scrollTop = chatArea.scrollHeight;

  // playback setup
  const playBtn = div.querySelector('.play-btn');
  const audio = new Audio(base64DataUrl);
  let playing = false;
  audio.addEventListener('ended', () => { playing = false; playBtn.textContent = '▶'; });
  playBtn.addEventListener('click', () => {
    if (!playing) { audio.play(); playBtn.textContent = '⏸'; playing = true; }
    else { audio.pause(); playBtn.textContent = '▶'; playing = false; }
  });
}

// escape HTML
function escapeHtml(s){ return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]); }

// local history
function saveLocal(msg){
  if(!room) return;
  const k = 'chat_' + room;
  const arr = JSON.parse(localStorage.getItem(k) || '[]');
  arr.push(msg);
  localStorage.setItem(k, JSON.stringify(arr));
}
function loadLocal(){
  if(!room) return;
  const k = 'chat_' + room;
  const arr = JSON.parse(localStorage.getItem(k) || '[]');
  arr.forEach(m => {
    if (m.sub === 'text') appendTextBubble(m.user, m.text, m.ts, m.user === me);
    if (m.sub === 'audio') appendAudioBubble(m.user, m.data, m.durationSec, m.ts, m.user === me);
  });
}

// connect web socket
function connectSocket(){
  if (ws && ws.readyState === WebSocket.OPEN) return;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const url = `${proto}://${location.host}/ws`;
  ws = new WebSocket(url);

  ws.addEventListener('open', () => {
    // send join
    ws.send(JSON.stringify({ type: 'join', name: me, friend }));
    // load history
    loadLocal();
  });

  ws.addEventListener('message', ev => {
    let data;
    try { data = JSON.parse(ev.data); } catch(e){ return; }

    if (data.type === 'typing') {
      if (data.user !== me && data.isTyping) showTypingDots(true);
      else if (data.user !== me) showTypingDots(false);
      return;
    }

    if (data.type === 'recording') {
      if (data.user !== me && data.recording) showRecording(true);
      else if (data.user !== me) showRecording(false);
      return;
    }

    if (data.type === 'chat') {
      if (data.sub === 'text') {
        appendTextBubble(data.user, data.text, data.ts, false);
        saveLocal({ sub:'text', user: data.user, text: data.text, ts: data.ts });
      } else if (data.sub === 'audio') {
        appendAudioBubble(data.user, data.data, data.durationSec, data.ts, false);
        saveLocal({ sub:'audio', user: data.user, data: data.data, durationSec: data.durationSec, ts: data.ts });
      }
      return;
    }

    if (data.type === 'system') {
      // optional: show join/leave system messages
    }
  });

  ws.addEventListener('close', ()=> {
    // attempt reconnect after a short delay
    setTimeout(() => { if (!ws || ws.readyState !== WebSocket.OPEN) connectSocket(); }, 800);
  });
}

// show typing dots in footer
let typingVisible = false;
function showTypingDots(show){
  typingVisible = show;
  renderFooterStatus();
}

// show recording indicator in footer
let recordingVisible = false;
function showRecording(show){
  recordingVisible = show;
  renderFooterStatus();
}

function renderFooterStatus(){
  if (recordingVisible) {
    statusFooter.innerHTML = `<div class="recording"><span class="rec-dot"></span> Recording voice message...</div>`;
  } else if (typingVisible) {
    statusFooter.innerHTML = `<div class="typing"><span class="dot"></span><span class="dot"></span><span class="dot"></span> &nbsp; ${escapeHtml(friend)} is typing...</div>`;
  } else {
    statusFooter.innerHTML = ``;
  }
}

// send typing event (debounced)
textInput.addEventListener('input', () => {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  const isTyping = textInput.value.trim().length > 0;
  ws.send(JSON.stringify({ type: 'typing', isTyping }));
  // stop typing after 900ms of no input
  clearTimeout(typingTimer);
  typingTimer = setTimeout(() => {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'typing', isTyping: false }));
  }, 900);
});

// send text
sendBtn.addEventListener('click', () => {
  const txt = textInput.value.trim();
  if (!txt) return;
  const ts = Date.now();
  appendTextBubble(me, txt, ts, true);
  saveLocal({ sub:'text', user: me, text: txt, ts });
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type:'chat', sub:'text', text: txt, ts }));
  }
  textInput.value = '';
  // notify stop typing
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type:'typing', isTyping:false }));
});

// audio recording: hold to record (mousedown/mouseup & touch)
async function ensureMicrophone(){
  try {
    const s = await navigator.mediaDevices.getUserMedia({ audio: true });
    return s;
  } catch (e) {
    alert('Microphone access denied or unavailable.');
    throw e;
  }
}

let currentStream = null;
let recordStart = 0;

async function startRecording(){
  try {
    currentStream = await ensureMicrophone();
    audioChunks = [];
    mediaRecorder = new MediaRecorder(currentStream);
    mediaRecorder.ondataavailable = (ev) => { if (ev.data && ev.data.size) audioChunks.push(ev.data); };
    mediaRecorder.onstop = async () => {
      // build blob and base64
      const blob = new Blob(audioChunks, { type: audioChunks[0]?.type || 'audio/webm' });
      const durationSec = await getBlobDuration(blob);
      const base64 = await blobToDataURL(blob);

      const ts = Date.now();
      // append locally as me
      appendAudioBubble(me, base64, durationSec, ts, true);
      saveLocal({ sub:'audio', user: me, data: base64, durationSec, ts });

      // send to server
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type:'chat', sub:'audio', data: base64, durationSec, ts }));
      }

      // cleanup stream tracks
      if (currentStream) {
        currentStream.getTracks().forEach(t => t.stop());
        currentStream = null;
      }
      recordingVisible = false;
      renderFooterStatus();
      // notify server recording ended
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type:'recording', recording: false }));
    };

    mediaRecorder.start();
    recordStart = Date.now();
    recordingVisible = true;
    renderFooterStatus();
    // notify server
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type:'recording', recording: true }));
  } catch (e) {
    console.error('record fail', e);
  }
}

function stopRecording(){
  try {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
    if (currentStream) {
      currentStream.getTracks().forEach(t => t.stop());
      currentStream = null;
    }
  } catch (e) { /* ignore */ }
}

// helper: convert blob to base64 data url
function blobToDataURL(blob){
  return new Promise((res) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result);
    fr.readAsDataURL(blob);
  });
}

// helper: get blob duration robustly
function getBlobDuration(blob){
  return new Promise((resolve) => {
    try {
      const audio = document.createElement('audio');
      audio.preload = 'metadata';
      audio.src = URL.createObjectURL(blob);
      audio.addEventListener('loadedmetadata', () => {
        const d = audio.duration || 0;
        resolve(Number.isFinite(d) ? d : 0);
      });
      // fallback if metadata doesn't load
      setTimeout(() => resolve(0), 3000);
    } catch (e) { resolve(0); }
  });
}

// record button events
recordBtn.addEventListener('mousedown', (e) => { e.preventDefault(); startRecording(); });
recordBtn.addEventListener('touchstart', (e) => { e.preventDefault(); startRecording(); }, {passive:false});

recordBtn.addEventListener('mouseup', (e) => { e.preventDefault(); stopRecording(); });
recordBtn.addEventListener('mouseleave', (e) => { /* if they drag out, we'll still stop */ stopRecording(); });
recordBtn.addEventListener('touchend', (e) => { e.preventDefault(); stopRecording(); }, {passive:false});

// start button (modal)
startBtn.addEventListener('click', () => {
  const a = yourNameInput.value.trim();
  const b = theirNameInput.value.trim();
  if (!a || !b) { alert('Enter both names'); return; }
  me = a; friend = b;
  room = [me, friend].map(s => s.toLowerCase().trim()).sort().join('#');
  modal.classList.add('hidden');
  chatContainer.classList.remove('hidden');

  // connect and load
  connectSocket();
});

// on unload: notify server stop typing / stop recording
window.addEventListener('beforeunload', () => {
  if (ws && ws.readyState === WebSocket.OPEN) {
    try { ws.send(JSON.stringify({ type: 'typing', isTyping: false })); } catch(e){}
    try { ws.send(JSON.stringify({ type: 'recording', recording: false })); } catch(e){}
  }
});
