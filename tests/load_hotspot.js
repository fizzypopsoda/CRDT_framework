import ws from 'k6/ws';
import { Counter } from 'k6/metrics';

export let options = {
  vus: Number(__ENV.VUS || 300),
  duration: __ENV.DURATION || '60s',
};

const messagesSent = new Counter('pixel_updates_sent');
const messagesRecv = new Counter('pixel_updates_received');

const WS_URL = __ENV.WS_URL || 'ws://localhost:3000/ws';
const MODE = __ENV.MODE || 'per_pixel';      // 'per_pixel' or 'batch'
const WORKLOAD = __ENV.WORKLOAD || 'hotspot';
const BATCH_INTERVAL_MS = Number(__ENV.BATCH_INTERVAL_MS || 1000);

const CANVAS_WIDTH = Number(__ENV.CANVAS_WIDTH || 128);
const CANVAS_HEIGHT = Number(__ENV.CANVAS_HEIGHT || 128);

function userColor() {
  const hues = [0, 60, 120, 180, 240, 300];
  const h = hues[(__VU - 1) % hues.length];
  return `hsl(${h},100%,50%)`;
}

function pickPixel() {
  if (WORKLOAD === 'hotspot') {
    const regionSize = 20;
    const x0 = Math.floor(CANVAS_WIDTH / 2 - regionSize / 2);
    const y0 = Math.floor(CANVAS_HEIGHT / 2 - regionSize / 2);
    const x = x0 + Math.floor(Math.random() * regionSize);
    const y = y0 + Math.floor(Math.random() * regionSize);
    return { x, y };
  } else {
    const stripes = Math.min(
      CANVAS_WIDTH,
      __ENV.STRIPES ? Number(__ENV.STRIPES) : 16
    );
    const stripeWidth = Math.floor(CANVAS_WIDTH / stripes);
    const stripeIdx = (__VU - 1) % stripes;
    const x0 = stripeIdx * stripeWidth;
    const x = x0 + Math.floor(Math.random() * stripeWidth);
    const y = Math.floor(Math.random() * CANVAS_HEIGHT);
    return { x, y };
  }
}

function sendDraw(socket, pixel) {
  const msg = JSON.stringify({
    type: 'draw',
    x: pixel.x,
    y: pixel.y,
    color: userColor(),
  });
  socket.send(msg);
  messagesSent.add(1);
}

export default function () {
  ws.connect(WS_URL, {}, function (socket) {
    let closed = false;

    socket.on('open', function () {
      if (MODE === 'per_pixel') {
        runPerPixel(socket, () => closed);
      } else {
        runBatched(socket, () => closed);
      }
    });

    socket.on('message', function (_data) {
      messagesRecv.add(1);
    });

    socket.on('close', function () {
      closed = true;
    });

    socket.on('error', function () {
      closed = true;
    });

    socket.setTimeout(function () {
      closed = true;
      socket.close();
    }, 55 * 1000);
  });
}

function runPerPixel(socket, isClosed) {
  const intervalMs = Number(__ENV.PER_PIXEL_INTERVAL_MS || 100); // 10 ops/s per user
  const start = Date.now();
  const maxDurationMs = Number(__ENV.SESSION_MS || 50000);

  function loop() {
    const now = Date.now();
    if (now - start > maxDurationMs || isClosed()) {
      return;
    }
    const pixel = pickPixel();
    sendDraw(socket, pixel);
    socket.setTimeout(loop, intervalMs);
  }

  loop();
}

function runBatched(socket, isClosed) {
  const drawIntervalMs = Number(__ENV.BATCH_DRAW_INTERVAL_MS || 100);
  const start = Date.now();
  const maxDurationMs = Number(__ENV.SESSION_MS || 50000);

  let batch = [];

  function addToBatchLoop() {
    const now = Date.now();
    if (now - start > maxDurationMs || isClosed()) {
      return;
    }
    const pixel = pickPixel();
    batch.push({
      x: pixel.x,
      y: pixel.y,
      color: userColor(),
    });
    socket.setTimeout(addToBatchLoop, drawIntervalMs);
  }

  function flushLoop() {
    const now = Date.now();
    if (now - start > maxDurationMs || isClosed()) {
      return;
    }
    if (batch.length > 0) {
      const msg = JSON.stringify({
        type: 'draw_batch',
        pixels: batch,
      });
      socket.send(msg);
      messagesSent.add(batch.length);
      batch = [];
    }
    socket.setTimeout(flushLoop, BATCH_INTERVAL_MS);
  }

  addToBatchLoop();
  flushLoop();
}
