import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import {
  collection, doc,
  onSnapshot, setDoc, updateDoc, deleteDoc, writeBatch, getDocs,
} from "firebase/firestore";
import { ref as stRef, uploadBytes, getDownloadURL, deleteObject } from "firebase/storage";
import { TRANSLATIONS } from "./src/i18n.js";

// ── Strip id before writing to Firestore ───────────────────────────────────
const toFS = ({ id, ...rest }) => rest;

// ── Bloom base (colors + icons, language-independent) ─────────────────────
const BLOOM_BASE = [
  { level: 1, color: "#94a3b8", icon: "🌱" },
  { level: 2, color: "#eab308", icon: "💡" },
  { level: 3, color: "#3b82f6", icon: "🔧" },
  { level: 4, color: "#a855f7", icon: "🔍" },
  { level: 5, color: "#f97316", icon: "⚡" },
  { level: 6, color: "#ef4444", icon: "🚀" },
];

const REL_LABELS = ["same pattern","causes","opposite of","helps explain","relates to","triggers","based on"];

const INIT_NODES = [
  { id:"n1", label:"Association",       category:"Teaching Method",  bloomLevel:5, topicId:"teach", description:"Link new info to existing memories & emotions — my core teaching technique", emotion:"✨ Excitement khi student nói 'I GET IT!'", x:420, y:220 },
  { id:"n2", label:"Relative Clauses",  category:"IELTS Grammar",   bloomLevel:3, topicId:"lang",  description:"who / which / that — gộp 2 câu ngắn thành 1 câu phức. Band 5→6 essential.", emotion:"😮 Cảm giác 'aha' lần đầu mình hiểu cái này", x:200, y:150 },
  { id:"n3", label:"Eliciting",         category:"Teaching Method",  bloomLevel:4, topicId:"teach", description:"Hỏi TRƯỚC khi nói. Buộc học sinh phải tự suy nghĩ trước.", emotion:"💬 Johnson hay hỏi mình về ngày hôm nay thay vì nói luôn", x:630, y:160 },
  { id:"n4", label:"Collocations",      category:"IELTS Vocabulary", bloomLevel:2, topicId:"lang",  description:"Fixed word partnerships. heavy rain NOT strong rain.", emotion:"😅 Ngại khi mình từng nói 'do a mistake' trước mặt sếp", x:170, y:370 },
  { id:"n5", label:"STM → LTM",         category:"Psychology",       bloomLevel:3, topicId:"psych", description:"Cảm xúc + Lặp lại = Ghi nhớ dài hạn (Long-term memory)", emotion:"❤️ Mọi kỷ niệm với Johnson đều ở trong long-term memory", x:530, y:400 },
  { id:"n6", label:"Bloom's Taxonomy",  category:"Psychology",       bloomLevel:2, topicId:"psych", description:"Nhớ→Hiểu→Vận dụng→Phân tích→Đánh giá→Sáng tạo", emotion:"🌱 Giống trồng cây — mỗi giai đoạn cần thời gian riêng", x:340, y:420 },
];

const INIT_EDGES = [
  { id:"e1", from:"n1", to:"n2", label:"makes memorable" },
  { id:"e2", from:"n1", to:"n3", label:"uses" },
  { id:"e3", from:"n3", to:"n5", label:"triggers encoding" },
  { id:"e4", from:"n1", to:"n5", label:"drives" },
  { id:"e5", from:"n2", to:"n4", label:"grammar ↔ vocab" },
  { id:"e6", from:"n5", to:"n6", label:"theoretical basis" },
];

const STOP_WORDS = new Set([
  'the','a','an','and','or','is','are','was','were','to','of','in','for','on','with',
  'at','by','from','this','that','it','be','as','we','do','not','can','but','if','my',
  'its','our','have','has','had','will','would','could','should',
  'tôi','mình','bạn','khi','một','trong','được','của','là','và','có','không',
  'cho','với','này','đó','các','những','hay','cái','nó'
]);

const TOPIC_EMOJIS = ["📌","📚","🎓","🧬","🔬","🎨","🏆","🌍","🎯","💼","🔧","🌱","⚡","💡","🎵","🌟"];
const TOPIC_COLORS = ["#a855f7","#3b82f6","#22c55e","#f97316","#eab308","#ef4444","#06b6d4","#ec4899","#84cc16","#f43f5e"];

const MIN_SCALE  = 0.06;
const MAX_SCALE  = 8;
const CULL_MARGIN = 80;
const OVERLAP_DIST = 92;

// (getB is defined inside component using translated BLOOM)

function resolveOverlap(pos, existing) {
  let { x, y } = pos;
  for (let iter = 0; iter < 40; iter++) {
    let moved = false;
    for (const n of existing) {
      const dx = x - n.x, dy = y - n.y;
      const d  = Math.sqrt(dx*dx + dy*dy) || 1;
      if (d < OVERLAP_DIST) {
        const push = (OVERLAP_DIST - d) / d * 0.55;
        x += dx * push; y += dy * push;
        moved = true;
      }
    }
    if (!moved) break;
  }
  return { x, y };
}

function getKeywords(node) {
  const text = `${node.label} ${node.description || ''}`.toLowerCase();
  return text.split(/\W+/).filter(w => w.length >= 3 && !STOP_WORDS.has(w));
}

function inferRelLabel(n1, n2) {
  const t = `${n1.label} ${n1.description||''} ${n2.label} ${n2.description||''}`.toLowerCase();
  if (/caus|trigger|lead|kích|dẫn/.test(t)) return 'causes';
  if (/oppos|ngược|contrari|versus/.test(t)) return 'opposite of';
  if (/explain|giải thích|hỗ trợ|basis|based/.test(t)) return 'helps explain';
  return 'relates to';
}

function btnStyle(active, color) {
  return {
    padding:"8px 16px", borderRadius:8, cursor:"pointer",
    border:`1px solid ${active ? color : "rgba(255,255,255,0.12)"}`,
    background: active ? `${color}28` : "rgba(255,255,255,0.04)",
    color: active ? color : "rgba(232,220,255,0.6)",
    fontSize:13, fontWeight:600, whiteSpace:"nowrap",
    fontFamily:"inherit", transition:"all 0.15s"
  };
}

const fmtTime = (s) => `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`;

// ── Main component ─────────────────────────────────────────────────────────
export default function BrainNetwork({ db, storage, userId, user, lang, setLang, onBack }) {
  // ── Translations ─────────────────────────────────────────────────────────
  const t = TRANSLATIONS[lang] || TRANSLATIONS.en;
  const BLOOM = BLOOM_BASE.map((b, i) => ({ ...b, name: t.bloom[i].name, desc: t.bloom[i].desc }));
  const getB = (lvl) => BLOOM[Math.min(Math.max((lvl||1)-1,0),5)];

  // ── Data state ─────────────────────────────────────────────────────────
  const [nodes, setNodes]             = useState([]);
  const [edges, setEdges]             = useState([]);
  const [topics, setTopics]           = useState(t.defaultTopics);
  const [activeTopic, setActiveTopic] = useState("all");
  const [mode, setMode]               = useState("view");
  const [selected, setSelected]       = useState(null);
  const [connecting, setConnecting]   = useState(null);
  const [drag, setDrag]               = useState(null);
  const [showAdd, setShowAdd]         = useState(false);
  const [hoverEdge, setHoverEdge]     = useState(null);
  const [loaded, setLoaded]           = useState(false);
  const [connLabel, setConnLabel]     = useState("relates to");
  const [form, setForm]               = useState({ label:"", bloomLevel:1, description:"", emotion:"", topicId:"other" });
  const [suggestions, setSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [mediaForm, setMediaForm]     = useState(null);
  const [migrationChecked, setMigrationChecked] = useState(false);

  // ── Feature A: Focus Mode ───────────────────────────────────────────────
  const [focusNodeId, setFocusNodeId] = useState(null);

  // ── Feature B: Topic Cluster Bubbles ────────────────────────────────────
  const [collapsedTopics, setCollapsedTopics] = useState(new Set());

  // ── Feature C: Auto-layout ──────────────────────────────────────────────
  const [layoutAnimating, setLayoutAnimating] = useState(false);
  const [layoutSnapshot,  setLayoutSnapshot]  = useState(null); // {[id]:{x,y}} for undo
  const [animPos,         setAnimPos]         = useState(null); // {[id]:{x,y}} display override
  const animDelaysRef = useRef({});  // {[id]: ms delay}

  // ── Topic add state ─────────────────────────────────────────────────────
  const [showAddTopic, setShowAddTopic]   = useState(false);
  const [newTopicName, setNewTopicName]   = useState("");
  const [newTopicEmoji, setNewTopicEmoji] = useState("📌");
  const [newTopicColor, setNewTopicColor] = useState("#94a3b8");

  // ── Audio state ─────────────────────────────────────────────────────────
  const [recording, setRecording]         = useState(false);
  const [audioSec, setAudioSec]           = useState(0);
  const [audioWarning, setAudioWarning]   = useState(false);
  const [audioUploading, setAudioUploading] = useState(false);
  const [audioUploadStatus, setAudioUploadStatus] = useState(""); // "", "uploading", "success", or error text
  const [audioPlaying, setAudioPlaying]   = useState(false);
  const [audioCurrent, setAudioCurrent]   = useState(0);
  const [audioDuration, setAudioDuration] = useState(0);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef   = useRef([]);
  const audioTimerRef    = useRef(null);
  const audioElemRef     = useRef(null);

  // ── Camera ─────────────────────────────────────────────────────────────
  const cameraRef = useRef({ x: 0, y: 0, scale: 1 });
  const [camera, _setCamera] = useState({ x: 0, y: 0, scale: 1 });
  const setCam = useCallback((updater) => {
    _setCamera(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      cameraRef.current = next;
      return next;
    });
  }, []);

  // ── Refs ────────────────────────────────────────────────────────────────
  const svgRef            = useRef(null);
  const panRef            = useRef(null);
  const touchRef          = useRef(null);
  const cameraInitialized = useRef(false);
  const dragPosRef        = useRef(null);
  const nodeDragTouchRef  = useRef(null);
  const [isPanning, setIsPanning]   = useState(false);
  const [svgSize, setSvgSize]       = useState({ w: 900, h: 600 });
  const mediaInputRef = useRef(null);
  const nodeMediaRef  = useRef(null);

  // ── Derived collections (per-user) ──────────────────────────────────────
  const nodesCol    = useMemo(() => collection(db, "users", userId, "nodes"), [db, userId]);
  const edgesCol    = useMemo(() => collection(db, "users", userId, "edges"), [db, userId]);
  const topicsDocRef = useMemo(() => doc(db, "users", userId, "topics", "list"), [db, userId]);

  // ── Reset state when userId changes ────────────────────────────────────
  useEffect(() => {
    setNodes([]); setEdges([]); setTopics(t.defaultTopics);
    setActiveTopic("all"); setSelected(null); setLoaded(false);
    setMigrationChecked(false); cameraInitialized.current = false;
    setRecording(false); setAudioSec(0); setAudioWarning(false);
    setAudioUploading(false); setAudioUploadStatus(""); setAudioPlaying(false); setAudioCurrent(0); setAudioDuration(0);
    clearInterval(audioTimerRef.current);
    setFocusNodeId(null); setCollapsedTopics(new Set());
    setLayoutAnimating(false); setLayoutSnapshot(null); setAnimPos(null);
  }, [userId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Migration check (user1 only) ────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      if (userId === "user1") {
        try {
          const userNodesSnap = await getDocs(nodesCol);
          if (userNodesSnap.empty) {
            const rootSnap = await getDocs(collection(db, "nodes"));
            if (!rootSnap.empty && !cancelled) {
              const rootEdgesSnap = await getDocs(collection(db, "edges"));
              const batch = writeBatch(db);
              rootSnap.docs.forEach(d => {
                const nd = d.data();
                batch.set(doc(nodesCol, d.id), { ...nd, topicId: nd.topicId || "other" });
              });
              rootEdgesSnap.docs.forEach(d => {
                batch.set(doc(edgesCol, d.id), d.data());
              });
              await batch.commit();
            }
          }
        } catch (err) { /* proceed without migration */ }
      }
      if (!cancelled) setMigrationChecked(true);
    };
    check();
    return () => { cancelled = true; };
  }, [userId, db, nodesCol, edgesCol]);

  // ── Firestore realtime sync (starts after migration check) ──────────────
  useEffect(() => {
    if (!migrationChecked) return;
    let nodesReady = false, edgesReady = false;
    const checkLoaded = () => { if (nodesReady && edgesReady) setLoaded(true); };

    const unsubNodes = onSnapshot(nodesCol, (snap) => {
      if (!nodesReady) {
        nodesReady = true;
        const fromFS = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        if (fromFS.length > 0) {
          // BUG 2 fix: merge instead of replace.
          // The user may have called addNode() while this initial snapshot was
          // in-flight (cache hit before the write committed).  A direct setNodes(fromFS)
          // would wipe those locally-pending nodes.  Keep any node that is already in
          // React state but absent from this snapshot — it is a pending local write.
          setNodes(prev => {
            const fsIds = new Set(fromFS.map(n => n.id));
            const localOnly = prev.filter(n => !fsIds.has(n.id));
            return [...fromFS, ...localOnly];
          });
        } else {
          const batch = writeBatch(db);
          INIT_NODES.forEach(n => batch.set(doc(nodesCol, n.id), toFS(n)));
          batch.commit().catch(() => {});
          // Same merge logic for the seed case
          setNodes(prev => {
            const seedIds = new Set(INIT_NODES.map(n => n.id));
            const localOnly = prev.filter(n => !seedIds.has(n.id));
            return [...INIT_NODES, ...localOnly];
          });
        }
        checkLoaded(); return;
      }
      snap.docChanges().forEach(change => {
        const data = { id: change.doc.id, ...change.doc.data() };
        if (change.type === "added")    setNodes(prev => prev.some(n => n.id === data.id) ? prev : [...prev, data]);
        else if (change.type === "modified") setNodes(prev => prev.map(n => n.id === data.id ? data : n));
        else if (change.type === "removed")  setNodes(prev => prev.filter(n => n.id !== data.id));
      });
    });

    const unsubEdges = onSnapshot(edgesCol, (snap) => {
      if (!edgesReady) {
        edgesReady = true;
        const fromFS = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        if (fromFS.length > 0) {
          setEdges(prev => {
            const fsIds = new Set(fromFS.map(e => e.id));
            const localOnly = prev.filter(e => !fsIds.has(e.id));
            return [...fromFS, ...localOnly];
          });
        } else {
          const batch = writeBatch(db);
          INIT_EDGES.forEach(e => batch.set(doc(edgesCol, e.id), toFS(e)));
          batch.commit().catch(() => {});
          setEdges(INIT_EDGES);
        }
        checkLoaded(); return;
      }
      snap.docChanges().forEach(change => {
        const data = { id: change.doc.id, ...change.doc.data() };
        if (change.type === "added")    setEdges(prev => prev.some(e => e.id === data.id) ? prev : [...prev, data]);
        else if (change.type === "modified") setEdges(prev => prev.map(e => e.id === data.id ? data : e));
        else if (change.type === "removed")  setEdges(prev => prev.filter(e => e.id !== data.id));
      });
    });

    return () => { unsubNodes(); unsubEdges(); };
  }, [migrationChecked, nodesCol, edgesCol, db]);

  // ── Topics realtime sync ────────────────────────────────────────────────
  useEffect(() => {
    if (!migrationChecked) return;
    const unsub = onSnapshot(topicsDocRef, (snap) => {
      if (snap.exists() && snap.data().topicList?.length) {
        setTopics(snap.data().topicList);
      } else {
        const defaults = t.defaultTopics;
        setTopics(defaults);
        setDoc(topicsDocRef, { topicList: defaults }).catch(() => {});
      }
    });
    return () => unsub();
  }, [migrationChecked, topicsDocRef]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Audio: watch audioSec for auto-stop ────────────────────────────────
  useEffect(() => {
    if (!recording) return;
    if (audioSec >= 170) setAudioWarning(true);
    if (audioSec >= 180) {
      clearInterval(audioTimerRef.current);
      if (mediaRecorderRef.current?.state === "recording") {
        mediaRecorderRef.current.stop();
      }
    }
  }, [audioSec, recording]);

  // ── Audio: stop recording + reset player when selection changes ─────────
  useEffect(() => {
    // Stop any in-progress recording
    if (recording) {
      clearInterval(audioTimerRef.current);
      if (mediaRecorderRef.current?.state === "recording") {
        mediaRecorderRef.current.stop();
      }
    }
    // Reset the audio player for the newly-selected node
    if (audioElemRef.current) audioElemRef.current.pause();
    setAudioPlaying(false);
    setAudioCurrent(0);
    setAudioDuration(0);
    setAudioUploadStatus("");
  }, [selected]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── SVG resize + initial camera ─────────────────────────────────────────
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const obs = new ResizeObserver(([entry]) => {
      const { width: w, height: h } = entry.contentRect;
      setSvgSize({ w, h });
      if (!cameraInitialized.current && w > 0 && h > 0 && loaded) {
        setCam({ x: w / 2 - 390, y: h / 2 - 285, scale: 1 });
        cameraInitialized.current = true;
      }
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, [loaded, setCam]);

  useEffect(() => {
    if (!loaded || cameraInitialized.current) return;
    const { w, h } = svgSize;
    if (w <= 0 || h <= 0) return;
    setCam({ x: w / 2 - 390, y: h / 2 - 285, scale: 1 });
    cameraInitialized.current = true;
  }, [loaded, svgSize, setCam]);

  // ── Wheel zoom ──────────────────────────────────────────────────────────
  const onWheel = useCallback((e) => {
    e.preventDefault();
    const rect = svgRef.current.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const delta = e.deltaMode === 1 ? e.deltaY * 30 : e.deltaY;
    const factor = delta < 0 ? 1.10 : 1 / 1.10;
    setCam(c => {
      const s = Math.max(MIN_SCALE, Math.min(MAX_SCALE, c.scale * factor));
      const wx = (mx - c.x) / c.scale, wy = (my - c.y) / c.scale;
      return { x: mx - wx * s, y: my - wy * s, scale: s };
    });
  }, [setCam]);

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [onWheel]);

  // ── Touch (non-passive touchmove) ───────────────────────────────────────
  const onTouchMove = useCallback((e) => {
    e.preventDefault();
    if (e.touches.length === 1 && nodeDragTouchRef.current) {
      const touch = e.touches[0];
      const rect = svgRef.current.getBoundingClientRect();
      const c    = cameraRef.current;
      const nx   = (touch.clientX - rect.left - c.x) / c.scale - nodeDragTouchRef.current.ox;
      const ny   = (touch.clientY - rect.top  - c.y) / c.scale - nodeDragTouchRef.current.oy;
      const id   = nodeDragTouchRef.current.id;
      dragPosRef.current = { id, x: nx, y: ny };
      setNodes(prev => prev.map(n => n.id === id ? { ...n, x: nx, y: ny } : n));
      setDrag(d => d ? { ...d, moved: true } : d);
    } else if (e.touches.length === 1 && panRef.current) {
      const touch = e.touches[0];
      const dx = touch.clientX - panRef.current.startX;
      const dy = touch.clientY - panRef.current.startY;
      setCam({ x: panRef.current.cx + dx, y: panRef.current.cy + dy, scale: cameraRef.current.scale });
    } else if (e.touches.length === 2 && touchRef.current) {
      const [t1, t2] = e.touches;
      const dx = t2.clientX - t1.clientX, dy = t2.clientY - t1.clientY;
      const newDist = Math.sqrt(dx*dx + dy*dy);
      const factor  = newDist / touchRef.current.dist;
      const rect    = svgRef.current.getBoundingClientRect();
      const mx      = touchRef.current.mx - rect.left;
      const my      = touchRef.current.my - rect.top;
      const s       = Math.max(MIN_SCALE, Math.min(MAX_SCALE, touchRef.current.scale * factor));
      const wx      = (mx - touchRef.current.camX) / touchRef.current.scale;
      const wy      = (my - touchRef.current.camY) / touchRef.current.scale;
      setCam({ x: mx - wx * s, y: my - wy * s, scale: s });
    }
  }, [setCam]);

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    return () => el.removeEventListener('touchmove', onTouchMove);
  }, [onTouchMove]);

  // ── Coordinate helpers ──────────────────────────────────────────────────
  const getWorldPt = (e) => {
    const rect = svgRef.current.getBoundingClientRect();
    const c    = cameraRef.current;
    return { x: (e.clientX - rect.left - c.x) / c.scale, y: (e.clientY - rect.top - c.y) / c.scale };
  };

  // ── Viewport culling ────────────────────────────────────────────────────
  const visibleNodes = useMemo(() => {
    const { w, h } = svgSize;
    const { x: cx, y: cy, scale: cs } = camera;
    return nodes.filter(n => {
      const sx = n.x * cs + cx, sy = n.y * cs + cy;
      const r  = 56 * cs + CULL_MARGIN;
      return sx + r >= 0 && sx - r <= w && sy + r >= 0 && sy - r <= h;
    });
  }, [nodes, camera, svgSize]);

  const visibleNodeIds = useMemo(() => new Set(visibleNodes.map(n => n.id)), [visibleNodes]);
  const visibleEdges   = useMemo(() => edges.filter(e => visibleNodeIds.has(e.from) || visibleNodeIds.has(e.to)), [edges, visibleNodeIds]);

  // ── Fit view ────────────────────────────────────────────────────────────
  const fitView = useCallback(() => {
    if (!nodes.length || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const xs   = nodes.map(n => n.x), ys = nodes.map(n => n.y);
    const pad  = 100;
    const minX = Math.min(...xs) - pad, maxX = Math.max(...xs) + pad;
    const minY = Math.min(...ys) - pad, maxY = Math.max(...ys) + pad;
    const s    = Math.min(rect.width / (maxX - minX), rect.height / (maxY - minY), 2);
    setCam({ x: (rect.width - (minX + maxX) * s) / 2, y: (rect.height - (minY + maxY) * s) / 2, scale: s });
  }, [nodes, setCam]);

  // ── Mouse events ─────────────────────────────────────────────────────────
  const onNodePD = (e, id) => {
    e.stopPropagation();
    if (mode === "connect") return;
    const node = nodes.find(n => n.id === id);
    const pt   = getWorldPt(e);
    setDrag({ id, ox: pt.x - node.x, oy: pt.y - node.y, moved: false });
  };

  const onNodeTouchStart = (e, id) => {
    if (mode === "connect" || e.touches.length !== 1) return;
    e.stopPropagation();
    const touch = e.touches[0];
    const rect  = svgRef.current.getBoundingClientRect();
    const c     = cameraRef.current;
    const worldX = (touch.clientX - rect.left - c.x) / c.scale;
    const worldY = (touch.clientY - rect.top  - c.y) / c.scale;
    const node   = nodes.find(n => n.id === id);
    if (!node) return;
    nodeDragTouchRef.current = { id, ox: worldX - node.x, oy: worldY - node.y };
    panRef.current = null;
    setDrag({ id, ox: worldX - node.x, oy: worldY - node.y, moved: false });
  };

  const onSVGMouseDown = (e) => {
    if (drag || mode === "connect" || e.button !== 0) return;
    setIsPanning(true);
    const c = cameraRef.current;
    panRef.current = { startX: e.clientX, startY: e.clientY, cx: c.x, cy: c.y };
  };

  const onSVGMM = (e) => {
    if (drag) {
      const pt = getWorldPt(e);
      const nx = pt.x - drag.ox, ny = pt.y - drag.oy;
      dragPosRef.current = { id: drag.id, x: nx, y: ny };
      setNodes(prev => prev.map(n => n.id === drag.id ? { ...n, x: nx, y: ny } : n));
      setDrag(d => ({ ...d, moved: true }));
      return;
    }
    if (panRef.current) {
      const dx = e.clientX - panRef.current.startX;
      const dy = e.clientY - panRef.current.startY;
      setCam(c => ({ ...c, x: panRef.current.cx + dx, y: panRef.current.cy + dy }));
    }
  };

  const onSVGMU = () => {
    if (drag?.moved && dragPosRef.current) {
      const { id, x, y } = dragPosRef.current;
      updateDoc(doc(nodesCol, id), { x, y }).catch(() => {});
      dragPosRef.current = null;
    }
    panRef.current = null; setIsPanning(false); setDrag(null);
  };

  const onTouchStart = (e) => {
    if (e.touches.length === 1) {
      const touch = e.touches[0], c = cameraRef.current;
      panRef.current = { startX: touch.clientX, startY: touch.clientY, cx: c.x, cy: c.y };
    } else if (e.touches.length === 2) {
      const [t1, t2] = e.touches;
      const dx = t2.clientX - t1.clientX, dy = t2.clientY - t1.clientY;
      const c  = cameraRef.current;
      touchRef.current = {
        dist: Math.sqrt(dx*dx + dy*dy),
        mx: (t1.clientX + t2.clientX) / 2, my: (t1.clientY + t2.clientY) / 2,
        scale: c.scale, camX: c.x, camY: c.y,
      };
      panRef.current = null;
    }
  };

  const onNodeClick = (e, id) => {
    e.stopPropagation();
    if (drag?.moved) return;
    if (mode === "connect") {
      if (!connecting) { setConnecting(id); return; }
      if (connecting === id) { setConnecting(null); return; }
      const exists = edges.find(ed => (ed.from===connecting&&ed.to===id)||(ed.from===id&&ed.to===connecting));
      if (!exists) {
        const newEdge = { id:`e${Date.now()}`, from:connecting, to:id, label:connLabel||"relates to" };
        setEdges(prev => [...prev, newEdge]);
        setDoc(doc(edgesCol, newEdge.id), toFS(newEdge)).catch(() => {});
      }
      setConnecting(null); setConnLabel("relates to"); setMode("view");
    } else {
      const newSel = id === selected ? null : id;
      setSelected(newSel);
      setFocusNodeId(newSel); // Feature A: enter/exit focus mode on click
    }
  };

  const onSVGClick = () => {
    if (mode==="connect") { setConnecting(null); return; }
    setSelected(null);
    setFocusNodeId(null); // Feature A: exit focus mode on background click
  };

  // ── Auto Synapses ───────────────────────────────────────────────────────
  const findAutoSynapses = () => {
    const newSugs = [];
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const n1 = nodes[i], n2 = nodes[j];
        if (edges.find(e => (e.from===n1.id&&e.to===n2.id)||(e.from===n2.id&&e.to===n1.id))) continue;
        const kw1 = new Set(getKeywords(n1)), kw2 = new Set(getKeywords(n2));
        const sharedKw = [...kw1].filter(k => kw2.has(k));
        const a1 = (n1.emotion||'').toLowerCase().split(/\W+/).filter(w => w.length >= 4 && !STOP_WORDS.has(w));
        const a2 = new Set((n2.emotion||'').toLowerCase().split(/\W+/).filter(w => w.length >= 4 && !STOP_WORDS.has(w)));
        const sharedA = a1.filter(w => a2.has(w));
        if (sharedKw.length >= 2 || sharedA.length >= 1) {
          newSugs.push({
            id: `sug-${n1.id}-${n2.id}`, from: n1.id, to: n2.id,
            label: inferRelLabel(n1, n2),
            reason: sharedKw.length >= 2
              ? t.sharedKeywords(sharedKw.slice(0,3).join('", "'))
              : t.similarEmotion(sharedA.slice(0,2).join('", "')),
          });
        }
      }
    }
    setSuggestions(newSugs); setShowSuggestions(true);
  };

  const acceptSuggestion = (sug) => {
    const newEdge = { id:`e${Date.now()}`, from:sug.from, to:sug.to, label:sug.label };
    setEdges(prev => [...prev, newEdge]);
    setSuggestions(prev => prev.filter(s => s.id !== sug.id));
    setDoc(doc(edgesCol, newEdge.id), toFS(newEdge)).catch(() => {});
  };
  const rejectSuggestion = (id) => setSuggestions(prev => prev.filter(s => s.id !== id));
  const updateSugLabel   = (id, label) => setSuggestions(prev => prev.map(s => s.id===id ? {...s,label} : s));

  // ── Media ───────────────────────────────────────────────────────────────
  const handleMediaFile = (file, isExisting) => {
    if (!file) return;
    const mediaType = file.type.split('/')[0];
    const reader    = new FileReader();
    reader.onerror  = () => {};
    reader.onload   = (ev) => {
      const previewUrl = ev.target.result;
      if (!previewUrl) return;
      if (isExisting && selected) {
        const nodeId = selected;
        const patch  = { hasMedia:true, mediaType, mediaName:file.name, mediaData:previewUrl };
        setNodes(p => p.map(n => n.id===nodeId ? {...n, ...patch} : n));
        updateDoc(doc(nodesCol, nodeId), patch).catch(() => {});
      } else {
        setMediaForm({ type: mediaType, name: file.name, data: previewUrl, file });
      }
    };
    reader.readAsDataURL(file);
  };

  const removeNodeMedia = () => {
    if (!selected) return;
    setNodes(p => p.map(n => n.id===selected
      ? {...n, hasMedia:false, mediaType:undefined, mediaData:undefined, mediaName:undefined}
      : n));
    updateDoc(doc(nodesCol, selected), { hasMedia:false, mediaType:null, mediaData:null, mediaName:null }).catch(() => {});
  };

  // ── Audio recording ─────────────────────────────────────────────────────
  const startRecording = async () => {
    if (!selected || !storage) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr     = new MediaRecorder(stream);
      audioChunksRef.current = [];
      mr.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      mr.onstop = async () => {
        stream.getTracks().forEach(track => track.stop());
        clearInterval(audioTimerRef.current);
        // Transition: recording → uploading
        setRecording(false); setAudioSec(0); setAudioWarning(false);
        setAudioUploading(true);
        setAudioUploadStatus("Uploading audio to Firebase...");
        const blob       = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const path       = `audio/${userId}/${selected}.webm`;
        const storageRef = stRef(storage, path);
        const TIMEOUT_MS = 20000;
        try {
          const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error("Upload timeout")), TIMEOUT_MS)
          );
          await Promise.race([uploadBytes(storageRef, blob), timeoutPromise]);
          const url = await Promise.race([getDownloadURL(storageRef), new Promise((_, reject) =>
            setTimeout(() => reject(new Error("Upload timeout")), TIMEOUT_MS)
          )]);
          setNodes(p => p.map(n => n.id === selected ? { ...n, audioUrl: url } : n));
          updateDoc(doc(nodesCol, selected), { audioUrl: url }).catch(() => {});
          setAudioUploadStatus("Upload success");
        } catch (error) {
          setAudioUploadStatus(error.message || "Upload failed");
        }
        setAudioUploading(false);
      };
      mr.start();
      mediaRecorderRef.current = mr;
      setRecording(true); setAudioSec(0); setAudioWarning(false);
      audioTimerRef.current = setInterval(() => setAudioSec(s => s + 1), 1000);
    } catch { /* mic denied */ }
  };

  const stopRecording = () => {
    clearInterval(audioTimerRef.current);
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop();
    }
  };

  const deleteAudio = () => {
    if (!selected || !storage) return;
    if (audioElemRef.current) audioElemRef.current.pause();
    setAudioPlaying(false); setAudioCurrent(0); setAudioDuration(0);
    const storageRef = stRef(storage, `audio/${userId}/${selected}.webm`);
    deleteObject(storageRef).catch(() => {});
    setNodes(p => p.map(n => n.id === selected ? { ...n, audioUrl: null } : n));
    updateDoc(doc(nodesCol, selected), { audioUrl: null }).catch(() => {});
  };

  const reRecord = () => {
    if (audioElemRef.current) audioElemRef.current.pause();
    setAudioPlaying(false); setAudioCurrent(0); setAudioDuration(0);
    startRecording();
  };

  // ── Topics CRUD ─────────────────────────────────────────────────────────
  const addTopic = () => {
    if (!newTopicName.trim()) return;
    const newTopic = { id:`tp_${Date.now()}`, label:newTopicName.trim(), emoji:newTopicEmoji, color:newTopicColor };
    const updated  = [...topics, newTopic];
    setTopics(updated);
    setDoc(topicsDocRef, { topicList: updated }).catch(() => {});
    setNewTopicName(""); setNewTopicEmoji("📌"); setNewTopicColor("#94a3b8");
    setShowAddTopic(false);
  };

  const deleteTopic = (topicId) => {
    const updated = topics.filter(tp => tp.id !== topicId);
    setTopics(updated);
    setDoc(topicsDocRef, { topicList: updated }).catch(() => {});
    // Reassign all nodes with this topicId to "other"
    const affected = nodes.filter(n => n.topicId === topicId);
    if (affected.length) {
      const batch = writeBatch(db);
      affected.forEach(n => batch.update(doc(nodesCol, n.id), { topicId: "other" }));
      batch.commit().catch(() => {});
      setNodes(p => p.map(n => n.topicId === topicId ? { ...n, topicId: "other" } : n));
    }
    if (activeTopic === topicId) setActiveTopic("all");
  };

  // ── Feature C: Auto-layout (deterministic topic-cluster) ─────────────────
  // Algorithm: no physics, no randomness, no iteration.
  //   1. Group expanded nodes by topicId (sorted for determinism).
  //   2. Place each topic's cluster center evenly around a circle in world-space.
  //   3. Distribute nodes within each cluster in concentric rings (fixed angle = i/count*2π).
  //   4. Self-check: abort on NaN before touching Firestore.
  const runAutoLayout = useCallback(() => {
    if (layoutAnimating) return;

    // ── Viewport center in world coordinates (always fresh from ref) ────────
    const c = cameraRef.current;
    const { w, h } = svgSize;
    const worldCx = (w / 2 - c.x) / c.scale;
    const worldCy = (h / 2 - c.y) / c.scale;
    // Layout radius scales to visible world area (at least 700×500 logical px)
    const worldW = Math.max((w - 120) / c.scale, 700);
    const worldH = Math.max((h - 120) / c.scale, 500);

    // ── Save snapshot for undo ───────────────────────────────────────────────
    const snapshot = {};
    nodes.forEach(n => { snapshot[n.id] = { x: n.x, y: n.y }; });
    setLayoutSnapshot(snapshot);

    // ── Group expanded nodes by topic (sort keys for determinism) ───────────
    const expandedNodes = nodes.filter(n => !collapsedTopics.has(n.topicId));
    if (expandedNodes.length === 0) return;

    const groups = {};
    expandedNodes.forEach(n => {
      const tid = n.topicId || "other";
      if (!groups[tid]) groups[tid] = [];
      groups[tid].push(n);
    });
    const topicIds = Object.keys(groups).sort(); // deterministic order
    const numTopics = topicIds.length;

    // ── Cluster centers: evenly spaced on a circle around the viewport center ─
    // Single topic → place at center; multiple → distribute on a ring.
    const outerR = Math.min(worldW, worldH) * 0.36;
    const clusterCenters = {};
    topicIds.forEach((tid, i) => {
      if (numTopics === 1) {
        clusterCenters[tid] = { x: worldCx, y: worldCy };
      } else {
        const angle = (i / numTopics) * 2 * Math.PI - Math.PI / 2; // start at top
        clusterCenters[tid] = {
          x: worldCx + outerR * Math.cos(angle),
          y: worldCy + outerR * Math.sin(angle),
        };
      }
    });

    // ── Distribute nodes in concentric rings within each cluster ─────────────
    // Ring 0 = center (1 node), ring 1 = up to 6, ring 2 = up to 12, ring 3 = up to 18 …
    const RING_CAP = [1, 6, 12, 18, 24, 30];
    const RING_RAD = [0, 80, 155, 230, 305, 380];

    const finalPos = {};
    topicIds.forEach(tid => {
      const groupNodes = groups[tid];
      const center = clusterCenters[tid];
      let idx = 0;
      for (let ring = 0; ring < RING_CAP.length && idx < groupNodes.length; ring++) {
        const slots = Math.min(RING_CAP[ring], groupNodes.length - idx);
        const radius = RING_RAD[ring];
        for (let i = 0; i < slots; i++) {
          const n = groupNodes[idx++];
          if (radius === 0) {
            finalPos[n.id] = { x: center.x, y: center.y };
          } else {
            const angle = (i / slots) * 2 * Math.PI - Math.PI / 2;
            finalPos[n.id] = {
              x: center.x + radius * Math.cos(angle),
              y: center.y + radius * Math.sin(angle),
            };
          }
        }
      }
    });

    // ── Self-check: abort immediately if any position is NaN ────────────────
    for (const [id, pos] of Object.entries(finalPos)) {
      if (!Number.isFinite(pos.x) || !Number.isFinite(pos.y)) {
        console.error("[Arrange] NaN position for node", id, pos, "— aborting layout");
        return;
      }
    }

    // ── Animate: freeze at old positions, then glide to new ones ────────────
    // Stagger delay by topic index (deterministic, no Math.random)
    const oldAnimPos = {};
    nodes.forEach(n => { oldAnimPos[n.id] = { x: n.x, y: n.y }; });
    const delays = {};
    topicIds.forEach((tid, ti) => {
      (groups[tid] || []).forEach(n => { delays[n.id] = ti * 40; });
    });
    animDelaysRef.current = delays;

    setAnimPos(oldAnimPos);
    setLayoutAnimating(true);

    requestAnimationFrame(() => {
      setAnimPos(finalPos);
      // Commit after CSS transition (700 ms) finishes
      setTimeout(() => {
        setNodes(prev => prev.map(n => finalPos[n.id] ? { ...n, ...finalPos[n.id] } : n));
        const batch = writeBatch(db);
        Object.entries(finalPos).forEach(([id, pos]) => {
          batch.update(doc(nodesCol, id), { x: pos.x, y: pos.y });
        });
        batch.commit().catch(() => {});
        setLayoutAnimating(false);
        setAnimPos(null);
        requestAnimationFrame(() => fitView());
      }, 700);
    });
  }, [nodes, collapsedTopics, svgSize, layoutAnimating, db, nodesCol]);

  const undoLayout = useCallback(() => {
    if (!layoutSnapshot || layoutAnimating) return;
    const snap = layoutSnapshot;
    const oldAnimPos = {};
    nodes.forEach(n => { oldAnimPos[n.id] = { x: n.x, y: n.y }; });
    const delays = {};
    nodes.forEach(n => { delays[n.id] = Math.random() * 80; });
    animDelaysRef.current = delays;
    setAnimPos(oldAnimPos);
    setLayoutAnimating(true);
    requestAnimationFrame(() => {
      setAnimPos(snap);
      setTimeout(() => {
        setNodes(prev => prev.map(n => snap[n.id] ? { ...n, ...snap[n.id] } : n));
        const batch = writeBatch(db);
        Object.entries(snap).forEach(([id, pos]) => {
          batch.update(doc(nodesCol, id), { x: pos.x, y: pos.y });
        });
        batch.commit().catch(()=>{});
        setLayoutAnimating(false);
        setAnimPos(null);
        setLayoutSnapshot(null);
        requestAnimationFrame(() => fitView());
      }, 700);
    });
  }, [layoutSnapshot, layoutAnimating, nodes, db, nodesCol]);

  // ── Mutations ───────────────────────────────────────────────────────────
  const openAddModal = () => {
    const defaultTopicId = selNode?.topicId || (activeTopic === "all" ? "other" : activeTopic) || "other";
    setForm({ label:"", bloomLevel:1, description:"", emotion:"", topicId: defaultTopicId });
    setMediaForm(null);
    setShowAdd(true);
  };

  const addNode = () => {
    if (!form.label.trim()) return;
    const id  = `n${Date.now()}`;
    const sel = selected ? nodes.find(n => n.id === selected) : null;
    let spawnX, spawnY;
    if (sel) {
      const angle = Math.random() * Math.PI * 2;
      spawnX = sel.x + Math.cos(angle) * 130;
      spawnY = sel.y + Math.sin(angle) * 130;
    } else {
      const c = cameraRef.current;
      spawnX = (svgSize.w / 2 - c.x) / c.scale + (Math.random() - 0.5) * 180;
      spawnY = (svgSize.h / 2 - c.y) / c.scale + (Math.random() - 0.5) * 180;
    }
    const { x, y } = resolveOverlap({ x: spawnX, y: spawnY }, nodes);
    const nodeData  = { ...form, id, x, y };
    if (mediaForm) {
      nodeData.hasMedia  = true;
      nodeData.mediaType = mediaForm.type;
      nodeData.mediaName = mediaForm.name;
      nodeData.mediaData = mediaForm.data;
    }
    setNodes(prev => [...prev, nodeData]);
    setDoc(doc(nodesCol, id), toFS(nodeData)).catch(() => {});
    setForm({ label:"", bloomLevel:1, description:"", emotion:"", topicId:"other" });
    setMediaForm(null); setShowAdd(false); setSelected(id);
  };

  const deleteNode = (id) => {
    const connEdges = edges.filter(e => e.from === id || e.to === id);
    setNodes(p => p.filter(n => n.id !== id));
    setEdges(p => p.filter(e => e.from !== id && e.to !== id));
    deleteDoc(doc(nodesCol, id)).catch(() => {});
    connEdges.forEach(e => deleteDoc(doc(edgesCol, e.id)).catch(() => {}));
    setSelected(null);
  };

  const upgradeBloom = (id) => {
    const node = nodes.find(n => n.id === id);
    if (!node || node.bloomLevel >= 6) return;
    const bloomLevel = node.bloomLevel + 1;
    setNodes(p => p.map(n => n.id===id ? {...n, bloomLevel} : n));
    updateDoc(doc(nodesCol, id), { bloomLevel }).catch(() => {});
  };

  const downgradeBloom = (id) => {
    const node = nodes.find(n => n.id === id);
    if (!node || node.bloomLevel <= 1) return;
    const bloomLevel = node.bloomLevel - 1;
    setNodes(p => p.map(n => n.id===id ? {...n, bloomLevel} : n));
    updateDoc(doc(nodesCol, id), { bloomLevel }).catch(() => {});
  };

  // ── Edge path ───────────────────────────────────────────────────────────
  const edgePath = (edge) => {
    const f = nodes.find(n => n.id===edge.from), to = nodes.find(n => n.id===edge.to);
    if (!f||!to) return null;
    const dx=to.x-f.x, dy=to.y-f.y, dist=Math.sqrt(dx*dx+dy*dy)||1;
    const nx=dx/dist, ny=dy/dist, r=30;
    const sx=f.x+nx*r, sy=f.y+ny*r, ex=to.x-nx*r, ey=to.y-ny*r;
    const cx=(sx+ex)/2 - ny*50, cy=(sy+ey)/2 + nx*50;
    return { path:`M${sx},${sy} Q${cx},${cy} ${ex},${ey}`, mx:(sx+2*cx+ex)/4, my:(sy+2*cy+ey)/4 };
  };

  // ── Derived ─────────────────────────────────────────────────────────────
  const connCount = (id) => edges.filter(e => e.from===id||e.to===id).length;
  const selNode   = nodes.find(n => n.id===selected);
  const selB      = selNode ? getB(selNode.bloomLevel) : null;
  const avgBloom  = nodes.length ? (nodes.reduce((a,n) => a+n.bloomLevel, 0)/nodes.length).toFixed(1) : 0;
  const zoomPct   = Math.round(camera.scale * 100);

  // Feature A: focus mode neighbour set
  const focusNeighbourIds = useMemo(() => {
    if (!focusNodeId) return null;
    const s = new Set();
    edges.forEach(e => {
      if (e.from === focusNodeId) s.add(e.to);
      if (e.to   === focusNodeId) s.add(e.from);
    });
    return s;
  }, [focusNodeId, edges]);

  // Feature B: collapsed topic bubble positions (centroid of members)
  const topicBubbles = useMemo(() => {
    return [...collapsedTopics].map(tId => {
      const tp      = topics.find(t => t.id === tId);
      const members = nodes.filter(n => n.topicId === tId);
      if (!members.length || !tp) return null;
      const bx = members.reduce((s,n)=>s+n.x,0) / members.length;
      const by = members.reduce((s,n)=>s+n.y,0) / members.length;
      return { topicId: tId, tp, members, x: bx, y: by, count: members.length };
    }).filter(Boolean);
  }, [collapsedTopics, nodes, topics]);

  // helper: get display position (animPos override during layout animation)
  const dispXY = (node) => {
    if (animPos && animPos[node.id]) return animPos[node.id];
    return { x: node.x, y: node.y };
  };

  // ─── RENDER ──────────────────────────────────────────────────────────────
  return (
    <div style={{
      height:"100vh", width:"100%", overflow:"hidden",
      background:"radial-gradient(ellipse at 25% 40%, #1a0f3c 0%, #0d0820 55%, #050310 100%)",
      fontFamily:"'Segoe UI',system-ui,sans-serif", color:"#e8dcff",
      display:"flex", flexDirection:"column", userSelect:"none"
    }}>

      {/* ── HEADER ─────────────────────────────────────────────── */}
      <div style={{
        padding:"10px 16px 9px", borderBottom:"1px solid rgba(255,255,255,0.07)",
        background:"rgba(0,0,0,0.35)", backdropFilter:"blur(12px)",
        display:"flex", justifyContent:"space-between", alignItems:"center", flexWrap:"wrap", gap:8,
        flexShrink:0
      }}>
        {/* Brand + user badge */}
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          <div>
            <div style={{fontSize:9,letterSpacing:4,color:"#a855f7",marginBottom:1}}>{t.tagline}</div>
            <div style={{fontSize:20,fontWeight:800,color:"#fff",lineHeight:1.1}}>{t.appTitle}</div>
          </div>
          {user && (
            <div
              onClick={onBack}
              title={t.switchUser}
              style={{
                display:"flex",alignItems:"center",gap:6,padding:"4px 10px",borderRadius:999,cursor:"pointer",
                border:`1px solid ${user.color}55`,background:`${user.color}15`,
                transition:"all .15s",
              }}
              onMouseEnter={e => e.currentTarget.style.background = `${user.color}28`}
              onMouseLeave={e => e.currentTarget.style.background = `${user.color}15`}
            >
              <span style={{fontSize:18}}>{user.emoji}</span>
              <span style={{fontSize:12,fontWeight:700,color:user.color}}>{user.name}</span>
            </div>
          )}
        </div>

        {/* Action buttons */}
        <div style={{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center"}}>
          <button onClick={()=>{setMode("view");setConnecting(null);}} style={btnStyle(mode==="view","#6366f1")}>{t.view}</button>
          <button onClick={()=>{setMode("connect");setSelected(null);}} style={btnStyle(mode==="connect","#a855f7")}>
            {mode==="connect"&&connecting ? t.connectModeActive(nodes.find(n=>n.id===connecting)?.label||"") : t.connect}
          </button>
          <button onClick={openAddModal} style={btnStyle(false,"#22c55e")}>{t.addNeuron}</button>
          <button onClick={findAutoSynapses} style={btnStyle(showSuggestions,"#f59e0b")}>{t.autoSynapse}</button>
          <button onClick={fitView} style={btnStyle(false,"#06b6d4")}>{t.fit}</button>
          {/* Feature C: Auto-layout */}
          <button onClick={runAutoLayout} disabled={layoutAnimating}
            style={{...btnStyle(false,"#a855f7"),opacity:layoutAnimating?.5:1}}>✦ Arrange</button>
          {layoutSnapshot && !layoutAnimating && (
            <button onClick={undoLayout} style={btnStyle(false,"#94a3b8")}>↩ Undo</button>
          )}
          {/* Feature B: Collapse all / Expand all */}
          <button onClick={()=>setCollapsedTopics(new Set(topics.filter(tp=>tp.id!=="all"&&tp.id!=="other").map(tp=>tp.id)))}
            style={btnStyle(false,"#6366f1")} title="Collapse all topics">⊙ All</button>
          <button onClick={()=>setCollapsedTopics(new Set())}
            style={btnStyle(false,"#6366f1")} title="Expand all topics">⊚ All</button>
        </div>

        {/* Stats + language switcher */}
        <div style={{display:"flex",gap:16,alignItems:"center"}}>
          {[{n:nodes.length,label:t.neurons},{n:edges.length,label:t.synapses},{n:avgBloom,label:t.avgBloom}].map(s=>(
            <div key={s.label} style={{textAlign:"center"}}>
              <div style={{fontSize:18,fontWeight:800,color:"#a855f7"}}>{s.n}</div>
              <div style={{fontSize:9,color:"rgba(232,220,255,0.4)",letterSpacing:1}}>{s.label}</div>
            </div>
          ))}
          {/* Language switcher */}
          <div style={{display:"flex",gap:3}}>
            {["en","vi","zh"].map(l => (
              <button key={l} onClick={()=>setLang(l)}
                style={{
                  padding:"3px 8px",borderRadius:6,cursor:"pointer",fontSize:10,fontWeight:700,
                  border:`1px solid ${lang===l ? "#a855f7" : "rgba(255,255,255,.12)"}`,
                  background: lang===l ? "rgba(168,85,247,.2)" : "rgba(255,255,255,.04)",
                  color: lang===l ? "#c084fc" : "rgba(232,220,255,.45)",
                  fontFamily:"inherit",
                }}>
                {l.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── BLOOM LEGEND ────────────────────────────────────────── */}
      <div style={{display:"flex",gap:6,padding:"6px 14px",overflowX:"auto",background:"rgba(0,0,0,0.22)",borderBottom:"1px solid rgba(255,255,255,0.04)",flexShrink:0}}>
        {BLOOM.map(b=>(
          <div key={b.level} style={{
            display:"flex",alignItems:"center",gap:5,padding:"3px 10px",borderRadius:999,
            background:`${b.color}15`,border:`1px solid ${b.color}40`,fontSize:11,whiteSpace:"nowrap",color:b.color,flexShrink:0
          }}>
            <span>{b.icon}</span><span style={{fontWeight:700}}>L{b.level}</span><span style={{opacity:.75}}>{b.name}</span>
          </div>
        ))}
      </div>

      {/* ── TOPIC FILTER BAR ─────────────────────────────────────── */}
      <div style={{
        display:"flex",gap:6,padding:"7px 14px",overflowX:"auto",
        background:"rgba(0,0,0,0.18)",borderBottom:"1px solid rgba(255,255,255,0.04)",
        flexShrink:0,alignItems:"center",flexWrap:"nowrap"
      }}>
        {topics.map(tp => (
          <div key={tp.id} style={{display:"flex",alignItems:"center",gap:0,flexShrink:0}}>
            <button
              onClick={() => setActiveTopic(tp.id)}
              style={{
                padding:"3px 11px",borderRadius:999,cursor:"pointer",fontSize:11,
                border:`1px solid ${tp.id===activeTopic ? tp.color : tp.color+"40"}`,
                background: tp.id===activeTopic ? `${tp.color}28` : "rgba(255,255,255,0.04)",
                color: tp.id===activeTopic ? tp.color : "rgba(232,220,255,0.45)",
                fontFamily:"inherit",whiteSpace:"nowrap",transition:"all .15s",
                borderTopRightRadius: (tp.id !== "all" && tp.id !== "other") ? 0 : 999,
                borderBottomRightRadius: (tp.id !== "all" && tp.id !== "other") ? 0 : 999,
              }}>
              {tp.emoji} {tp.label}
            </button>
            {tp.id !== "all" && tp.id !== "other" && (<>
              {/* Feature B: collapse toggle */}
              <button
                onClick={()=>setCollapsedTopics(prev=>{
                  const n=new Set(prev);
                  if(n.has(tp.id)) n.delete(tp.id); else n.add(tp.id);
                  return n;
                })}
                title={collapsedTopics.has(tp.id)?"Expand topic":"Collapse topic"}
                style={{
                  padding:"3px 5px",cursor:"pointer",fontSize:10,
                  border:`1px solid ${tp.id===activeTopic ? tp.color : tp.color+"40"}`,
                  borderLeft:"none", borderRight:"none",
                  background: collapsedTopics.has(tp.id) ? `${tp.color}30` : (tp.id===activeTopic ? `${tp.color}28` : "rgba(255,255,255,0.04)"),
                  color: collapsedTopics.has(tp.id) ? tp.color : "rgba(232,220,255,.5)",
                  fontFamily:"inherit",lineHeight:1,
                }}>{collapsedTopics.has(tp.id)?"⊚":"⊙"}</button>
              <button
                onClick={() => { if (window.confirm(`Delete topic "${tp.label}"?`)) deleteTopic(tp.id); }}
                style={{
                  padding:"3px 5px",cursor:"pointer",fontSize:10,
                  border:`1px solid ${tp.id===activeTopic ? tp.color : tp.color+"40"}`,
                  borderLeft:"none",
                  background: tp.id===activeTopic ? `${tp.color}28` : "rgba(255,255,255,0.04)",
                  color:"rgba(232,220,255,.35)",
                  borderTopRightRadius:999,borderBottomRightRadius:999,
                  fontFamily:"inherit",lineHeight:1,
                }}>×</button>
            </>)}
          </div>
        ))}

        {/* + Topic button */}
        {!showAddTopic ? (
          <button onClick={() => setShowAddTopic(true)}
            style={{
              padding:"3px 10px",borderRadius:999,cursor:"pointer",fontSize:11,flexShrink:0,
              border:"1px dashed rgba(255,255,255,.2)",background:"transparent",
              color:"rgba(232,220,255,.4)",fontFamily:"inherit",whiteSpace:"nowrap",
            }}>
            {t.addTopic}
          </button>
        ) : (
          <div style={{display:"flex",alignItems:"center",gap:4,flexShrink:0}}>
            <input
              value={newTopicName}
              onChange={e => setNewTopicName(e.target.value)}
              onKeyDown={e => { if (e.key==="Enter") addTopic(); if (e.key==="Escape") setShowAddTopic(false); }}
              placeholder={t.newTopicNamePh}
              autoFocus
              style={{padding:"2px 8px",borderRadius:6,border:"1px solid rgba(255,255,255,.2)",background:"rgba(255,255,255,.07)",color:"#fff",fontSize:11,outline:"none",fontFamily:"inherit",width:100}}
            />
            {TOPIC_EMOJIS.slice(0,6).map(em => (
              <button key={em} onClick={() => setNewTopicEmoji(em)}
                style={{
                  width:22,height:22,borderRadius:4,border:`1px solid ${newTopicEmoji===em?"rgba(168,85,247,.7)":"rgba(255,255,255,.1)"}`,
                  background:newTopicEmoji===em?"rgba(168,85,247,.2)":"transparent",cursor:"pointer",fontSize:12,fontFamily:"inherit",flexShrink:0,
                }}>{em}</button>
            ))}
            {TOPIC_COLORS.slice(0,5).map(c => (
              <button key={c} onClick={() => setNewTopicColor(c)}
                style={{
                  width:16,height:16,borderRadius:"50%",background:c,cursor:"pointer",flexShrink:0,
                  border:`2px solid ${newTopicColor===c?"#fff":"transparent"}`,outline:"none",boxSizing:"border-box",
                }}/>
            ))}
            <button onClick={addTopic}
              style={{padding:"2px 8px",borderRadius:6,border:"1px solid rgba(168,85,247,.5)",background:"rgba(168,85,247,.15)",color:"#c084fc",cursor:"pointer",fontSize:11,fontFamily:"inherit"}}>
              {t.addTopicBtn}
            </button>
            <button onClick={() => setShowAddTopic(false)}
              style={{padding:"2px 6px",borderRadius:6,border:"none",background:"transparent",color:"rgba(232,220,255,.35)",cursor:"pointer",fontSize:12,fontFamily:"inherit"}}>×</button>
          </div>
        )}
      </div>

      {/* ── AUTO SYNAPSE PANEL ───────────────────────────────────── */}
      {showSuggestions && (
        <div style={{background:"rgba(0,0,0,0.4)",borderBottom:"1px solid rgba(245,158,11,.25)",padding:"10px 18px",backdropFilter:"blur(8px)",flexShrink:0}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
            <div style={{fontSize:13,fontWeight:700,color:"#f59e0b"}}>
              {t.autoSynapseSuggestions}
              <span style={{fontWeight:400,color:"rgba(232,220,255,.5)",marginLeft:8,fontSize:11}}>{suggestions.length} found</span>
            </div>
            <button onClick={()=>setShowSuggestions(false)} style={{background:"none",border:"none",color:"rgba(232,220,255,.4)",cursor:"pointer",fontSize:18,lineHeight:1}}>×</button>
          </div>
          {suggestions.length === 0 ? (
            <div style={{fontSize:12,color:"rgba(232,220,255,.4)",fontStyle:"italic"}}>{t.noSuggestions}</div>
          ) : (
            <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
              {suggestions.map(sug => {
                const fn=nodes.find(n=>n.id===sug.from), tn=nodes.find(n=>n.id===sug.to);
                if (!fn||!tn) return null;
                const fb=getB(fn.bloomLevel), tb=getB(tn.bloomLevel);
                return (
                  <div key={sug.id} style={{background:"rgba(245,158,11,0.07)",border:"1px solid rgba(245,158,11,.25)",borderRadius:12,padding:"10px 14px",minWidth:260,maxWidth:340,display:"flex",flexDirection:"column",gap:6}}>
                    <div style={{display:"flex",alignItems:"center",gap:6,fontSize:12}}>
                      <span style={{color:fb.color,fontWeight:700}}>{fb.icon} {fn.label}</span>
                      <span style={{color:"rgba(232,220,255,.35)"}}>→</span>
                      <span style={{color:tb.color,fontWeight:700}}>{tb.icon} {tn.label}</span>
                    </div>
                    <div style={{fontSize:10,color:"rgba(232,220,255,.45)",lineHeight:1.4}}>{sug.reason}</div>
                    <div style={{display:"flex",alignItems:"center",gap:6}}>
                      <select value={sug.label} onChange={e=>updateSugLabel(sug.id,e.target.value)}
                        style={{flex:1,padding:"4px 8px",borderRadius:6,fontSize:11,border:"1px solid rgba(245,158,11,.3)",background:"#0d0820",color:"#f59e0b",outline:"none",fontFamily:"inherit"}}>
                        {REL_LABELS.map(l=><option key={l} value={l}>{l}</option>)}
                      </select>
                      <button onClick={()=>acceptSuggestion(sug)} style={{padding:"4px 10px",borderRadius:6,border:"1px solid rgba(34,197,94,.4)",background:"rgba(34,197,94,.12)",color:"#4ade80",cursor:"pointer",fontSize:11,fontWeight:700,fontFamily:"inherit"}}>✓</button>
                      <button onClick={()=>rejectSuggestion(sug.id)} style={{padding:"4px 8px",borderRadius:6,border:"none",background:"rgba(255,255,255,.04)",color:"rgba(232,220,255,.35)",cursor:"pointer",fontSize:12,fontFamily:"inherit"}}>✕</button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── INFINITE CANVAS ─────────────────────────────────────── */}
      <div style={{flex:1,position:"relative",overflow:"hidden",minHeight:0}}>

        <svg
          ref={svgRef}
          style={{ width:"100%", height:"100%", display:"block",
            cursor: isPanning ? "grabbing" : mode==="connect" ? "crosshair" : "grab" }}
          onMouseDown={onSVGMouseDown} onMouseMove={onSVGMM}
          onMouseUp={onSVGMU} onMouseLeave={onSVGMU}
          onClick={onSVGClick}
          onTouchStart={onTouchStart}
          onTouchEnd={() => {
            if (nodeDragTouchRef.current && dragPosRef.current) {
              const { id, x, y } = dragPosRef.current;
              updateDoc(doc(nodesCol, id), { x, y }).catch(() => {});
              dragPosRef.current = null;
            }
            nodeDragTouchRef.current = null;
            panRef.current = null; touchRef.current = null;
            setDrag(null);
          }}
        >
          <defs>
            {BLOOM.map(b=>(
              <marker key={b.level} id={`arr${b.level}`} markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto">
                <path d="M0,0 L0,6 L8,3 z" fill={b.color} opacity=".8"/>
              </marker>
            ))}
            <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="5" result="blur"/>
              <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
            </filter>
            <filter id="softglow" x="-30%" y="-30%" width="160%" height="160%">
              <feGaussianBlur stdDeviation="2.5" result="blur"/>
              <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
            </filter>
            <pattern id="grid" x={camera.x % 28} y={camera.y % 28} width="28" height="28" patternUnits="userSpaceOnUse">
              <circle cx="0.8" cy="0.8" r="0.8" fill="rgba(255,255,255,0.038)"/>
            </pattern>
          </defs>

          <rect width="100%" height="100%" fill="url(#grid)"/>

          <g transform={`translate(${camera.x},${camera.y}) scale(${camera.scale})`}>

            {/* ── EDGES ── */}
            {visibleEdges.map(edge => {
              const fn  = nodes.find(n => n.id===edge.from);
              const tn  = nodes.find(n => n.id===edge.to);
              if (!fn || !tn) return null;
              // BUG 1 guard: skip edges whose endpoints have corrupt coordinates
              if (!Number.isFinite(fn.x) || !Number.isFinite(fn.y) ||
                  !Number.isFinite(tn.x) || !Number.isFinite(tn.y)) return null;

              // Feature B: skip intra-collapsed edges; redirect cross-topic edges to bubble
              const fromCollapsed = collapsedTopics.has(fn.topicId);
              const toCollapsed   = collapsedTopics.has(tn.topicId);
              if (fromCollapsed && toCollapsed && fn.topicId === tn.topicId) return null; // internal, hidden
              const fromBub = fromCollapsed ? topicBubbles.find(b=>b.topicId===fn.topicId) : null;
              const toBub   = toCollapsed   ? topicBubbles.find(b=>b.topicId===tn.topicId) : null;
              const fx = fromBub ? fromBub.x : dispXY(fn).x;
              const fy = fromBub ? fromBub.y : dispXY(fn).y;
              const tx = toBub   ? toBub.x   : dispXY(tn).x;
              const ty = toBub   ? toBub.y   : dispXY(tn).y;

              const dx=tx-fx, dy=ty-fy, dist=Math.sqrt(dx*dx+dy*dy)||1;
              const nx=dx/dist, ny=dy/dist, r=fromBub?44:28, tr=toBub?44:28;
              const sx=fx+nx*r, sy=fy+ny*r, ex=tx-nx*tr, ey=ty-ny*tr;
              const cxp=(sx+ex)/2 - ny*50, cyp=(sy+ey)/2 + nx*50;
              const edgePath2 = `M${sx},${sy} Q${cxp},${cyp} ${ex},${ey}`;
              const emx=(sx+2*cxp+ex)/4, emy=(sy+2*cyp+ey)/4;

              const b   = getB(fn.bloomLevel||1);
              const ho  = hoverEdge===edge.id;

              // Topic-based opacity
              const fromMatch = fn.topicId === activeTopic;
              const toMatch   = tn.topicId === activeTopic;
              let edgeOpacity, strokeColor;
              if (activeTopic === "all") {
                edgeOpacity = 1; strokeColor = null;
              } else if (fromMatch && toMatch) {
                edgeOpacity = 1; strokeColor = null;
              } else if (fromMatch || toMatch) {
                edgeOpacity = 1; strokeColor = "#ffffff";
              } else {
                edgeOpacity = 0.18; strokeColor = null;
              }

              // Feature A: focus mode opacity
              if (focusNodeId) {
                const involvesFocus = edge.from===focusNodeId || edge.to===focusNodeId;
                edgeOpacity = involvesFocus ? 1 : 0.05;
              }

              const finalStroke = strokeColor
                ? (ho ? strokeColor : `${strokeColor}88`)
                : (ho ? b.color : `${b.color}50`);
              const sw = focusNodeId && (edge.from===focusNodeId||edge.to===focusNodeId) ? (ho?2.8:2.2) : (ho?2.2:1.5);

              return (
                <g key={edge.id} style={{opacity:edgeOpacity,transition:"opacity .3s"}}>
                  <path d={edgePath2} fill="none" stroke="transparent" strokeWidth={16}
                    onMouseEnter={()=>setHoverEdge(edge.id)} onMouseLeave={()=>setHoverEdge(null)}
                    onClick={e=>{e.stopPropagation();if(window.confirm(t.deleteEdgeConfirm(edge.label))){setEdges(prev=>prev.filter(ed=>ed.id!==edge.id));deleteDoc(doc(edgesCol,edge.id)).catch(()=>{});}}}
                    style={{cursor:"pointer"}}/>
                  <path d={edgePath2} fill="none"
                    stroke={finalStroke}
                    strokeWidth={sw}
                    strokeDasharray={ho?"none":"5 4"}
                    markerEnd={`url(#arr${fn.bloomLevel||1})`}
                    style={{transition:"stroke .15s,stroke-width .15s",pointerEvents:"none"}}/>
                  {(ho || edges.length < 12) &&
                    <text x={emx} y={emy-6} textAnchor="middle" fontSize="10" fill={strokeColor||b.color} opacity=".9"
                      style={{pointerEvents:"none"}} filter="url(#softglow)">{edge.label}</text>
                  }
                </g>
              );
            })}

            {/* ── NODES ── */}
            {visibleNodes.map(node => {
              // Feature B: hide nodes whose topic is collapsed
              if (collapsedTopics.has(node.topicId)) return null;

              // BUG 1 guard: skip any node with missing/corrupt data
              // (prevents a single bad Firestore doc from crashing the entire canvas)
              if (!node.id) return null;
              if (!Number.isFinite(node.x) || !Number.isFinite(node.y)) return null;
              const safeLabel = String(node.label ?? "");

              const b      = getB(node.bloomLevel);
              const isSel  = selected===node.id;
              const isConn = connecting===node.id;
              const cc     = connCount(node.id);
              const r      = 28 + Math.min(cc * 2.5, 14);

              // Topic ring + opacity
              const nodeTopic  = topics.find(tp => tp.id === node.topicId);
              const topicMatch = activeTopic === "all" || node.topicId === activeTopic;
              let nodeOpacity  = topicMatch ? 1 : 0.18;

              // Feature A: focus mode opacity
              if (focusNodeId) {
                if (node.id === focusNodeId) nodeOpacity = 1;
                else if (focusNeighbourIds?.has(node.id)) nodeOpacity = 1;
                else nodeOpacity = 0.08;
              }

              // Feature A: focused node scale
              const isFocused = focusNodeId === node.id;

              // Feature C: layout animation — use animPos display override
              const { x: dx, y: dy } = dispXY(node);
              const animDelay = animDelaysRef.current[node.id] || 0;

              return (
                <g key={node.id}
                  transform={`translate(${dx},${dy})${isFocused?" scale(1.15)":""}`}
                  opacity={nodeOpacity}
                  style={{
                    transition: `opacity .3s, transform ${layoutAnimating ? `600ms ease-out ${animDelay}ms` : ".2s"}`,
                    cursor: layoutAnimating ? "default" : (mode==="connect"?"pointer":"grab"),
                  }}
                  onMouseDown={e=>{ if(layoutAnimating) return; onNodePD(e,node.id); }}
                  onTouchStart={e=>{ if(layoutAnimating) return; onNodeTouchStart(e,node.id); }}
                  onClick={e=>{ if(layoutAnimating) return; onNodeClick(e,node.id); }}
                >
                  {(isSel||isConn) && <>
                    <circle cx={0} cy={0} r={r+18} fill={`${b.color}08`} filter="url(#glow)"/>
                    <circle cx={0} cy={0} r={r+10} fill="none" stroke={b.color} strokeWidth=".8" opacity=".4" strokeDasharray={isConn?"4 3":"none"}/>
                  </>}
                  {/* Topic color ring */}
                  {nodeTopic && nodeTopic.id !== "all" && (
                    <circle cx={0} cy={0} r={r+5} fill="none"
                      stroke={nodeTopic.color} strokeWidth={1.8} opacity={0.55}
                      strokeDasharray="4 3"/>
                  )}
                  <circle cx={0} cy={0} r={r+3} fill="none" stroke={b.color} strokeWidth={isSel?1.8:.8} opacity={isSel?.9:.35}/>
                  <circle cx={0} cy={0} r={r}   fill="#0d0820" stroke={b.color} strokeWidth="1.6"/>
                  <circle cx={0} cy={0} r={r}   fill={`${b.color}18`}/>
                  <text x={0} y={1} textAnchor="middle" dominantBaseline="middle" fontSize="16" style={{pointerEvents:"none"}}>{b.icon}</text>
                  <text x={0} y={r+14} textAnchor="middle" fontSize="10.5" fill="#e8dcff" fontWeight="600" filter="url(#softglow)" style={{pointerEvents:"none"}}>
                    {safeLabel.length>15 ? safeLabel.slice(0,13)+"…" : safeLabel}
                  </text>
                  <circle cx={r} cy={-r+2} r={9} fill={b.color} style={{pointerEvents:"none"}}/>
                  <text x={r} y={-r+2} textAnchor="middle" dominantBaseline="middle" fontSize="8" fill="#fff" fontWeight="800" style={{pointerEvents:"none"}}>L{node.bloomLevel}</text>
                  {node.hasMedia && <>
                    <circle cx={-r+2} cy={-r+2} r={7} fill="#06b6d4" style={{pointerEvents:"none"}}/>
                    <text x={-r+2} y={-r+2} textAnchor="middle" dominantBaseline="middle" fontSize="8" fill="#fff" style={{pointerEvents:"none"}}>
                      {node.mediaType?.startsWith("image")?"📷":node.mediaType?.startsWith("video")?"🎬":"🎵"}
                    </text>
                  </>}
                  {node.audioUrl && <>
                    <circle cx={r-2} cy={r-2} r={7} fill="#a855f7" style={{pointerEvents:"none"}}/>
                    <text x={r-2} y={r-2} textAnchor="middle" dominantBaseline="middle" fontSize="8" fill="#fff" style={{pointerEvents:"none"}}>🎙</text>
                  </>}
                  {cc > 0 &&
                    <text x={0} y={r+26} textAnchor="middle" fontSize="8.5" fill={`${b.color}90`} style={{pointerEvents:"none"}}>
                      {cc} synapse{cc!==1?"s":""}
                    </text>
                  }
                </g>
              );
            })}

            {/* ── TOPIC CLUSTER BUBBLES (Feature B) ── */}
            {topicBubbles.map(bub => {
              const { tp, x: bx, y: by, count } = bub;
              const isFocusBub = focusNodeId && bub.members.some(m=>m.id===focusNodeId);
              let bubOpacity = 1;
              if (focusNodeId) {
                const hasCrossEdge = edges.some(e =>
                  (bub.members.some(m=>m.id===e.from) && !bub.members.some(m=>m.id===e.to)) ||
                  (bub.members.some(m=>m.id===e.to)   && !bub.members.some(m=>m.id===e.from))
                );
                bubOpacity = (isFocusBub || hasCrossEdge) ? 1 : 0.08;
              }
              return (
                <g key={`bubble_${bub.topicId}`}
                  opacity={bubOpacity}
                  style={{cursor:"pointer",transition:"opacity .3s"}}
                  onClick={e=>{
                    e.stopPropagation();
                    setCollapsedTopics(prev=>{const n=new Set(prev);n.delete(bub.topicId);return n;});
                  }}
                >
                  {/* Pulsing glow */}
                  <circle cx={bx} cy={by} r={52} fill={`${tp.color}12`} style={{animation:"bubblePulse 2s ease-in-out infinite"}}/>
                  <circle cx={bx} cy={by} r={44} fill={`${tp.color}22`} stroke={tp.color} strokeWidth="2" opacity=".85"/>
                  <text x={bx} y={by-10} textAnchor="middle" dominantBaseline="middle" fontSize="20" style={{pointerEvents:"none"}}>{tp.emoji}</text>
                  <text x={bx} y={by+6}  textAnchor="middle" dominantBaseline="middle" fontSize="11" fill={tp.color} fontWeight="700" style={{pointerEvents:"none"}}>{tp.label}</text>
                  <text x={bx} y={by+20} textAnchor="middle" dominantBaseline="middle" fontSize="9"  fill={`${tp.color}bb`} style={{pointerEvents:"none"}}>{count} neurons</text>
                </g>
              );
            })}
          </g>
        </svg>

        {/* ── FOCUS MODE PILL (Feature A) ── */}
        {focusNodeId && (() => {
          const fn = nodes.find(n=>n.id===focusNodeId);
          if (!fn) return null;
          return (
            <div style={{
              position:"absolute",top:10,left:10,zIndex:8,
              display:"flex",alignItems:"center",gap:6,
              padding:"5px 12px",borderRadius:999,
              background:"rgba(168,85,247,.22)",border:"1px solid rgba(168,85,247,.6)",
              backdropFilter:"blur(8px)",fontSize:12,color:"#c084fc",pointerEvents:"auto",
            }}>
              <span>🔍 Focus:</span>
              <span style={{fontWeight:700,color:"#fff"}}>{fn.label}</span>
              <button onClick={()=>{setFocusNodeId(null);}}
                style={{background:"none",border:"none",cursor:"pointer",color:"rgba(168,85,247,.8)",fontSize:14,lineHeight:1,padding:0,marginLeft:2}}>✕</button>
            </div>
          );
        })()}

        {/* ── SIDE PANEL ──────────────────────────────────────────── */}
        {selNode && (
          <div style={{
            position:"absolute",top:12,right:12,width:282,maxHeight:"calc(100% - 24px)",overflowY:"auto",
            background:"rgba(8,4,22,0.93)",backdropFilter:"blur(20px)",
            border:`1px solid ${selB.color}45`,borderRadius:16,padding:20,
            boxShadow:`0 0 40px ${selB.color}18`,zIndex:10,
          }}>
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:12}}>
              <div style={{padding:"4px 12px",borderRadius:999,background:`${selB.color}20`,border:`1px solid ${selB.color}50`,fontSize:12,color:selB.color,fontWeight:700}}>
                {selB.icon} L{selNode.bloomLevel} — {selB.name}
              </div>
            </div>
            <div style={{fontSize:10,color:`${selB.color}cc`,letterSpacing:.5,marginBottom:4}}>{selB.desc}</div>
            <div style={{fontSize:18,fontWeight:800,color:"#fff",marginBottom:3,lineHeight:1.2}}>{selNode.label}</div>
            {/* Topic selector (inline edit) */}
            <div style={{marginBottom:10}}>
              <div style={{fontSize:9,color:"rgba(232,220,255,.35)",letterSpacing:1.5,marginBottom:5}}>TOPIC</div>
              <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
                {topics.filter(tp=>tp.id!=="all").map(tp=>(
                  <button key={tp.id}
                    onClick={()=>{
                      if(tp.id===selNode.topicId) return;
                      setNodes(p=>p.map(n=>n.id===selNode.id?{...n,topicId:tp.id}:n));
                      updateDoc(doc(nodesCol,selNode.id),{topicId:tp.id}).catch(()=>{});
                    }}
                    style={{
                      padding:"2px 8px",borderRadius:999,cursor:"pointer",fontSize:10,
                      border:`1px solid ${tp.id===selNode.topicId?tp.color:tp.color+"30"}`,
                      background:tp.id===selNode.topicId?`${tp.color}22`:"transparent",
                      color:tp.id===selNode.topicId?tp.color:"rgba(232,220,255,.35)",
                      fontFamily:"inherit",transition:"all .12s",
                    }}>
                    {tp.emoji} {tp.label}
                  </button>
                ))}
              </div>
            </div>

            {selNode.description && <div style={{fontSize:12.5,color:"rgba(232,220,255,.75)",lineHeight:1.65,marginBottom:12}}>{selNode.description}</div>}
            {selNode.emotion && (
              <div style={{padding:"10px 13px",borderRadius:10,marginBottom:12,background:`${selB.color}0e`,border:`1px solid ${selB.color}28`}}>
                <div style={{fontSize:9,color:selB.color,letterSpacing:1.5,marginBottom:5}}>{t.emotionalAnchor}</div>
                <div style={{fontSize:12,color:"rgba(232,220,255,.7)",lineHeight:1.55}}>{selNode.emotion}</div>
              </div>
            )}

            {/* ── Media section ── */}
            <div style={{marginBottom:12}}>
              <div style={{fontSize:9,color:"rgba(232,220,255,.4)",letterSpacing:1.5,marginBottom:7}}>{t.media}</div>
              {selNode.mediaData ? (
                <div>
                  <div style={{borderRadius:10,overflow:"hidden",marginBottom:6,border:"1px solid rgba(6,182,212,.25)",background:"rgba(6,182,212,.05)"}}>
                    <div style={{padding:"6px 10px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                      <span style={{fontSize:10,color:"#06b6d4"}}>
                        {selNode.mediaType?.startsWith("image")?"📷":selNode.mediaType?.startsWith("video")?"🎬":"🎵"} {selNode.mediaName||""}
                      </span>
                      <button onClick={removeNodeMedia} style={{background:"none",border:"none",cursor:"pointer",color:"rgba(239,68,68,.5)",fontSize:13,padding:0}}>×</button>
                    </div>
                    <div style={{padding:"0 10px 10px"}}>
                      {selNode.mediaType?.startsWith("image") && (
                        <img src={selNode.mediaData} alt={selNode.mediaName||""} style={{width:"100%",maxHeight:160,borderRadius:6,objectFit:"cover",display:"block"}} onError={()=>{}}/>
                      )}
                      {selNode.mediaType?.startsWith("video") && <video controls src={selNode.mediaData} style={{width:"100%",maxHeight:140,borderRadius:6,display:"block"}}/>}
                      {selNode.mediaType?.startsWith("audio") && <audio controls src={selNode.mediaData} style={{width:"100%",marginTop:4}}/>}
                    </div>
                  </div>
                  <button onClick={()=>nodeMediaRef.current?.click()} style={{width:"100%",padding:"6px 0",borderRadius:7,border:"1px solid rgba(6,182,212,.3)",background:"rgba(6,182,212,.08)",color:"#67e8f9",cursor:"pointer",fontSize:11,fontFamily:"inherit"}}>{t.replaceMedia}</button>
                </div>
              ) : (
                <button onClick={()=>nodeMediaRef.current?.click()} style={{width:"100%",padding:"8px 0",borderRadius:8,border:"1px dashed rgba(6,182,212,.3)",background:"rgba(6,182,212,.05)",color:"rgba(6,182,212,.7)",cursor:"pointer",fontSize:12,fontFamily:"inherit"}}>{t.addMedia}</button>
              )}
              <input ref={nodeMediaRef} type="file" accept="image/*,video/*" style={{display:"none"}} onChange={e=>{handleMediaFile(e.target.files[0],true);e.target.value='';}}/>
            </div>

            {/* ── Audio section ── */}
            <div style={{marginBottom:12}}>
              <div style={{fontSize:9,color:"rgba(232,220,255,.4)",letterSpacing:1.5,marginBottom:7}}>{t.audioSection}</div>

              {/* 1 — Uploading spinner */}
              {audioUploading ? (
                <div style={{display:"flex",alignItems:"center",gap:8,padding:"10px 12px",borderRadius:10,background:"rgba(168,85,247,.08)",border:"1px solid rgba(168,85,247,.2)"}}>
                  <div style={{
                    width:16,height:16,borderRadius:"50%",flexShrink:0,
                    border:"2px solid rgba(168,85,247,.3)",borderTopColor:"#a855f7",
                    animation:"spin 0.8s linear infinite",
                  }}/>
                  <span style={{fontSize:12,color:"rgba(168,85,247,.8)"}}>Saving audio…</span>
                </div>

              /* 2 — Recording in progress */
              ) : recording ? (
                <div style={{textAlign:"center"}}>
                  <div style={{
                    width:48,height:48,borderRadius:"50%",background:"rgba(239,68,68,.18)",
                    border:"2px solid #ef4444",display:"inline-flex",alignItems:"center",justifyContent:"center",
                    fontSize:20,marginBottom:6,cursor:"pointer",
                    animation:"pulse 1s ease-in-out infinite",
                  }} onClick={stopRecording}>⏹</div>
                  <div style={{fontSize:13,fontWeight:700,color:"#ef4444"}}>{fmtTime(audioSec)}</div>
                  {audioWarning && <div style={{fontSize:10,color:"#f87171",marginTop:2}}>{t.audioWarning}</div>}
                  <div style={{fontSize:10,color:"rgba(232,220,255,.35)",marginTop:2}}>{t.stopRecording}</div>
                </div>

              /* 3 — Audio player (existing URL) */
              ) : selNode.audioUrl ? (
                <div>
                  {/* Hidden audio element — controlled via JS */}
                  <audio
                    ref={audioElemRef}
                    src={selNode.audioUrl}
                    preload="metadata"
                    style={{display:"none"}}
                    onTimeUpdate={() => setAudioCurrent(audioElemRef.current?.currentTime || 0)}
                    onDurationChange={() => setAudioDuration(audioElemRef.current?.duration || 0)}
                    onEnded={() => setAudioPlaying(false)}
                    onPlay={() => setAudioPlaying(true)}
                    onPause={() => setAudioPlaying(false)}
                  />

                  {/* Player chrome */}
                  <div style={{borderRadius:10,padding:"10px 12px",background:"rgba(168,85,247,.08)",border:"1px solid rgba(168,85,247,.25)"}}>
                    {/* Top row: play/pause + progress + time */}
                    <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
                      {/* Play / Pause */}
                      <button
                        onClick={() => {
                          const el = audioElemRef.current;
                          if (!el) return;
                          audioPlaying ? el.pause() : el.play();
                        }}
                        style={{
                          width:32,height:32,borderRadius:"50%",flexShrink:0,cursor:"pointer",
                          border:"1px solid rgba(168,85,247,.55)",background:"rgba(168,85,247,.2)",
                          color:"#c084fc",fontSize:13,display:"flex",alignItems:"center",justifyContent:"center",
                        }}
                      >
                        {audioPlaying ? "⏸" : "▶"}
                      </button>

                      {/* Scrub bar */}
                      <div
                        style={{flex:1,height:5,borderRadius:3,background:"rgba(168,85,247,.18)",cursor:"pointer",position:"relative"}}
                        onClick={e => {
                          const el = audioElemRef.current;
                          if (!el || !audioDuration || !isFinite(audioDuration)) return;
                          const rect = e.currentTarget.getBoundingClientRect();
                          el.currentTime = ((e.clientX - rect.left) / rect.width) * audioDuration;
                        }}
                      >
                        <div style={{
                          position:"absolute",left:0,top:0,bottom:0,borderRadius:3,
                          background:"#a855f7",pointerEvents:"none",
                          width: `${audioDuration && isFinite(audioDuration) ? (audioCurrent / audioDuration) * 100 : 0}%`,
                          transition:"width 0.15s linear",
                        }}/>
                      </div>

                      {/* Time */}
                      <span style={{fontSize:10,color:"rgba(232,220,255,.5)",whiteSpace:"nowrap",flexShrink:0}}>
                        {fmtTime(Math.floor(audioCurrent))} / {fmtTime(Math.floor(isFinite(audioDuration) ? audioDuration : 0))}
                      </span>
                    </div>

                    {/* Bottom row: Re-record + Delete */}
                    <div style={{display:"flex",gap:6}}>
                      <button onClick={reRecord}
                        style={{flex:1,padding:"5px 0",borderRadius:7,cursor:"pointer",fontSize:11,fontFamily:"inherit",
                          border:"1px solid rgba(168,85,247,.35)",background:"rgba(168,85,247,.1)",color:"#c084fc"}}>
                        🔄 Re-record
                      </button>
                      <button onClick={deleteAudio}
                        style={{flex:1,padding:"5px 0",borderRadius:7,cursor:"pointer",fontSize:11,fontFamily:"inherit",
                          border:"1px solid rgba(239,68,68,.3)",background:"rgba(239,68,68,.08)",color:"#f87171"}}>
                        🗑 {t.deleteAudio}
                      </button>
                    </div>
                  </div>
                </div>

              /* 4 — No audio yet: show record button */
              ) : (
                <button onClick={startRecording}
                  style={{width:"100%",padding:"8px 0",borderRadius:8,border:"1px dashed rgba(168,85,247,.35)",background:"rgba(168,85,247,.07)",color:"rgba(168,85,247,.8)",cursor:"pointer",fontSize:12,fontFamily:"inherit"}}>
                  {t.recordAudio}
                </button>
              )}

              {/* Upload status box — visible during and after upload */}
              {audioUploadStatus ? (
                <div style={{
                  marginTop:8,padding:"6px 10px",borderRadius:7,fontSize:11,
                  background: audioUploadStatus === "Upload success"
                    ? "rgba(34,197,94,.1)"
                    : audioUploadStatus.startsWith("Uploading")
                      ? "rgba(168,85,247,.08)"
                      : "rgba(239,68,68,.1)",
                  border: `1px solid ${
                    audioUploadStatus === "Upload success"
                      ? "rgba(34,197,94,.3)"
                      : audioUploadStatus.startsWith("Uploading")
                        ? "rgba(168,85,247,.2)"
                        : "rgba(239,68,68,.3)"
                  }`,
                  color: audioUploadStatus === "Upload success"
                    ? "#4ade80"
                    : audioUploadStatus.startsWith("Uploading")
                      ? "rgba(168,85,247,.85)"
                      : "#f87171",
                }}>
                  {audioUploadStatus}
                </div>
              ) : null}
            </div>

            {/* Bloom progress */}
            <div style={{marginBottom:12}}>
              <div style={{fontSize:9,color:"rgba(232,220,255,.4)",letterSpacing:1.5,marginBottom:6}}>{t.bloomProgress}</div>
              <div style={{display:"flex",gap:3,marginBottom:6}}>
                {BLOOM.map(b=>(
                  <div key={b.level} title={`L${b.level} ${b.name}`} style={{flex:1,height:7,borderRadius:4,background:selNode.bloomLevel>=b.level?b.color:"rgba(255,255,255,0.08)",transition:"background .3s"}}/>
                ))}
              </div>
              <div style={{display:"flex",gap:5}}>
                <button onClick={()=>downgradeBloom(selNode.id)} disabled={selNode.bloomLevel<=1}
                  style={{padding:"5px 10px",borderRadius:6,border:"1px solid rgba(255,255,255,.15)",background:"rgba(255,255,255,.04)",color:"rgba(232,220,255,.5)",cursor:selNode.bloomLevel>1?"pointer":"default",fontSize:12}}>
                  {t.bloomUndo}
                </button>
                <button onClick={()=>upgradeBloom(selNode.id)} disabled={selNode.bloomLevel>=6}
                  style={{flex:1,padding:"5px 0",borderRadius:6,border:`1px solid ${selB.color}50`,background:`${selB.color}18`,color:selB.color,cursor:selNode.bloomLevel<6?"pointer":"default",fontSize:12,fontWeight:700}}>
                  {selNode.bloomLevel<6 ? t.bloomUpgrade(BLOOM[selNode.bloomLevel].name) : t.bloomMax}
                </button>
              </div>
            </div>

            {/* Connections list */}
            {edges.filter(e=>e.from===selNode.id||e.to===selNode.id).length > 0 && (
              <div style={{marginBottom:12}}>
                <div style={{fontSize:9,color:"rgba(232,220,255,.4)",letterSpacing:1.5,marginBottom:7}}>{t.synapseSection(edges.filter(e=>e.from===selNode.id||e.to===selNode.id).length)}</div>
                {edges.filter(e=>e.from===selNode.id||e.to===selNode.id).map(edge=>{
                  const otherId=edge.from===selNode.id?edge.to:edge.from;
                  const other=nodes.find(n=>n.id===otherId);
                  if (!other) return null;
                  const ob=getB(other.bloomLevel);
                  return (
                    <div key={edge.id} style={{display:"flex",alignItems:"center",gap:6,padding:"5px 9px",borderRadius:7,marginBottom:4,background:"rgba(255,255,255,0.04)",fontSize:11}}>
                      <span>{ob.icon}</span>
                      <span style={{color:ob.color,fontWeight:600}}>{other.label}</span>
                      <span style={{color:"rgba(232,220,255,.3)",flex:1,fontSize:10}}>{edge.from===selNode.id?"→":"←"} {edge.label}</span>
                      <button onClick={()=>{setEdges(p=>p.filter(e=>e.id!==edge.id));deleteDoc(doc(edgesCol,edge.id)).catch(()=>{});}} style={{background:"none",border:"none",cursor:"pointer",color:"rgba(239,68,68,.5)",fontSize:13,padding:0,lineHeight:1}}>×</button>
                    </div>
                  );
                })}
              </div>
            )}

            <div style={{display:"flex",gap:7}}>
              <button onClick={()=>{setMode("connect");setSelected(null);setConnecting(selNode.id);}}
                style={{flex:1,padding:"8px 0",borderRadius:8,border:"1px solid rgba(99,102,241,.5)",background:"rgba(99,102,241,.15)",color:"#818cf8",cursor:"pointer",fontSize:12,fontWeight:600}}>
                {t.connectBtn}
              </button>
              <button onClick={()=>deleteNode(selNode.id)} style={{padding:"8px 13px",borderRadius:8,border:"1px solid rgba(239,68,68,.3)",background:"rgba(239,68,68,.1)",color:"#f87171",cursor:"pointer",fontSize:13}}>{t.deleteBtn}</button>
            </div>
          </div>
        )}

        {/* ── CONNECT HINTS ── */}
        {mode==="connect" && (
          <div style={{position:"absolute",bottom:52,left:"50%",transform:"translateX(-50%)",background:"rgba(168,85,247,0.18)",border:"1px solid rgba(168,85,247,.55)",borderRadius:12,padding:"9px 20px",fontSize:13,color:"#c084fc",backdropFilter:"blur(12px)",textAlign:"center",pointerEvents:"none",zIndex:5}}>
            {connecting ? t.connectModeActive(nodes.find(n=>n.id===connecting)?.label||"") : t.connectModeIdle}
          </div>
        )}
        {mode==="connect" && connecting && (
          <div style={{position:"absolute",bottom:96,left:"50%",transform:"translateX(-50%)",display:"flex",gap:8,zIndex:5}}>
            <input value={connLabel} onChange={e=>setConnLabel(e.target.value)} list="rel-labels"
              placeholder="Link label…"
              style={{padding:"7px 14px",borderRadius:8,border:"1px solid rgba(168,85,247,.4)",background:"rgba(10,5,30,.85)",color:"#e8dcff",fontSize:12,outline:"none",width:240,fontFamily:"inherit"}}/>
            <datalist id="rel-labels">{REL_LABELS.map(l=><option key={l} value={l}/>)}</datalist>
          </div>
        )}

        {/* ── ZOOM HUD ── */}
        <div style={{position:"absolute",bottom:14,right:14,display:"flex",gap:4,alignItems:"center",zIndex:5}}>
          <button onClick={()=>setCam(c=>({...c,scale:Math.min(c.scale*1.2,MAX_SCALE)}))}
            style={{width:28,height:28,borderRadius:6,border:"1px solid rgba(255,255,255,.12)",background:"rgba(0,0,0,.4)",color:"#e8dcff",cursor:"pointer",fontSize:16,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"inherit"}}>+</button>
          <div style={{minWidth:44,textAlign:"center",fontSize:11,color:"rgba(232,220,255,.45)",background:"rgba(0,0,0,.4)",borderRadius:6,padding:"4px 6px",border:"1px solid rgba(255,255,255,.08)"}}>{zoomPct}%</div>
          <button onClick={()=>setCam(c=>({...c,scale:Math.max(c.scale/1.2,MIN_SCALE)}))}
            style={{width:28,height:28,borderRadius:6,border:"1px solid rgba(255,255,255,.12)",background:"rgba(0,0,0,.4)",color:"#e8dcff",cursor:"pointer",fontSize:16,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"inherit"}}>−</button>
        </div>
      </div>

      {/* ── ADD NODE MODAL ──────────────────────────────────────── */}
      {showAdd && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.75)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:200,padding:16}}
          onClick={()=>{setShowAdd(false);setMediaForm(null);}}>
          <div style={{background:"linear-gradient(160deg,#110828 0%,#0d0620 100%)",border:"1px solid rgba(168,85,247,.35)",borderRadius:20,padding:28,width:"100%",maxWidth:440,maxHeight:"90vh",overflowY:"auto",boxShadow:"0 0 70px rgba(168,85,247,.2)"}}
            onClick={e=>e.stopPropagation()}>
            <div style={{fontSize:19,fontWeight:800,color:"#fff",marginBottom:20}}>{t.addNeuronTitle}</div>

            {/* Text fields */}
            {[
              {label:t.labelField,     key:"label",       ph:t.labelPh,   ta:false},
              {label:t.descField,      key:"description", ph:t.descPh,    ta:true },
              {label:t.emotionField,   key:"emotion",     ph:t.emotionPh, ta:false},
            ].map(f=>(
              <div key={f.key} style={{marginBottom:14}}>
                <div style={{fontSize:10,color:"rgba(232,220,255,.5)",letterSpacing:1,marginBottom:5}}>{f.label}</div>
                {f.ta
                  ? <textarea value={form[f.key]} onChange={e=>setForm(p=>({...p,[f.key]:e.target.value}))} placeholder={f.ph} rows={2}
                      style={{width:"100%",padding:"9px 13px",borderRadius:9,resize:"none",border:"1px solid rgba(255,255,255,.1)",background:"rgba(255,255,255,.05)",color:"#fff",fontSize:13,outline:"none",fontFamily:"inherit",boxSizing:"border-box"}}/>
                  : <input value={form[f.key]} onChange={e=>setForm(p=>({...p,[f.key]:e.target.value}))} placeholder={f.ph}
                      style={{width:"100%",padding:"9px 13px",borderRadius:9,border:"1px solid rgba(255,255,255,.1)",background:"rgba(255,255,255,.05)",color:"#fff",fontSize:13,outline:"none",fontFamily:"inherit",boxSizing:"border-box"}}/>
                }
              </div>
            ))}

            {/* Topic */}
            <div style={{marginBottom:14}}>
              <div style={{fontSize:10,color:"rgba(232,220,255,.5)",letterSpacing:1,marginBottom:5}}>{t.topicField}</div>
              <div style={{display:"flex",flexWrap:"wrap",gap:5}}>
                {topics.filter(tp => tp.id !== "all").map(tp => (
                  <button key={tp.id} onClick={()=>setForm(p=>({...p,topicId:tp.id}))}
                    style={{
                      padding:"4px 10px",borderRadius:999,cursor:"pointer",fontSize:11,
                      border:`1px solid ${form.topicId===tp.id ? tp.color : tp.color+"40"}`,
                      background: form.topicId===tp.id ? `${tp.color}25` : "transparent",
                      color: form.topicId===tp.id ? tp.color : "rgba(232,220,255,.45)",
                      fontFamily:"inherit",
                    }}>
                    {tp.emoji} {tp.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Media */}
            <div style={{marginBottom:14}}>
              <div style={{fontSize:10,color:"rgba(232,220,255,.5)",letterSpacing:1,marginBottom:5}}>{t.media} (optional)</div>
              {mediaForm ? (
                <div style={{borderRadius:10,border:"1px solid rgba(6,182,212,.3)",background:"rgba(6,182,212,.06)",overflow:"hidden"}}>
                  <div style={{padding:"6px 12px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                    <span style={{fontSize:11,color:"#06b6d4"}}>{mediaForm.type==="image"?"📷":mediaForm.type==="video"?"🎬":"🎵"} {mediaForm.name}</span>
                    <button onClick={()=>setMediaForm(null)} style={{background:"none",border:"none",cursor:"pointer",color:"rgba(239,68,68,.6)",fontSize:14,padding:0}}>×</button>
                  </div>
                  {mediaForm.type==="image" && <img src={mediaForm.data} alt={mediaForm.name} style={{width:"100%",maxHeight:140,objectFit:"cover",display:"block"}}/>}
                  {mediaForm.type==="video" && <video controls src={mediaForm.data} style={{width:"100%",maxHeight:120,display:"block"}}/>}
                </div>
              ) : (
                <button onClick={()=>mediaInputRef.current?.click()} style={{width:"100%",padding:"9px 0",borderRadius:9,border:"1px dashed rgba(6,182,212,.3)",background:"rgba(6,182,212,.04)",color:"rgba(6,182,212,.7)",cursor:"pointer",fontSize:12,fontFamily:"inherit"}}>{t.attachMedia}</button>
              )}
              <input ref={mediaInputRef} type="file" accept="image/*,video/*" style={{display:"none"}} onChange={e=>{handleMediaFile(e.target.files[0],false);e.target.value='';}}/>
            </div>

            {/* Bloom selector */}
            <div style={{marginBottom:22}}>
              <div style={{fontSize:10,color:"rgba(232,220,255,.5)",letterSpacing:1,marginBottom:8}}>{t.bloomField}</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:6}}>
                {BLOOM.map(b=>(
                  <button key={b.level} onClick={()=>setForm(p=>({...p,bloomLevel:b.level}))}
                    style={{padding:"9px 4px",borderRadius:9,cursor:"pointer",textAlign:"center",border:`1px solid ${form.bloomLevel===b.level?b.color:"rgba(255,255,255,.1)"}`,background:form.bloomLevel===b.level?`${b.color}22`:"transparent",color:form.bloomLevel===b.level?b.color:"rgba(232,220,255,.4)",fontFamily:"inherit",transition:"all .15s"}}>
                    <div style={{fontSize:16,marginBottom:3}}>{b.icon}</div>
                    <div style={{fontSize:9,fontWeight:700,letterSpacing:.5}}>L{b.level} {b.name}</div>
                  </button>
                ))}
              </div>
            </div>

            <div style={{display:"flex",gap:10}}>
              <button onClick={()=>{setShowAdd(false);setMediaForm(null);}} style={{flex:1,padding:"12px 0",borderRadius:10,border:"1px solid rgba(255,255,255,.1)",background:"transparent",color:"rgba(232,220,255,.45)",cursor:"pointer",fontSize:14,fontFamily:"inherit"}}>{t.cancel}</button>
              <button onClick={addNode} style={{flex:2,padding:"12px 0",borderRadius:10,border:"none",background:"linear-gradient(135deg,#a855f7,#6366f1)",color:"#fff",cursor:"pointer",fontSize:15,fontWeight:800,fontFamily:"inherit"}}>{t.addToBrain}</button>
            </div>
          </div>
        </div>
      )}

      {/* ── FOOTER ─────────────────────────────────────────────── */}
      <div style={{padding:"8px 18px",borderTop:"1px solid rgba(255,255,255,0.05)",background:"rgba(0,0,0,.2)",display:"flex",gap:14,flexWrap:"wrap",fontSize:10,color:"rgba(232,220,255,0.28)",letterSpacing:.5,flexShrink:0}}>
        <span>{t.footerPan}</span>
        <span>{t.footerZoom}</span>
        <span>{t.footerConnect}</span>
        <span>{t.footerSynapse}</span>
        <span>{t.footerFit}</span>
        <span style={{marginLeft:"auto"}}>Ngan's Brain • {new Date().getFullYear()}</span>
      </div>

      {/* ── Pulse animation for recording button ── */}
      <style>{`
        @keyframes pulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(239,68,68,0.6); }
          50% { box-shadow: 0 0 0 10px rgba(239,68,68,0); }
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        @keyframes bubblePulse {
          0%, 100% { opacity: 0.4; r: 52; }
          50%       { opacity: 0.15; r: 62; }
        }
      `}</style>
    </div>
  );
}
