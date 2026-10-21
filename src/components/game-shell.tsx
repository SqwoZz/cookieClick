'use client';
import {
  ADMIN_PASSWORD,
  COOKIE_EMOJIS,
  COOKIE_SIZES,
  NAME_STORAGE_KEY,
  costOf,
  format,
  formatRate,
  MULTIPLIERS,
  perClick,
  perSecond,
  plural,
  totalUpgrades,
  UPGRADES,
  useClickerGame,
  type CookieSize,
  type GameState,
  type Upgrade,
} from "@/components/clicker-logic";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { WelcomeGate } from "@/components/welcome-gate";
import { cn } from "@/lib/utils";
import { validateDisplayName } from "@/lib/name-filter";
import {
  BarChart3,
  Coins,
  Cookie,
  Database,
  Gamepad2,
  LoaderCircle,
  LogIn,
  Plus,
  RefreshCw,
  RotateCcw,
  Settings,
  Shield,
  Trash2,
  Trophy,
  User,
  Zap,
} from "lucide-react";
import { useTheme } from "next-themes";
import { useCallback, useEffect, useState } from "react";

// 🔊 Звук клика
let audioContext: AudioContext | null = null;
function playClickSound() {
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!audioContext) audioContext = new AudioCtx();
    if (audioContext.state === 'suspended') audioContext.resume();
    const o = audioContext.createOscillator();
    const g = audioContext.createGain();
    o.connect(g); g.connect(audioContext.destination);
    o.frequency.value = 600 + Math.random() * 300;
    o.type = "sine";
    g.gain.setValueAtTime(0.25, audioContext.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.08);
    o.start(audioContext.currentTime);
    o.stop(audioContext.currentTime + 0.08);
  } catch {}
}

// 🔐 Конфиг
const GIST_API = "/api/gist-sync";
const SESSION_TOKEN_KEY = "game_session_token";

// Типы данных
type GistData = {
  users: Record<string, {
    passwordHash: string;
    progress: Partial<GameState>;
    createdAt: number;
  }>;
};

// Сессия
function getSessionToken() {
  try { return localStorage.getItem(SESSION_TOKEN_KEY); } catch { return null; }
}
function setSessionToken(token: string | null) {
  try {
    if (token) localStorage.setItem(SESSION_TOKEN_KEY, token);
    else localStorage.removeItem(SESSION_TOKEN_KEY);
  } catch {}
}

// Хеширование пароля
async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(password + "your-secret-salt-here");
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("");
}

// 📋 Форма входа
function LoginGate({ onSuccess }: { onSuccess: (username: string) => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [isNew, setIsNew] = useState(false); // ← было const, теперь useState

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setIsNew(false);

    const trimmedUser = username.trim();
    const trimmedPass = password.trim();

    if (!trimmedUser || !trimmedPass) {
      setError("Заполни оба поля");
      return;
    }

    setLoading(true);
    try {
      // Получаем данные из гиста
      const res = await fetch(`${GIST_API}?action=read`);
      if (!res.ok) throw new Error("Не удалось подключиться к облаку");
      
      const data: GistData = await res.json();
      if (!data.users) data.users = {};

      const userRecord = data.users[trimmedUser];
      const passHash = await hashPassword(trimmedPass);

      if (userRecord) {
        // Проверка пароля
        if (userRecord.passwordHash !== passHash) {
          throw new Error("Неверный пароль");
        }
      } else {
        // Создаём нового пользователя
        data.users[trimmedUser] = {
          passwordHash: passHash,
          progress: {},
          createdAt: Date.now()
        };
        setIsNew(true); // ← теперь работает корректно
        
        // Сохраняем в гист
        const saveRes = await fetch(GIST_API, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "write", data })
        });
        if (!saveRes.ok) throw new Error("Не удалось создать аккаунт");
      }

      // Создаём сессию
      const token = btoa(`${trimmedUser}:${Date.now()}`);
      setSessionToken(token);
      localStorage.setItem(NAME_STORAGE_KEY, trimmedUser);
      
      setTimeout(() => onSuccess(trimmedUser), isNew ? 800 : 100);
    } catch (err: any) {
      setError(err.message || "Ошибка соединения");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="animate-panel-in mx-auto max-w-sm pt-10">
      <form onSubmit={handleSubmit}
        className="space-y-4 rounded-2xl border bg-card p-6 text-center shadow-sm"
      >
        <span className="mx-auto grid size-12 place-items-center rounded-full bg-secondary">
          <User className="size-5" aria-hidden />
        </span>
        <div>
          <h2 className="text-lg font-semibold">
            {isNew ? "✅ Аккаунт создан!" : "Вход в игру"}
          </h2>
          {!isNew && (
            <p className="mt-1 text-sm text-muted-foreground">
              Введи данные — если аккаунта нет, создастся автоматически
            </p>
          )}
        </div>

        {isNew ? (
          <p className="text-green-500 text-sm">Данные сохранены в облаке! Подключаемся...</p>
        ) : (
          <>
            <div className="space-y-2 text-left">
              <label className="text-sm font-medium">Юзернейм</label>
              <Input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Введи юзернейм"
                disabled={loading}
                autoComplete="username"
              />
            </div>
            <div className="space-y-2 text-left">
              <label className="text-sm font-medium">Пароль</label>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Введи пароль"
                disabled={loading}
                autoComplete="current-password"
              />
            </div>

            {error && <p className="text-red-500 text-sm">{error}</p>}

            <Button type="submit" disabled={loading} className="w-full">
              {loading
                ? <LoaderCircle className="size-4 animate-spin mr-2" />
                : <LogIn className="size-4 mr-2" />}
              {loading ? "Подключение к облаку..." : "Войти / Создать"}
            </Button>
          </>
        )}
      </form>
    </section>
  );
}

// Основной компонент
export default function GameShell() {
  const [user, setUser] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);

  // Проверка сессии
  useEffect(() => {
    const token = getSessionToken();
    if (token) {
      try {
        const [savedUser] = atob(token).split(":");
        if (savedUser) {
          setUser(savedUser);
          localStorage.setItem(NAME_STORAGE_KEY, savedUser);
        }
      } catch {}
    }
    setChecking(false);
  }, []);

  const handleLogout = () => {
    setSessionToken(null);
    setUser(null);
    localStorage.removeItem(NAME_STORAGE_KEY);
  };

  if (checking) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <LoaderCircle className="size-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!user) {
    return <LoginGate onSuccess={setUser} />;
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="p-4">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Database className="size-5 text-green-500" />
            Игра — облачное хранилище
          </h1>
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground">👤 {user}</span>
            <Button variant="secondary" size="sm" onClick={handleLogout}>
              Выйти
            </Button>
          </div>
        </div>
        <WelcomeGate />
      </div>
    </main>
  );
}
