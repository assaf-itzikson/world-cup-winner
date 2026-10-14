import { apiBaseUrl, staticSite } from './config.js';

const element = id => document.getElementById(id);
const crossOrigin = Boolean(apiBaseUrl) && new URL(apiBaseUrl).origin !== window.location.origin;
const apiPath = pathname => `${apiBaseUrl}${pathname}`;
let adminToken = sessionStorage.getItem('drawAdminToken') || '';
const authHeaders = () => adminToken ? { Authorization: `Bearer ${adminToken}` } : {};
const canvas = element('wheel');
const context = canvas.getContext('2d');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
let state = { participants: [], draw: null };
let admin = false;
let connected = false;
let stream;
let transport = 'sse';
let pollTimer;
let pollController;
let connectionGeneration = 0;
let viewerId = sessionStorage.getItem('viewerId') || crypto.randomUUID();
sessionStorage.setItem('viewerId', viewerId);
const pageId = crypto.randomUUID();
let submittedName = sessionStorage.getItem('submittedWatchName') || '';
let checkInPending = false;
let offset = 0;
let rotation = 0;
let previousDrawKey;
let pending = false;
let toastTimer;
element('viewer-name').value = '';
updateCheckInControls();

function updateCheckInControls() {
  if (submittedName) {
    element('viewer-name').value = submittedName;
    element('watch-message').textContent = `Checked in as ${submittedName}. Your name is saved for this tab.`;
  }
  element('viewer-name').disabled = Boolean(submittedName) || checkInPending;
  element('watch-form').querySelector('button[type="submit"]').disabled = Boolean(submittedName) || checkInPending;
}
async function submitCheckIn(name) {
  if (checkInPending) return;
  checkInPending = true;
  updateCheckInControls();
  try {
    await post('watch', { id: viewerId, pageId, name });
    submittedName = name;
    sessionStorage.setItem('submittedWatchName', name);
    updateCheckInControls();
  } catch (error) {
    element('watch-message').textContent = error.message;
  } finally {
    checkInPending = false;
    element('viewer-name').disabled = Boolean(submittedName);
    element('watch-form').querySelector('button[type="submit"]').disabled = Boolean(submittedName);
  }
}

function toast(message) {
  element('toast').textContent = message;
  element('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { element('toast').hidden = true; }, 5000);
}
async function post(route, data = {}, signal) {
  const response = await fetch(apiPath(`/api/${route}`), { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify(data), signal });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Something went wrong. Please try again.');
  return result;
}
function drawWheel(angle) {
  if (!state.participants.length) return;
  const size = canvas.width;
  const radius = size / 2;
  const slice = Math.PI * 2 / state.participants.length;
  context.clearRect(0, 0, size, size);
  context.save();
  context.translate(radius, radius);
  context.rotate(angle - Math.PI / 2);
  state.participants.forEach((name, index) => {
    const start = index * slice;
    context.beginPath();
    context.moveTo(0, 0);
    context.arc(0, 0, radius - 2, start, start + slice);
    context.closePath();
    context.fillStyle = ['#1b4434', '#e9deb4', '#718769', '#c5cbaa'][index % 4];
    context.fill();
    context.strokeStyle = '#f6f0dc55';
    context.lineWidth = 2;
    context.stroke();
    context.save();
    context.rotate(start + slice / 2);
    context.textAlign = 'right';
    context.textBaseline = 'middle';
    context.fillStyle = index % 4 === 0 ? '#f4eccf' : '#173d2e';
    context.font = '500 22px Arial';
    context.fillText(name, radius - 32, 0, radius - 160);
    context.restore();
  });
  context.restore();
}
function updateControls() {
  const spinning = state.draw && !state.draw.complete;
  element('spin').disabled = !admin || !connected || Boolean(state.draw) || pending;
  element('spin-label').textContent = spinning ? 'The wheel is turning…' : state.draw?.complete ? 'The winners are in!' : admin ? 'Spin & pick three winners' : 'Waiting for the admin';
  element('spin-label').parentElement.setAttribute('aria-busy', String(Boolean(spinning)));
  element('reset').hidden = !admin || !state.draw?.complete;
  element('reset').disabled = pending;
  element('admin-open').textContent = admin ? 'Sign out ↗' : 'Admin access ↗';
  element('admin-viewers').hidden = !admin;
  element('wheel-note').textContent = admin ? 'You’re in control. The draw is live for everyone in the room.' : 'The admin starts the draw. Everyone shares the moment.';
}
function render() {
  element('viewer-count').textContent = state.viewerCount || 0;
  element('participant-count').textContent = state.participants.length;
  element('footer-count').textContent = state.participants.length;
  const spinning = state.draw && !state.draw.complete;
  element('draw-badge').textContent = spinning ? 'SPINNING LIVE' : state.draw?.complete ? 'DRAW COMPLETE' : 'READY WHEN YOU ARE';
  element('wheel-status').textContent = spinning ? 'Hold your breath. Your moment is coming.' : state.draw?.complete ? 'Three names. Three lucky winners. Congratulations!' : `${state.participants.length} names. Equal chances. Let fate decide.`;
  const drawKey = `${state.draw?.id || 'none'}:${Boolean(state.draw?.complete)}:${state.participants.join('|')}`;
  if (drawKey !== previousDrawKey) {
    const winners = state.draw?.winners || [];
    element('winner-list').replaceChildren(...[0, 1, 2].map(index => {
      const card = document.createElement('div');
      card.className = `winner${winners[index] ? ' revealed' : ''}`;
      const number = document.createElement('span');
      number.className = 'winner-number';
      number.textContent = `0${index + 1}`;
      const details = document.createElement('div');
      const name = document.createElement('strong');
      name.textContent = winners[index] || (spinning ? 'Fate is doing its thing…' : 'Could it be you?');
      const caption = document.createElement('small');
      caption.textContent = winners[index] ? 'Selected in the live draw' : 'Waiting for the wheel';
      details.append(name, caption);
      card.append(number, details);
      return card;
    }));
    element('participants').replaceChildren(...state.participants.map(name => {
      const chip = document.createElement('span');
      chip.className = `participant${winners.includes(name) ? ' selected' : ''}`;
      chip.textContent = name;
      return chip;
    }));
    document.body.classList.toggle('celebrating', Boolean(state.draw?.complete));
    previousDrawKey = drawKey;
  }
  updateControls();
}
function renderViewers(viewers) {
  element('viewer-list').replaceChildren(...viewers.map(viewer => {
    const item = document.createElement('li');
    item.textContent = viewer.name;
    return item;
  }));
  if (!viewers.length) {
    const item = document.createElement('li');
    item.textContent = 'No check-ins yet.';
    element('viewer-list').append(item);
  }
}
function setConnected(value) {
  connected = value;
  element('connection-dot').classList.toggle('online', value);
  element('connection-label').textContent = value ? 'Live room' : 'Reconnecting';
  updateControls();
}
async function pollRoom(generation) {
  const controller = new AbortController();
  pollController = controller;
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const result = await post('poll', { id: viewerId, pageId }, controller.signal);
    if (generation !== connectionGeneration) return;
    viewerId = result.id;
    sessionStorage.setItem('viewerId', viewerId);
    admin = result.admin;
    state = result.state;
    offset = state.serverTime - Date.now();
    setConnected(true);
    render();
    if (admin) renderViewers(result.viewers);
    if (submittedName && !result.checkedIn) await submitCheckIn(submittedName);
  } catch (error) {
    if (generation === connectionGeneration) setConnected(false);
  } finally {
    clearTimeout(timeout);
    if (generation === connectionGeneration) pollTimer = setTimeout(() => pollRoom(generation), 1000);
  }
}
function connect() {
  connectionGeneration += 1;
  clearTimeout(pollTimer);
  pollController?.abort();
  stream?.close();
  if (transport === 'poll') {
    pollRoom(connectionGeneration);
    return;
  }
  stream = new EventSource(apiPath(`/api/events?id=${encodeURIComponent(viewerId)}&pageId=${encodeURIComponent(pageId)}`));
  stream.addEventListener('connected', async event => {
    const connection = JSON.parse(event.data);
    viewerId = connection.id;
    sessionStorage.setItem('viewerId', viewerId);
    connected = true;
    element('connection-dot').classList.add('online');
    element('connection-label').textContent = 'Live room';
    updateControls();
    if (submittedName && !connection.checkedIn) await submitCheckIn(submittedName);
  });
  stream.addEventListener('state', event => {
    state = JSON.parse(event.data);
    offset = state.serverTime - Date.now();
    render();
  });
  stream.addEventListener('viewers', event => {
    renderViewers(JSON.parse(event.data));
  });
  stream.onerror = () => {
    connected = false;
    element('connection-dot').classList.remove('online');
    element('connection-label').textContent = 'Reconnecting';
    updateControls();
  };
}
function animate() {
  if (state.draw && !state.draw.complete) {
    const elapsed = Math.max(0, Date.now() + offset - state.draw.startedAt) / 1000;
    rotation = reducedMotion ? 0 : elapsed * 3.8;
  } else if (state.draw?.complete) {
    const winnerIndex = state.participants.indexOf(state.draw.winners[0]);
    const target = -(winnerIndex + 0.5) * Math.PI * 2 / state.participants.length;
    const difference = Math.atan2(Math.sin(target - rotation), Math.cos(target - rotation));
    rotation = reducedMotion ? target : rotation + difference * 0.09;
  } else rotation = 0;
  drawWheel(rotation);
  requestAnimationFrame(animate);
}
element('admin-open').addEventListener('click', async () => {
  if (admin) {
    try {
      await post('logout');
      admin = false;
      adminToken = '';
      sessionStorage.removeItem('drawAdminToken');
      element('viewer-list').replaceChildren();
      connect();
      updateControls();
    }
    catch (error) { toast(error.message); }
  } else element('admin-dialog').showModal();
});
element('admin-close').addEventListener('click', () => element('admin-dialog').close());
element('login-form').addEventListener('submit', async event => {
  event.preventDefault();
  const button = event.currentTarget.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    const result = await post('login', { password: element('admin-password').value });
    adminToken = result.token;
    sessionStorage.setItem('drawAdminToken', adminToken);
    admin = true;
    element('admin-password').value = '';
    element('login-error').textContent = '';
    element('admin-dialog').close();
    connect();
    updateControls();
  } catch (error) { element('login-error').textContent = error.message; }
  finally { button.disabled = false; }
});
element('watch-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (submittedName || checkInPending) return;
  await submitCheckIn(element('viewer-name').value.trim());
});
element('spin').addEventListener('click', async () => {
  pending = true;
  updateControls();
  try { await post('spin'); }
  catch (error) { toast(error.message); }
  finally { pending = false; updateControls(); }
});
element('reset').addEventListener('click', async () => {
  if (!window.confirm('Clear the current results and prepare a new draw?')) return;
  pending = true;
  updateControls();
  try { await post('reset'); }
  catch (error) { toast(error.message); }
  finally { pending = false; updateControls(); }
});
async function start() {
  if (staticSite) {
    try {
      const response = await fetch('./participants.json');
      if (!response.ok) throw new Error('Unable to load participant list.');
      state.participants = [...new Set(await response.json())];
      render();
    } catch (error) { toast(error.message); }
    if (!apiBaseUrl) {
      element('connection-label').textContent = 'Draw not connected';
      element('draw-badge').textContent = 'AWAITING HOST';
      element('spin-label').textContent = 'Waiting for live connection';
      element('viewer-count').textContent = '—';
      element('watch-message').textContent = 'The live draw is not connected yet. Please check back soon.';
      element('viewer-name').disabled = true;
      element('watch-form').querySelector('button[type="submit"]').disabled = true;
      element('admin-open').disabled = true;
      animate();
      return;
    }
  }
  try {
    const response = await fetch(apiPath('/api/session'), { headers: authHeaders() });
    if (!response.ok) throw new Error('Unable to connect to the room.');
    const session = await response.json();
    admin = session.admin;
    transport = crossOrigin ? 'poll' : session.transport;
  } catch (error) { toast(error.message); }
  connect();
  animate();
}
window.addEventListener('pagehide', () => {
  connectionGeneration += 1;
  clearTimeout(pollTimer);
  pollController?.abort();
  stream?.close();
  if (staticSite && !apiBaseUrl) return;
  const departure = JSON.stringify({ id: viewerId, pageId });
  if (crossOrigin) {
    fetch(apiPath('/api/leave'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: departure, keepalive: true, credentials: 'omit' }).catch(() => {});
  } else navigator.sendBeacon(apiPath('/api/leave'), new Blob([departure], { type: 'application/json' }));
});
window.addEventListener('pageshow', event => {
  if (event.persisted) connect();
});
start();
