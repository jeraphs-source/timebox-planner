import React, { useEffect, useState } from "react";
import { initializeApp } from "firebase/app";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
} from "firebase/auth";

import {
  getFirestore,
  doc,
  setDoc,
  getDoc,
} from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyDIEPk5rt_1MyP_uCSKk2ppySackEPYkGg",
  authDomain: "timebox-5d286.firebaseapp.com",
  projectId: "timebox-5d286",
  storageBucket: "timebox-5d286.firebasestorage.app",
  messagingSenderId: "144812873208",
  appId: "1:144812873208:web:c55f3a386fb492cca1720d"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

function today() {
  return new Date().toISOString().slice(0, 10);
}

export default function App() {
  const [user, setUser] = useState(null);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    return onAuthStateChanged(auth, async (u) => {
      setUser(u);

      if (u) {
        const ref = doc(db, "users", u.uid, "plans", today());
        const snap = await getDoc(ref);

        if (snap.exists()) {
          setText(snap.data().text || "");
        }
      }

      setLoading(false);
    });
  }, []);

  async function login() {
    const provider = new GoogleAuthProvider();
    await signInWithPopup(auth, provider);
  }

  async function logout() {
    await signOut(auth);
  }

  async function save() {
    if (!user) return;

    await setDoc(
      doc(db, "users", user.uid, "plans", today()),
      {
        text,
        updatedAt: new Date().toISOString(),
      },
      { merge: true }
    );

    alert("저장 완료");
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-2xl font-bold">
        불러오는 중...
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100 p-6">
      <div className="max-w-4xl mx-auto bg-white rounded-3xl shadow p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-4xl font-black">
              TimeBox Planner
            </h1>

            <p className="text-slate-500 mt-2">
              날짜별 기록이 자동 저장됩니다
            </p>
          </div>

          <div>
            {!user ? (
              <button
                onClick={login}
                className="bg-blue-600 text-white px-4 py-2 rounded-2xl font-bold"
              >
                Google 로그인
              </button>
            ) : (
              <div className="flex items-center gap-3">
                <div className="text-sm text-slate-500">
                  {user.email}
                </div>

                <button
                  onClick={logout}
                  className="bg-slate-200 px-4 py-2 rounded-2xl font-bold"
                >
                  로그아웃
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="mb-3 font-bold">
          오늘 기록 ({today()})
        </div>

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="오늘 계획 / 업무 / 회고 등을 자유롭게 기록하세요"
          className="w-full min-h-[500px] rounded-2xl border border-slate-300 p-4 outline-none"
        />

        <div className="mt-4">
          <button
            onClick={save}
            disabled={!user}
            className="bg-black text-white px-6 py-3 rounded-2xl font-bold disabled:bg-slate-300"
          >
            저장
          </button>
        </div>
      </div>
    </div>
  );
}
