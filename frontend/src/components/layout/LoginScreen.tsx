import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Brand } from "./Brand";
import { useAuthStore } from "@/stores/authStore";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

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
    <div className="fixed inset-0 z-50 grid place-items-center bg-[#eef2f7]">
      <div className="w-full max-w-[420px] rounded-lg border border-border bg-card p-6 shadow-app">
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
          className="mb-3"
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
          className="mb-3"
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
