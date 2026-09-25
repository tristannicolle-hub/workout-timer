const $ = s => document.querySelector(s);
const MODES = ["INTERVAL","TABATA","EMOM","AMRAP","FOR TIME","CUSTOM"];
const MODE_COLORS = {INTERVAL:"#ff5a36",TABATA:"#ff3d7f",EMOM:"#ffb020",AMRAP:"#7c5cff","FOR TIME":"#22c1d6",CUSTOM:"#34d399"};
const LS_WORKOUTS = "wt_workouts_v2";
const LS_WORKOUTS_OLD = "wt_workouts";
const LS_PREFS = "wt_prefs";

let mode = "INTERVAL";
let settings = defaultSettings();
let workouts = [];
let currentTab = "mine";
let editingId = null;
let timer = null, state = null;
let lastFinished = null;
let audioCtx = null, deferredPrompt = null, mutedBefore = null;
let prefs = {soundMode:"both", voiceURI:null, volume:0.8};

/* ---------- helpers ---------- */
function uid(){return Math.random().toString(36).slice(2,9)}
function defaultSettings(){return {name:"Nouveau workout",work:40,rest:20,rounds:10,prep:10,duration:600,cap:600,blocks:[],customRounds:1,favorite:false}}
function fmt(s){s=Math.max(0,Math.ceil(s));return `${String(Math.floor(s/60)).padStart(2,"0")}:${String(Math.floor(s%60)).padStart(2,"0")}`}
function fmt1(s){s=Math.max(0,Math.floor(s));return `${Math.floor(s/60)}:${String(s%60).padStart(2,"0")}`}
function esc(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]))}

/* ---------- storage ---------- */
function loadWorkouts(){
  try{
    const raw = localStorage.getItem(LS_WORKOUTS);
    if(raw) return JSON.parse(raw);
    const old = localStorage.getItem(LS_WORKOUTS_OLD);
    if(old){
      const arr = JSON.parse(old).map(w=>({...defaultSettings(),...w,createdAt:Date.now(),lastUsed:0}));
      localStorage.setItem(LS_WORKOUTS, JSON.stringify(arr));
      return arr;
    }
  }catch{}
  return null;
}
function saveWorkouts(){localStorage.setItem(LS_WORKOUTS, JSON.stringify(workouts))}
function savePrefs(){localStorage.setItem(LS_PREFS, JSON.stringify(prefs))}

workouts = loadWorkouts();
if(!workouts){
  workouts = [
    {id:1,name:"10 × 40/20",mode:"INTERVAL",work:40,rest:20,rounds:10,prep:10,duration:600,cap:600,blocks:[],customRounds:1,favorite:true,createdAt:Date.now(),lastUsed:0},
    {id:2,name:"Tabata classique",mode:"TABATA",work:20,rest:10,rounds:8,prep:10,duration:600,cap:600,blocks:[],customRounds:1,favorite:false,createdAt:Date.now(),lastUsed:0},
    {id:3,name:"Circuit force",mode:"CUSTOM",work:40,rest:20,rounds:10,prep:10,duration:600,cap:600,favorite:false,createdAt:Date.now(),lastUsed:0,customRounds:3,
      blocks:[
        {id:uid(),label:"Pompes",kind:"work",duration:40},
        {id:uid(),label:"Repos",kind:"rest",duration:20},
        {id:uid(),label:"Squats",kind:"work",duration:40},
        {id:uid(),label:"Repos",kind:"rest",duration:20},
        {id:uid(),label:"Gainage",kind:"work",duration:30},
        {id:uid(),label:"Repos",kind:"rest",duration:30}
      ]}
  ];
  saveWorkouts();
}
try{prefs = {...prefs, ...JSON.parse(localStorage.getItem(LS_PREFS)||"{}")}}catch{}

/* ---------- sound ---------- */
function beep(freq=700,d=.08){
  if(prefs.soundMode==="off"||prefs.soundMode==="voice")return;
  try{
    audioCtx ??= new (window.AudioContext||window.webkitAudioContext)();
    audioCtx.resume();
    const o=audioCtx.createOscillator(), g=audioCtx.createGain();
    o.frequency.value=freq; g.gain.value=.16*prefs.volume;
    o.connect(g); g.connect(audioCtx.destination); o.start(); o.stop(audioCtx.currentTime+d);
  }catch{}
}
function vib(p=35){navigator.vibrate?.(p)}
function speak(t){
  if(prefs.soundMode==="off"||prefs.soundMode==="beep")return;
  if(typeof speechSynthesis==="undefined")return;
  speechSynthesis.cancel();
  const u=new SpeechSynthesisUtterance(t);
  u.lang="fr-FR"; u.rate=1.05; u.volume=prefs.volume;
  if(prefs.voiceURI){const v=speechSynthesis.getVoices().find(v=>v.voiceURI===prefs.voiceURI); if(v)u.voice=v}
  speechSynthesis.speak(u);
}
function unlock(){try{audioCtx ??= new (window.AudioContext||window.webkitAudioContext)();audioCtx.resume()}catch{}}
function populateVoices(){
  if(typeof speechSynthesis==="undefined")return;
  const voices = speechSynthesis.getVoices();
  if(!voices.length)return;
  const sel = $("#voiceSelect");
  const fr = voices.filter(v=>v.lang.startsWith("fr"));
  const rest = voices.filter(v=>!v.lang.startsWith("fr"));
  sel.innerHTML = `<option value="">Automatique</option>` + [...fr,...rest].map(v=>`<option value="${esc(v.voiceURI)}" ${v.voiceURI===prefs.voiceURI?"selected":""}>${esc(v.name)} (${v.lang})</option>`).join("");
}
if(typeof speechSynthesis!=="undefined")speechSynthesis.addEventListener?.("voiceschanged",populateVoices);

/* ---------- navigation ---------- */
function show(id){["home","editor","timer","done"].forEach(x=>$("#"+x).classList.toggle("hidden",x!==id))}

/* ---------- home ---------- */
function meta(w){
  if(w.mode==="AMRAP")return fmt(w.duration);
  if(w.mode==="FOR TIME")return w.cap>0?`cap ${fmt(w.cap)}`:"sans limite";
  if(w.mode==="EMOM")return `${fmt(w.work)} × ${w.rounds}`;
  if(w.mode==="CUSTOM"){
    const n=(w.blocks||[]).length, total=(w.blocks||[]).reduce((a,b)=>a+b.duration,0)*(w.customRounds||1);
    return `${n} bloc${n>1?"s":""} · ${fmt(total)} · ${w.customRounds||1}×`;
  }
  return `${fmt(w.work)}/${fmt(w.rest)} × ${w.rounds}`;
}
function cardHtml(w){
  const color = MODE_COLORS[w.mode]||"#888";
  return `<div class="workout-card">
    <div class="wc-bar" style="background:${color}"></div>
    <div class="wc-body" data-open="${w.id}">
      <div class="wc-top">
        <div class="wc-name">${esc(w.name)}</div>
        <div class="wc-mode-pill" style="color:${color};border-color:${color}55;background:${color}1a">${w.mode}</div>
      </div>
      <div class="wc-meta">${meta(w)}</div>
    </div>
    <div class="wc-actions">
      <button class="wc-fav ${w.favorite?"active":""}" data-fav="${w.id}" aria-label="Favori">${w.favorite?"★":"☆"}</button>
      <button class="wc-start" data-start="${w.id}" aria-label="Démarrer">▶</button>
    </div>
  </div>`;
}
function renderHome(){
  let list = workouts.slice();
  if(currentTab==="fav")list = list.filter(w=>w.favorite);
  else if(currentTab==="recent")list = list.filter(w=>w.lastUsed).sort((a,b)=>b.lastUsed-a.lastUsed).slice(0,15);
  else list = list.sort((a,b)=>b.createdAt-a.createdAt);
  $("#workoutList").innerHTML = list.map(cardHtml).join("");
  $("#emptyState").classList.toggle("hidden", list.length>0);
  $("#emptyText").textContent = currentTab==="fav"?"Aucun favori pour l'instant.":currentTab==="recent"?"Aucun workout récent.":"Crée ton premier workout.";
  document.querySelectorAll("[data-open]").forEach(el=>el.onclick=()=>openEditor(workouts.find(w=>w.id==el.dataset.open)));
  document.querySelectorAll("[data-fav]").forEach(el=>el.onclick=e=>{e.stopPropagation();const w=workouts.find(x=>x.id==el.dataset.fav);w.favorite=!w.favorite;saveWorkouts();renderHome()});
  document.querySelectorAll("[data-start]").forEach(el=>el.onclick=e=>{e.stopPropagation();const w=workouts.find(x=>x.id==el.dataset.start);mode=w.mode;settings={...defaultSettings(),...w,blocks:(w.blocks||[]).map(b=>({...b}))};editingId=w.id;start()});
}

/* ---------- editor ---------- */
function renderModes(){
  $("#modeGrid").innerHTML = MODES.map(m=>`<button class="mode-btn ${m===mode?"active":""}" data-mode="${m}">${m}</button>`).join("");
  document.querySelectorAll("[data-mode]").forEach(b=>b.onclick=()=>{mode=b.dataset.mode;renderModes();renderSettings()});
}
function row(label,k,step,min,max,help){return `<div class="setting-row"><div><div class="setting-label">${label}</div><div class="setting-help">${help}</div></div><div class="stepper"><button data-k="${k}" data-d="-1">−</button><div class="value">${k==="rounds"?settings[k]:fmt(settings[k])}</div><button data-k="${k}" data-d="1">+</button></div></div>`}
function renderSettings(){
  let h = "";
  if(mode==="AMRAP")h += row("Durée","duration",30,30,3600,"Travail libre pendant cette durée");
  else if(mode==="FOR TIME")h += row("Time cap","cap",30,30,3600,"Temps maximum (0 = illimité)");
  else if(mode!=="CUSTOM")h += row(mode==="EMOM"?"Intervalle":"Effort","work",5,5,3600,"Temps d'effort");
  if(["INTERVAL","TABATA"].includes(mode))h += row("Repos","rest",5,0,3600,"Récupération");
  if(!["AMRAP","FOR TIME","CUSTOM"].includes(mode))h += row("Tours","rounds",1,1,999,"Nombre de tours");
  h += row("Préparation","prep",5,0,60,"Avant le lancement");
  $("#settingsCard").innerHTML = h;
  document.querySelectorAll("[data-k]").forEach(b=>b.onclick=()=>{
    const k=b.dataset.k, d=+b.dataset.d;
    const step = k==="rounds"?1:k==="prep"?5:(k==="duration"||k==="cap")?30:5;
    const min = k==="prep"||k==="cap"?0:k==="rounds"?1:5;
    const max = k==="rounds"?999:k==="prep"?60:3600;
    settings[k] = Math.min(max,Math.max(min,settings[k]+d*step));
    renderSettings();
  });
  $("#customCard").classList.toggle("hidden", mode!=="CUSTOM");
  if(mode==="CUSTOM")renderBlocks();
}
function blockRow(b,i,len){
  return `<div class="block-row">
    <div class="block-drag">
      <button data-move="${b.id}" data-dir="-1" ${i===0?"disabled":""}>▲</button>
      <button data-move="${b.id}" data-dir="1" ${i===len-1?"disabled":""}>▼</button>
    </div>
    <div class="block-main">
      <input class="block-name" data-name="${b.id}" maxlength="24" placeholder="Nom du bloc" value="${esc(b.label)}">
      <div class="block-controls">
        <button class="kind-btn kind-${b.kind}" data-kind="${b.id}">${b.kind==="rest"?"REST":"WORK"}</button>
        <div class="stepper small">
          <button data-blockstep="${b.id}" data-d="-1">−</button>
          <div class="value">${fmt(b.duration)}</div>
          <button data-blockstep="${b.id}" data-d="1">+</button>
        </div>
      </div>
    </div>
    <button class="block-del" data-delblock="${b.id}">✕</button>
  </div>`;
}
function renderBlocks(){
  if(!settings.blocks || !settings.blocks.length)settings.blocks = [{id:uid(),label:"Bloc 1",kind:"work",duration:40}];
  $("#blockList").innerHTML = settings.blocks.map((b,i)=>blockRow(b,i,settings.blocks.length)).join("");
  $("#customRoundsValue").textContent = settings.customRounds||1;
  document.querySelectorAll("[data-name]").forEach(el=>el.oninput=e=>{settings.blocks.find(b=>b.id===el.dataset.name).label=e.target.value});
  document.querySelectorAll("[data-kind]").forEach(el=>el.onclick=()=>{const b=settings.blocks.find(x=>x.id===el.dataset.kind);b.kind=b.kind==="rest"?"work":"rest";renderBlocks()});
  document.querySelectorAll("[data-blockstep]").forEach(el=>el.onclick=()=>{const b=settings.blocks.find(x=>x.id===el.dataset.blockstep);const d=+el.dataset.d;b.duration=Math.min(3600,Math.max(5,b.duration+d*5));renderBlocks()});
  document.querySelectorAll("[data-delblock]").forEach(el=>el.onclick=()=>{if(settings.blocks.length<=1)return;settings.blocks=settings.blocks.filter(b=>b.id!==el.dataset.delblock);renderBlocks()});
  document.querySelectorAll("[data-move]").forEach(el=>el.onclick=()=>{
    const idx = settings.blocks.findIndex(b=>b.id===el.dataset.move);
    const dir = +el.dataset.dir, j = idx+dir;
    if(j<0||j>=settings.blocks.length)return;
    [settings.blocks[idx],settings.blocks[j]] = [settings.blocks[j],settings.blocks[idx]];
    renderBlocks();
  });
}
function updateFavIcon(){$("#editorFav").textContent = settings.favorite?"★":"☆"}
function openEditor(w){
  editingId = w ? w.id : null;
  if(w){mode=w.mode; settings={...defaultSettings(),...w,blocks:(w.blocks||[]).map(b=>({...b}))}}
  else{mode="INTERVAL"; settings=defaultSettings()}
  $("#editorTitle").textContent = w?"MODIFIER LE WORKOUT":"NOUVEAU WORKOUT";
  $("#nameInput").value = settings.name;
  $("#duplicateBtn").classList.toggle("hidden", !w);
  $("#deleteBtn").classList.toggle("hidden", !w);
  updateFavIcon();
  renderModes(); renderSettings();
  show("editor");
}
function persistDraft(){
  settings.name = ($("#nameInput").value||"").trim() || "Workout";
  if(editingId){
    const idx = workouts.findIndex(w=>w.id===editingId);
    if(idx>-1)workouts[idx] = {...workouts[idx],...settings,mode};
    else{const w={id:editingId,...settings,mode,createdAt:Date.now(),lastUsed:0};workouts.unshift(w)}
  }else{
    const w = {id:Date.now(),...settings,mode,createdAt:Date.now(),lastUsed:0};
    workouts.unshift(w);
    editingId = w.id;
  }
  saveWorkouts();
}

/* ---------- timer engine ---------- */
function buildPlan(){
  const s = settings, steps = [];
  if(mode==="EMOM"){
    for(let r=1;r<=s.rounds;r++)steps.push({phase:"WORK",duration:s.work,round:r,label:""});
  }else if(mode==="INTERVAL"||mode==="TABATA"){
    for(let r=1;r<=s.rounds;r++){
      steps.push({phase:"WORK",duration:s.work,round:r,label:""});
      if(s.rest>0)steps.push({phase:"REST",duration:s.rest,round:r,label:""});
    }
  }else if(mode==="CUSTOM"){
    const rounds = Math.max(1,s.customRounds||1);
    for(let r=1;r<=rounds;r++){
      (s.blocks||[]).forEach(b=>{if(b.duration>0)steps.push({phase:b.kind==="rest"?"REST":"WORK",duration:b.duration,round:r,label:b.label||""})});
    }
  }
  return steps;
}
function setPhaseColor(phase){$("#timer").dataset.phase = phase}
function announceStep(){
  setPhaseColor(state.phase.toLowerCase());
  if(state.phase==="WORK"){speak(state.blockLabel||"C'est parti");beep(900,.1)}
  else if(state.phase==="REST"){speak("Repos");beep(600,.1)}
  vib(40);
}
function start(){
  unlock();
  persistDraft();
  const idx = workouts.findIndex(w=>w.id===editingId);
  if(idx>-1){workouts[idx].lastUsed = Date.now(); saveWorkouts()}
  const plan = (mode==="AMRAP"||mode==="FOR TIME") ? null : buildPlan();
  state = {
    plan, stepIndex:0, phase:"PREP",
    remaining:settings.prep, elapsed:0, last:performance.now(), paused:false,
    lastCount:null, showGo:false, round:1,
    totalRounds: mode==="CUSTOM" ? Math.max(1,settings.customRounds||1) : settings.rounds
  };
  $("#timerTitle").textContent = (settings.name||"WORKOUT").toUpperCase();
  $("#finishBtn").classList.toggle("hidden", !["AMRAP","FOR TIME"].includes(mode));
  $("#skipBtn").classList.toggle("hidden", ["AMRAP","FOR TIME"].includes(mode));
  setPhaseColor("prep");
  show("timer");
  render();
  clearInterval(timer);
  timer = setInterval(tick,50);
  if(!settings.prep)beginFirstStep(); else speak("Prêt");
}
function beginFirstStep(){
  if(mode==="AMRAP"||mode==="FOR TIME"){
    state.phase = "WORK";
    state.remaining = mode==="AMRAP" ? settings.duration : Infinity;
  }else{
    const st = state.plan[0];
    if(!st)return finish();
    state.phase = st.phase; state.remaining = st.duration; state.round = st.round; state.blockLabel = st.label;
  }
  announceStep();
  render();
}
function advanceStep(){
  state.stepIndex++;
  const st = state.plan[state.stepIndex];
  if(!st)return finish();
  state.phase = st.phase; state.remaining = st.duration; state.round = st.round; state.blockLabel = st.label;
  announceStep();
}
function tick(){
  if(!state || state.paused)return;
  const n = performance.now(), dt = (n-state.last)/1000; state.last = n;
  if(state.phase==="PREP"){
    state.remaining -= dt;
    const secLeft = Math.ceil(state.remaining);
    if(secLeft<=3 && secLeft>=1 && state.lastCount!==secLeft){state.lastCount=secLeft;beep(520,.09);vib(25)}
    if(state.remaining<=0){
      beginFirstStep();
      state.showGo = true;
      setTimeout(()=>{if(state){state.showGo=false;render()}},550);
    }
  }else if(mode==="AMRAP"){
    state.elapsed += dt; state.remaining -= dt;
    if(state.remaining<=0)return finish();
  }else if(mode==="FOR TIME"){
    state.elapsed += dt;
    if(settings.cap>0 && state.elapsed>=settings.cap)return finish();
  }else{
    state.elapsed += dt; state.remaining -= dt;
    if(state.remaining<=0)advanceStep();
  }
  render();
}
function progressMax(){
  if(state.phase==="PREP")return null;
  if(mode==="AMRAP")return settings.duration;
  if(mode==="FOR TIME")return null;
  return state.plan[state.stepIndex]?.duration || 1;
}
function render(){
  if(!state)return;
  const showCountdown = state.phase==="PREP" && Math.ceil(state.remaining)<=3 && Math.ceil(state.remaining)>=1;
  $("#countdownDisplay").classList.toggle("hidden", !(showCountdown||state.showGo));
  $("#countdownDisplay").textContent = state.showGo ? "GO" : String(Math.max(1,Math.ceil(state.remaining)));
  $("#timeDisplay").classList.toggle("hidden", showCountdown||state.showGo);
  $("#phaseLabel").textContent = state.phase==="PREP" ? "PRÊT" : state.phase==="REST" ? "REPOS" : "EFFORT";
  $("#blockLabel").classList.toggle("hidden", !state.blockLabel || state.phase==="PREP");
  $("#blockLabel").textContent = state.blockLabel||"";
  $("#timeDisplay").textContent = (mode==="FOR TIME" && state.phase!=="PREP") ? fmt1(state.elapsed) : fmt(state.remaining);
  const showRounds = ["INTERVAL","TABATA","EMOM","CUSTOM"].includes(mode) && state.phase!=="PREP";
  $("#roundDisplay").textContent = showRounds ? `ROUND ${state.round} / ${state.totalRounds}` : "";
  $("#totalDisplay").textContent = mode==="FOR TIME" ? "" : `TOTAL ${fmt1(state.elapsed)}`;
  $("#pauseBtn").textContent = state.paused ? "▶" : "Ⅱ";
  const max = progressMax();
  $("#progressBar").style.width = max ? `${Math.max(0,Math.min(100,100*(1-state.remaining/max)))}%` : "0%";
}
function finish(){
  clearInterval(timer); timer=null;
  const totalSec = mode==="FOR TIME" ? state.elapsed : mode==="AMRAP" ? settings.duration : state.elapsed;
  $("#doneTitle").textContent = settings.name ? `${settings.name} — terminé` : "Workout terminé";
  $("#doneTime").textContent = fmt1(totalSec);
  const roundsInfo = ["INTERVAL","TABATA","EMOM","CUSTOM"].includes(mode) ? `${state.round} / ${state.totalRounds} rounds` : "";
  $("#doneSummary").textContent = [mode, roundsInfo].filter(Boolean).join(" · ");
  lastFinished = {mode, settings:{...settings}};
  show("done");
  speak("Bravo, workout terminé");
  beep(1000,.12); vib([60,50,120]);
}

/* ---------- static bindings ---------- */
$("#fabNew").onclick = () => openEditor(null);
$("#editorBack").onclick = () => {show("home"); renderHome()};
$("#editorFav").onclick = () => {settings.favorite=!settings.favorite; updateFavIcon()};
$("#saveBtn").onclick = () => {persistDraft(); show("home"); renderHome()};
$("#startBtn").onclick = start;
$("#duplicateBtn").onclick = () => {
  persistDraft();
  const src = workouts.find(w=>w.id===editingId);
  if(!src)return;
  const copy = {...src, id:Date.now(), name:`${src.name} (copie)`, favorite:false, createdAt:Date.now(), lastUsed:0, blocks:(src.blocks||[]).map(b=>({...b}))};
  workouts.unshift(copy);
  saveWorkouts();
  openEditor(copy);
};
$("#deleteBtn").onclick = () => {
  if(!editingId)return;
  if(!confirm("Supprimer ce workout ?"))return;
  workouts = workouts.filter(w=>w.id!==editingId);
  saveWorkouts();
  show("home"); renderHome();
};
$("#addBlockBtn").onclick = () => {settings.blocks.push({id:uid(),label:`Bloc ${settings.blocks.length+1}`,kind:"work",duration:30}); renderBlocks()};
$("#nameInput").oninput = e => settings.name = e.target.value;
document.querySelectorAll("[data-custom-round]").forEach(b=>b.onclick=()=>{
  settings.customRounds = Math.min(99,Math.max(1,(settings.customRounds||1)+ +b.dataset.customRound));
  $("#customRoundsValue").textContent = settings.customRounds;
});

document.querySelectorAll(".tab").forEach(t=>t.onclick=()=>{
  document.querySelectorAll(".tab").forEach(x=>x.classList.remove("active"));
  t.classList.add("active");
  currentTab = t.dataset.tab;
  renderHome();
});

$("#pauseBtn").onclick = () => {state.paused=!state.paused; state.last=performance.now(); render()};
$("#skipBtn").onclick = () => {if(state && state.phase!=="PREP")advanceStep()};
$("#finishBtn").onclick = finish;
$("#exitBtn").onclick = () => {clearInterval(timer); state=null; show("home"); renderHome()};
$("#doneBackBtn").onclick = () => {state=null; show("home"); renderHome()};
$("#doneRepeatBtn").onclick = () => {if(!lastFinished)return; mode=lastFinished.mode; settings={...defaultSettings(),...lastFinished.settings}; start()};
$("#soundBtn").onclick = () => {
  if(prefs.soundMode!=="off"){mutedBefore=prefs.soundMode; prefs.soundMode="off"; $("#soundBtn").textContent="🔇"}
  else{prefs.soundMode=mutedBefore||"both"; $("#soundBtn").textContent="🔊"; unlock()}
  savePrefs();
};

$("#settingsBtn").onclick = () => {
  populateVoices();
  $("#soundModeSelect").value = prefs.soundMode;
  $("#volumeSlider").value = Math.round(prefs.volume*100);
  $("#settingsOverlay").classList.remove("hidden");
};
$("#settingsClose").onclick = () => $("#settingsOverlay").classList.add("hidden");
$("#soundModeSelect").onchange = e => {prefs.soundMode = e.target.value; savePrefs()};
$("#voiceSelect").onchange = e => {prefs.voiceURI = e.target.value||null; savePrefs()};
$("#volumeSlider").oninput = e => {prefs.volume = +e.target.value/100; savePrefs()};

$("#exportBtn").onclick = () => {
  const blob = new Blob([JSON.stringify(workouts,null,2)],{type:"application/json"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "workout-timer-export.json"; a.click();
  URL.revokeObjectURL(url);
};
$("#importBtn").onclick = () => $("#importFile").click();
$("#importFile").onchange = async e => {
  const file = e.target.files[0];
  if(!file)return;
  try{
    const data = JSON.parse(await file.text());
    if(!Array.isArray(data))throw new Error("format");
    const imported = data.map(w=>({...defaultSettings(),...w,id:Date.now()+Math.floor(Math.random()*1000),createdAt:Date.now(),lastUsed:0,blocks:(w.blocks||[]).map(b=>({...b,id:uid()}))}));
    workouts = [...imported, ...workouts];
    saveWorkouts();
    renderHome();
    alert(`${imported.length} workout(s) importé(s).`);
  }catch{
    alert("Fichier invalide.");
  }
  e.target.value = "";
};

window.addEventListener("beforeinstallprompt", e => {e.preventDefault(); deferredPrompt=e; $("#installBtn").classList.remove("hidden")});
$("#installBtn").onclick = async () => {if(deferredPrompt){deferredPrompt.prompt(); await deferredPrompt.userChoice; deferredPrompt=null; $("#installBtn").classList.add("hidden")}};
document.addEventListener("visibilitychange", () => {if(state && !state.paused)state.last=performance.now()});
if("serviceWorker" in navigator)navigator.serviceWorker.register("sw.js").catch(()=>{});

renderHome();
