"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { ArrowRight, UserRound } from "lucide-react";

import { addChatContact, createOrGetSession, hydrateChatStorage } from "@/lib/chat-storage";
import { createCharacter, loadCharacters, saveCharacters } from "@/lib/character-storage";

export function FirstCharacterOnboarding({ children }: { children: ReactNode }) {
  const [needsCharacter, setNeedsCharacter] = useState(() => loadCharacters().length === 0);
  const [name, setName] = useState("");
  const [persona, setPersona] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleanName = name.trim();
    const cleanPersona = persona.trim();
    if (!cleanName || !cleanPersona || busy) return;
    setBusy(true);
    try {
      await hydrateChatStorage();
      const character = createCharacter({
        name: cleanName,
        persona: cleanPersona,
        personality: cleanPersona,
        avatar: null,
        tags: [],
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
      saveCharacters([character]);
      addChatContact(character.id);
      createOrGetSession(character.id);
      setNeedsCharacter(false);
    } finally {
      setBusy(false);
    }
  }

  if (!needsCharacter) return children;
  return (
    <main className="app-root account-gate-root">
      <section className="account-gate-card" aria-label="创建第一个角色">
        <div className="account-gate-copy">
          <span>FIRST CHARACTER</span>
          <h1>你想遇见谁？</h1>
          <p>先创建一个角色，之后可以在角色 App 里继续完善。</p>
        </div>
        <form className="account-gate-form" onSubmit={submit}>
          <label>
            <span>角色名字</span>
            <input value={name} onChange={(event) => setName(event.target.value)} maxLength={40} placeholder="例如：林晚" autoFocus />
          </label>
          <label>
            <span>一句设定</span>
            <textarea value={persona} onChange={(event) => setPersona(event.target.value)} maxLength={500} placeholder="例如：外冷内热的摄影师，喜欢雨天和旧唱片。" />
          </label>
          <button type="submit" disabled={busy || !name.trim() || !persona.trim()}>
            <UserRound size={18} />
            <span>{busy ? "正在创建" : "开始使用"}</span>
            {!busy && <ArrowRight size={17} />}
          </button>
        </form>
      </section>
    </main>
  );
}
