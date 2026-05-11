import { useState, useEffect, useRef } from "react";

const BLOOM = [
  { level: 1, name: "Remember",  vi: "Nhớ",        color: "#94a3b8", icon: "🌱", desc: "Tôi biết nó tồn tại" },
  { level: 2, name: "Understand",vi: "Hiểu",        color: "#eab308", icon: "💡", desc: "Tôi giải thích được" },
  { level: 3, name: "Apply",     vi: "Vận dụng",    color: "#3b82f6", icon: "🔧", desc: "Tôi dùng được trong thực tế" },
  { level: 4, name: "Analyze",   vi: "Phân tích",   color: "#a855f7", icon: "🔍", desc: "Tôi hiểu tại sao nó hoạt động" },
  { level: 5, name: "Evaluate",  vi: "Đánh giá",    color: "#f97316", icon: "⚡", desc: "Tôi biết khi nào dùng, khi nào không" },
  { level: 6, name: "Create",    vi: "Sáng tạo",    color: "#ef4444", icon: "🚀", desc: "Tôi tạo ra cái mới từ kiến thức này" },
];

const CATS = ["IELTS Grammar","IELTS Vocabulary","Teaching Method","Psychology","Life Experience","Business","Other"];

const REL_LABELS = ["same pattern","causes","opposite of","helps explain","relates to","triggers","based on"];

const INIT_NODES = [
  { id:"n1", label:"Association",        category:"Teaching Method",  bloomLevel:5, description:"Link new info to existing memories & emotions — my core teaching technique", emotion:"✨ Excitement khi student nói 'I GET IT!'", x:420, y:220 },
  { id:"n2", label:"Relative Clauses",   category:"IELTS Grammar",    bloomLevel:3, description:"who / which / that — gộp 2 câu ngắn thành 1 câu phức. Band 5→6 essential.", emotion:"😮 Cảm giác 'aha' lần đầu mình hiểu cái này", x:200, y:150 },
  { id:"n3", label:"Eliciting",          category:"Teaching Method",  bloomLevel:4, description:"Hỏi TRƯỚC khi nói. Buộc học sinh phải tự suy nghĩ trước.", emotion:"💬 Johnson hay hỏi mình về ngày hôm nay thay vì nói luôn", x:630, y:160 },
  { id:"n4", label:"Collocations",       category:"IELTS Vocabulary", bloomLevel:2, description:"Fixed word partnerships. heavy rain NOT strong rain.", emotion:"😅 Ngại khi mình từng nói 'do a mistake' trước mặt sếp", x:170, y:370 },
  { id:"n5", label:"STM → LTM",          category:"Psychology",       bloomLevel:3, description:"Cảm xúc + Lặp lại = Ghi nhớ dài hạn (Long-term memory)", emotion:"❤️ Mọi kỷ niệm với Johnson đều ở trong long-term memory", x:530, y:400 },
  { id:"n6", label:"Bloom's Taxonomy",   category:"Psychology",       bloomLevel:2, description:"Nhớ→Hiểu→Vận dụng→Phân tích→Đánh giá→Sáng tạo", emotion:"🌱 Giống trồng cây — mỗi giai đoạn cần thời gian riêng", x:340, y:420 },
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
  'its','our','not','not','have','has','had','will','would','could','should',
  'tôi','mình','bạn','khi','một','trong','được','của','là','và','có','không',
  'cho','với','này','đó','khi','các','những','hay','cái','nó'
]);

const getB = (lvl) => BLOOM[Math.min(Math.max((lvl||1)-1,0),5)];

function btn(active, color) {
  return {
    padding:"8px 16px", borderRadius:8, cursor:"pointer",
    border:`1px solid ${active ? color : "rgba(255,255,255,0.12)"}`,
    background: active ? `${color}28` : "rgba(255,255,255,0.04)",
    color: active ? color : "rgba(232,220,255,0.6)",
    fontSize:13, fontWeight:600, whiteSpace:"nowrap",
    fontFamily:"inherit", transition:"all 0.15s"
  };
}

function getKeywords(node) {
  const text = `${node.label} ${node.description || ''}`.toLowerCase();
  return text.split(/\W+/).filter(w => w.length >= 3 && !STOP_WORDS.has(w));
}

function inferRelLabel(n1, n2) {
  const t = `${n1.label} ${n1.description||''} ${n2.label} ${n2.description||''}`.toLowerCase();
  if (/caus|trigger|lead|kích|dẫn|triggers/.test(t)) return 'causes';
  if (/oppos|ngược|contrari|versus/.test(t)) return 'opposite of';
  if (/explain|giải thích|hỗ trợ|basis|based/.test(t)) return 'helps explain';
  if (n1.category === n2.category) return 'same pattern';
  return 'relates to';
}

export default function BrainNetwork() {
  const [nodes, setNodes]           = useState(INIT_NODES);
  const [edges, setEdges]           = useState(INIT_EDGES);
  const [mode, setMode]             = useState("view");
  const [selected, setSelected]     = useState(null);
  const [connecting, setConnecting] = useState(null);
  const [drag, setDrag]             = useState(null);
  const [showAdd, setShowAdd]       = useState(false);
  const [hoverEdge, setHoverEdge]   = useState(null);
  const [loaded, setLoaded]         = useState(false);
  const [connLabel, setConnLabel]   = useState("relates to");
  const [form, setForm]             = useState({ label:"", category:"IELTS Grammar", bloomLevel:1, description:"", emotion:"" });

  // New feature state
  const [suggestions, setSuggestions]       = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [nodeMedia, setNodeMedia]           = useState(null);
  const [mediaForm, setMediaForm]           = useState(null);

  const svgRef       = useRef(null);
  const mediaInputRef = useRef(null);
  const nodeMediaRef  = useRef(null);
  const svgW = 820, svgH = 520;

  // ── Storage ────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const n = await window.storage.get("brain-v3-nodes");
        const e = await window.storage.get("brain-v3-edges");
        if (n?.value) setNodes(JSON.parse(n.value));
        if (e?.value) setEdges(JSON.parse(e.value));
      } catch {}
      setLoaded(true);
    })();
  }, []);

  useEffect(() => {
    if (!loaded) return;
    window.storage.set("brain-v3-nodes", JSON.stringify(nodes)).catch(()=>{});
    window.storage.set("brain-v3-edges", JSON.stringify(edges)).catch(()=>{});
  }, [nodes, edges, loaded]);

  // Load media for selected node
  useEffect(() => {
    if (!selected) { setNodeMedia(null); return; }
    (async () => {
      try {
        const m = await window.storage.get(`brain-v3-media-${selected}`);
        setNodeMedia(m?.value ? JSON.parse(m.value) : null);
      } catch { setNodeMedia(null); }
    })();
  }, [selected]);

  // ── SVG helpers ────────────────────────────────
  const getSVGPt = (e) => {
    const rect = svgRef.current.getBoundingClientRect();
    const scaleX = svgW / rect.width;
    const scaleY = svgH / rect.height;
    return { x:(e.clientX - rect.left)*scaleX, y:(e.clientY - rect.top)*scaleY };
  };

  // ── Drag ───────────────────────────────────────
  const onNodePD = (e, id) => {
    e.stopPropagation();
    if (mode==="connect") return;
    const node = nodes.find(n=>n.id===id);
    const pt = getSVGPt(e);
    setDrag({ id, ox:pt.x-node.x, oy:pt.y-node.y, moved:false });
  };

  const onSVGMM = (e) => {
    if (!drag) return;
    const pt = getSVGPt(e);
    const x = Math.max(55, Math.min(svgW-55, pt.x - drag.ox));
    const y = Math.max(40, Math.min(svgH-50, pt.y - drag.oy));
    setNodes(prev => prev.map(n => n.id===drag.id ? {...n,x,y} : n));
    setDrag(d => ({...d, moved:true}));
  };

  const onSVGMU = () => { setDrag(null); };

  // ── Click ─────────────────────────────────────
  const onNodeClick = (e, id) => {
    e.stopPropagation();
    if (drag?.moved) return;
    if (mode==="connect") {
      if (!connecting) { setConnecting(id); return; }
      if (connecting===id) { setConnecting(null); return; }
      const exists = edges.find(ed=>(ed.from===connecting&&ed.to===id)||(ed.from===id&&ed.to===connecting));
      if (!exists) setEdges(prev=>[...prev,{id:`e${Date.now()}`,from:connecting,to:id,label:connLabel||"relates to"}]);
      setConnecting(null);
      setConnLabel("relates to");
      setMode("view");
    } else {
      setSelected(id===selected ? null : id);
    }
  };

  const onSVGClick = () => {
    if (mode==="connect") { setConnecting(null); return; }
    setSelected(null);
  };

  // ── Auto Synaptic Connections ──────────────────
  const findAutoSynapses = () => {
    const newSugs = [];
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const n1 = nodes[i], n2 = nodes[j];
        const exists = edges.find(e =>
          (e.from===n1.id && e.to===n2.id) || (e.from===n2.id && e.to===n1.id)
        );
        if (exists) continue;

        const kw1 = new Set(getKeywords(n1));
        const kw2 = new Set(getKeywords(n2));
        const sharedKw = [...kw1].filter(k => kw2.has(k));

        const a1 = (n1.emotion||'').toLowerCase().split(/\W+/).filter(w => w.length >= 4 && !STOP_WORDS.has(w));
        const a2 = new Set((n2.emotion||'').toLowerCase().split(/\W+/).filter(w => w.length >= 4 && !STOP_WORDS.has(w)));
        const sharedAnchor = a1.filter(w => a2.has(w));

        if (sharedKw.length >= 2 || sharedAnchor.length >= 1) {
          newSugs.push({
            id: `sug-${n1.id}-${n2.id}`,
            from: n1.id, to: n2.id,
            label: inferRelLabel(n1, n2),
            reason: sharedKw.length >= 2
              ? `Shared keywords: "${sharedKw.slice(0,3).join('", "')}"`
              : `Similar emotional anchor: "${sharedAnchor.slice(0,2).join('", "')}"`,
          });
        }
      }
    }
    setSuggestions(newSugs);
    setShowSuggestions(true);
  };

  const acceptSuggestion = (sug) => {
    setEdges(prev => [...prev, { id:`e${Date.now()}`, from:sug.from, to:sug.to, label:sug.label }]);
    setSuggestions(prev => prev.filter(s => s.id !== sug.id));
  };

  const rejectSuggestion = (id) => setSuggestions(prev => prev.filter(s => s.id !== id));

  const updateSugLabel = (id, label) =>
    setSuggestions(prev => prev.map(s => s.id===id ? {...s, label} : s));

  // ── Media ──────────────────────────────────────
  const handleMediaFile = (file, isExisting) => {
    if (!file) return;
    const mediaType = file.type.split('/')[0]; // image | video | audio
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const media = { type: mediaType, name: file.name, data: ev.target.result };
      if (isExisting && selected) {
        await window.storage.set(`brain-v3-media-${selected}`, JSON.stringify(media)).catch(()=>{});
        setNodes(p => p.map(n => n.id===selected ? {...n, hasMedia:true, mediaType} : n));
        setNodeMedia(media);
      } else {
        setMediaForm(media);
      }
    };
    reader.readAsDataURL(file);
  };

  const removeNodeMedia = async () => {
    if (!selected) return;
    await window.storage.set(`brain-v3-media-${selected}`, "").catch(()=>{});
    setNodes(p => p.map(n => n.id===selected ? {...n, hasMedia:false, mediaType:undefined} : n));
    setNodeMedia(null);
  };

  // ── Mutations ─────────────────────────────────
  const addNode = () => {
    if (!form.label.trim()) return;
    const id = `n${Date.now()}`;
    const nodeData = { ...form, id, x:280+Math.random()*220, y:180+Math.random()*140 };
    if (mediaForm) {
      nodeData.hasMedia = true;
      nodeData.mediaType = mediaForm.type;
      window.storage.set(`brain-v3-media-${id}`, JSON.stringify(mediaForm)).catch(()=>{});
    }
    setNodes(prev => [...prev, nodeData]);
    setForm({ label:"", category:"IELTS Grammar", bloomLevel:1, description:"", emotion:"" });
    setMediaForm(null);
    setShowAdd(false);
    setSelected(id);
  };

  const deleteNode = (id) => {
    setNodes(p=>p.filter(n=>n.id!==id));
    setEdges(p=>p.filter(e=>e.from!==id&&e.to!==id));
    window.storage.set(`brain-v3-media-${id}`, "").catch(()=>{});
    setSelected(null);
  };

  const upgradeBloom   = (id) => setNodes(p=>p.map(n=>n.id===id&&n.bloomLevel<6?{...n,bloomLevel:n.bloomLevel+1}:n));
  const downgradeBloom = (id) => setNodes(p=>p.map(n=>n.id===id&&n.bloomLevel>1?{...n,bloomLevel:n.bloomLevel-1}:n));

  // ── Edge path ─────────────────────────────────
  const edgePath = (edge) => {
    const f=nodes.find(n=>n.id===edge.from), t=nodes.find(n=>n.id===edge.to);
    if(!f||!t) return null;
    const dx=t.x-f.x, dy=t.y-f.y, dist=Math.sqrt(dx*dx+dy*dy)||1;
    const nx=dx/dist, ny=dy/dist, r=30;
    const sx=f.x+nx*r, sy=f.y+ny*r, ex=t.x-nx*r, ey=t.y-ny*r;
    const cx=(sx+ex)/2 - ny*50, cy=(sy+ey)/2 + nx*50;
    const mx=(sx+2*cx+ex)/4, my=(sy+2*cy+ey)/4;
    return { path:`M${sx},${sy} Q${cx},${cy} ${ex},${ey}`, mx, my };
  };

  const connCount = (id) => edges.filter(e=>e.from===id||e.to===id).length;
  const selNode   = nodes.find(n=>n.id===selected);
  const selB      = selNode ? getB(selNode.bloomLevel) : null;
  const avgBloom  = nodes.length ? (nodes.reduce((a,n)=>a+n.bloomLevel,0)/nodes.length).toFixed(1) : 0;

  // ── Media preview renderer ─────────────────────
  const MediaPreview = ({ media, compact }) => {
    if (!media?.data) return null;
    const maxH = compact ? 120 : 180;
    const style = { width:"100%", maxHeight:maxH, borderRadius:8, objectFit:"cover", display:"block" };
    if (media.type === "image") return <img src={media.data} alt={media.name} style={style}/>;
    if (media.type === "video") return (
      <video controls src={media.data} style={style}/>
    );
    if (media.type === "audio") return (
      <audio controls src={media.data} style={{ width:"100%", marginTop:4 }}/>
    );
    return null;
  };

  return (
    <div style={{
      minHeight:"100vh", width:"100%",
      background:"radial-gradient(ellipse at 25% 40%, #1a0f3c 0%, #0d0820 55%, #050310 100%)",
      fontFamily:"'Segoe UI',system-ui,sans-serif", color:"#e8dcff",
      display:"flex", flexDirection:"column", userSelect:"none", overflowX:"hidden"
    }}>

      {/* ── HEADER ─────────────────────────────── */}
      <div style={{
        padding:"14px 20px 12px", borderBottom:"1px solid rgba(255,255,255,0.07)",
        background:"rgba(0,0,0,0.35)", backdropFilter:"blur(12px)",
        display:"flex", justifyContent:"space-between", alignItems:"center", flexWrap:"wrap", gap:10
      }}>
        <div>
          <div style={{fontSize:10,letterSpacing:4,color:"#a855f7",marginBottom:2}}>NGAN'S BRAIN</div>
          <div style={{fontSize:22,fontWeight:800,color:"#fff",lineHeight:1.1}}>🧠 Knowledge Network</div>
        </div>

        <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
          <button onClick={()=>{setMode("view");setConnecting(null);}} style={btn(mode==="view","#6366f1")}>👁 View</button>
          <button onClick={()=>{setMode("connect");setSelected(null);}} style={btn(mode==="connect","#a855f7")}>
            {mode==="connect"&&connecting
              ? `⚡ "${nodes.find(n=>n.id===connecting)?.label}" → chọn node tiếp theo`
              : "🔗 Connect"}
          </button>
          <button onClick={()=>setShowAdd(true)} style={btn(false,"#22c55e")}>＋ Add Neuron</button>
          <button onClick={findAutoSynapses} style={btn(showSuggestions,"#f59e0b")}>
            💡 Auto Synapse
          </button>
        </div>

        <div style={{display:"flex",gap:20}}>
          {[
            {n:nodes.length,  label:"NEURONS"},
            {n:edges.length,  label:"SYNAPSES"},
            {n:avgBloom,      label:"AVG BLOOM"},
          ].map(s=>(
            <div key={s.label} style={{textAlign:"center"}}>
              <div style={{fontSize:20,fontWeight:800,color:"#a855f7"}}>{s.n}</div>
              <div style={{fontSize:9,color:"rgba(232,220,255,0.4)",letterSpacing:1}}>{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── BLOOM LEGEND ───────────────────────── */}
      <div style={{display:"flex",gap:6,padding:"8px 16px",overflowX:"auto",background:"rgba(0,0,0,0.25)",borderBottom:"1px solid rgba(255,255,255,0.04)",flexShrink:0}}>
        {BLOOM.map(b=>(
          <div key={b.level} style={{
            display:"flex",alignItems:"center",gap:5,padding:"3px 11px",borderRadius:999,
            background:`${b.color}15`,border:`1px solid ${b.color}40`,
            fontSize:11,whiteSpace:"nowrap",color:b.color,flexShrink:0
          }}>
            <span>{b.icon}</span>
            <span style={{fontWeight:700}}>L{b.level}</span>
            <span style={{opacity:.75}}>{b.vi}</span>
          </div>
        ))}
      </div>

      {/* ── AUTO SYNAPSE PANEL ─────────────────── */}
      {showSuggestions && (
        <div style={{
          background:"rgba(0,0,0,0.4)", borderBottom:"1px solid rgba(245,158,11,.25)",
          padding:"12px 20px", backdropFilter:"blur(8px)"
        }}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
            <div style={{fontSize:13,fontWeight:700,color:"#f59e0b"}}>
              💡 Auto Synapse Suggestions
              <span style={{fontWeight:400,color:"rgba(232,220,255,.5)",marginLeft:8,fontSize:11}}>
                {suggestions.length} connection{suggestions.length!==1?"s":""} found
              </span>
            </div>
            <button onClick={()=>setShowSuggestions(false)}
              style={{background:"none",border:"none",color:"rgba(232,220,255,.4)",cursor:"pointer",fontSize:18,lineHeight:1}}>×</button>
          </div>

          {suggestions.length === 0 ? (
            <div style={{fontSize:12,color:"rgba(232,220,255,.4)",fontStyle:"italic"}}>
              No new suggestions — all shared-keyword neurons are already connected.
            </div>
          ) : (
            <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
              {suggestions.map(sug => {
                const fn = nodes.find(n=>n.id===sug.from);
                const tn = nodes.find(n=>n.id===sug.to);
                if (!fn||!tn) return null;
                const fb = getB(fn.bloomLevel), tb = getB(tn.bloomLevel);
                return (
                  <div key={sug.id} style={{
                    background:"rgba(245,158,11,0.07)",border:"1px solid rgba(245,158,11,.25)",
                    borderRadius:12, padding:"10px 14px", minWidth:260, maxWidth:340,
                    display:"flex",flexDirection:"column",gap:6
                  }}>
                    <div style={{display:"flex",alignItems:"center",gap:6,fontSize:12}}>
                      <span style={{color:fb.color,fontWeight:700}}>{fb.icon} {fn.label}</span>
                      <span style={{color:"rgba(232,220,255,.35)"}}>→</span>
                      <span style={{color:tb.color,fontWeight:700}}>{tb.icon} {tn.label}</span>
                    </div>
                    <div style={{fontSize:10,color:"rgba(232,220,255,.45)",lineHeight:1.4}}>{sug.reason}</div>
                    <div style={{display:"flex",alignItems:"center",gap:6}}>
                      <select
                        value={sug.label}
                        onChange={e=>updateSugLabel(sug.id, e.target.value)}
                        style={{
                          flex:1,padding:"4px 8px",borderRadius:6,fontSize:11,
                          border:"1px solid rgba(245,158,11,.3)",background:"#0d0820",
                          color:"#f59e0b",outline:"none",fontFamily:"inherit"
                        }}>
                        {REL_LABELS.map(l=><option key={l} value={l}>{l}</option>)}
                      </select>
                      <button onClick={()=>acceptSuggestion(sug)}
                        style={{padding:"4px 10px",borderRadius:6,border:"1px solid rgba(34,197,94,.4)",
                          background:"rgba(34,197,94,.12)",color:"#4ade80",cursor:"pointer",fontSize:11,fontWeight:700,fontFamily:"inherit"}}>
                        ✓ Accept
                      </button>
                      <button onClick={()=>rejectSuggestion(sug.id)}
                        style={{padding:"4px 8px",borderRadius:6,border:"none",
                          background:"rgba(255,255,255,.04)",color:"rgba(232,220,255,.35)",cursor:"pointer",fontSize:12,fontFamily:"inherit"}}>
                        ✕
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── CANVAS + PANEL ─────────────────────── */}
      <div style={{flex:1,display:"flex",position:"relative",minHeight:520}}>

        {/* SVG */}
        <svg ref={svgRef}
          viewBox={`0 0 ${svgW} ${svgH}`}
          style={{flex:1,cursor:mode==="connect"?"crosshair":"default",display:"block",minHeight:520}}
          onMouseMove={onSVGMM} onMouseUp={onSVGMU}
          onMouseLeave={onSVGMU} onClick={onSVGClick}
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
            <pattern id="grid" x="0" y="0" width="28" height="28" patternUnits="userSpaceOnUse">
              <circle cx="0.8" cy="0.8" r="0.8" fill="rgba(255,255,255,0.035)"/>
            </pattern>
          </defs>

          <rect width={svgW} height={svgH} fill="url(#grid)"/>

          {/* ── EDGES ── */}
          {edges.map(edge=>{
            const p = edgePath(edge);
            if(!p) return null;
            const fn = nodes.find(n=>n.id===edge.from);
            const b  = getB(fn?.bloomLevel||1);
            const ho = hoverEdge===edge.id;
            return (
              <g key={edge.id}>
                <path d={p.path} fill="none" stroke="transparent" strokeWidth={14}
                  onMouseEnter={()=>setHoverEdge(edge.id)}
                  onMouseLeave={()=>setHoverEdge(null)}
                  onClick={e=>{e.stopPropagation();if(window.confirm(`Delete synapse "${edge.label}"?`))setEdges(prev=>prev.filter(ed=>ed.id!==edge.id));}}
                  style={{cursor:"pointer"}}
                />
                <path d={p.path} fill="none"
                  stroke={ho ? b.color : `${b.color}50`}
                  strokeWidth={ho?2.2:1.5}
                  strokeDasharray={ho?"none":"5 4"}
                  markerEnd={`url(#arr${fn?.bloomLevel||1})`}
                  style={{transition:"all .2s", pointerEvents:"none"}}
                />
                {(ho||edges.length<10) &&
                  <text x={p.mx} y={p.my-6} textAnchor="middle"
                    fontSize="10" fill={b.color} opacity=".9"
                    style={{pointerEvents:"none"}} filter="url(#softglow)"
                  >{edge.label}</text>
                }
              </g>
            );
          })}

          {/* ── NODES ── */}
          {nodes.map(node=>{
            const b = getB(node.bloomLevel);
            const isSel  = selected===node.id;
            const isConn = connecting===node.id;
            const cc  = connCount(node.id);
            const r   = 28 + Math.min(cc*2.5,14);

            return (
              <g key={node.id}
                onMouseDown={e=>onNodePD(e,node.id)}
                onClick={e=>onNodeClick(e,node.id)}
                style={{cursor:mode==="connect"?"pointer":"grab"}}
              >
                {(isSel||isConn) && <>
                  <circle cx={node.x} cy={node.y} r={r+18} fill={`${b.color}08`} filter="url(#glow)"/>
                  <circle cx={node.x} cy={node.y} r={r+10} fill="none" stroke={b.color} strokeWidth=".8" opacity=".4"
                    strokeDasharray={isConn?"4 3":"none"}/>
                </>}
                <circle cx={node.x} cy={node.y} r={r+3} fill="none" stroke={b.color}
                  strokeWidth={isSel?1.8:.8} opacity={isSel?.9:.35}/>
                <circle cx={node.x} cy={node.y} r={r}
                  fill="#0d0820" stroke={b.color} strokeWidth="1.6"/>
                <circle cx={node.x} cy={node.y} r={r}
                  fill={`${b.color}18`}/>
                <text x={node.x} y={node.y+1} textAnchor="middle" dominantBaseline="middle"
                  fontSize="16" style={{pointerEvents:"none"}}>{b.icon}</text>
                <text x={node.x} y={node.y+r+14} textAnchor="middle"
                  fontSize="10.5" fill="#e8dcff" fontWeight="600"
                  filter="url(#softglow)"
                  style={{pointerEvents:"none"}}>
                  {node.label.length>15 ? node.label.slice(0,13)+"…" : node.label}
                </text>
                <circle cx={node.x+r} cy={node.y-r+2} r={9} fill={b.color} style={{pointerEvents:"none"}}/>
                <text x={node.x+r} y={node.y-r+2} textAnchor="middle" dominantBaseline="middle"
                  fontSize="8" fill="#fff" fontWeight="800" style={{pointerEvents:"none"}}>
                  L{node.bloomLevel}
                </text>
                {/* Media indicator dot */}
                {node.hasMedia &&
                  <circle cx={node.x-r+2} cy={node.y-r+2} r={7} fill="#06b6d4" style={{pointerEvents:"none"}}/>
                }
                {node.hasMedia &&
                  <text x={node.x-r+2} y={node.y-r+2} textAnchor="middle" dominantBaseline="middle"
                    fontSize="8" fill="#fff" style={{pointerEvents:"none"}}>
                    {node.mediaType==="image"?"📷":node.mediaType==="video"?"🎬":"🎵"}
                  </text>
                }
                {cc>0 &&
                  <text x={node.x} y={node.y+r+26} textAnchor="middle"
                    fontSize="8.5" fill={`${b.color}90`} style={{pointerEvents:"none"}}>
                    {cc} synapse{cc!==1?"s":""}
                  </text>
                }
              </g>
            );
          })}
        </svg>

        {/* ── SIDE PANEL ─────────────────────────────── */}
        {selNode && (
          <div style={{
            position:"absolute", top:12, right:12, width:280,
            maxHeight:"calc(100% - 24px)", overflowY:"auto",
            background:"rgba(8,4,22,0.93)", backdropFilter:"blur(20px)",
            border:`1px solid ${selB.color}45`, borderRadius:16, padding:20,
            boxShadow:`0 0 40px ${selB.color}18`
          }}>
            {/* Bloom badge */}
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:14,flexWrap:"wrap"}}>
              <div style={{
                padding:"4px 12px", borderRadius:999,
                background:`${selB.color}20`, border:`1px solid ${selB.color}50`,
                fontSize:12, color:selB.color, fontWeight:700
              }}>{selB.icon} L{selNode.bloomLevel} — {selB.vi}</div>
            </div>
            <div style={{fontSize:10,color:`${selB.color}cc`,letterSpacing:.5,marginBottom:4}}>{selB.desc}</div>

            <div style={{fontSize:18,fontWeight:800,color:"#fff",marginBottom:3,lineHeight:1.2}}>{selNode.label}</div>
            <div style={{fontSize:10,color:selB.color,letterSpacing:1.5,marginBottom:12}}>{selNode.category.toUpperCase()}</div>

            {selNode.description && (
              <div style={{fontSize:12.5,color:"rgba(232,220,255,.75)",lineHeight:1.65,marginBottom:12}}>
                {selNode.description}
              </div>
            )}

            {selNode.emotion && (
              <div style={{
                padding:"10px 13px", borderRadius:10, marginBottom:14,
                background:`${selB.color}0e`, border:`1px solid ${selB.color}28`
              }}>
                <div style={{fontSize:9,color:selB.color,letterSpacing:1.5,marginBottom:5}}>💫 EMOTIONAL ANCHOR</div>
                <div style={{fontSize:12,color:"rgba(232,220,255,.7)",lineHeight:1.55}}>{selNode.emotion}</div>
              </div>
            )}

            {/* ── MEDIA SECTION ── */}
            <div style={{marginBottom:14}}>
              <div style={{fontSize:9,color:"rgba(232,220,255,.4)",letterSpacing:1.5,marginBottom:8}}>📎 MEDIA</div>
              {nodeMedia ? (
                <div>
                  <div style={{
                    borderRadius:10, overflow:"hidden", marginBottom:8,
                    border:"1px solid rgba(6,182,212,.25)", background:"rgba(6,182,212,.05)"
                  }}>
                    <div style={{padding:"6px 10px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                      <span style={{fontSize:10,color:"#06b6d4"}}>
                        {nodeMedia.type==="image"?"📷":nodeMedia.type==="video"?"🎬":"🎵"} {nodeMedia.name}
                      </span>
                      <button onClick={removeNodeMedia}
                        style={{background:"none",border:"none",cursor:"pointer",color:"rgba(239,68,68,.5)",fontSize:13,padding:0}}>×</button>
                    </div>
                    <div style={{padding:"0 10px 10px"}}>
                      {nodeMedia.type === "image" && (
                        <img src={nodeMedia.data} alt={nodeMedia.name}
                          style={{width:"100%",maxHeight:160,borderRadius:6,objectFit:"cover",display:"block"}}/>
                      )}
                      {nodeMedia.type === "video" && (
                        <video controls src={nodeMedia.data}
                          style={{width:"100%",maxHeight:140,borderRadius:6,display:"block"}}/>
                      )}
                      {nodeMedia.type === "audio" && (
                        <audio controls src={nodeMedia.data} style={{width:"100%",marginTop:4}}/>
                      )}
                    </div>
                  </div>
                  <button onClick={()=>nodeMediaRef.current?.click()}
                    style={{width:"100%",padding:"6px 0",borderRadius:7,border:"1px solid rgba(6,182,212,.3)",
                      background:"rgba(6,182,212,.08)",color:"#67e8f9",cursor:"pointer",fontSize:11,fontFamily:"inherit"}}>
                    🔄 Replace Media
                  </button>
                </div>
              ) : (
                <button onClick={()=>nodeMediaRef.current?.click()}
                  style={{width:"100%",padding:"8px 0",borderRadius:8,border:"1px dashed rgba(6,182,212,.3)",
                    background:"rgba(6,182,212,.05)",color:"rgba(6,182,212,.7)",cursor:"pointer",fontSize:12,fontFamily:"inherit"}}>
                  📎 Add Image / Video / Audio
                </button>
              )}
              <input ref={nodeMediaRef} type="file" accept="image/*,video/*,audio/*"
                style={{display:"none"}}
                onChange={e=>{handleMediaFile(e.target.files[0], true); e.target.value='';}}
              />
            </div>

            {/* Bloom progress */}
            <div style={{marginBottom:14}}>
              <div style={{fontSize:9,color:"rgba(232,220,255,.4)",letterSpacing:1.5,marginBottom:6}}>BLOOM LEVEL PROGRESS</div>
              <div style={{display:"flex",gap:3,marginBottom:6}}>
                {BLOOM.map(b=>(
                  <div key={b.level} title={`L${b.level} ${b.vi}`} style={{
                    flex:1, height:7, borderRadius:4,
                    background:selNode.bloomLevel>=b.level?b.color:"rgba(255,255,255,0.08)",
                    transition:"background .3s"
                  }}/>
                ))}
              </div>
              <div style={{display:"flex",gap:5,justifyContent:"center"}}>
                <button onClick={()=>downgradeBloom(selNode.id)} disabled={selNode.bloomLevel<=1}
                  style={{padding:"5px 10px",borderRadius:6,border:"1px solid rgba(255,255,255,.15)",
                    background:"rgba(255,255,255,.04)",color:"rgba(232,220,255,.5)",
                    cursor:selNode.bloomLevel>1?"pointer":"default",fontSize:12}}>← Undo</button>
                <button onClick={()=>upgradeBloom(selNode.id)} disabled={selNode.bloomLevel>=6}
                  style={{
                    flex:1,padding:"5px 0",borderRadius:6,
                    border:`1px solid ${selB.color}50`, background:`${selB.color}18`,
                    color:selB.color,cursor:selNode.bloomLevel<6?"pointer":"default",fontSize:12,fontWeight:700
                  }}>
                  {selNode.bloomLevel<6 ? `⬆ Level up → ${BLOOM[selNode.bloomLevel].vi}` : "🏆 Max Level!"}
                </button>
              </div>
            </div>

            {/* Connections */}
            {edges.filter(e=>e.from===selNode.id||e.to===selNode.id).length > 0 && (
              <div style={{marginBottom:14}}>
                <div style={{fontSize:9,color:"rgba(232,220,255,.4)",letterSpacing:1.5,marginBottom:7}}>
                  SYNAPSES ({edges.filter(e=>e.from===selNode.id||e.to===selNode.id).length})
                </div>
                {edges.filter(e=>e.from===selNode.id||e.to===selNode.id).map(edge=>{
                  const otherId = edge.from===selNode.id?edge.to:edge.from;
                  const other   = nodes.find(n=>n.id===otherId);
                  if(!other) return null;
                  const ob = getB(other.bloomLevel);
                  const dir = edge.from===selNode.id ? "→" : "←";
                  return (
                    <div key={edge.id} style={{
                      display:"flex",alignItems:"center",gap:6,
                      padding:"5px 9px",borderRadius:7,marginBottom:4,
                      background:"rgba(255,255,255,0.04)",fontSize:11
                    }}>
                      <span>{ob.icon}</span>
                      <span style={{color:ob.color,fontWeight:600}}>{other.label}</span>
                      <span style={{color:"rgba(232,220,255,.3)",flex:1,fontSize:10}}>{dir} {edge.label}</span>
                      <button onClick={()=>setEdges(p=>p.filter(e=>e.id!==edge.id))}
                        style={{background:"none",border:"none",cursor:"pointer",color:"rgba(239,68,68,.5)",fontSize:13,padding:0,lineHeight:1}}>×</button>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Actions */}
            <div style={{display:"flex",gap:7,flexWrap:"wrap"}}>
              <button onClick={()=>{setMode("connect");setSelected(null);setConnecting(selNode.id);}}
                style={{flex:1,padding:"8px 0",borderRadius:8,border:"1px solid rgba(99,102,241,.5)",
                  background:"rgba(99,102,241,.15)",color:"#818cf8",cursor:"pointer",fontSize:12,fontWeight:600}}>
                🔗 Connect
              </button>
              <button onClick={()=>deleteNode(selNode.id)}
                style={{padding:"8px 13px",borderRadius:8,border:"1px solid rgba(239,68,68,.3)",
                  background:"rgba(239,68,68,.1)",color:"#f87171",cursor:"pointer",fontSize:13}}>
                🗑
              </button>
            </div>
          </div>
        )}

        {/* ── CONNECT MODE HINT ── */}
        {mode==="connect" && (
          <div style={{
            position:"absolute",bottom:14,left:"50%",transform:"translateX(-50%)",
            background:"rgba(168,85,247,0.18)",border:"1px solid rgba(168,85,247,.55)",
            borderRadius:12,padding:"10px 22px",fontSize:13,color:"#c084fc",
            backdropFilter:"blur(12px)",textAlign:"center",pointerEvents:"none"
          }}>
            {connecting
              ? <>✅ <b>"{nodes.find(n=>n.id===connecting)?.label}"</b> — nhấp vào neuron tiếp theo để tạo synapse</>
              : "🔗 Connect Mode — nhấp vào một neuron để bắt đầu kết nối"}
          </div>
        )}

        {/* ── CONNECT LABEL INPUT ── */}
        {mode==="connect" && connecting && (
          <div style={{
            position:"absolute",bottom:55,left:"50%",transform:"translateX(-50%)",
            display:"flex",gap:8,alignItems:"center"
          }}>
            <input value={connLabel} onChange={e=>setConnLabel(e.target.value)}
              list="rel-labels"
              placeholder="Tên liên kết... (e.g. causes, helps explain)"
              style={{
                padding:"7px 14px",borderRadius:8,border:"1px solid rgba(168,85,247,.4)",
                background:"rgba(10,5,30,.85)",color:"#e8dcff",fontSize:12,
                outline:"none",width:260,fontFamily:"inherit"
              }}/>
            <datalist id="rel-labels">
              {REL_LABELS.map(l=><option key={l} value={l}/>)}
            </datalist>
          </div>
        )}
      </div>

      {/* ── ADD NODE MODAL ──────────────────────── */}
      {showAdd && (
        <div style={{
          position:"fixed",inset:0,background:"rgba(0,0,0,.75)",
          display:"flex",alignItems:"center",justifyContent:"center",zIndex:200,padding:16
        }} onClick={()=>{setShowAdd(false);setMediaForm(null);}}>
          <div style={{
            background:"linear-gradient(160deg,#110828 0%,#0d0620 100%)",
            border:"1px solid rgba(168,85,247,.35)",borderRadius:20,
            padding:28,width:"100%",maxWidth:440,maxHeight:"90vh",overflowY:"auto",
            boxShadow:"0 0 70px rgba(168,85,247,.2)"
          }} onClick={e=>e.stopPropagation()}>
            <div style={{fontSize:19,fontWeight:800,color:"#fff",marginBottom:22}}>🧠 Add New Neuron</div>

            {[
              {label:"Kiến thức / Khái niệm *", key:"label",    ph:"e.g. Passive Voice, IELTS Writing Task 2…"},
              {label:"Mô tả",                   key:"description",ph:"Nó nghĩa là gì? Hoạt động như thế nào?"},
              {label:"Mỏ neo cảm xúc 💫",        key:"emotion",  ph:"Ký ức, hình ảnh, cảm xúc bạn gắn với kiến thức này?"},
            ].map(f=>(
              <div key={f.key} style={{marginBottom:14}}>
                <div style={{fontSize:10,color:"rgba(232,220,255,.5)",letterSpacing:1,marginBottom:5}}>{f.label}</div>
                {f.key==="description"
                  ? <textarea value={form[f.key]} onChange={e=>setForm(p=>({...p,[f.key]:e.target.value}))}
                      placeholder={f.ph} rows={2}
                      style={{width:"100%",padding:"9px 13px",borderRadius:9,resize:"none",
                        border:"1px solid rgba(255,255,255,.1)",background:"rgba(255,255,255,.05)",
                        color:"#fff",fontSize:13,outline:"none",fontFamily:"inherit",boxSizing:"border-box"}}/>
                  : <input value={form[f.key]} onChange={e=>setForm(p=>({...p,[f.key]:e.target.value}))}
                      placeholder={f.ph}
                      style={{width:"100%",padding:"9px 13px",borderRadius:9,
                        border:"1px solid rgba(255,255,255,.1)",background:"rgba(255,255,255,.05)",
                        color:"#fff",fontSize:13,outline:"none",fontFamily:"inherit",boxSizing:"border-box"}}/>
                }
              </div>
            ))}

            <div style={{marginBottom:14}}>
              <div style={{fontSize:10,color:"rgba(232,220,255,.5)",letterSpacing:1,marginBottom:5}}>CATEGORY</div>
              <select value={form.category} onChange={e=>setForm(p=>({...p,category:e.target.value}))}
                style={{width:"100%",padding:"9px 13px",borderRadius:9,
                  border:"1px solid rgba(255,255,255,.1)",background:"#0d0820",
                  color:"#e8dcff",fontSize:13,outline:"none",fontFamily:"inherit"}}>
                {CATS.map(c=><option key={c} value={c}>{c}</option>)}
              </select>
            </div>

            {/* Media upload in modal */}
            <div style={{marginBottom:14}}>
              <div style={{fontSize:10,color:"rgba(232,220,255,.5)",letterSpacing:1,marginBottom:5}}>📎 MEDIA (optional)</div>
              {mediaForm ? (
                <div style={{
                  borderRadius:10,border:"1px solid rgba(6,182,212,.3)",
                  background:"rgba(6,182,212,.06)",overflow:"hidden"
                }}>
                  <div style={{padding:"6px 12px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                    <span style={{fontSize:11,color:"#06b6d4"}}>
                      {mediaForm.type==="image"?"📷":mediaForm.type==="video"?"🎬":"🎵"} {mediaForm.name}
                    </span>
                    <button onClick={()=>setMediaForm(null)}
                      style={{background:"none",border:"none",cursor:"pointer",color:"rgba(239,68,68,.6)",fontSize:14,padding:0}}>×</button>
                  </div>
                  {mediaForm.type === "image" && (
                    <img src={mediaForm.data} alt={mediaForm.name}
                      style={{width:"100%",maxHeight:140,objectFit:"cover",display:"block"}}/>
                  )}
                  {mediaForm.type === "video" && (
                    <video controls src={mediaForm.data} style={{width:"100%",maxHeight:120,display:"block"}}/>
                  )}
                  {mediaForm.type === "audio" && (
                    <audio controls src={mediaForm.data} style={{width:"100%",padding:"0 12px 8px"}}/>
                  )}
                </div>
              ) : (
                <button onClick={()=>mediaInputRef.current?.click()}
                  style={{width:"100%",padding:"9px 0",borderRadius:9,border:"1px dashed rgba(6,182,212,.3)",
                    background:"rgba(6,182,212,.04)",color:"rgba(6,182,212,.7)",cursor:"pointer",fontSize:12,fontFamily:"inherit"}}>
                  📎 Attach Image / Video / Audio
                </button>
              )}
              <input ref={mediaInputRef} type="file" accept="image/*,video/*,audio/*"
                style={{display:"none"}}
                onChange={e=>{handleMediaFile(e.target.files[0], false); e.target.value='';}}
              />
            </div>

            <div style={{marginBottom:22}}>
              <div style={{fontSize:10,color:"rgba(232,220,255,.5)",letterSpacing:1,marginBottom:8}}>
                BLOOM LEVEL — Bạn đang ở đâu với kiến thức này?
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:6}}>
                {BLOOM.map(b=>(
                  <button key={b.level} onClick={()=>setForm(p=>({...p,bloomLevel:b.level}))}
                    style={{
                      padding:"9px 4px",borderRadius:9,cursor:"pointer",textAlign:"center",
                      border:`1px solid ${form.bloomLevel===b.level?b.color:"rgba(255,255,255,.1)"}`,
                      background:form.bloomLevel===b.level?`${b.color}22`:"transparent",
                      color:form.bloomLevel===b.level?b.color:"rgba(232,220,255,.4)",
                      fontFamily:"inherit",transition:"all .15s"
                    }}>
                    <div style={{fontSize:16,marginBottom:3}}>{b.icon}</div>
                    <div style={{fontSize:9,fontWeight:700,letterSpacing:.5}}>L{b.level} {b.vi}</div>
                  </button>
                ))}
              </div>
            </div>

            <div style={{display:"flex",gap:10}}>
              <button onClick={()=>{setShowAdd(false);setMediaForm(null);}}
                style={{flex:1,padding:"12px 0",borderRadius:10,border:"1px solid rgba(255,255,255,.1)",
                  background:"transparent",color:"rgba(232,220,255,.45)",cursor:"pointer",fontSize:14,fontFamily:"inherit"}}>
                Huỷ
              </button>
              <button onClick={addNode}
                style={{flex:2,padding:"12px 0",borderRadius:10,border:"none",
                  background:"linear-gradient(135deg,#a855f7,#6366f1)",
                  color:"#fff",cursor:"pointer",fontSize:15,fontWeight:800,fontFamily:"inherit"}}>
                ✨ Thêm vào Brain
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── FOOTER ─────────────────────────────── */}
      <div style={{
        padding:"10px 20px",borderTop:"1px solid rgba(255,255,255,0.05)",
        background:"rgba(0,0,0,.2)",display:"flex",gap:20,flexWrap:"wrap",
        fontSize:10,color:"rgba(232,220,255,0.3)",letterSpacing:.5
      }}>
        <span>🖱 Kéo neuron để di chuyển</span>
        <span>🔗 "Connect" → chọn 2 neuron để tạo synapse</span>
        <span>💡 "Auto Synapse" → gợi ý kết nối tự động</span>
        <span>📎 Attach media vào neuron card</span>
        <span>⬆ "Level up" khi bạn hiểu sâu hơn</span>
        <span style={{marginLeft:"auto"}}>Ngan's Brain • {new Date().getFullYear()}</span>
      </div>
    </div>
  );
}
