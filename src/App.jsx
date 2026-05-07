import React, { useEffect, useMemo, useRef, useState } from "react";
import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut } from "firebase/auth";
import { doc, getDoc, getFirestore, serverTimestamp, setDoc } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyDIEPk5rt_1MyP_uCSKk2ppySackEPYkGg",
  authDomain: "timebox-5d286.firebaseapp.com",
  projectId: "timebox-5d286",
  storageBucket: "timebox-5d286.firebasestorage.app",
  messagingSenderId: "144812873208",
  appId: "1:144812873208:web:c55f3a386fb492cca1720d",
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const provider = new GoogleAuthProvider();

function todayString() {
  const d = new Date();
  const offset = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - offset).toISOString().slice(0, 10);
}

function addDays(dateString, days) {
  const d = new Date(`${dateString}T00:00:00`);
  d.setDate(d.getDate() + days);
  const offset = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - offset).toISOString().slice(0, 10);
}

function makeSlots() {
  const slots = [];
  for (let h = 9; h <= 22; h += 1) {
    slots.push(`${String(h).padStart(2, "0")}:00`);
    if (h !== 22) slots.push(`${String(h).padStart(2, "0")}:30`);
  }
  return slots;
}

const OLD_BRAIN_DUMP_TEMPLATE = "• 오늘 떠오르는 일을 모두 적어두세요\n• 줄바꿈된 내용을 복사해서 Plan/Do 칸에 붙여넣을 수 있습니다\n• 예: 오전 진료 준비\n• 예: 보호자 연락\n• 예: 퇴근 전 정산 확인";

const BRAIN_DUMP_PLACEHOLDER = "• 오늘 떠오르는 일을 모두 적어두세요\n• 줄바꿈된 내용을 복사해서 Plan/Do 칸에 붙여넣을 수 있습니다.";

function isOnlyBrainDumpGuideText(value) {
  if (!value || typeof value !== "string") return false;

  const normalized = value
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");

  const oldNormalized = OLD_BRAIN_DUMP_TEMPLATE
    .split("\n")
    .map((line) => line.trim())
    .join("\n");

  const placeholderNormalized = BRAIN_DUMP_PLACEHOLDER
    .split("\n")
    .map((line) => line.trim())
    .join("\n");

  return (
    normalized === oldNormalized ||
    normalized === placeholderNormalized ||
    (
      normalized.includes("오늘 떠오르는 일을 모두 적어두세요") &&
      normalized.includes("줄바꿈된 내용을 복사해서 Plan/Do 칸에 붙여넣을 수 있습니다") &&
      normalized.includes("예: 오전 진료 준비") &&
      normalized.includes("예: 보호자 연락") &&
      normalized.includes("예: 퇴근 전 정산 확인")
    )
  );
}

function emptyDay() {
  return {
    priorities: Array.from({ length: 7 }, () => ({ text: "", done: false })),
    brainDump: "",
    reflection: "",
    plans: Array.from({ length: 27 }, () => ""),
    dos: Array.from({ length: 27 }, () => ""),
    completed: Array.from({ length: 27 }, () => false),
  };
}

function mergeDay(value) {
  const base = emptyDay();
  if (!value || typeof value !== "object") return base;
  const cleanedBrainDump = isOnlyBrainDumpGuideText(value.brainDump) ? "" : value.brainDump;
  return {
    ...base,
    ...value,
    brainDump: cleanedBrainDump || "",
    priorities: Array.from({ length: 7 }, (_, i) => value.priorities?.[i] || base.priorities[i]),
    plans: Array.from({ length: 27 }, (_, i) => value.plans?.[i] || ""),
    dos: Array.from({ length: 27 }, (_, i) => value.dos?.[i] || ""),
    completed: Array.from({ length: 27 }, (_, i) => Boolean(value.completed?.[i])),
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeLines(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*[•◦▪\-]\s*/, "").trim())
    .filter(Boolean);
}

function classNames(...items) {
  return items.filter(Boolean).join(" ");
}

export default function App() {
  const slots = useMemo(() => makeSlots(), []);
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [date, setDate] = useState(todayString());
  const [data, setData] = useState(emptyDay());
  const [dayLoaded, setDayLoaded] = useState(false);
  const [saveStatus, setSaveStatus] = useState("로그인 필요");
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [history, setHistory] = useState([]);
  const [dragPayload, setDragPayload] = useState(null);
  const [selectedRows, setSelectedRows] = useState(new Set());
  const saveTimer = useRef(null);
  const justLoaded = useRef(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setAuthLoading(false);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) {
      setDayLoaded(false);
      setData(emptyDay());
      setSaveStatus("로그인 필요");
      return;
    }

    let cancelled = false;

    async function loadDay() {
      setDayLoaded(false);
      setSaveStatus("불러오는 중...");
      setSelectedRows(new Set());

      try {
        const ref = doc(db, "users", user.uid, "dailyPlans", date);
        const snapshot = await getDoc(ref);
        if (cancelled) return;

        justLoaded.current = true;
        setData(snapshot.exists() ? mergeDay(snapshot.data()) : emptyDay());
        setDayLoaded(true);
        setSaveStatus("자동 저장 켜짐");
      } catch (error) {
        if (cancelled) return;
        console.error(error);
        setDayLoaded(true);
        setSaveStatus("불러오기 실패: Firestore 규칙 확인 필요");
      }
    }

    loadDay();

    return () => {
      cancelled = true;
    };
  }, [user, date]);

  useEffect(() => {
    if (!user || !dayLoaded) return;

    if (justLoaded.current) {
      justLoaded.current = false;
      return;
    }

    if (saveTimer.current) clearTimeout(saveTimer.current);

    saveTimer.current = setTimeout(async () => {
      try {
        setSaveStatus("저장 중...");
        const ref = doc(db, "users", user.uid, "dailyPlans", date);
        const dataToSave = {
          ...data,
          brainDump: isOnlyBrainDumpGuideText(data.brainDump) ? "" : data.brainDump,
          updatedAt: serverTimestamp(),
        };
        await setDoc(ref, dataToSave, { merge: true });
        setSaveStatus("저장됨");
        setTimeout(() => setSaveStatus("자동 저장 켜짐"), 1200);
      } catch (error) {
        console.error(error);
        setSaveStatus("저장 실패: Firestore 규칙 확인 필요");
      }
    }, 1000);

    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [data, user, date, dayLoaded]);

  useEffect(() => {
    const updateCurrentTime = () => {
      if (date !== todayString()) {
        setCurrentIndex(-1);
        return;
      }
      const now = new Date();
      const h = now.getHours();
      const m = now.getMinutes();
      if (h < 9 || h > 22) {
        setCurrentIndex(-1);
        return;
      }
      setCurrentIndex(Math.min(26, (h - 9) * 2 + (m >= 30 ? 1 : 0)));
    };
    updateCurrentTime();
    const id = window.setInterval(updateCurrentTime, 60000);
    return () => window.clearInterval(id);
  }, [date]);

  useEffect(() => {
    const onKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        undo();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [history]);

  const completedPriorityCount = data.priorities.filter((p) => p.done).length;
  const progress = Math.round((completedPriorityCount / 7) * 100);
  const weekday = new Intl.DateTimeFormat("ko-KR", { weekday: "long" }).format(new Date(`${date}T00:00:00`));

  function pushHistory() {
    setHistory((prev) => [...prev.slice(-39), clone(data)]);
  }

  function undo() {
    setHistory((prev) => {
      if (!prev.length) return prev;
      const last = prev[prev.length - 1];
      setData(last);
      return prev.slice(0, -1);
    });
  }

  async function login() {
    try {
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error(error);
      setSaveStatus("로그인 실패");
    }
  }

  async function logout() {
    await signOut(auth);
  }

  function updatePriority(index, patch) {
    setData((prev) => {
      const priorities = [...prev.priorities];
      priorities[index] = { ...priorities[index], ...patch };
      return { ...prev, priorities };
    });
  }

  function updatePlan(index, value) {
    setData((prev) => {
      const plans = [...prev.plans];
      plans[index] = value;
      return { ...prev, plans };
    });
  }

  function updateDo(index, value) {
    setData((prev) => {
      const dos = [...prev.dos];
      dos[index] = value;
      return { ...prev, dos };
    });
  }

  function toggleCompleted(index) {
    pushHistory();
    setData((prev) => {
      const completed = [...prev.completed];
      completed[index] = !completed[index];
      return { ...prev, completed };
    });
  }

  function shiftDown(index) {
    pushHistory();
    setData((prev) => {
      const plans = [...prev.plans];
      const completed = [...prev.completed];
      for (let i = plans.length - 1; i > index; i -= 1) {
        plans[i] = plans[i - 1];
        completed[i] = completed[i - 1];
      }
      plans[index] = "";
      completed[index] = false;
      return { ...prev, plans, completed };
    });
  }

  function clearDay() {
    if (!window.confirm("오늘 기록을 모두 비울까요?")) return;
    pushHistory();
    setData(emptyDay());
  }

  function pasteIntoPriority(e, index) {
    const text = e.clipboardData.getData("text");
    if (!text.includes("\n")) return;
    e.preventDefault();
    pushHistory();
    const lines = normalizeLines(text);
    setData((prev) => {
      const priorities = [...prev.priorities];
      lines.forEach((line, offset) => {
        if (index + offset < 7) priorities[index + offset] = { ...priorities[index + offset], text: line };
      });
      return { ...prev, priorities };
    });
  }

  function pasteIntoTimeBox(e, index, target) {
    const text = e.clipboardData.getData("text");
    if (!text.includes("\n")) return;
    e.preventDefault();
    pushHistory();
    const lines = normalizeLines(text);
    setData((prev) => {
      const arr = target === "plan" ? [...prev.plans] : [...prev.dos];
      lines.forEach((line, offset) => {
        if (index + offset < arr.length) arr[index + offset] = line;
      });
      return target === "plan" ? { ...prev, plans: arr } : { ...prev, dos: arr };
    });
  }

  function onDragStart(type, index, text) {
    if (!text) return;
    setDragPayload({ type, index, text });
  }

  function onDrop(target, index) {
    if (!dragPayload?.text) return;
    pushHistory();
    setData((prev) => {
      const next = clone(prev);
      if (target === "priority") next.priorities[index].text = dragPayload.text;
      if (target === "plan") next.plans[index] = dragPayload.text;
      if (target === "do") next.dos[index] = dragPayload.text;

      const sameCell = dragPayload.type === target && dragPayload.index === index;
      const keepOriginal = dragPayload.type === "priority" && target !== "priority";
      if (!sameCell && !keepOriginal) {
        if (dragPayload.type === "priority") next.priorities[dragPayload.index] = { text: "", done: false };
        if (dragPayload.type === "plan") {
          next.plans[dragPayload.index] = "";
          next.completed[dragPayload.index] = false;
        }
        if (dragPayload.type === "do") next.dos[dragPayload.index] = "";
      }
      return next;
    });
    setDragPayload(null);
  }

  function toggleRow(index) {
    setSelectedRows((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  function clearSelectedPlans() {
    if (!selectedRows.size) return;
    pushHistory();
    setData((prev) => {
      const plans = [...prev.plans];
      const completed = [...prev.completed];
      selectedRows.forEach((i) => {
        plans[i] = "";
        completed[i] = false;
      });
      return { ...prev, plans, completed };
    });
    setSelectedRows(new Set());
  }

  function copyText() {
    const text = [
      `Today Plan - ${date}`,
      "",
      "Top 7 Priorities",
      ...data.priorities.map((p, i) => `${i + 1}. ${p.done ? "[완료]" : "[ ]"} ${p.text || "-"}`),
      "",
      "Time Box",
      ...slots.map((slot, i) => `${slot}\tPlan: ${data.plans[i] || "-"}\tDo: ${data.dos[i] || "-"}`),
      "",
      "Brain Dump",
      data.brainDump || "-",
      "",
      "Reflection",
      data.reflection || "-",
    ].join("\n");
    navigator.clipboard?.writeText(text);
    setSaveStatus("클립보드에 복사됨");
  }

  if (authLoading) {
    return <div className="min-h-screen bg-slate-100 p-8 text-center text-xl font-bold">로그인 상태 확인 중...</div>;
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-slate-100 p-4 text-slate-900">
        <div className="mx-auto mt-20 max-w-md rounded-3xl bg-white p-8 text-center shadow-sm">
          <div className="text-sm font-bold text-slate-500">✨ TimeBoxing Planner</div>
          <h1 className="mt-2 text-4xl font-black">Today Plan</h1>
          <p className="mt-3 text-sm leading-6 text-slate-500">Google 계정으로 로그인하면 날짜별 플래너가 클라우드에 저장됩니다.</p>
          <button onClick={login} className="mt-8 w-full rounded-2xl bg-blue-600 px-5 py-3 font-bold text-white hover:bg-blue-700">
            Google 로그인
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100 p-4 text-slate-900 print:bg-white print:p-0">
      <div className="mx-auto max-w-7xl space-y-4 print:max-w-none">
        <header className="rounded-3xl bg-white p-5 shadow-sm print:rounded-none print:shadow-none">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="text-sm font-bold text-slate-500">✨ TimeBoxing Planner</div>
              <h1 className="mt-1 text-4xl font-black tracking-tight md:text-5xl">Today Plan</h1>
              <p className="mt-2 text-sm text-slate-500">우선순위 → 시간 배치 → 실행 기록 → 회고 순서로 하루를 정리합니다.</p>
              <div className="mt-3 flex flex-wrap gap-2 text-xs font-bold print:hidden">
                <span className="rounded-full bg-emerald-100 px-3 py-1 text-emerald-700">클라우드 동기화 모드</span>
                <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-600">{user.email}</span>
                <span className="rounded-full bg-slate-900 px-3 py-1 text-white">💾 {saveStatus}</span>
              </div>
            </div>

            <div className="flex flex-col gap-3 lg:items-end print:hidden">
              <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-slate-50 p-2">
                <button className="rounded-xl px-3 py-2 font-black hover:bg-white" onClick={() => setDate(addDays(date, -1))}>‹</button>
                <input className="rounded-xl bg-white px-3 py-2 text-sm font-bold outline-none shadow-sm" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
                <button className="rounded-xl px-3 py-2 font-black hover:bg-white" onClick={() => setDate(addDays(date, 1))}>›</button>
              </div>

              <div className="flex flex-wrap justify-end gap-2 text-sm">
                <button className="rounded-full bg-white px-3 py-1.5 font-bold shadow-sm hover:bg-slate-50" onClick={undo}>↩ 실행 취소</button>
                <button className="rounded-full bg-white px-3 py-1.5 font-bold shadow-sm hover:bg-slate-50" onClick={copyText}>📋 복사</button>
                <button className="rounded-full bg-white px-3 py-1.5 font-bold shadow-sm hover:bg-slate-50" onClick={() => window.print()}>🖨 인쇄</button>
                <button className="rounded-full bg-rose-50 px-3 py-1.5 font-bold text-rose-700 hover:bg-rose-100" onClick={clearDay}>🗑 초기화</button>
                <button className="rounded-full bg-slate-100 px-3 py-1.5 font-bold text-slate-700 hover:bg-slate-200" onClick={logout}>로그아웃</button>
              </div>
            </div>
          </div>
        </header>

        <main className={classNames("grid gap-4 lg:grid-cols-[380px_1fr] print:grid-cols-[330px_1fr]", !dayLoaded && "opacity-60")}>
          <section className="space-y-4">
            <div className="rounded-3xl bg-white p-5 shadow-sm print:rounded-none print:shadow-none">
              <div className="mb-4 flex items-end justify-between">
                <div>
                  <h2 className="text-xl font-black">Top 7 Priorities</h2>
                  <p className="text-sm text-slate-500">오늘 반드시 챙길 핵심 업무 7개</p>
                </div>
                <span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-black">{completedPriorityCount}/7</span>
              </div>

              <div className="mb-4 h-2 overflow-hidden rounded-full bg-slate-100 print:hidden">
                <div className="h-full rounded-full bg-slate-900 transition-all" style={{ width: `${progress}%` }} />
              </div>

              <div className="space-y-2">
                {data.priorities.map((item, index) => (
                  <div
                    key={index}
                    draggable={Boolean(item.text)}
                    onDragStart={() => onDragStart("priority", index, item.text)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => onDrop("priority", index)}
                    className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-2 transition hover:border-slate-300 print:rounded-none print:bg-white"
                  >
                    <button
                      onClick={() => {
                        pushHistory();
                        updatePriority(index, { done: !item.done });
                      }}
                      className={classNames(
                        "grid h-7 w-7 shrink-0 place-items-center rounded-xl border text-sm font-black",
                        item.done ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-white text-transparent"
                      )}
                    >
                      ✓
                    </button>
                    <input
                      value={item.text}
                      onPaste={(e) => pasteIntoPriority(e, index)}
                      onChange={(e) => updatePriority(index, { text: e.target.value })}
                      placeholder={`${index + 1}. 우선순위 입력`}
                      className={classNames(
                        "min-w-0 flex-1 bg-transparent text-sm font-semibold outline-none placeholder:text-slate-300",
                        item.done && "text-slate-400 line-through"
                      )}
                    />
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-3xl bg-white p-5 shadow-sm print:rounded-none print:shadow-none">
              <h2 className="text-xl font-black">Brain Dump</h2>
              <p className="mb-3 text-sm text-slate-500">생각나는 일을 먼저 쏟아낸 뒤, 복사해서 시간표에 붙여넣으세요.</p>
              <textarea
                value={data.brainDump}
                onChange={(e) => setData((prev) => ({ ...prev, brainDump: e.target.value }))}
                placeholder={BRAIN_DUMP_PLACEHOLDER}
                className="min-h-56 w-full resize-y rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm leading-6 outline-none focus:border-slate-400 placeholder:text-slate-400 print:min-h-40 print:rounded-none print:bg-white"
              />
            </div>

            <div className="rounded-3xl bg-white p-5 shadow-sm print:rounded-none print:shadow-none">
              <h2 className="text-xl font-black">Daily Reflection</h2>
              <p className="mb-3 text-sm text-slate-500">오늘 잘한 점, 미룬 이유, 내일로 넘길 일을 정리합니다.</p>
              <textarea
                value={data.reflection}
                onChange={(e) => setData((prev) => ({ ...prev, reflection: e.target.value }))}
                placeholder="예: 오전 진료가 길어져 행정업무가 밀림. 내일 10:00에 먼저 처리."
                className="min-h-40 w-full resize-y rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm leading-6 outline-none focus:border-slate-400 print:min-h-32 print:rounded-none print:bg-white"
              />
            </div>
          </section>

          <section className="rounded-3xl bg-white p-5 shadow-sm print:rounded-none print:p-3 print:shadow-none">
            <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-end md:justify-between print:mb-2">
              <div>
                <h2 className="text-2xl font-black">Time Box</h2>
                <p className="text-sm text-slate-500">{date} · {weekday} · 09:00부터 22:00까지 30분 단위</p>
              </div>
              <div className="flex gap-2 print:hidden">
                <button
                  onClick={clearSelectedPlans}
                  className="rounded-full bg-slate-100 px-3 py-1.5 text-sm font-bold hover:bg-slate-200 disabled:opacity-40"
                  disabled={!selectedRows.size}
                >
                  선택 계획 삭제
                </button>
              </div>
            </div>

            <div className="overflow-hidden rounded-2xl border border-slate-200 print:rounded-none">
              <div className="grid grid-cols-[82px_1fr_1fr_76px] bg-slate-900 text-sm font-black text-white print:grid-cols-[70px_1fr_1fr_54px]">
                <div className="px-3 py-3">시간</div>
                <div className="px-3 py-3">Plan</div>
                <div className="px-3 py-3">Do</div>
                <div className="px-3 py-3 text-center">완료</div>
              </div>

              {slots.map((slot, index) => (
                <div
                  key={slot}
                  className={classNames(
                    "relative grid grid-cols-[82px_1fr_1fr_76px] border-t border-slate-200 print:grid-cols-[70px_1fr_1fr_54px]",
                    currentIndex === index && "bg-rose-50",
                    selectedRows.has(index) && "bg-sky-50"
                  )}
                >
                  {currentIndex === index && <div className="absolute left-0 right-0 top-0 h-0.5 bg-rose-500 print:hidden" />}

                  <button
                    onClick={() => toggleRow(index)}
                    className="flex items-center justify-center border-r border-slate-200 px-2 py-2 text-xs font-black text-slate-500 hover:bg-slate-50 print:pointer-events-none"
                    title="행 선택"
                  >
                    {slot}
                  </button>

                  <div
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => onDrop("plan", index)}
                    className="flex min-h-11 items-center gap-1 border-r border-slate-200 px-2 py-1 print:min-h-8"
                  >
                    <input
                      draggable={Boolean(data.plans[index])}
                      onDragStart={() => onDragStart("plan", index, data.plans[index])}
                      value={data.plans[index]}
                      onPaste={(e) => pasteIntoTimeBox(e, index, "plan")}
                      onChange={(e) => updatePlan(index, e.target.value)}
                      placeholder="계획"
                      className={classNames(
                        "min-w-0 flex-1 bg-transparent text-sm font-semibold outline-none placeholder:text-slate-300",
                        data.completed[index] && "text-slate-400 line-through"
                      )}
                    />
                    <button
                      onClick={() => shiftDown(index)}
                      className="rounded-lg px-1.5 py-1 text-xs font-black text-slate-400 hover:bg-slate-100 hover:text-slate-900 print:hidden"
                      title="이 시간 이후 계획을 30분씩 미루기"
                    >
                      ↓
                    </button>
                  </div>

                  <div
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => onDrop("do", index)}
                    className="flex min-h-11 items-center border-r border-slate-200 px-2 py-1 print:min-h-8"
                  >
                    <input
                      draggable={Boolean(data.dos[index])}
                      onDragStart={() => onDragStart("do", index, data.dos[index])}
                      value={data.dos[index]}
                      onPaste={(e) => pasteIntoTimeBox(e, index, "do")}
                      onChange={(e) => updateDo(index, e.target.value)}
                      placeholder="실행 기록"
                      className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-slate-300"
                    />
                  </div>

                  <div className="grid place-items-center px-2 py-1">
                    <button
                      onClick={() => toggleCompleted(index)}
                      className={classNames(
                        "grid h-8 w-8 place-items-center rounded-xl border text-sm font-black transition print:h-6 print:w-6",
                        data.completed[index] ? "border-emerald-600 bg-emerald-600 text-white" : "border-slate-200 bg-white text-slate-300 hover:border-slate-400"
                      )}
                    >
                      ✓
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
