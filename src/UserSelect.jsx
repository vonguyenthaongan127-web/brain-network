import { useState, useEffect } from "react";
import { doc, setDoc, onSnapshot } from "firebase/firestore";

const DEFAULT_SLOTS = [
  { id: "user1", name: "User 1", emoji: "🧠", color: "#a855f7" },
  { id: "user2", name: "User 2", emoji: "⚡", color: "#3b82f6" },
  { id: "user3", name: "User 3", emoji: "🌱", color: "#22c55e" },
  { id: "user4", name: "User 4", emoji: "🔥", color: "#f97316" },
  { id: "user5", name: "User 5", emoji: "💡", color: "#eab308" },
  { id: "user6", name: "User 6", emoji: "🎯", color: "#ef4444" },
  { id: "user7", name: "User 7", emoji: "🌙", color: "#06b6d4" },
];

const EMOJI_PALETTE = [
  "🧠","⚡","🌱","🔥","💡","🎯","🌙","🌟","🦋","🎨",
  "🚀","💎","🌊","🎭","🔮","🌸","🏆","🦁","🐉","🎵",
];

const COLOR_PALETTE = [
  "#a855f7","#3b82f6","#22c55e","#f97316","#eab308",
  "#ef4444","#06b6d4","#ec4899","#84cc16","#f43f5e",
];

export default function UserSelect({ db, onSelect, lang }) {
  const [users, setUsers]   = useState(DEFAULT_SLOTS);
  const [editing, setEditing] = useState(null);

  // Language-aware strings (minimal — only what's needed on this screen)
  const T = {
    en: { title:"Who are you?", sub:"Select your profile to continue", editTitle:"Edit Profile", name:"Name", save:"Save", cancel:"Cancel", emoji:"EMOJI", color:"COLOR" },
    vi: { title:"Bạn là ai?",   sub:"Chọn hồ sơ của bạn để tiếp tục", editTitle:"Chỉnh sửa hồ sơ", name:"Tên", save:"Lưu", cancel:"Huỷ", emoji:"BIỂU TƯỢNG", color:"MÀU" },
    zh: { title:"您是谁？",      sub:"选择您的档案以继续", editTitle:"编辑档案", name:"名称", save:"保存", cancel:"取消", emoji:"表情符号", color:"颜色" },
  }[lang] || { title:"Who are you?", sub:"Select your profile to continue", editTitle:"Edit Profile", name:"Name", save:"Save", cancel:"Cancel", emoji:"EMOJI", color:"COLOR" };

  useEffect(() => {
    const unsubs = DEFAULT_SLOTS.map(slot =>
      onSnapshot(doc(db, "users", slot.id), (snap) => {
        if (snap.exists()) {
          setUsers(prev => prev.map(u => u.id === slot.id ? { id: slot.id, ...snap.data() } : u));
        }
      })
    );
    return () => unsubs.forEach(u => u());
  }, [db]);

  const saveUser = async (user) => {
    await setDoc(doc(db, "users", user.id), { name: user.name, emoji: user.emoji, color: user.color });
    setEditing(null);
  };

  return (
    <div style={{
      minHeight:"100vh", width:"100%",
      background:"radial-gradient(ellipse at 25% 40%, #1a0f3c 0%, #0d0820 55%, #050310 100%)",
      fontFamily:"'Segoe UI',system-ui,sans-serif", color:"#e8dcff",
      display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center",
      padding:24, boxSizing:"border-box",
    }}>
      <div style={{fontSize:10,letterSpacing:4,color:"#a855f7",marginBottom:8,textAlign:"center"}}>NGAN'S BRAIN</div>
      <div style={{fontSize:30,fontWeight:800,color:"#fff",marginBottom:6,textAlign:"center"}}>🧠 {T.title}</div>
      <div style={{fontSize:13,color:"rgba(232,220,255,0.45)",marginBottom:40,textAlign:"center"}}>{T.sub}</div>

      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(130px,1fr))",gap:12,width:"100%",maxWidth:740}}>
        {users.map(user => (
          <div key={user.id} style={{position:"relative"}}>
            <div
              onClick={() => onSelect(user)}
              style={{
                padding:"22px 12px 18px",borderRadius:18,cursor:"pointer",textAlign:"center",
                border:`1px solid ${user.color}55`,background:`${user.color}12`,
                transition:"all 0.18s",
              }}
              onMouseEnter={e => { e.currentTarget.style.background = `${user.color}28`; e.currentTarget.style.transform = "translateY(-2px)"; }}
              onMouseLeave={e => { e.currentTarget.style.background = `${user.color}12`; e.currentTarget.style.transform = "none"; }}
            >
              <div style={{fontSize:38,marginBottom:8,lineHeight:1}}>{user.emoji}</div>
              <div style={{fontSize:13,fontWeight:700,color:"#fff",marginBottom:6,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{user.name}</div>
              <div style={{width:28,height:3,borderRadius:2,background:user.color,margin:"0 auto"}}/>
            </div>
            <button
              onClick={e => { e.stopPropagation(); setEditing({ ...user }); }}
              style={{
                position:"absolute",top:8,right:8,
                background:"none",border:"none",cursor:"pointer",
                color:"rgba(232,220,255,0.35)",fontSize:13,lineHeight:1,padding:3,
                borderRadius:4,transition:"color .15s",
              }}
              onMouseEnter={e => e.currentTarget.style.color = "rgba(232,220,255,0.8)"}
              onMouseLeave={e => e.currentTarget.style.color = "rgba(232,220,255,0.35)"}
              title={T.editTitle}
            >✏</button>
          </div>
        ))}
      </div>

      {/* ── Edit modal ── */}
      {editing && (
        <div
          style={{position:"fixed",inset:0,background:"rgba(0,0,0,.78)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:200,padding:16}}
          onClick={() => setEditing(null)}
        >
          <div
            style={{background:"linear-gradient(160deg,#110828 0%,#0d0620 100%)",border:"1px solid rgba(168,85,247,.35)",borderRadius:20,padding:28,width:"100%",maxWidth:380,boxShadow:"0 0 70px rgba(168,85,247,.2)"}}
            onClick={e => e.stopPropagation()}
          >
            <div style={{fontSize:18,fontWeight:800,color:"#fff",marginBottom:20}}>✏ {T.editTitle}</div>

            <div style={{textAlign:"center",marginBottom:16}}>
              <div style={{fontSize:52,lineHeight:1}}>{editing.emoji}</div>
            </div>

            <div style={{marginBottom:14}}>
              <div style={{fontSize:10,color:"rgba(232,220,255,.5)",letterSpacing:1,marginBottom:5}}>{T.name}</div>
              <input
                value={editing.name}
                onChange={e => setEditing(p => ({ ...p, name: e.target.value }))}
                style={{width:"100%",padding:"9px 13px",borderRadius:9,border:"1px solid rgba(255,255,255,.12)",background:"rgba(255,255,255,.06)",color:"#fff",fontSize:13,outline:"none",fontFamily:"inherit",boxSizing:"border-box"}}
              />
            </div>

            <div style={{marginBottom:14}}>
              <div style={{fontSize:10,color:"rgba(232,220,255,.5)",letterSpacing:1,marginBottom:8}}>{T.emoji}</div>
              <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                {EMOJI_PALETTE.map(em => (
                  <button key={em} onClick={() => setEditing(p => ({ ...p, emoji: em }))}
                    style={{
                      width:36,height:36,borderRadius:8,cursor:"pointer",fontSize:18,
                      border:`1px solid ${editing.emoji === em ? "rgba(168,85,247,.7)" : "rgba(255,255,255,.1)"}`,
                      background: editing.emoji === em ? "rgba(168,85,247,.22)" : "transparent",
                      fontFamily:"inherit",
                    }}>{em}</button>
                ))}
              </div>
            </div>

            <div style={{marginBottom:22}}>
              <div style={{fontSize:10,color:"rgba(232,220,255,.5)",letterSpacing:1,marginBottom:8}}>{T.color}</div>
              <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                {COLOR_PALETTE.map(c => (
                  <button key={c} onClick={() => setEditing(p => ({ ...p, color: c }))}
                    style={{
                      width:28,height:28,borderRadius:"50%",background:c,cursor:"pointer",
                      border:`3px solid ${editing.color === c ? "#fff" : "transparent"}`,
                      boxSizing:"border-box",outline:"none",
                    }}/>
                ))}
              </div>
            </div>

            <div style={{display:"flex",gap:10}}>
              <button onClick={() => setEditing(null)}
                style={{flex:1,padding:"11px 0",borderRadius:10,border:"1px solid rgba(255,255,255,.1)",background:"transparent",color:"rgba(232,220,255,.45)",cursor:"pointer",fontSize:14,fontFamily:"inherit"}}>
                {T.cancel}
              </button>
              <button onClick={() => saveUser(editing)}
                style={{flex:2,padding:"11px 0",borderRadius:10,border:"none",background:"linear-gradient(135deg,#a855f7,#6366f1)",color:"#fff",cursor:"pointer",fontSize:14,fontWeight:800,fontFamily:"inherit"}}>
                {T.save}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
