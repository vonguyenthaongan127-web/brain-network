// ── Brain Network — Force-directed Layout Worker ───────────────────────────
// Runs entirely off the main thread so the UI never freezes.
//
// Receives (postMessage):
//   { nodes, edges, centerX, centerY, worldW, worldH, iterations }
//   nodes      – array of { id, topicId, x?, y? }   (expanded nodes only)
//   edges      – array of { from, to }
//   centerX/Y  – viewport center in world coordinates (seed origin)
//   worldW/H   – visible world dimensions (controls cluster spread)
//   iterations – number of force iterations (default 200)
//
// Posts back:
//   { positions: [{ id, x, y }, …] }   on success
//   { error: string }                   on failure

// ── Simulation constants ──────────────────────────────────────────────────────
const K_REPEL   = 18000; // repulsion strength (higher = more spread)
const K_SPRING  = 0.008; // edge spring stiffness
const REST_LEN  = 160;   // spring natural length (px)
const K_CENTER  = 0.004; // centering gravity (prevents drift)
const REPEL_CUT = 600;   // skip repulsion beyond this distance → effectively O(n·k)
const START_TEMP = 80;   // max displacement (px) at iteration 0; cools to 0

// ── Seed positions: deterministic topic-cluster layout ────────────────────────
// Mirrors the main-thread deterministic algorithm so force simulation starts
// from a reasonable arrangement rather than a random blob.
function seedPositions(nodes, centerX, centerY, worldW, worldH) {
  const outerR  = Math.min(worldW, worldH) * 0.36;
  const RING_CAP = [1,  6,  12,  18,  24,  30];
  const RING_RAD = [0, 80, 155, 230, 305, 380];

  // Group by topicId (sorted for determinism)
  const groups = {};
  nodes.forEach(n => {
    const tid = n.topicId || "other";
    if (!groups[tid]) groups[tid] = [];
    groups[tid].push(n);
  });
  const topicIds  = Object.keys(groups).sort();
  const numTopics = topicIds.length;

  // Cluster centers evenly around a circle
  const centers = {};
  topicIds.forEach((tid, i) => {
    if (numTopics === 1) {
      centers[tid] = { x: centerX, y: centerY };
    } else {
      const angle = (i / numTopics) * 2 * Math.PI - Math.PI / 2;
      centers[tid] = {
        x: centerX + outerR * Math.cos(angle),
        y: centerY + outerR * Math.sin(angle),
      };
    }
  });

  // Distribute nodes in concentric rings within each cluster
  const pos = {};
  topicIds.forEach(tid => {
    const grp    = groups[tid];
    const center = centers[tid];
    let idx = 0;
    for (let ring = 0; ring < RING_CAP.length && idx < grp.length; ring++) {
      const slots  = Math.min(RING_CAP[ring], grp.length - idx);
      const radius = RING_RAD[ring];
      for (let i = 0; i < slots; i++) {
        const n = grp[idx++];
        if (radius === 0) {
          pos[n.id] = { x: center.x, y: center.y };
        } else {
          const angle = (i / slots) * 2 * Math.PI - Math.PI / 2;
          pos[n.id] = {
            x: center.x + radius * Math.cos(angle),
            y: center.y + radius * Math.sin(angle),
          };
        }
      }
    }
  });
  return pos;
}

// ── Force-directed simulation ─────────────────────────────────────────────────
// O(n²) repulsion with distance cutoff ≈ O(n·k) in practice.
// Spring forces along edges + centering gravity + simulated annealing.
function runForces(nodes, edges, pos, iterations, centerX, centerY) {
  const ids = nodes.map(n => n.id);
  const n   = ids.length;

  for (let iter = 0; iter < iterations; iter++) {
    // Cooling: temperature falls linearly from START_TEMP → 0
    const temp = START_TEMP * (1 - iter / iterations);
    const disp = {};
    ids.forEach(id => { disp[id] = { x: 0, y: 0 }; });

    // ── Pairwise repulsion (with cutoff) ──────────────────────────────────
    for (let i = 0; i < n; i++) {
      const a  = ids[i];
      const pa = pos[a];
      for (let j = i + 1; j < n; j++) {
        const b  = ids[j];
        const pb = pos[b];
        const dx = pa.x - pb.x;
        const dy = pa.y - pb.y;
        const d2 = dx * dx + dy * dy;
        if (d2 > REPEL_CUT * REPEL_CUT) continue; // skip distant pairs
        const d  = Math.sqrt(d2) || 0.1;
        const f  = K_REPEL / d2;
        const fx = (dx / d) * f;
        const fy = (dy / d) * f;
        disp[a].x += fx;  disp[a].y += fy;
        disp[b].x -= fx;  disp[b].y -= fy;
      }
    }

    // ── Spring attraction along edges ─────────────────────────────────────
    for (let e = 0; e < edges.length; e++) {
      const edge = edges[e];
      const pa   = pos[edge.from];
      const pb   = pos[edge.to];
      if (!pa || !pb) continue;
      const dx     = pb.x - pa.x;
      const dy     = pb.y - pa.y;
      const d      = Math.sqrt(dx * dx + dy * dy) || 0.1;
      const stretch = d - REST_LEN;
      const f      = K_SPRING * stretch;
      const fx     = (dx / d) * f;
      const fy     = (dy / d) * f;
      if (disp[edge.from]) { disp[edge.from].x += fx; disp[edge.from].y += fy; }
      if (disp[edge.to])   { disp[edge.to].x   -= fx; disp[edge.to].y   -= fy; }
    }

    // ── Centering gravity ────────────────────────────────────────────────
    for (let i = 0; i < n; i++) {
      const id = ids[i];
      const p  = pos[id];
      disp[id].x -= K_CENTER * (p.x - centerX);
      disp[id].y -= K_CENTER * (p.y - centerY);
    }

    // ── Apply displacements clamped to current temperature ────────────────
    for (let i = 0; i < n; i++) {
      const id = ids[i];
      const dx = disp[id].x;
      const dy = disp[id].y;
      const d  = Math.sqrt(dx * dx + dy * dy) || 1;
      const clamp = Math.min(d, temp) / d;
      pos[id] = {
        x: pos[id].x + dx * clamp,
        y: pos[id].y + dy * clamp,
      };
    }
  }
}

// ── Message handler ───────────────────────────────────────────────────────────
self.onmessage = (e) => {
  const {
    nodes,
    edges,
    centerX    = 0,
    centerY    = 0,
    worldW     = 1400,
    worldH     = 1000,
    iterations = 200,
  } = e.data;

  try {
    // Seed → simulate → validate → return
    const pos = seedPositions(nodes, centerX, centerY, worldW, worldH);
    runForces(nodes, edges, pos, iterations, centerX, centerY);

    // NaN guard — abort if simulation produced bad values
    for (const [id, p] of Object.entries(pos)) {
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) {
        self.postMessage({ error: `NaN position for node ${id}` });
        return;
      }
    }

    const positions = Object.entries(pos).map(([id, { x, y }]) => ({ id, x, y }));
    self.postMessage({ positions });
  } catch (err) {
    self.postMessage({ error: err.message || "Unknown worker error" });
  }
};
