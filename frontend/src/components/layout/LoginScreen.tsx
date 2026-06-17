import { useEffect, useRef, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Brand } from "./Brand";
import { useAuthStore } from "@/stores/authStore";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const wavePalette = [
  "rgba(115, 139, 135, 0.36)",
  "rgba(158, 173, 162, 0.32)",
  "rgba(180, 154, 141, 0.27)",
  "rgba(159, 179, 187, 0.29)",
  "rgba(199, 208, 201, 0.36)",
];

function LayeredWaveBackground() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d", { alpha: true });
    if (!canvas || !ctx) return;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let width = 0;
    let height = 0;
    let frame = 0;
    let rafId = 0;

    const pointer = {
      x: 0.56,
      y: 0.42,
      tx: 0.56,
      ty: 0.42,
      active: 0,
      targetActive: 0,
    };
    const ripples: Array<{ x: number; y: number; t: number }> = [];
    const layerResponses = Array.from({ length: 7 }, () => ({ value: 0, target: 0 }));

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const setPointer = (clientX: number, clientY: number, active = 1) => {
      pointer.tx = Math.max(0, Math.min(1, clientX / Math.max(width, 1)));
      pointer.ty = Math.max(0, Math.min(1, clientY / Math.max(height, 1)));
      pointer.targetActive = active;
    };

    const pointerInfluence = (x: number, layer: number) => {
      const px = pointer.x * width;
      const dx = x - px;
      const reach = Math.max(130, width * 0.13);
      const horizontalFalloff = Math.exp(-(dx * dx) / (reach * reach));
      const drift = Math.sin((x - px) * 0.012 + layer * 0.9) * 1.4;
      const lift = 1 + Math.sin(layer * 1.7) * 0.22;
      return horizontalFalloff * layerResponses[layer].value * (6 + layer * 1.15) * lift + drift * layerResponses[layer].value;
    };

    const rippleInfluence = (x: number, layer: number, t: number) => {
      let total = 0;
      const base = height * (0.48 + layer * 0.072);

      for (const ripple of ripples) {
        const age = t - ripple.t;
        if (age < 0 || age > 2.1) continue;

        const layerDistance = Math.abs(base - ripple.y);
        const layerAffinity = Math.exp(-(layerDistance * layerDistance) / (height * height * 0.018));
        if (layerAffinity < 0.02) continue;

        const radius = age * 260;
        const dx = x - ripple.x;
        const dy = base - ripple.y;
        const distance = Math.hypot(dx, dy);
        const band = Math.exp(-((distance - radius) ** 2) / 2600);
        total += Math.sin(age * 8 - layer * 0.35) * band * layerAffinity * (1 - age / 2.1) * 7;
      }

      return total;
    };

    const waveY = (x: number, layer: number, t: number) => {
      const base = height * (0.48 + layer * 0.072);
      const long = Math.sin(x * (0.004 + layer * 0.00042) + t * (0.72 + layer * 0.04) + layer * 1.1);
      const close = Math.sin(x * (0.011 + layer * 0.00058) - t * (0.95 - layer * 0.05));
      const pull = Math.sin((x - width * 0.62) * 0.0028 + t * 0.48);
      return base
        + long * (38 + layer * 9)
        + close * (12 + layer * 2)
        + pull * 20
        + pointerInfluence(x, layer)
        + rippleInfluence(x, layer, t);
    };

    const drawLayer = (layer: number, t: number) => {
      const step = Math.max(18, width / 72);
      const top = height * 0.16;
      const bottom = height + 90;

      ctx.beginPath();
      ctx.moveTo(-40, bottom);
      for (let x = -40; x <= width + 40; x += step) ctx.lineTo(x, waveY(x, layer, t));
      ctx.lineTo(width + 40, bottom);
      ctx.closePath();

      const gradient = ctx.createLinearGradient(0, top, width, bottom);
      gradient.addColorStop(0, wavePalette[layer % wavePalette.length]);
      gradient.addColorStop(0.48, wavePalette[(layer + 2) % wavePalette.length]);
      gradient.addColorStop(1, "rgba(238, 241, 237, 0.12)");
      ctx.fillStyle = gradient;
      ctx.fill();

      ctx.beginPath();
      for (let x = -40; x <= width + 40; x += step) {
        const y = waveY(x, layer, t);
        if (x === -40) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = `rgba(65, 80, 80, ${0.08 + layer * 0.012 + layerResponses[layer].value * 0.025})`;
      ctx.lineWidth = 1;
      ctx.stroke();
    };

    const drawGoalStream = (t: number) => {
      const focalX = width * (0.56 + Math.sin(t * 0.34) * 0.08);
      const focalY = height * (0.42 + Math.cos(t * 0.28) * 0.06);

      ctx.save();
      ctx.globalCompositeOperation = "screen";
      for (let i = 0; i < 26; i += 1) {
        const progress = (t * 0.085 + i / 26) % 1;
        const angle = -0.58 + i * 0.046 + Math.sin(t * 0.4 + i) * 0.08;
        const distance = 90 + progress * Math.max(width, height) * 0.68;
        const x = focalX - Math.cos(angle) * distance;
        const y = focalY - Math.sin(angle) * distance * 0.38 + Math.sin(progress * Math.PI) * 34;
        const size = 1.3 + Math.sin(progress * Math.PI) * 2.8;
        ctx.beginPath();
        ctx.arc(x, y, size, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(246, 248, 242, ${0.12 + (1 - progress) * 0.2})`;
        ctx.fill();
      }

      const glowRadius = Math.min(width, height) * 0.34;
      const glow = ctx.createRadialGradient(focalX, focalY, 0, focalX, focalY, glowRadius);
      glow.addColorStop(0, "rgba(246, 248, 242, 0.2)");
      glow.addColorStop(0.42, "rgba(159, 179, 187, 0.12)");
      glow.addColorStop(1, "rgba(246, 248, 242, 0)");
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, width, height);
      ctx.restore();
    };

    const drawPointerTrace = (t: number) => {
      if (pointer.active < 0.03) return;
      const x = pointer.x * width;
      const y = pointer.y * height;

      ctx.save();
      ctx.globalCompositeOperation = "screen";
      const halo = ctx.createRadialGradient(x, y, 0, x, y, 120);
      halo.addColorStop(0, `rgba(246, 248, 242, ${0.12 * pointer.active})`);
      halo.addColorStop(0.36, `rgba(115, 139, 135, ${0.045 * pointer.active})`);
      halo.addColorStop(1, "rgba(246, 248, 242, 0)");
      ctx.fillStyle = halo;
      ctx.fillRect(0, 0, width, height);

      for (const ripple of ripples) {
        const age = t - ripple.t;
        if (age < 0 || age > 2.1) continue;
        ctx.beginPath();
        ctx.arc(ripple.x, ripple.y, age * 260, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(246, 248, 242, ${(1 - age / 2.1) * 0.09})`;
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }
      ctx.restore();
    };

    const updatePointer = () => {
      pointer.x += (pointer.tx - pointer.x) * 0.045;
      pointer.y += (pointer.ty - pointer.y) * 0.045;
      pointer.active += (pointer.targetActive - pointer.active) * 0.055;

      const py = pointer.y * height;
      for (let layer = 0; layer < layerResponses.length; layer += 1) {
        const layerY = height * (0.48 + layer * 0.072);
        const distance = Math.abs(py - layerY);
        const verticalReach = Math.max(44, height * 0.075);
        layerResponses[layer].target = Math.exp(-(distance * distance) / (verticalReach * verticalReach)) * pointer.active;
        layerResponses[layer].value += (layerResponses[layer].target - layerResponses[layer].value) * 0.035;
      }
    };

    const render = (now: number) => {
      frame = now * 0.001 * (reduceMotion.matches ? 0 : 1);
      updatePointer();
      while (ripples.length && frame - ripples[0].t > 2.5) ripples.shift();

      ctx.clearRect(0, 0, width, height);
      const wash = ctx.createLinearGradient(0, 0, width, height);
      wash.addColorStop(0, "rgba(238, 242, 236, 0.74)");
      wash.addColorStop(0.52, "rgba(243, 242, 237, 0.62)");
      wash.addColorStop(1, "rgba(226, 235, 232, 0.78)");
      ctx.fillStyle = wash;
      ctx.fillRect(0, 0, width, height);

      ctx.globalCompositeOperation = "multiply";
      for (let layer = 6; layer >= 0; layer -= 1) drawLayer(layer, frame);

      ctx.globalCompositeOperation = "source-over";
      drawPointerTrace(frame);
      drawGoalStream(frame);

      if (!reduceMotion.matches) rafId = requestAnimationFrame(render);
    };

    const start = () => {
      cancelAnimationFrame(rafId);
      resize();
      render(performance.now());
      if (!reduceMotion.matches) rafId = requestAnimationFrame(render);
    };

    const handlePointerMove = (event: PointerEvent) => setPointer(event.clientX, event.clientY, 1);
    const handlePointerLeave = () => {
      pointer.targetActive = 0;
    };
    const handlePointerDown = (event: PointerEvent) => {
      setPointer(event.clientX, event.clientY, 1);
      ripples.push({ x: event.clientX, y: event.clientY, t: frame });
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerleave", handlePointerLeave);
    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("resize", start);
    reduceMotion.addEventListener("change", start);
    start();

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerleave", handlePointerLeave);
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("resize", start);
      reduceMotion.removeEventListener("change", start);
    };
  }, []);

  return <canvas ref={canvasRef} className="absolute inset-0 size-full" aria-hidden="true" />;
}

interface PasswordInputProps {
  id: string;
  name?: string;
  placeholder?: string;
  autoComplete: string;
  value: string;
  className?: string;
  onChange: (value: string) => void;
  onKeyDown?: (event: React.KeyboardEvent<HTMLInputElement>) => void;
  onInput?: () => void;
}

function PasswordInput({
  id,
  name,
  placeholder,
  autoComplete,
  value,
  className,
  onChange,
  onKeyDown,
  onInput,
}: PasswordInputProps) {
  const [visible, setVisible] = useState(false);
  const Icon = visible ? EyeOff : Eye;

  return (
    <div className={cn("relative", className)}>
      <Input
        id={id}
        name={name}
        type={visible ? "text" : "password"}
        placeholder={placeholder}
        autoComplete={autoComplete}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
        onInput={onInput}
        className="pr-10"
      />
      <button
        type="button"
        aria-label={visible ? "隐藏密码" : "显示密码"}
        title={visible ? "隐藏密码" : "显示密码"}
        className="absolute right-2 top-1/2 inline-flex size-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => setVisible((current) => !current)}
      >
        <Icon className="size-4" />
      </button>
    </div>
  );
}

export function LoginScreen() {
  const { login, changePassword } = useAuthStore();

  const [loginName, setLoginName] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [loginBusy, setLoginBusy] = useState(false);

  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [changeLoginName, setChangeLoginName] = useState("");
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [changeBusy, setChangeBusy] = useState(false);

  const handleLogin = async () => {
    if (!loginName.trim() || !loginPassword.trim()) {
      setLoginError("请输入账号和密码");
      return;
    }
    setLoginBusy(true);
    setLoginError("");
    try {
      await login(loginName.trim(), loginPassword);
    } catch (error) {
      setLoginError(error instanceof Error ? error.message : "登录失败，请检查账号和密码");
      setLoginBusy(false);
    }
  };

  const handleChangePassword = async () => {
    if (!changeLoginName.trim() || !oldPassword || !newPassword) {
      toast.error("请填写完整信息");
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error("两次输入的新密码不一致");
      return;
    }
    setChangeBusy(true);
    try {
      await changePassword(changeLoginName.trim(), oldPassword, newPassword);
      toast.success("密码修改成功，请使用新密码登录");
      setShowPasswordForm(false);
      setOldPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "密码修改失败");
    } finally {
      setChangeBusy(false);
    }
  };

  const handleLoginKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") handleLogin();
    setLoginError("");
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center overflow-hidden bg-[radial-gradient(circle_at_22%_20%,rgba(180,154,141,0.22),transparent_34%),radial-gradient(circle_at_84%_12%,rgba(159,179,187,0.28),transparent_31%),linear-gradient(135deg,#e7ebe6_0%,#f3f2ed_46%,#e4ebe9_100%)] p-5">
      <LayeredWaveBackground />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(37,48,51,0.05)_1px,transparent_1px),linear-gradient(90deg,rgba(37,48,51,0.04)_1px,transparent_1px)] bg-[length:22px_22px] opacity-[0.18] mix-blend-multiply [mask-image:radial-gradient(circle_at_center,black_0%,transparent_76%)]" />
      <div className="relative w-full max-w-[420px] rounded-lg border border-[rgba(68,82,82,0.16)] bg-white/70 p-6 text-[#253033] shadow-[0_24px_70px_rgba(36,47,48,0.16)] backdrop-blur-[22px] backdrop-saturate-[1.02]">
        <div className="mb-5 flex justify-center">
          <Brand />
        </div>

        <Label htmlFor="loginName" className="mb-1 block text-sm">
          账号
        </Label>
        <Input
          id="loginName"
          name="login"
          placeholder="请输入账号"
          autoComplete="username"
          spellCheck={false}
          value={loginName}
          onChange={(event) => setLoginName(event.target.value)}
          onKeyDown={handleLoginKeyDown}
          onInput={() => setLoginError("")}
          className="mb-3 h-10 border-[rgba(72,86,87,0.2)] bg-white/60 focus-visible:border-[rgba(115,139,135,0.78)] focus-visible:bg-white/85 focus-visible:ring-[rgba(115,139,135,0.13)]"
        />

        <Label htmlFor="loginPassword" className="mb-1 block text-sm">
          密码
        </Label>
        <PasswordInput
          id="loginPassword"
          name="password"
          placeholder="请输入密码"
          autoComplete="current-password"
          value={loginPassword}
          onChange={setLoginPassword}
          onKeyDown={handleLoginKeyDown}
          onInput={() => setLoginError("")}
          className="mb-3 [&_input]:h-10 [&_input]:border-[rgba(72,86,87,0.2)] [&_input]:bg-white/60 [&_input]:focus-visible:border-[rgba(115,139,135,0.78)] [&_input]:focus-visible:bg-white/85 [&_input]:focus-visible:ring-[rgba(115,139,135,0.13)]"
        />

        {loginError && <p className="mb-3 text-sm text-destructive">{loginError}</p>}

        <Button className="mb-2 w-full" onClick={handleLogin} disabled={loginBusy}>
          {loginBusy ? "登录中..." : "登录"}
        </Button>

        <Button
          variant="link"
          className="w-full text-muted-foreground"
          onClick={() => {
            setShowPasswordForm(!showPasswordForm);
            if (!showPasswordForm) {
              setChangeLoginName(loginName);
            }
          }}
        >
          修改登录密码
        </Button>

        {showPasswordForm && (
          <div className="mt-3 space-y-3 border-t border-border pt-3 animate-fade-in">
            <Label htmlFor="changeLoginName" className="block text-sm">
              账号
            </Label>
            <Input
              id="changeLoginName"
              autoComplete="username"
              spellCheck={false}
              value={changeLoginName}
              onChange={(event) => setChangeLoginName(event.target.value)}
            />

            <Label htmlFor="oldPassword" className="block text-sm">
              旧密码
            </Label>
            <PasswordInput
              id="oldPassword"
              autoComplete="current-password"
              value={oldPassword}
              onChange={setOldPassword}
            />

            <Label htmlFor="newPassword" className="block text-sm">
              新密码
            </Label>
            <PasswordInput
              id="newPassword"
              autoComplete="new-password"
              value={newPassword}
              onChange={setNewPassword}
            />

            <Label htmlFor="confirmPassword" className="block text-sm">
              确认新密码
            </Label>
            <PasswordInput
              id="confirmPassword"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={setConfirmPassword}
            />

            <Button className="w-full" onClick={handleChangePassword} disabled={changeBusy}>
              {changeBusy ? "保存中..." : "保存新密码"}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
