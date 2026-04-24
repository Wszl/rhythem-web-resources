(() => {
  // =========================
  // UI
  // =========================
  const style = document.createElement("style");
  style.textContent =
    ".nes-root{position:fixed;inset:0;background:#000;z-index:9999;display:flex;flex-direction:column;align-items:center;justify-content:center;font-family:monospace;color:#aaa}" +
    ".nes-title{font-size:28px;margin-bottom:10px}" +
    ".nes-layout{display:flex;align-items:center;gap:20px}" +
    ".nes-side{width:120px;font-size:12px;line-height:1.8}" +
    ".nes-left{text-align:right}" +
    ".nes-right{text-align:left}" +
    "canvas{border:2px solid #333;image-rendering:pixelated}";
  document.head.appendChild(style);

  const root = document.createElement("div");
  root.className = "nes-root";

  root.innerHTML = `
    <div class="nes-title">Loading...</div>
    <div class="nes-layout">
      <div class="nes-side nes-left">
        <div>CONTROLS</div>
        <div>W A S D</div>
        <div>↑ ↓ ← →</div>
        <div>SPACE PAUSE</div>
      </div>

      <canvas width="256" height="256"></canvas>

      <div class="nes-side nes-right">
        <div>1/2/3 SPEED</div>
        <div id="spd"></div>
      </div>
    </div>
  `;

  document.body.appendChild(root);

  const canvas = root.querySelector("canvas");
  const ctx = canvas.getContext("2d");
  const spdText = root.querySelector("#spd");

  // =========================
  // Config
  // =========================
  const size = 16;
  const total = size * size;
  const cell = 16;

  let snake, food;
  let paused = false;
  let dead = false;
  let speed = 120;

  let mode = "ai";
  let lastInputTime = 0;
  const INPUT_TIMEOUT = 3000;

  let currentDir = 1;
  let nextDir = 1;

  let last = 0;
  let raf = null;
  let loadingClosed = false;

  // =========================
  // Vue 检测（纯 JS 核心）
  // =========================
  function getAppEl() {
    return document.getElementById("app");
  }

  function isVueRenderedStable() {
    const el = getAppEl();
    if (!el) return false;

    // 必须有内容
    if (el.childNodes.length === 0) return false;

    // Vue 通常会注入一个稳定 DOM 结构
    // 用“稳定性检测”避免误判（关键）
    const now = el.innerHTML;

    if (!el.__lastHTML) {
      el.__lastHTML = now;
      el.__stableCount = 0;
      return false;
    }

    if (el.__lastHTML === now) {
      el.__stableCount++;
    } else {
      el.__stableCount = 0;
      el.__lastHTML = now;
    }

    // 连续稳定 10 帧认为 Vue 已完成渲染
    return el.__stableCount > 10;
  }

  // MutationObserver（增强检测）
  let vueReady = false;

  function startVueObserver(cb) {
    const el = document.body;

    const obs = new MutationObserver(() => {
      if (isVueRenderedStable()) {
        obs.disconnect();
        cb();
      }
    });

    obs.observe(el, {
      childList: true,
      subtree: true,
      attributes: false
    });

    // fallback polling
    const timer = setInterval(() => {
      if (isVueRenderedStable()) {
        clearInterval(timer);
        obs.disconnect();
        cb();
      }
    }, 200);
  }

  function destroyLoading() {
    if (loadingClosed) return;
    loadingClosed = true;

    cancelAnimationFrame(raf);

    root.style.transition = "opacity 0.4s";
    root.style.opacity = "0";

    setTimeout(() => root.remove(), 400);
  }

  // =========================
  // Utils（原逻辑不变）
  // =========================
  function neighbors(i) {
    const res = [];
    const x = i % size;
    const y = Math.floor(i / size);

    if (x > 0) res.push(i - 1);
    if (x < size - 1) res.push(i + 1);
    if (y > 0) res.push(i - size);
    if (y < size - 1) res.push(i + size);

    return res;
  }

  function isWall(a, b) {
    if (b < 0 || b >= total) return true;

    const ax = a % size, ay = Math.floor(a / size);
    const bx = b % size, by = Math.floor(b / size);

    return Math.abs(ax - bx) + Math.abs(ay - by) !== 1;
  }

  function bfs(start, target, blocked) {
    const q = [[start]];
    const vis = new Set([start]);

    while (q.length) {
      const path = q.shift();
      const cur = path[path.length - 1];

      if (cur === target) return path;

      for (const n of neighbors(cur)) {
        if (vis.has(n) || blocked.has(n)) continue;
        vis.add(n);
        q.push([...path, n]);
      }
    }
    return null;
  }

  function flood(start, blocked) {
    const stack = [start];
    const vis = new Set([start]);
    let count = 0;

    while (stack.length) {
      const cur = stack.pop();
      count++;

      for (const n of neighbors(cur)) {
        if (vis.has(n) || blocked.has(n)) continue;
        vis.add(n);
        stack.push(n);
      }
    }

    return count;
  }

  function simulate(snake, next) {
    const s = [next, ...snake];
    s.pop();
    return s;
  }

  function canReachTailAfterMove(snake, next) {
    const sim = simulate(snake, next);
    const blocked = new Set(sim.slice(0, -1));
    return bfs(sim[0], sim[sim.length - 1], blocked) !== null;
  }

  // =========================
  // AI
  // =========================
  function aiNext() {
    const head = snake[0];
    const neck = snake[1];

    const candidates = neighbors(head)
      .filter(n => !snake.includes(n))
      .filter(n => n !== neck);

    let best = null;
    let bestScore = -Infinity;

    for (const n of candidates) {
      const sim = simulate(snake, n);
      const blocked = new Set(sim.slice(0, -1));

      const space = flood(n, blocked);
      const foodPath = bfs(n, food, blocked);
      const foodScore = foodPath ? (1000 - foodPath.length) : 0;

      if (!canReachTailAfterMove(snake, n)) continue;

      const score = space + foodScore;

      if (score > bestScore) {
        bestScore = score;
        best = n;
      }
    }

    if (best !== null) return best - head;

    const tail = snake[snake.length - 1];
    const blocked = new Set(snake.slice(0, -1));
    const path = bfs(head, tail, blocked);

    if (path && path.length > 1) return path[1] - head;

    return 1;
  }

  // =========================
  // Game
  // =========================
  const totalCells = size * size;

  function rand() {
    const used = new Set(snake);
    const free = [];
    for (let i = 0; i < totalCells; i++) {
      if (!used.has(i)) free.push(i);
    }
    return free[Math.floor(Math.random() * free.length)];
  }

  function reset() {
    snake = [Math.floor(totalCells / 2)];
    food = rand();
    paused = false;
    dead = false;
    mode = "ai";
    lastInputTime = 0;
  }

  reset();

  // =========================
  // Input
  // =========================
  document.addEventListener("keydown", (e) => {
    const map = {
      KeyW: -size,
      KeyS: size,
      KeyA: -1,
      KeyD: 1,
      ArrowUp: -size,
      ArrowDown: size,
      ArrowLeft: -1,
      ArrowRight: 1
    };

    if (e.code === "Space") {
      e.preventDefault();
      if (dead) {
        reset();
        last = performance.now();
        return;
      }
      paused = !paused;
      return;
    }

    if (e.key === "1") speed = 200;
    if (e.key === "2") speed = 120;
    if (e.key === "3") speed = 70;

    const nd = map[e.code];
    if (nd !== undefined) {
      if (nd === -currentDir) return;
      nextDir = nd;
      mode = "player";
      lastInputTime = performance.now();
    }
  });

  // =========================
  // Step / Render
  // =========================
  function step() {
    if (paused || dead) return;

    if (mode === "player" && performance.now() - lastInputTime > INPUT_TIMEOUT) {
      mode = "ai";
    }

    const head = snake[0];
    const dir = mode === "ai" ? aiNext() : nextDir;
    const next = head + dir;

    if (isWall(head, next) || snake.includes(next)) {
      dead = true;
      return;
    }

    snake.unshift(next);

    if (next === food) food = rand();
    else snake.pop();

    currentDir = dir;
  }

  function draw(i, c) {
    ctx.fillStyle = c;
    ctx.fillRect((i % size) * cell, Math.floor(i / size) * cell, cell, cell);
  }

  function render() {
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, 256, 256);

    draw(food, "#fff");
    snake.forEach((s, i) => draw(s, i === 0 ? "#ccc" : "#666"));

    spdText.textContent = speed + "ms";

    if (dead) {
      ctx.fillStyle = "#fff";
      ctx.fillText("PRESS SPACE", 80, 128);
    }
  }

  // =========================
  // Loop
  // =========================
  function loop(t) {
    if (loadingClosed) return;

    if (!last) last = t;

    if (t - last > speed) {
      step();
      last = t;
    }

    render();

    if (isVueRenderedStable()) {
      vueReady = true;
      destroyLoading();
      return;
    }

    raf = requestAnimationFrame(loop);
  }

  // =========================
  // Start
  // =========================
  startVueObserver(() => {
    destroyLoading();
  });

  requestAnimationFrame(loop);
})();